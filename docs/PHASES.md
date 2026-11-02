# Development phases

| Phase | Scope                                   | Status        |
| ----- | --------------------------------------- | ------------- |
| 1     | Foundation and design system            | **Complete**  |
| 2     | Database and authentication             | **Complete**  |
| 3     | Projects and checklist management (API) | **Complete**  |
| 4     | Sharing and collaboration               | **Complete**  |
| 5     | DOCX export                             | **Complete**  |
| 6     | Admin dashboard                         | **Complete**  |
| 7     | Testing and production readiness        | Complete      |

## Phase 1 — Foundation and design system (complete)

Delivered a responsive, interactive frontend prototype on mock data.

**Project structure**
- npm-workspace monorepo: `apps/web`, `packages/contracts`.
- Vite 6 build compiling React 19 (primary) and Vue 3 (scoped modules) together.
- Path aliases, strict TypeScript, typecheck + build scripts.

**Design system** (`apps/web/src/design-system`)
- Tokens: one accent (electric indigo), ink/grey neutrals, radii, shadows, motion, layout sizes.
- Primitives: `Button`, `Badge`, `Checkbox` (animated), `Input`/`Textarea`/`Select`, `MemberAvatar`/`AvatarStack`, `ProgressBar`/`ProgressRing`, `Skeleton`, `EmptyState`, `Card`, `Breadcrumbs`, `SearchInput`, `SegmentedControl`, `BentoGrid`/`BentoCard`, `BottomSheet`, `ConfirmDialog`.

**Layout and navigation**
- Desktop: sidebar with project switcher, top bar with breadcrumbs/search/profile, scrollable main.
- Mobile: compact top bar with back control, bottom navigation, full-width sheets.
- "Slide to drill in" page transitions; "rise for task" sheet; reduced-motion support.

**Modules**
- Dashboard: bento grid (overview + ring, stats, upcoming deadlines, recent activity, sections, members), project switcher, export entry point.
- Projects: list with status filter + search, project cards, create-project sheet, project workspace with progress strip, filters, section cards, quick-add, add section, members and export actions.
- Checklist: task rows laid out like the scope document (Checked by Developer / Client ticks · item · Remarks status chip), drag-and-drop reorder (Framer `Reorder`), section drill-in page, task detail sheet (title, Remarks status picker, Checked-by log with who/when per tick, description, due date, priority, assignee, move section, comments, delete with confirmation).
- Task status model: 11 Remarks statuses (`TASK_STATUSES`), colour-coded; progress counts resolved statuses (Done, Done (For Production), Completed, Not Applicable). Each tick records the acting user and timestamp; ticks and status changes are written to the activity log.
- Collaboration: members card, manage-members sheet (invite form prototype), Vue `ActivityFeed` module, Activity page.
- Export: preview sheet rendering the default document template as HTML — the "Checked by (Developer | Client) / Item Description / Remarks" table, ticks with logged date/time and name, numbered sections, status chips, signature area — with section selection and options (download wired in Phase 5).
- Auth: profile page layout.

## Phase 2 — Database and authentication (complete)

Delivered a functional application with authenticated users against a real database.

**Backend** (`apps/api`, Node 22+ / Express 5 / TypeScript)
- Layered: `routes` → `controllers` (thin) → `services` (business rules) → `repositories` (SQL) → `db` drivers. Request validation with zod schemas (Form-Request equivalent); `DomainError` hierarchy mapped to the `{ success, data | error }` envelope; no stack traces leave the process.
- Database abstraction with two drivers: built-in `node:sqlite` (zero-install development default) and `mysql2` (MySQL 8 / MariaDB). Plain-SQL migrations in MySQL syntax with dialect tokens, a `migrations` ledger, auto-migrate on boot.
- Migrations: `users`, `sessions`, `password_resets`, `projects`, `project_members`, `project_invitations`, `checklist_sections`, `tasks` (status + developer/client checked-by/at), `task_comments`, `activity_logs`, `export_templates` — standard SQL types, integer PKs, unique `uuid`s, FKs, soft deletes, indexes.
- Seeder reproducing the Phase 1 fixtures (same uuids, 4 users, 4 projects, 11 sections, 42 tasks, comments, activity); every seeded account's password is `password`. `db:migrate`, `db:seed`, `db:fresh` scripts; seeding/dropping refuse to run in production.
- Authentication: registration, login, logout, current user, profile update, change password (revokes other sessions), forgot/reset password through a `MailService` (console mailer in development). Sessions are httpOnly `SameSite=Lax` cookies whose tokens are stored hashed with sliding expiry; scrypt password hashing; login throttling; CSRF via Origin allow-list / `X-Requested-With`.
- Authorization: `admin`/`user` system roles; `owner`/`editor`/`viewer` project roles. Admins see everything; others see only projects they belong to (404 otherwise); viewers are read-only except comments. "Checked by" ticks are stamped with the acting session user and server time.
- REST API for auth, projects, sections, tasks (create, update, soft delete, reorder), comments and activity. Public identifiers are uuids only.

**Frontend**
- `ScopeApi` extended with auth methods; `httpApi` (fetch, cookie credentials, envelope → `ApiError`, 401 → session reset) selected by `VITE_API_URL`; the mock implementation still satisfies the contract so the UI runs without a server.
- Vite dev proxy `/api → http://localhost:4000`; `.env.development` points the app at the API.
- Store: `bootState` gains `unauthenticated`; `login`, `register`, `logout`, `updateProfile`, `changePassword`, `resetSession`; optimistic mutations unchanged.
- Auth pages in `modules/auth`: Login (with `?next=` return and post-reset notice), Register, Forgot password, Reset password; shared `AuthLayout`, `FormAlert`, `useFormSubmit` (duplicate-submit guard, inline server field errors, values preserved on failure).
- Route guards (`app/guards.tsx`): `RequireAuth` around the app shell (splash / retry / redirect), `RedirectIfAuthenticated` around public pages.
- Profile page wired: save name, change password sheet, sign out with confirmation.
- Viewer role honoured in the UI (`lib/permissions.ts`): ticks, status, fields, quick-add, add-section, reorder and delete are disabled/hidden for viewers; commenting stays available.

**Verified**
- `npm run typecheck` and `npm run build` pass for both workspaces; the bundled `dist/server.js` boots and serves `/api/health`.
- 45-check API smoke run (health, CSRF, throttled/invalid login, validation 422 with fields, register/duplicate, login/me/logout, project visibility per role, viewer 403 vs comment 201, hidden project 404, admin access, create project → owner + General section, task create/tick/status/strict-body/delete, comments, activity feed, profile/password, forgot/reset).
- Browser: redirect to `/login?next=/projects` → wrong password error → sign in → projects from SQLite (identical to Phase 1 numbers); Client tick stamped "Daniel Reyes, Nov 2, 2026, 11:00 AM" and visible in the Vue activity feed; profile save propagates to header/sidebar; wrong current password shown on the field; sign out → login; forgot password → console link → reset → `/login?reset=1` → sign in with the new password as a viewer (one project, disabled controls, comment box present); registration with duplicate e-mail error, then success → empty dashboard → create project; phone (390px) login layout.

**Known limitations**
- Invitations/adding members were a visual prototype until Phase 4; the `project_invitations` table was created here.
- E-mail delivery is the console mailer; a provider implementation of `MailService` is deployment-specific (see `docs/DEPLOYMENT.md`).
- Rate limiting and throttle state are in-process (fine for a single node; move to Redis if scaled out).
- The smoke script used for verification lived outside the repo; the automated suite arrived in Phase 7 (`apps/api/test`).

## Phase 3 — Projects and checklist management (complete)

Goal: users can create and manage real projects and checklists end to end — editing, lifecycle status, section management and deletion — with every change authorized, logged and soft-deleted.

**API**
- `PATCH /projects/:uuid` — strict partial body (`name`, `description`, `startDate`, `deadline`, `status`). Cross-field check: deadline must not precede the start date (422 on `deadline`). Editors may change details; only the owner (or an admin) may change `status`. Logs `project.updated` and/or `project.status_changed` (`meta: { from, to }`) only when something actually changed.
- `DELETE /projects/:uuid` — owner/admin only. Soft delete (`deleted_at`); members, sections, tasks and the activity log stay for auditing. The project disappears from every list and returns 404 afterwards. Logs `project.deleted` (new `ActivityAction`).
- `PATCH /sections/:uuid` — rename / edit description (`null` clears it). Logs `section.updated`.
- `DELETE /sections/:uuid` — soft-deletes the section and every task inside it; refused with 409 for the last section of a project so a project can always receive tasks. Logs `section.deleted` with `meta.taskCount`.
- `POST /projects/:uuid/sections/reorder` — `{ orderedSectionUuids }`; uuids outside the project are ignored.
- New `SectionController`; `ProjectController.update/remove/reorderSections`; zod schemas `updateProjectSchema`, `updateSectionSchema`, `reorderSectionsSchema`; repository methods `ProjectRepository.update/softDelete`, `SectionRepository.update/softDelete/reorder/idsForUuids`; `canManage`/`assertCanManage` beside `canEdit` in `ProjectService`.
- No schema change was needed — `deleted_at` columns already existed on `projects`, `checklist_sections` and `tasks`.

**Contracts**
- `UpdateSectionInput`, `ReorderSectionsInput`; `ActivityAction` gains `project.deleted`.

**Frontend**
- `ScopeApi` + HTTP client + mock: `updateProject`, `deleteProject`, `updateSection`, `deleteSection`, `reorderSections`. The mock enforces the same rules (deadline check, last-section 409) so mock mode behaves like the API.
- Store: `updateProject`, `deleteProject` (drops cached sections/tasks/activity and re-points the active project), `updateSection`, `deleteSection` (recomputes stats), `reorderSections` (optimistic with rollback).
- `EditProjectSheet` ("Project settings" button in the project header, editors and owners): name, description, dates, status segmented control (owner/admin only), and a destructive "Delete project" zone with a `ConfirmDialog` that states the task/section count; on success you land on Projects.
- `EditSectionSheet` (pencil on each section card and on the section page): title, description, and a delete zone that explains the last-section rule and confirms with the task count; deleting from the section page returns to the project.
- Section ordering: move up / move down buttons in each section header (touch-friendly and keyboard-accessible, no new drag surface); the list animates with `layout="position"`. Hidden while filtering and for viewers.
- Activity feed labels for `project.deleted` and "changed status of … to completed".

**Verified**
- `npm run typecheck` and `npm run build` pass for both workspaces.
- 33-check API smoke run: owner updates details; empty/unknown-field body 422; deadline-before-start 422 on `deadline`; owner sets status; editor edits details but gets 403 on status and delete; viewer 403; activity entries with meta; section create → rename → clear description → empty patch 422 → viewer 403; task in section; reorder (positions renumbered, foreign uuid ignored); delete section cascades to its task (404) and logs `taskCount`; last-section delete 409; project delete → 404 / absent from owner and admin lists / sections 404.
- Browser: move a section up and back (persisted, confirmed via API); rename "Resident lookup" with a description → header and section page update; project settings → status Completed → badge updates and the Vue activity feed shows "changed status of Barangay Records Portal to completed"; editor (Priya) sees the settings form without status/delete; viewer (Jonas) sees no settings button, section actions or add-section; 390px layout — section header actions fit, sheet footer stays visible; delete a throwaway project → confirmation → redirected to Projects, sidebar updated.

**Decisions / limitations**
- Section reordering uses explicit up/down controls instead of drag-and-drop on whole cards; tasks keep drag-and-drop within a section.
- Deleting a project is a soft delete on the server. There is no restore UI yet (admin tooling is Phase 6).
- Lists are still loaded per project without pagination; sizes in scope so far are small. Server-side pagination for the activity feed arrived in Phase 4.

## Phase 4 — Sharing and collaboration (complete)

Goal: multiple users collaborate on shared projects — owners invite people by e-mail, manage roles and hand over ownership; invitees accept from their dashboard or the e-mailed link; every membership change is in the audit trail, which is now paged and filterable.

**API**
- Invitations (`project_invitations`, already migrated in Phase 2):
  - `GET /projects/:uuid/invitations` (owner/admin) — pending first, then answered ones, so the history stays visible.
  - `POST /projects/:uuid/invitations` — `{ email, role: editor | viewer }`. 422 on `email` when the person is already a member or an invitation is still pending. Creates a random token (only its SHA-256 hash is stored), logs `member.invited` (`meta.role`) and, after the transaction commits, sends `${APP_URL}/invitations/<token>` through `MailService` (printed on the API console in development).
  - `DELETE /projects/:uuid/invitations/:uuid` — revoke (status `revoked`, token cleared); 409 if already answered. Logs `member.invitation_revoked`.
  - `GET /invitations` — pending invitations addressed to the signed-in user's e-mail (only for non-deleted projects).
  - `POST /invitations/:uuid/accept|decline` and `POST /invitations/accept-token { token }` — the signed-in account must match the invited e-mail (403 with a message naming the address), the invitation must be pending (409), unknown/used tokens are 400 `invalid_token`. Accepting adds the member with the invited role, closes the invitation and logs `member.joined`; declining logs `member.invitation_declined`. Both return the now-visible `Project`.
- Membership:
  - `PATCH /projects/:uuid/members/:uuid { role }` — owner/admin; the owner's row cannot be changed (409); logs `member.role_changed` (`meta: { from, to }`).
  - `DELETE /projects/:uuid/members/:uuid` — owner/admin; removing yourself (409 → use leave) or the owner (409) is refused; logs `member.removed`.
  - `POST /projects/:uuid/members/leave` — any editor/viewer; owners get 409 (transfer first); logs `member.left`.
  - `POST /projects/:uuid/members/transfer { memberUuid }` — owner/admin; target becomes `owner` and `projects.owner_id`, the previous owner becomes `editor`; logs `project.ownership_transferred` (`meta.to`).
  - Member rows are deleted on remove/leave; the activity log is the historical record. Invitations are never deleted.
- Activity history: `GET /activity` keeps its original `?project=&limit=` contract. When `page`, `perPage` or `type` is present it answers one page — `data` is the item array and `meta` carries `{ page, perPage, total, totalPages }` (new `okPage()` helper; `ApiMeta` gained optional paging fields). `type` is one of `all | tasks | checks | comments | members | project`, mapped server-side to action lists (`ACTIVITY_TYPE_ACTIONS` in `ActivityService`). `perPage` is capped at 100.
- New `MembershipService` (`invite`, `revokeInvitation`, `listInvitations`, `myInvitations`, `accept`, `acceptByToken`, `decline`, `changeRole`, `removeMember`, `leave`, `transferOwnership`), `MembershipController`, `InvitationRepository`, `ProjectRepository.findMemberByUuid/findMemberByUser/updateMemberRole/removeMember/setOwner`, `ActivityRepository.page`, `ActivityService.page`; zod schemas `inviteMemberSchema`, `updateMemberRoleSchema`, `transferOwnershipSchema`, `acceptInvitationByTokenSchema`, extended `activityQuerySchema`.
- Seeder adds three invitations: Jonas → Treasury (pending, editor), `secretary@barangay.gov.ph` → Portal (pending, unregistered address; token `seed-invitation-token-2`) and a revoked one on HR Leave, plus their activity entries.

**Contracts**
- `ProjectInvitation.projectName`; inputs `InviteMemberInput`, `UpdateMemberRoleInput`, `TransferOwnershipInput`, `AcceptInvitationByTokenInput`; `ActivityType`/`ACTIVITY_TYPES`, `ActivityQuery`; new `ActivityAction`s `member.left`, `member.role_changed`, `member.invitation_declined`, `member.invitation_revoked`, `project.ownership_transferred`.

**Frontend**
- `ScopeApi` + HTTP client + mock: `listProjectInvitations`, `inviteMember`, `revokeInvitation`, `updateMemberRole`, `removeMember`, `transferOwnership`, `leaveProject`, `listMyInvitations`, `acceptInvitation`, `acceptInvitationByToken`, `declineInvitation`, `listActivityPage`. The HTTP client gained an envelope-returning request so paged lists can read `meta`; the mock mirrors every rule (duplicate 422s, 403 e-mail mismatch, 409s, type→action mapping) and treats the invitation uuid as its token.
- Store: `invitationsByProject`, `myInvitations` (+ load state) and the matching actions; membership mutations replace the project with the server copy; accepting adds the project to the list; leaving drops the project and its caches (shared `forgetProject` helper with delete).
- `ManageMembersSheet` rewritten: owners/admins get the invite form (API field errors inline), a role `Select` and an overflow menu (Make owner / Remove) per member, and the pending invitations with revoke; everyone else sees the roster; editors and viewers get "Leave project" in the footer. Remove, transfer, revoke and leave all go through `ConfirmDialog`.
- `InvitationsPage` at `/invitations` (accept/decline cards) and `/invitations/:token` (redeems the e-mailed link on arrival, lands in the project, or explains why it failed with a path to the list). Unauthenticated visitors are sent to `/login?next=` and come back to the link afterwards.
- Dashboard `PendingInvitationsBanner` and a sidebar "Invitations" entry with a pending count.
- `ActivityPage`: server-side pages of 25 with a project `Select`, a kind `SegmentedControl` (All / Tasks / Checks / Comments / Members / Project) and prev/next paging; filters and page live in the URL so they survive navigation; refetches when the store refreshes activity after a logged mutation.
- `ActivityFeed.vue` labels and descriptions for every new action ("changed the role of Jonas Lim to Editor", "transferred ownership of … to …", "left the project", "invited … as Viewer"), with a safe fallback for unknown actions.
- `lib/permissions.ts`: `canLeaveProject`.

**Verified**
- `npm run typecheck` and `npm run build` pass for both workspaces.
- 57-check API smoke run: invitee list → accept (editor role, project appears) → double-accept 409; token for another e-mail 403, unknown token 400, register with the invited address → token accept → token reuse 400; owner lists invitations, editor 403; invite existing member / role `owner` / duplicate pending 422; invite lower-cases the e-mail; revoke (editor 403, twice 409, wrong project 404); role change (editor 403, owner row 409, `owner` 422, promote → the member can now create sections, admin allowed); remove self 409, editor 403, removed member loses access; owner leave 409, editor leaves and loses access; transfer (editor 403, to current owner 409, success swaps roles and `owner`, previous owner can no longer manage, new owner invites); decline → accept 409 → owner sees `declined`; legacy `/activity` unchanged; paged `meta` arithmetic incl. last page; `type=members` returns only member actions with `from/to` meta; `type=checks` scoped to a project; bad `type`/`page=0` 422; non-member 403 on a project page; user without projects gets an empty page.
- Browser: Jonas's dashboard shows the invitation banner and sidebar badge → Invitations page → Accept lands in Treasury as an editor and the badge clears; editor's members sheet shows the roster and "Leave project" only; Daniel's sheet shows the invite form, role selects, overflow menu and pending invitation; inviting an existing member shows the 422 inline; inviting a new address adds a pending row ("2 pending"); changing Jonas to Editor; revoke confirmation dialog; `/activity?type=members` lists the new entries with correct wording and the pager; 390px members sheet stacks cleanly; opening another person's token link while signed in shows the explanatory error card.

**Decisions / limitations**
- Invitations do not expire; owners revoke them. A TTL can be added later without a schema change.
- Member removal deletes the `project_members` row (the activity log is the audit record); invitations are append-only.
- Invitation e-mail goes through `ConsoleMailService` in development — a real provider is a deployment concern.
- The paged activity endpoint is opt-in via query parameters so the Phase 2 client contract is untouched.

## Phase 5 — DOCX export (complete)

Goal: users export a project, or selected sections of it, as a professionally formatted Word document that mirrors the on-screen preview.

**API**
- New `domain/export/` module, independent of HTTP and SQL:
  - `document.ts` — `ChecklistDocument` model + `buildChecklistDocument` (sections and tasks in stored order, both "checked by" records, options, generator) and `documentFileName`.
  - `template.ts` — `ExportTemplateDefinition` (page, font, colours, column widths, labels, status labels/fills, checkbox glyphs, signature, footer), `DEFAULT_TEMPLATE_DEFINITION` and `parseTemplateDefinition` (deep-merge of the stored JSON over the defaults; tolerant of partial and legacy shapes).
  - `DocumentGenerator.ts` — `DocumentGenerator` interface and `DocxDocumentGenerator` built on the `docx` library: A4 portrait with 0.75" margins, title block (eyebrow, project name, description, owner/start/deadline), the "Checked by (Developer | Client) / Item Description / Remarks" table with its header repeated on every page, numbered section rows kept with their first item, one row per task with Word checkbox content controls (☑/☐) and the logged date, time and name under a tick, the status label in a tinted Remarks cell, `cantSplit` rows so long checklists flow cleanly across pages, optional "Prepared by / Approved by" signature lines, and a footer with the generation date and "Page X of Y".
- `ExportService.export(actor, generatedBy, projectUuid, input)` — authorizes via `requireViewable` (viewers may export), validates `sectionUuids` against the project (422), resolves the template (`templateUuid` → 422 if unknown; otherwise the default; 503 `export_unavailable` if none exists), validates `timeZone` (422) falling back to `EXPORT_TIMEZONE`, generates, and logs `export.generated` with `{ template, sections, tasks, partial }`. `listTemplates()` for the picker.
- `ExportTemplateRepository` (`listAll`, `findByUuid`, `findDefault`), `ExportTemplateRow`/`toExportTemplate` in `models.ts`.
- Routes: `POST /projects/:uuid/exports` — the only endpoint whose success body is a file (`Content-Type` DOCX, `Content-Disposition: attachment; filename=…`, `X-Export-Template`, `X-Export-Sections`, `X-Export-Tasks`); errors still use the JSON envelope. `GET /export-templates`.
- `createExportSchema` (strict): `sectionUuids?` (1–500 uuids), `includeDescriptions?`, `includeSignature?`, `templateUuid?`, `timeZone?`.
- Config `export.defaultTimeZone` (`EXPORT_TIMEZONE`, default `Asia/Manila`). Seeder writes a partial definition for the Default template to demonstrate the override path.
- Dependency added: `docx` (API only).

**Contracts**
- `TASK_STATUS_LABELS` (single source for the Remarks column and the UI chips; `lib/taskStatus.ts` now reads from it), `CreateExportInput`.

**Frontend**
- `ScopeApi.listExportTemplates()` / `exportProject(projectUuid, input) → ExportedFile { blob, fileName, template, sectionCount, taskCount }`. The HTTP client gained `requestFile` (binary success body, envelope errors, RFC 6266 file name parsing); the mock produces a plain-text rendition of the same model and logs the activity so the flow works offline.
- Store: `exportTemplates` (+ load state), `loadExportTemplates`, `exportProject` (refreshes activity afterwards).
- `lib/download.ts` — `downloadBlob` (object URL + anchor click, revoked afterwards).
- `ExportPreviewSheet`: Download button enabled; sends the selected sections (omitted when all are selected), both options, the chosen template and the browser's IANA time zone; shows a spinner while generating, a success line with the file name and counts, or the API error inline; template picker appears when more than one template exists; the footer note names the template. The preview page keeps its print proportions and scrolls sideways inside the sheet on narrow screens.

**Verified**
- `npm run typecheck` and `npm run build` pass for both workspaces; no lint errors.
- 35-check API smoke run: templates list (default first, no internal ids); full export 200 with DOCX content type, attachment file name and ZIP magic; `document.xml` contains the table, repeated header rows, `cantSplit`, `w14:checkbox` controls with the ☑ glyph, project title, status labels, header fill, section numbering, signature labels; footer part contains `PAGE`/`NUMPAGES`; AM/PM timestamps present; partial export honours `sectionUuids`, `includeSignature=false` and `includeDescriptions=false`; 422 for empty/unknown sections, unknown time zone, unknown template and unknown body keys; viewer 200, non-member 404, anonymous 401; explicit `templateUuid` 200; `export.generated` logged with meta.
- Rendered the generated file with Word (COM → PDF) and inspected both pages: header repeats on page 2, section heading stays with its first row, checkbox controls and tick details render, Remarks cells tinted, signature lines on the last page.
- Browser: Daniel opens Export on Barangay Records Portal, deselects a section, clicks Download → success line "barangay-records-portal-scope-checklist-2026-11-02.docx · 3 sections, 13 tasks"; the Activity page (Project filter) lists the export; 390px: sheet, options and the scrolling preview page work and the download succeeds.

**Decisions / limitations**
- One built-in layout (`checked-by-table`). A second layout means a new `layout` value and a renderer branch; colours, labels, page and fonts are already data.
- Exports are generated on demand and never stored; the activity log is the export history. Storing files (e.g. in Spaces) can be added behind `ExportService` later.
- Viewers may export because the document is a read of data they can already see.
- Template management UI (create/edit templates) is not built yet; see the Phase 6 decisions.

## Phase 6 — Admin dashboard (complete)

Goal: administrators monitor the whole system and manage every account and project — system statistics, a user directory with account controls, a registry of all projects including soft-deleted ones (with restore), and an append-only audit log of administrative actions.

**Database**
- Migration `0005_admin_accounts_and_audit`: `users.disabled_at` (nullable; additive) and the new `admin_audit_logs` table (`uuid`, `actor_id→users`, `action`, `target_type` `user | project`, `target_uuid`, `subject`, `meta` JSON, `created_at`; unique uuid, `created_at` and `(target_type, target_uuid)` indexes). Nothing is removed or renamed.
- Seeder adds a soft-deleted project ("Legacy Intranet Migration", owner Priya) and two sample audit entries so the admin screens have data.

**API** — every route under `/admin/*`, guarded by `AdminService.assertAdmin` (403 "Administrator access is required." for everyone else; 401 anonymous)
- `GET /admin/stats` — `AdminStats`: users (total, admins, disabled, new in 30 days, active in 7 days from sessions), projects (total live, by status, deleted, overdue), tasks (total, completed, overdue, by status), collaboration (memberships, pending invitations, comments), exports (total, last 30 days), activity (last 7 days). One `StatsRepository` with parallel aggregate queries.
- `GET /admin/users?search=&role=&status=&page=&perPage=` — paged `AdminUser` rows (`User` + `disabledAt`, `lastSeenAt`, `ownedProjects`, `memberships`); search on name/e-mail; `role` ∈ `all | admin | user`; `status` ∈ `all | active | disabled`.
- `PATCH /admin/users/:uuid` — strict `{ name?, email?, role? }`. E-mail uniqueness 409 on the field. Rules: you cannot change your own role (409); the last enabled administrator cannot be demoted (409). Audits `user.updated` (`meta.fields`) and `user.role_changed` (`meta { from, to }`).
- `POST /admin/users/:uuid/disable` / `enable` — disabling revokes every session; you cannot disable yourself or the last enabled admin (409). Disabled accounts get 403 `account_disabled` on login, their existing sessions no longer resolve, and public forgot-password requests are silently ignored (still 202, no enumeration). Audits `user.disabled` / `user.enabled`.
- `POST /admin/users/:uuid/revoke-sessions` — signs the account out everywhere (your own current session is kept). Audits `user.sessions_revoked`.
- `POST /admin/users/:uuid/password-reset` — sends the same reset link as forgot-password; 409 for disabled accounts. Audits `user.password_reset_sent`.
- `GET /admin/projects?search=&status=&page=&perPage=` — every project with members and stats (`AdminProject` = `Project` + `deletedAt`); `status` ∈ `all | active | completed | archived | deleted` (deleted rows are only shown with `status=deleted`); search on project or owner name.
- `POST /admin/projects/:uuid/restore` — clears `deleted_at` (404 unknown, 409 when not deleted); logs `project.restored` in the project's activity and in the audit log. Archive/complete/delete reuse the existing project endpoints (admins already pass the owner check).
- `GET /admin/audit?page=&perPage=` — paged `AdminAuditEntry` list, newest first.
- New `AdminService`, `AdminController`, `AdminAuditRepository`, `StatsRepository`; `UserRepository.page/findAdminByUuid/updateRole/setDisabled/countActiveAdmins`; `ProjectRepository.pageAll/findByUuidIncludingDeleted/restore`; `AuthService` disabled-account checks and a reusable `sendPasswordReset`; zod schemas `adminUserQuerySchema`, `adminUpdateUserSchema`, `adminProjectQuerySchema`, `pageQuerySchema`.

**Contracts**
- `AdminStats`, `AdminUser`, `AdminUserQuery`, `AdminUpdateUserInput`, `AdminProject`, `AdminProjectQuery`, `AdminAuditAction`, `AdminAuditEntry`, `PageQuery`; `ActivityAction` gains `project.restored`.

**Frontend**
- `ScopeApi` + HTTP client + mock: `adminStats`, `adminListUsers`, `adminUpdateUser`, `adminSetUserDisabled`, `adminRevokeUserSessions`, `adminSendPasswordReset`, `adminListProjects`, `adminRestoreProject`, `adminListAudit`. The mock enforces the same rules (self/last-admin 409s, disabled login 403, deleted projects move to a restorable list).
- `RequireAdmin` guard (`app/guards.tsx`) around `/admin/*` — non-admins are sent to the dashboard. "Admin" appears in the desktop sidebar only for administrators; on mobile the Profile page shows an "Administration" card (the bottom bar keeps its four fixed items).
- `modules/admin/`: `AdminLayout` (header + Overview / Users / Projects / Audit log tabs), `AdminOverviewPage` (bento: projects with completion ring and state figures, users, active this week, tasks, tasks by status, exports, changes this week, collaboration with a "review deleted projects" link, recent admin actions), `AdminUsersPage` (search via the shared `?q=`, Enabled/Disabled and role filters, paged rows) with `UserDetailSheet` (name/e-mail, role select with promote/demote confirmation, send reset link, sign out everywhere, disable/re-enable — each confirmed and reported inline), `AdminProjectsPage` (All live / Active / Completed / Archived / Deleted, search by project or owner, open / archive / reactivate / delete / restore), `AdminAuditPage` + shared `AuditList`. Filters and page live in the URL (`usePagedQuery` / `useListParams`).
- New `Pagination` primitive in the design system; store gains `upsertProject` and `patchCurrentUser`; the activity feed labels `project.restored`.

**Verified**
- `npm run typecheck` and `npm run build` pass for both workspaces; no lint errors.
- 86-check API smoke run: anonymous 401 and non-admin 403 on every admin route; stats shapes and counts (4 users / 1 admin, 4 live + 1 deleted project, 42 tasks with `byStatus` summing to 42, 2 pending invitations, 5 comments, 1 export); users paging/search/role/status filters and 422s for bad enums/`perPage`; no ids or password hashes exposed; self-demotion 409; promote Daniel → his existing session gains admin access → he demotes Maya → she gets 403 → he cannot demote himself → roles restored; duplicate e-mail 409 on `email`, unknown key / empty body 422, unknown user 404; disable Jonas → his session 401, login 403 `account_disabled`, listed under `status=disabled`, reset link 409, public forgot-password still 202 → enable → login works → reset link 202; revoke sessions (target 401, own current session kept); project registry (live rows have `deletedAt: null`, `status=deleted` shows the seeded project, owner search, completed filter, Priya cannot see the deleted project); restore → 200, owner sees it again, `project.restored` in the project activity, second restore 409, unknown 404; soft-delete again via the regular endpoint; audit log contains every action with `meta { from, to }` on role changes and pages correctly.
- Browser: Maya sees "Admin" in the sidebar; Overview bento renders live figures; Users list → Jonas's sheet → Disable (confirm) → row shows "Disabled", reset action gated, Enable (confirm) restores; Projects with `?status=deleted` → Restore (confirm) → list empties and "All live" shows the project as Archived; Audit log lists the actions with "Open project" / "View account" links; 390px: overview stacks, users list and search, Profile shows the "Administration" card; Daniel (user) has no Admin nav and `/admin/users` redirects to the dashboard.

**Decisions / limitations**
- Admin actions that are not scoped to a project (role changes, disable/enable, forced sign-out, reset links) are recorded in the separate append-only `admin_audit_logs`; project restores are additionally written to the project's own activity so members can see them.
- Accounts are disabled, never deleted, so authorship and history stay intact.
- At least one enabled administrator must always exist; promotion to admin takes effect on the person's existing session immediately.
- Export-template management (create/edit templates) was not included; templates remain seeded data for now.
- The admin lists are page-local (fetched per page through `api`, like the Activity page) rather than cached in the store.

**Added after Phase 7 — Productivity report**
- `GET /admin/productivity?period=7d|30d|90d|all` (default `30d`; other values 422) ranks every account by a weighted score derived from `activity_logs`: task completed 5 (a `task.status_changed` whose `to` is a resolved status), check ticked 3, task created 2, other updates / comments / exports / everything else 1. Each entry also carries the raw counts per bucket, total actions, active days, distinct projects and the last activity timestamp; idle accounts are included with zeros. The default weights and the action → bucket mapping are exported from `@scope/contracts` (`PRODUCTIVITY_WEIGHTS`, `productivityBucket`, `productivityScore`, `parseProductivityWeights`) and shared by the API, the mock API and the UI. A deployment can tune any weight with `PRODUCTIVITY_WEIGHTS=tasksCompleted=8,comments=2` (API `.env`); the active weights are returned with every report and shown in the page's legend, and an invalid value stops the API at start-up through the same configuration gate as the production checks.
- Admin → **Productivity** tab (`/admin/productivity`): 7 days / 30 days / 90 days / All time switch kept in the URL, "Most productive" leader card, active people and actions logged, a ranking with relative score bars and a breakdown of what each person did, accounts without activity, and a scoring legend. The Overview gained a "Most productive · 30 days" card with the top three linking to the full report.
- Tests: contract unit tests for the bucket mapping and scoring; a feature test covering 403/422, the response shape and ordering, idle accounts, and that creating and completing a task raises the actor's counts and score by the documented weights. The existing confetti bursts (project and section reaching 100%) were added at the same time; see `docs/ARCHITECTURE.md`.

**Added after Phase 7 — PostgreSQL support**
- Third database driver, `db/drivers/postgres.ts` on `pg` (`DB_CLIENT=postgres`; `DATABASE_URL` or `DB_*`, `DB_SSL`). The repositories were not rewritten: the driver converts `?` to `$n`, appends `RETURNING id` to inserts so `insertId` keeps working, maps `rowCount` to `affectedRows` and registers per-pool result parsers so rows look exactly like SQLite/MySQL rows (date/time strings, numeric counts, JSON text). The migrator gained PostgreSQL tokens (`BIGSERIAL`, `BIGINT`, `JSONB`, `BOOLEAN`) plus two rewrites (`DATETIME` → `TIMESTAMP`, boolean `DEFAULT 0/1` → `FALSE/TRUE`); the existing seven migration files run unchanged. Two queries were made portable (`ErrorLogRepository` search now `LOWER(...) LIKE` like the other searches; `StatsRepository` active-days casts the timestamp before `SUBSTR`), `splitStatements` drops `--` comments (a `;` inside a comment in `0001` had been splitting the script — this would also have broken MySQL), and `dropAll` now includes `error_logs`. The production gate accepts `postgres` with a password or a connection string. The test harness is driver-selectable (`TEST_DB_CLIENT=postgres` + `TEST_DATABASE_URL`, one schema per test server); CI has an `api-postgres` job (PostgreSQL 16 service) that runs the full API suite, then `fresh` + `migrate` + boot. `docker-compose.postgres.yml` override, `.env.example`, `DEPLOYMENT.md` (PostgreSQL specifics, `pg_dump`) and `ARCHITECTURE.md` updated. Verified locally against PostgreSQL 18: all 96 API tests green, `db:fresh`/`db:migrate` idempotent, and the dev server on Postgres answering login, projects, admin stats/productivity, error-log search, templates and a DOCX export.

**Added after Phase 7 — Production readiness with Clerk**
- Dockerfile takes `VITE_CLERK_PUBLISHABLE_KEY` as a build argument (the web bundle decides sign-in at build time); docker-compose passes the build arg and `AUTH_PROVIDER`/`CLERK_*` through; the image still contains no `.env`. CORS preflight allows `Authorization` for split-origin deployments. CI additionally asserts that the production config gate refuses plain-http and development Clerk keys. `docs/DEPLOYMENT.md` gained a "Clerk — production" runbook (domain + DNS via `clerk deploy`, own OAuth credentials, live keys and the *production* JWT public key, build arg, admin seeder first, NTP) and the checklist now bootstraps the administrator with `seed-admin.js` instead of SQL. Verified by booting the bundle in production mode with the gate refusing the dev configuration, then starting cleanly (7 migrations, SPA served, HSTS, preflight) under a production-shaped environment.

**Added after Phase 7 — Admin and user seeders**
- `db/seeders/accounts.ts` with `seedAdmin` / `seedUser` and the `db:seed:admin` / `db:seed:user` scripts (`--email`, `--name`, `--password`, or `SEED_ADMIN_*` / `SEED_USER_*` environment variables). Production-safe and idempotent: create the account, promote an existing user to administrator (`seedAdmin` only; `seedUser` never demotes), otherwise leave it untouched — names and passwords of existing accounts are never overwritten. Input goes through the same zod rules as registration; the session provider requires a password, the Clerk provider stores the non-scrypt sentinel instead. Replaces the "promote with SQL" step in the deployment guide; `clerk:import --admin` now reuses `seedAdmin`. Covered by a seeder test suite on an empty database and against the running app (sign-in, admin area reachable, 403 for a seeded user, in-place promotion of a fixture account).

**Added after Phase 7 — Clerk sign-in (optional provider)**
- `AUTH_PROVIDER=session|clerk` (default `session`, so nothing changes for existing deployments). Under `clerk`, Clerk's hosted components handle sign-in, sign-up, password reset, MFA and social providers; the API verifies the Clerk session token sent as a bearer header (`@clerk/express` behind a `ClerkTokenVerifier` interface; networkless with the instance's PEM via `CLERK_JWT_KEY`, with issuer and authorized-party checks, or via JWKS; `CLERK_CLOCK_SKEW_MS` tolerance with a rate-limited "server clock is probably off" log hint, found necessary on a dev PC that was 38 s behind) and `ClerkAuthService` maps it to a local account — linked by `users.clerk_user_id` (migration `0007`, nullable, unique), matched by e-mail on first sign-in, or provisioned with the default role. Roles, memberships, admin rules, the audit log and the error log are unchanged. Each Clerk session is mirrored in `sessions`, so "last seen" and admin "revoke sessions"/"disable" keep working and also end the sessions at Clerk (`ClerkDirectory`, the single wrapper around Clerk's Backend API). The password endpoints answer `409 auth_managed_externally`; `GET /auth/provider` is public.
- Web: `VITE_CLERK_PUBLISHABLE_KEY` switches `/login` and `/register` to `<SignIn/>`/`<SignUp/>` styled with the design tokens, replaces the top-bar avatar with Clerk's `<UserButton/>` (with a "Profile" link back into the app), and swaps "Change password" on the profile page for "Manage account". Everything Clerk-specific lives in one lazily loaded chunk; deployments on the session provider never download it. A sign-in that the API cannot match to an active account shows an explicit "account cannot be used" screen with sign-out instead of looping.
- Operations: the API now loads `apps/api/.env` itself (Node's built-in `process.loadEnvFile`), so `clerk env pull` is enough; start-up refuses `clerk` without keys and test keys in production. `npm run clerk:import -w @scope/api [-- --dry-run] [-- --admin <email>]` creates or links Clerk users for existing accounts (our uuid as `external_id`, no password — scrypt hashes cannot be imported, users set one via Clerk's reset flow).
- Tests: a feature suite runs the whole Clerk path over HTTP with a deterministic verifier and an in-memory directory (linking, provisioning, no-e-mail identities, mirror sessions, revocation, disabled accounts, logout, malformed tokens, mirror rows never answering for another user) plus configuration-gate tests. The existing suites run on the session provider regardless of the developer's local `.env`.

**Added after Phase 7 — Error log**
- New append-only `error_logs` table (migration `0006`) and `ErrorLogRepository` / `ErrorLogService`. The API error handler now takes a `record` hook: every unhandled exception and every domain-level 5xx is stored with status, code, message, stack trace, method, path, acting user and user agent, while the client still receives the same generic message. 4xx outcomes are not recorded. Writing the entry is best-effort and can never alter or delay the response.
- `POST /errors` lets the web app report crashes (`message`, `name`, `stack`, `path`, `context`), signed in or anonymous, 30 per IP per 10 minutes. The web app reports from the route error page, `window.onerror` and unhandled promise rejections — skipping API errors (already captured server-side), 404s and stale-chunk reloads, once per distinct message per page load, at most ten per load.
- `GET /admin/errors?source=all|api|web&search=&page=&perPage=` and `GET /admin/errors/:uuid` (admins only). Admin → **Errors** tab: source filter, search over message / code / path, paged list with source icon, status and error-type badges, request or page, user and relative time; a detail panel shows the full message, request, user (linking to the account), browser, stack trace and context. `AdminStats.errors` adds total / 24-hour / 7-day counts and the Overview gained an "Errors" card linking to the tab.
- Tests: feature tests for anonymous and signed-in reports, admin-only access, source filter, search, 422 for bad input and unknown keys, 404 for unknown entries, no internal ids in responses, and the stats counts; unit tests for the error handler (4xx not recorded, unexpected and 5xx domain errors recorded with request context, generic response, failing recorder tolerated).

**Added after Phase 7 — Animated data**
- Progress bars, rings, chart bars (`Meter`) and headline figures (`AnimatedNumber`) now sweep in from zero when they first appear and glide to new values afterwards (dashboard, project and section pages, project cards, profile counts, admin overview charts, productivity ranking). Chart rows stagger; the productivity ranking rows fade in and reorder with layout animation. Everything collapses to an instant render under `prefers-reduced-motion`, and screen readers hear only the final figures.
- Fixed in passing: the productivity "All time" period could not be selected from the UI because the shared `useListParams` treats the value `all` as "clear the filter"; the page now reads `?period=` directly.

## Phase 7 — Testing and production readiness (complete)

Goal: a stable, production-ready application — automated tests, hardened error handling and security, accessibility and responsive verification, and everything needed to deploy.

**Automated tests** (Node's built-in `node --test` runner + `tsx`; `npm test` at the root runs both workspaces, 120 tests at the time of writing)
- `apps/api/test/helpers.ts` boots the real Express app over HTTP on an in-memory SQLite database (migrations + development seed) with a capturing mail service and a cookie-jar client, so every feature test exercises routing, validation, sessions, CSRF and SQL exactly as production does.
- `auth.test.ts` — health, 404 envelope, cookie flags, 401/422, login throttle, CSRF (foreign/empty Origin, `X-Requested-With`), CORS preflight, security headers, malformed/oversized bodies, register/duplicate/weak password, logout, profile update, change password revokes other sessions, forgot/reset via the captured e-mail (no enumeration, single-use token), rate limit on forgot-password.
- `projects.test.ts` — visibility per role and for admins, 404 instead of 403, create/update/status/deadline rules, sections (last-section 409, reorder, cascade delete), tasks (trim, developer/client check stamps, status, move, reorder, delete), viewer read-only except comments, activity paging and legacy contract.
- `membership.test.ts` — invitations list/accept/decline/revoke, invite by e-mail (normalisation, no token leak, mail link, 422s, editor 403), token redemption (wrong person, register-then-accept, reuse), role change/remove/owner protections, leave, transfer ownership.
- `export.test.ts` — templates, DOCX bytes (content type, filename, `X-Export-*`, ZIP magic), viewer may export, activity meta, partial export options, validation 422s, 404/401.
- `admin.test.ts` — 401/403, stats, user directory paging/filters/no leaks, role changes incl. last-admin and self protections with audit metas, account edits, disable/enable (session 401, login 403, reset 409, forgot-password silent), revoke sessions, project registry + restore, audit paging.
- `unit.test.ts` — password hashing/tokens, SQL dialect rendering, date helpers, validation, document model, template parsing.
- `apps/web/test/lib.test.ts` and `mockApi.test.ts` — task status meta, stats/progress, dates, permissions, routes/`safeNext`, `ApiError`, and the mock API's enforcement of session, admin, deleted-project and membership rules.

**API hardening**
- `rateLimit` middleware (per-IP fixed window, `RateLimit-*`/`Retry-After`, 429) on register, forgot-password, reset-password and invitation redemption.
- Extra headers: `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, `Cache-Control: no-store`, HSTS when `SESSION_SECURE=true`.
- `GET /health` pings the database (503 `unavailable` when it is down); optional access log (`LOG_REQUESTS`); `trust proxy` (`TRUST_PROXY`).
- `server.ts`: production configuration checks (`productionConfigProblems` — https `APP_URL`, no localhost origins, secure cookie, MySQL password, no SQLite) refuse to start a misconfigured instance; keep-alive timeouts; graceful `SIGTERM`/`SIGINT` shutdown with a 10 s grace period; unhandled rejection / uncaught exception handlers.
- Optional single-process deployment: `WEB_DIST` serves `apps/web/dist` from the API (immutable hashed assets, SPA fallback with CSP, 404 for missing files/JSON clients).
- The API bundle now includes `@scope/contracts`; runtime dependencies are only `express`, `mysql2`, `docx`, `zod`.

**Frontend**
- Route-level `ErrorPage` (`errorElement`) for render errors, stale lazy chunks after a deploy and unknown route errors; details stay in the console.
- Administration module lazy-loaded (`route.lazy`), cutting ~28 kB from the main chunk for regular users.
- Per-page `document.title`, keyboard-only "Skip to content" link, offline notice in the shell.
- Production builds (`.env.production` → `VITE_API_URL=/api`) alias the mock API to a stub so sample accounts and fixtures are not shipped.
- Accessibility/responsive sweep at 390, 768 and 1280 px (dashboard, project, activity, profile, admin users/projects): no page-level horizontal overflow, zero unlabeled controls, focus-visible ring, filter strips scroll independently.

**Deployment**
- `Dockerfile` (multi-stage, `node:24-alpine`, non-root, healthcheck) serving SPA + API from one container; `.dockerignore`.
- `docker-compose.yml` — API + MySQL 8.4 for a local production-like trial (`ALLOW_INSECURE_PRODUCTION=true` only there).
- `.github/workflows/ci.yml` — typecheck, tests, build, boot the bundle and probe `/api/health` + an SPA route, Docker image build.
- `apps/api/.env.example` documents the new variables; `docs/DEPLOYMENT.md` covers topologies, environment, start-up checks, database/backups, nginx, operations and a security checklist.

**Verified**
- `npm run typecheck`, `npm test` (60 API + 18 web, all passing), `npm run build` for both workspaces; no lint errors.
- Bundled `dist/server.js` booted with `WEB_DIST=../web/dist`: `/`, `/projects/abc`, `/login` → 200 HTML with CSP and `no-store`; hashed asset → `immutable` cache; `/missing.png` and JSON-only clients → 404; `/api/nothing` → JSON 404 envelope; `/api/health` → `db: ok`.
- Production web bundle contains no sample fixtures (grep for seeded names/e-mails is empty).
- Browser (Vite dev server): titles update per page; lazy admin chunk loads for Maya at 768 px; dashboard/project/activity/profile at 390 px without overflow; admin project registry at 1280 px.
- Runtime dependency install (`npm ci --omit=dev --workspace apps/api`) reproduced outside the repo to validate the Docker runtime stage.

**Decisions / limitations**
- Node's built-in test runner was chosen over a framework to avoid new dependencies; feature tests go through real HTTP so they double as API contract documentation.
- Rate limiting is in-process; a shared store (Redis) is only needed with several replicas and global limits.
- E-mail remains `ConsoleMailService` (links in the server log); a provider implementation of `MailService` is a one-class change.
- Export-template management UI, bulk operations and a Laravel port of the API remain future work; the schema and layering are already in the Laravel shape (see ARCHITECTURE → Laravel migration path).
- Docker was not available on the development machine; the image was validated by reproducing each stage's commands locally and in CI configuration rather than by a local `docker build`.
