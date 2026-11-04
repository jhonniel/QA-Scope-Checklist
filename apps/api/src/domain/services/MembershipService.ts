import type { InviteMemberInput, Project, ProjectInvitation, ProjectMemberRole } from "@scope/contracts";
import type { Database, Queryable } from "../../db/database.ts";
import { ConflictError, DomainError, ForbiddenError, NotFoundError, ValidationError } from "../errors.ts";
import { toInvitation, type Actor, type InvitationRow, type MemberRow, type ProjectRow } from "../models.ts";
import { repositories, type Repositories } from "../repositories/index.ts";
import type { MailService } from "./MailService.ts";
import { generateToken, hashToken } from "./password.ts";
import { assertCanManage, type ProjectService } from "./ProjectService.ts";

export interface MembershipServiceOptions {
  appUrl: string;
  mail: MailService;
}

/**
 * Invitations and membership. Inviting, changing roles, removing members and
 * transferring ownership are owner/admin actions; accepting or declining an
 * invitation belongs to the invitee; any non-owner member may leave.
 *
 * Invitations are never deleted — they are closed as accepted, declined or
 * revoked so the history stays auditable.
 */
export class MembershipService {
  constructor(
    private readonly db: Database,
    private readonly projects: ProjectService,
    private readonly options: MembershipServiceOptions,
  ) {}

  // ---- invitations (project side) -----------------------------------------

  async listInvitations(actor: Actor, projectUuid: string): Promise<ProjectInvitation[]> {
    const { project, access } = await this.projects.requireViewable(actor, projectUuid);
    assertCanManage(access);
    return (await repositories(this.db).invitations.listByProject(project.id)).map(toInvitation);
  }

  async invite(actor: Actor, projectUuid: string, input: InviteMemberInput): Promise<ProjectInvitation> {
    const email = input.email.trim().toLowerCase();
    const { invitation, project, token } = await this.db.transaction(async (tx) => {
      const { project, access } = await this.projects.requireViewable(actor, projectUuid, tx);
      assertCanManage(access);
      const repos = repositories(tx);

      const existingUser = await repos.users.findByEmail(email);
      if (existingUser && (await repos.projects.memberRole(project.id, existingUser.id))) {
        throw new ValidationError([{ field: "email", message: "That person is already a member of this project." }]);
      }
      if (await repos.invitations.findPending(project.id, email)) {
        throw new ValidationError([{ field: "email", message: "An invitation for this e-mail is already pending." }]);
      }

      const token = generateToken();
      const invitation = await repos.invitations.create({ projectId: project.id, email, role: input.role, invitedBy: actor.id, tokenHash: hashToken(token) });
      await repos.activity.record({ projectId: project.id, actorId: actor.id, action: "member.invited", subject: email, meta: { role: input.role } });
      return { invitation, project, token };
    });
    // Mail goes out after the transaction committed so a delivery failure never rolls back the invitation.
    await this.sendInvitationMail(project, email, token, actor);
    return toInvitation(invitation);
  }

  async revokeInvitation(actor: Actor, projectUuid: string, invitationUuid: string): Promise<ProjectInvitation> {
    return this.db.transaction(async (tx) => {
      const { project, access } = await this.projects.requireViewable(actor, projectUuid, tx);
      assertCanManage(access);
      const repos = repositories(tx);
      const invitation = await repos.invitations.findByUuid(invitationUuid);
      if (!invitation || invitation.project_id !== project.id) throw new NotFoundError("Invitation");
      if (invitation.status !== "pending") throw new ConflictError("This invitation has already been answered.");
      const updated = await repos.invitations.setStatus(invitation.id, "revoked");
      await repos.activity.record({ projectId: project.id, actorId: actor.id, action: "member.invitation_revoked", subject: invitation.email });
      return toInvitation(updated);
    });
  }

  // ---- invitations (invitee side) ------------------------------------------

  /** Pending invitations addressed to the signed-in user's e-mail. */
  async myInvitations(actor: Actor): Promise<ProjectInvitation[]> {
    const repos = repositories(this.db);
    const user = await repos.users.findById(actor.id);
    if (!user) return [];
    return (await repos.invitations.listPendingForEmail(user.email)).map(toInvitation);
  }

  /** Accept by uuid (from the in-app list). Returns the now-visible project. */
  async accept(actor: Actor, invitationUuid: string): Promise<Project> {
    return this.db.transaction(async (tx) => {
      const repos = repositories(tx);
      const invitation = await this.requireOwnPendingInvitation(repos, actor, await repos.invitations.findByUuid(invitationUuid));
      return this.acceptRow(repos, actor, invitation, tx);
    });
  }

  /** Accept by the e-mailed token. The signed-in account must match the invited e-mail. */
  async acceptByToken(actor: Actor, token: string): Promise<Project> {
    return this.db.transaction(async (tx) => {
      const repos = repositories(tx);
      const row = await repos.invitations.findPendingByTokenHash(hashToken(token));
      if (!row) throw new DomainError(400, "invalid_token", "This invitation link is invalid, has expired or was already used.");
      const invitation = await this.requireOwnPendingInvitation(repos, actor, row);
      return this.acceptRow(repos, actor, invitation, tx);
    });
  }

  async decline(actor: Actor, invitationUuid: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const repos = repositories(tx);
      const invitation = await this.requireOwnPendingInvitation(repos, actor, await repos.invitations.findByUuid(invitationUuid));
      await repos.invitations.setStatus(invitation.id, "declined");
      await repos.activity.record({ projectId: invitation.project_id, actorId: actor.id, action: "member.invitation_declined", subject: invitation.email });
    });
  }

  // ---- members -------------------------------------------------------------

  async changeRole(actor: Actor, projectUuid: string, memberUuid: string, role: Exclude<ProjectMemberRole, "owner">): Promise<Project> {
    return this.db.transaction(async (tx) => {
      const { project, access } = await this.projects.requireViewable(actor, projectUuid, tx);
      assertCanManage(access);
      const repos = repositories(tx);
      const member = await this.requireMember(repos, project, memberUuid);
      if (member.role === "owner") throw new ConflictError("Transfer ownership to change the owner's role.");
      if (member.role !== role) {
        await repos.projects.updateMemberRole(member.id!, role);
        await repos.activity.record({ projectId: project.id, actorId: actor.id, action: "member.role_changed", subject: member.u_name, meta: { from: member.role, to: role } });
      }
      return (await this.projects.hydrate([project], tx))[0];
    });
  }

  /** Owner/admin removes another member. */
  async removeMember(actor: Actor, projectUuid: string, memberUuid: string): Promise<Project> {
    return this.db.transaction(async (tx) => {
      const { project, access } = await this.projects.requireViewable(actor, projectUuid, tx);
      const repos = repositories(tx);
      const member = await this.requireMember(repos, project, memberUuid);
      if (member.user_id === actor.id) throw new ConflictError("Use “Leave project” to remove yourself.");
      assertCanManage(access);
      if (member.role === "owner") throw new ConflictError("The owner cannot be removed. Transfer ownership first.");
      await repos.projects.removeMember(member.id!);
      await repos.activity.record({ projectId: project.id, actorId: actor.id, action: "member.removed", subject: member.u_name, meta: { role: member.role } });
      return (await this.projects.hydrate([project], tx))[0];
    });
  }

  /** Any non-owner member leaves on their own. */
  async leave(actor: Actor, projectUuid: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const { project } = await this.projects.requireViewable(actor, projectUuid, tx);
      const repos = repositories(tx);
      const member = await repos.projects.findMemberByUser(project.id, actor.id);
      if (!member) throw new ForbiddenError("You are not a member of this project.");
      if (member.role === "owner") throw new ConflictError("Owners cannot leave. Transfer ownership first.");
      await repos.projects.removeMember(member.id!);
      await repos.activity.record({ projectId: project.id, actorId: actor.id, action: "member.left", subject: member.u_name, meta: { role: member.role } });
    });
  }

  /** Owner/admin hands the project to another member; the previous owner becomes an editor. */
  async transferOwnership(actor: Actor, projectUuid: string, memberUuid: string): Promise<Project> {
    return this.db.transaction(async (tx) => {
      const { project, access } = await this.projects.requireViewable(actor, projectUuid, tx);
      assertCanManage(access);
      const repos = repositories(tx);
      const target = await this.requireMember(repos, project, memberUuid);
      if (target.role === "owner") throw new ConflictError("That member already owns the project.");

      const currentOwner = await repos.projects.findMemberByUser(project.id, project.owner_id);
      if (currentOwner) await repos.projects.updateMemberRole(currentOwner.id!, "editor");
      await repos.projects.updateMemberRole(target.id!, "owner");
      await repos.projects.setOwner(project.id, target.user_id!);
      await repos.activity.record({ projectId: project.id, actorId: actor.id, action: "project.ownership_transferred", subject: project.name, meta: { to: target.u_name } });

      const refreshed = await repos.projects.findById(project.id);
      return (await this.projects.hydrate([refreshed!], tx))[0];
    });
  }

  // ---- helpers -------------------------------------------------------------

  private async requireMember(repos: Repositories, project: ProjectRow, memberUuid: string): Promise<MemberRow> {
    const member = await repos.projects.findMemberByUuid(project.id, memberUuid);
    if (!member) throw new NotFoundError("Member");
    return member;
  }

  /** The invitation must exist, be pending and be addressed to the actor's e-mail. */
  private async requireOwnPendingInvitation(repos: Repositories, actor: Actor, row: InvitationRow | null): Promise<InvitationRow> {
    if (!row) throw new NotFoundError("Invitation");
    const user = await repos.users.findById(actor.id);
    if (!user || user.email.toLowerCase() !== row.email.toLowerCase()) {
      throw new ForbiddenError(`This invitation was sent to ${row.email}. Sign in with that account to accept it.`);
    }
    if (row.status !== "pending") throw new ConflictError("This invitation is no longer open.");
    return row;
  }

  private async acceptRow(repos: Repositories, actor: Actor, invitation: InvitationRow, tx: Queryable): Promise<Project> {
    const project = await repos.projects.findById(invitation.project_id);
    if (!project) throw new NotFoundError("Project");
    const existing = await repos.projects.memberRole(project.id, actor.id);
    if (!existing) {
      await repos.projects.addMember(project.id, actor.id, invitation.role === "editor" ? "editor" : "viewer");
    }
    await repos.invitations.setStatus(invitation.id, "accepted");
    const user = await repos.users.findById(actor.id);
    await repos.activity.record({ projectId: project.id, actorId: actor.id, action: "member.joined", subject: `${user?.name ?? "A member"} joined as ${invitation.role}`, meta: { role: invitation.role } });
    return (await this.projects.hydrate([project], tx))[0];
  }

  private async sendInvitationMail(project: ProjectRow, email: string, token: string, actor: Actor): Promise<void> {
    const inviter = await repositories(this.db).users.findById(actor.id);
    const link = `${this.options.appUrl.replace(/\/$/, "")}/invitations/${token}`;
    await this.options.mail.send({
      to: email,
      subject: `${inviter?.name ?? "Someone"} invited you to “${project.name}” on Scope Checklist`,
      text: `${inviter?.name ?? "Someone"} invited you to collaborate on the project “${project.name}”.\n\nOpen the link below to accept. If you do not have an account yet, register with this e-mail address first — an administrator must approve new accounts before you can sign in.\n\n${link}\n\nIf you were not expecting this, you can ignore this message.`,
    });
  }
}
