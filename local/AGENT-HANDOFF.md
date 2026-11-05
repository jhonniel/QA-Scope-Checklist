# Agent handoff (current)

Short current-state brief for the next agent. No secrets.

## Status

Done — login no longer bounces back to the sign-in page; Sign in stays clickable

## Last updated

2026-11-05

## Where we left off

Login bug: after the landing page was removed, `/` and `/login` were still valid `safeNext` destinations, so a successful sign-in could send the user back to the sign-in screen. Autofill also left Sign in disabled because React state stayed empty.

Fixed: `safeNext` rejects `/`, `/login`, `/register`, `/forgot-password`, `/reset-password` and defaults to `/dashboard`. Login form uses `onInput` and does not disable Sign in for empty React state. Browser-verified: `/login?next=/login` now lands on the dashboard.

## Do next / Continue from here

- Follow the user's next request. Do not commit, push, or redeploy qac unless asked.
- Optional cleanup: delete the **Create-time note check** test scope on Barangay Records Portal.

## Blockers / errors

_None._

## Last issue fixed

Successful login could stay on `/login` when `next` pointed at an auth page. Sign in was also disabled when the browser autofilled the fields.

## Key context

| Item | Value |
|------|--------|
| Stack | React 19 + Vite web, Express 5 API, npm workspaces |
| Auth | `AUTH_PROVIDER=session` (Clerk opt-in only) |
| Dev | `npm run dev` → API `:4000/api`, web `:5173` |
| Prod | qac.poolreno.com + PostgreSQL |
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

- Shared fields: `apps/web/src/modules/checklist/SectionReferenceFields.tsx`
- Add form: `AddSectionForm` in `apps/web/src/modules/projects/ProjectPage.tsx`
- After-create panel: `apps/web/src/modules/checklist/SectionReferences.tsx`
- API create: `ChecklistService.createSection` + `createSectionSchema.reference`
- Mock: `buildSectionReference` in `apps/web/src/services/mock/mockApi.ts`
- Typecheck passed. Targeted API/web tests for create-with-reference passed.

## Recent handoff history

- 2026-11-05: Fixed login bounce (`safeNext` no longer returns auth pages) and autofill-disabled Sign in.
- 2026-11-05: Added `local/` memory + handoff and the always-apply agent-handoff rule.
- 2026-11-05: Optional note/link when adding a Scope or Revision (create `reference`).
- 2026-11-04: Notes and links after a scope exists; Note/Link switch animation + `w-fit`.
