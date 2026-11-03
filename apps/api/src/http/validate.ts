import { z } from "zod";
import { ACTIVITY_TYPES, normalizePhaseColor, SECTION_KINDS, TASK_STATUSES, type ActivityType, type SectionKind, type TaskStatus } from "@scope/contracts";
import { ValidationError } from "../domain/errors.ts";

/**
 * Request validation (the equivalent of Laravel Form Requests). Schemas live
 * next to the controllers that use them; `parse` converts Zod issues into the
 * API's field-error format.
 */
export function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input ?? {});
  if (result.success) return result.data;
  throw new ValidationError(
    result.error.issues.map((issue) => ({ field: issue.path.join(".") || "_", message: issue.message })),
  );
}

function literals<T extends string>(values: readonly T[]): [T, ...T[]] {
  return values as [T, ...T[]];
}

// ---- shared primitives ----------------------------------------------------

export const uuid = z.uuid({ error: "Invalid identifier." });
export const isoDate = z.iso.date({ error: "Use the YYYY-MM-DD format." });
export const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: "Enter a valid email address." }).max(191));
export const password = z.string().min(8, { error: "Use at least 8 characters." }).max(200);
export const nullableDate = isoDate.nullable();

// ---- auth -----------------------------------------------------------------

export const registerSchema = z.object({
  name: z.string().trim().min(2, { error: "Enter your name." }).max(120),
  email,
  password,
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1, { error: "Enter your password." }).max(200),
});

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z.object({
  token: z.string().min(16).max(200),
  password,
});

export const updateProfileSchema = z
  .object({
    name: z.string().trim().min(2, { error: "Enter your name." }).max(120).optional(),
    email: email.optional(),
  })
  .refine((v) => v.name !== undefined || v.email !== undefined, { error: "Nothing to update.", path: ["_"] });

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, { error: "Enter your current password." }).max(200),
  newPassword: password,
});

// ---- projects & checklists -------------------------------------------------

export const createProjectSchema = z.object({
  name: z.string().trim().min(2, { error: "Enter a project name." }).max(160),
  description: z.string().trim().max(2000).optional(),
  startDate: nullableDate.optional(),
  deadline: nullableDate.optional(),
});

const projectStatus = z.enum(["active", "completed", "archived"]);

export const updateProjectSchema = z
  .object({
    name: z.string().trim().min(2, { error: "Enter a project name." }).max(160).optional(),
    description: z.string().trim().max(2000).optional(),
    startDate: nullableDate.optional(),
    deadline: nullableDate.optional(),
    status: projectStatus.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { error: "Nothing to update.", path: ["_"] });

const sectionKind = z.enum(literals<SectionKind>(SECTION_KINDS));

export const createSectionSchema = z.object({
  title: z.string().trim().min(1, { error: "Enter a title." }).max(160),
  description: z.string().trim().max(2000).nullable().optional(),
  kind: sectionKind.optional(),
  phaseUuid: uuid.nullable().optional(),
  revisionDate: nullableDate.optional(),
});

export const updateSectionSchema = z
  .object({
    title: z.string().trim().min(1, { error: "Enter a title." }).max(160).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    kind: sectionKind.optional(),
    phaseUuid: uuid.nullable().optional(),
    revisionDate: nullableDate.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { error: "Nothing to update.", path: ["_"] });

export const reorderSectionsSchema = z.object({
  orderedSectionUuids: z.array(uuid).min(1).max(500),
});

const phaseColor = z
  .string()
  .trim()
  .min(1, { error: "Choose a colour." })
  .max(20)
  .refine((value) => normalizePhaseColor(value) !== null, { error: "Use a named colour or a #rrggbb hex code." })
  .transform((value) => normalizePhaseColor(value)!);

export const createPhaseSchema = z.object({
  title: z.string().trim().min(1, { error: "Enter a phase title." }).max(160),
  color: phaseColor.optional(),
});

export const updatePhaseSchema = z
  .object({
    title: z.string().trim().min(1, { error: "Enter a phase title." }).max(160).optional(),
    color: phaseColor.optional(),
  })
  .strict()
  .refine((v) => v.title !== undefined || v.color !== undefined, { error: "Nothing to update.", path: ["_"] });

export const reorderPhasesSchema = z.object({
  orderedPhaseUuids: z.array(uuid).min(1).max(500),
});

const priority = z.enum(["low", "medium", "high"]);
const status = z.enum(literals<TaskStatus>(TASK_STATUSES));

export const createTaskSchema = z.object({
  sectionUuid: uuid,
  title: z.string().trim().min(1, { error: "Enter a task title." }).max(255),
  description: z.string().trim().max(5000).nullable().optional(),
  dueDate: nullableDate.optional(),
  priority: priority.optional(),
  assigneeUuid: uuid.nullable().optional(),
});

export const updateTaskSchema = z
  .object({
    title: z.string().trim().min(1, { error: "Enter a task title." }).max(255).optional(),
    description: z.string().trim().max(5000).nullable().optional(),
    dueDate: nullableDate.optional(),
    priority: priority.optional(),
    assigneeUuid: uuid.nullable().optional(),
    sectionUuid: uuid.optional(),
    status: status.optional(),
    developerChecked: z.boolean().optional(),
    clientChecked: z.boolean().optional(),
  })
  .strict();

export const reorderTasksSchema = z.object({
  sectionUuid: uuid,
  orderedTaskUuids: z.array(uuid).max(1000),
});

export const addCommentSchema = z.object({
  body: z.string().trim().min(1, { error: "Write a comment." }).max(5000),
});

export const activityQuerySchema = z.object({
  project: uuid.optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  // Paged mode (any of these present → `data` is one page, paging in `meta`).
  page: z.coerce.number().int().min(1).optional(),
  perPage: z.coerce.number().int().min(1).max(100).optional(),
  type: z.enum(literals<ActivityType>(ACTIVITY_TYPES)).optional(),
});

// ---- membership & invitations ---------------------------------------------

const memberRole = z.enum(["editor", "viewer"]);

export const inviteMemberSchema = z.object({
  email,
  role: memberRole,
});

export const updateMemberRoleSchema = z.object({ role: memberRole }).strict();

export const transferOwnershipSchema = z.object({ memberUuid: uuid });

export const acceptInvitationByTokenSchema = z.object({ token: z.string().min(16).max(200) });

// ---- administration -------------------------------------------------------

const pageParams = {
  page: z.coerce.number().int().min(1).optional(),
  perPage: z.coerce.number().int().min(1).max(100).optional(),
};

export const pageQuerySchema = z.object(pageParams);

export const adminUserQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  role: z.enum(["all", "admin", "user"]).optional(),
  status: z.enum(["all", "active", "disabled"]).optional(),
  ...pageParams,
});

export const adminUpdateUserSchema = z
  .object({
    name: z.string().trim().min(2, { error: "Enter a name." }).max(120).optional(),
    email: email.optional(),
    role: z.enum(["admin", "user"]).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { error: "Nothing to update.", path: ["_"] });

export const adminProductivityQuerySchema = z.object({
  period: z.enum(["7d", "30d", "90d", "all"]).optional(),
});

export const adminProjectQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  status: z.enum(["all", "active", "completed", "archived", "deleted"]).optional(),
  ...pageParams,
});

export const adminErrorQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  source: z.enum(["all", "api", "web"]).optional(),
  ...pageParams,
});

// ---- error reporting --------------------------------------------------------

/** What the web app may send about a client-side failure. Sizes are capped; the repository caps again. */
export const clientErrorReportSchema = z
  .object({
    message: z.string().trim().min(1, { error: "A message is required." }).max(2000),
    name: z.string().trim().max(80).optional(),
    stack: z.string().max(8000).optional(),
    path: z.string().max(2048).optional(),
    context: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

// ---- export ---------------------------------------------------------------

export const createExportSchema = z
  .object({
    sectionUuids: z.array(uuid).min(1, { error: "Select at least one scope or revision to include." }).max(500).optional(),
    includeDescriptions: z.boolean().optional(),
    includeCheckDetails: z.boolean().optional(),
    /** Accepted for backward compatibility with older clients; the document no longer has a signature area. */
    includeSignature: z.boolean().optional(),
    includeChart: z.boolean().optional(),
    templateUuid: uuid.optional(),
    timeZone: z.string().trim().min(1).max(64).optional(),
  })
  .strict();
