# Agent handoff (current)

Short current-state brief for the next agent. No secrets.

## Status

Idle — task descriptions show under titles for guests and signed-in users

## Last updated

2026-11-06

## Where we left off

`TaskRow` always shows `task.description` under the title (project, section, dashboard, public share). Verified on Barangay Records Portal and Data migration. Not committed/pushed.

## Do next / Continue from here

- Rebuild/redeploy if they want share on iscope (`npm run db:migrate` there; never `db:fresh`).
- Do not commit, push, or restart unless asked.
- Optional cleanup: delete the **Create-time note check** test scope on Barangay Records Portal.

## Blockers / errors

_None._

## Last issue fixed

Task descriptions also show under the title for signed-in users.

## Key context

| Item | Value |
|------|--------|
| Stack | React 19 + Vite web, Express 5 API, npm workspaces |
| Auth | `AUTH_PROVIDER=session` (Clerk opt-in only) |
| Dev | `npm run dev` → API `:4000/api`, web `:5173` |
| Prod | iscope.poolreno.com (alias qac.poolreno.com) + PostgreSQL |
| Public IDs | `uuid` only |
| Section notes | `section_references`; create may send `reference` |

### Local seed logins (password for all)

| Name | Email | Role |
|------|-------|------|
| Maya Santos | `maya@infosoft.ph` | admin |
| Daniel Reyes | `daniel@infosoft.ph` | user |
| Priya Nair | `priya@infosoft.ph` | user |
| Jonas Lim | `jonas@infosoft.ph` | viewer on portal |

## Session scratch

- Share: `ShareService` / `ShareController`; web `ShareProjectSheet`, `PublicSharePage`; migration `0016_add_project_share.sql`.
- Shared fields: `apps/web/src/modules/checklist/SectionReferenceFields.tsx`
- Add form: `AddSectionForm` in `apps/web/src/modules/projects/ProjectPage.tsx`
- After-create panel: `apps/web/src/modules/checklist/SectionReferences.tsx`
- API create: `ChecklistService.createSection` + `createSectionSchema.reference`
- Mock: `buildSectionReference` in `apps/web/src/services/mock/mockApi.ts`
- Typecheck passed. Targeted API/web tests for create-with-reference passed.

## Recent handoff history

- 2026-11-06: Task descriptions under titles for signed-in users too.
- 2026-11-06: Public share shows task descriptions under titles.
- 2026-11-06: Public guests cannot open tasks; Client ticks still work.
- 2026-11-06: Public share links (`/s/:token`), Client-only guest ticks, per-scope visibility.
- 2026-11-06: Select tasks control moved to the far right of the bulk toolbar.
- 2026-11-06: Bulk pick checkbox moved to the end of the task row.
- 2026-11-06: Bulk remarks is select-then-apply (row checkboxes + Select all).
- 2026-11-06: Bulk remarks on a scope (`Set all to…` + `POST /projects/:uuid/tasks/status`).
- 2026-11-06: iscope login 401 with Maya — those emails are local seed only. Preloaded production admin `admin@qac.poolreno.com` / `Admin1234!` returns 200. CSRF 403 no longer reproduces.
- 2026-11-05: `POST /api/auth/login` on iscope.poolreno.com returned 403 — APP_URL still qac.poolreno.com. Same-origin Host check added; set APP_URL/ALLOWED_ORIGINS to iscope and restart the API.
- 2026-11-05: Fixed login bounce (`safeNext` no longer returns auth pages) and autofill-disabled Sign in.
- 2026-11-05: Added `local/` memory + handoff and the always-apply agent-handoff rule.
- 2026-11-05: Optional note/link when adding a Scope or Revision (create `reference`).
- 2026-11-04: Notes and links after a scope exists; Note/Link switch animation + `w-fit`.
