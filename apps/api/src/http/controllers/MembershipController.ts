import type { Request, Response } from "express";
import type { MembershipService } from "../../domain/services/MembershipService.ts";
import { requireAuth } from "../context.ts";
import { ok } from "../response.ts";
import { acceptInvitationByTokenSchema, inviteMemberSchema, parse, transferOwnershipSchema, updateMemberRoleSchema, uuid } from "../validate.ts";

/** Project members and invitations (both the inviting and the invited side). */
export class MembershipController {
  constructor(private readonly membership: MembershipService) {}

  // ---- /projects/:projectUuid/invitations ---------------------------------

  listInvitations = async (req: Request, res: Response) => {
    const { actor } = requireAuth(req);
    ok(res, await this.membership.listInvitations(actor, parse(uuid, req.params.projectUuid)));
  };

  invite = async (req: Request, res: Response) => {
    const { actor } = requireAuth(req);
    const input = parse(inviteMemberSchema, req.body);
    ok(res, await this.membership.invite(actor, parse(uuid, req.params.projectUuid), input), 201);
  };

  revokeInvitation = async (req: Request, res: Response) => {
    const { actor } = requireAuth(req);
    ok(res, await this.membership.revokeInvitation(actor, parse(uuid, req.params.projectUuid), parse(uuid, req.params.invitationUuid)));
  };

  // ---- /projects/:projectUuid/members -------------------------------------

  updateRole = async (req: Request, res: Response) => {
    const { actor } = requireAuth(req);
    const input = parse(updateMemberRoleSchema, req.body);
    ok(res, await this.membership.changeRole(actor, parse(uuid, req.params.projectUuid), parse(uuid, req.params.memberUuid), input.role));
  };

  remove = async (req: Request, res: Response) => {
    const { actor } = requireAuth(req);
    ok(res, await this.membership.removeMember(actor, parse(uuid, req.params.projectUuid), parse(uuid, req.params.memberUuid)));
  };

  transfer = async (req: Request, res: Response) => {
    const { actor } = requireAuth(req);
    const input = parse(transferOwnershipSchema, req.body);
    ok(res, await this.membership.transferOwnership(actor, parse(uuid, req.params.projectUuid), input.memberUuid));
  };

  leave = async (req: Request, res: Response) => {
    const { actor } = requireAuth(req);
    await this.membership.leave(actor, parse(uuid, req.params.projectUuid));
    ok(res, null);
  };

  // ---- /invitations (signed-in invitee) -----------------------------------

  mine = async (req: Request, res: Response) => {
    const { actor } = requireAuth(req);
    ok(res, await this.membership.myInvitations(actor));
  };

  accept = async (req: Request, res: Response) => {
    const { actor } = requireAuth(req);
    ok(res, await this.membership.accept(actor, parse(uuid, req.params.invitationUuid)));
  };

  acceptByToken = async (req: Request, res: Response) => {
    const { actor } = requireAuth(req);
    const input = parse(acceptInvitationByTokenSchema, req.body);
    ok(res, await this.membership.acceptByToken(actor, input.token));
  };

  decline = async (req: Request, res: Response) => {
    const { actor } = requireAuth(req);
    await this.membership.decline(actor, parse(uuid, req.params.invitationUuid));
    ok(res, null);
  };
}
