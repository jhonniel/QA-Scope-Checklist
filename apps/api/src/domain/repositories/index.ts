import type { Queryable } from "../../db/database.ts";
import { ActivityRepository } from "./ActivityRepository.ts";
import { AdminAuditRepository } from "./AdminAuditRepository.ts";
import { CommentRepository } from "./CommentRepository.ts";
import { ErrorLogRepository, type ErrorLogInput } from "./ErrorLogRepository.ts";
import { ExportTemplateRepository } from "./ExportTemplateRepository.ts";
import { InvitationRepository } from "./InvitationRepository.ts";
import { PasswordResetRepository } from "./PasswordResetRepository.ts";
import { ProjectRepository } from "./ProjectRepository.ts";
import { SectionRepository } from "./SectionRepository.ts";
import { SessionRepository } from "./SessionRepository.ts";
import { StatsRepository } from "./StatsRepository.ts";
import { TaskRepository } from "./TaskRepository.ts";
import { UserRepository } from "./UserRepository.ts";

export interface Repositories {
  users: UserRepository;
  sessions: SessionRepository;
  passwordResets: PasswordResetRepository;
  projects: ProjectRepository;
  sections: SectionRepository;
  tasks: TaskRepository;
  comments: CommentRepository;
  activity: ActivityRepository;
  invitations: InvitationRepository;
  exportTemplates: ExportTemplateRepository;
  adminAudit: AdminAuditRepository;
  errorLogs: ErrorLogRepository;
  stats: StatsRepository;
}

/** Bind every repository to one connection (or transaction). */
export function repositories(db: Queryable): Repositories {
  return {
    users: new UserRepository(db),
    sessions: new SessionRepository(db),
    passwordResets: new PasswordResetRepository(db),
    projects: new ProjectRepository(db),
    sections: new SectionRepository(db),
    tasks: new TaskRepository(db),
    comments: new CommentRepository(db),
    activity: new ActivityRepository(db),
    invitations: new InvitationRepository(db),
    exportTemplates: new ExportTemplateRepository(db),
    adminAudit: new AdminAuditRepository(db),
    errorLogs: new ErrorLogRepository(db),
    stats: new StatsRepository(db),
  };
}

export type { ErrorLogInput };
export {
  ActivityRepository,
  AdminAuditRepository,
  CommentRepository,
  ErrorLogRepository,
  ExportTemplateRepository,
  InvitationRepository,
  PasswordResetRepository,
  ProjectRepository,
  SectionRepository,
  SessionRepository,
  StatsRepository,
  TaskRepository,
  UserRepository,
};
