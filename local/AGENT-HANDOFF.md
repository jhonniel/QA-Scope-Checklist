# Agent handoff (current)

Short current-state brief for the next agent. No secrets.

## Status

In progress — iscope login 403 is CSRF origin; env + same-origin Host check

## Last updated

2026-11-05

## Where we left off

`POST https://iscope.poolreno.com/api/auth/login` is 403 because CSRF still allow-lists `https://qac.poolreno.com` only. Probe: Origin iscope → 403; Origin qac → 401 (request reached login). Code now treats the proxied Host as same-origin. Deploy env examples point `APP_URL` at iscope and list both hosts.

Not deployed yet. On the server, set `APP_URL` / `ALLOWED_ORIGINS` and restart the API so login works before that code ships.

## Do next / Continue from here

- On 146.190.85.225: set `APP_URL=https://iscope.poolreno.com` and `ALLOWED_ORIGINS=https://iscope.poolreno.com,https://qac.poolreno.com`, then restart the API.
- Pull/rebuild if using the new same-origin Host check.
- Do not commit, push, or restart for the user unless they ask.
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

- Shared fields: `apps/web/src/modules/checklist/SectionReferenceFields.tsx`
- Add form: `AddSectionForm` in `apps/web/src/modules/projects/ProjectPage.tsx`
- After-create panel: `apps/web/src/modules/checklist/SectionReferences.tsx`
- API create: `ChecklistService.createSection` + `createSectionSchema.reference`
- Mock: `buildSectionReference` in `apps/web/src/services/mock/mockApi.ts`
- Typecheck passed. Targeted API/web tests for create-with-reference passed.

## Recent handoff history

- 2026-11-05: `POST /api/auth/login` on iscope.poolreno.com returned 403 — APP_URL still qac.poolreno.com. Same-origin Host check added; set APP_URL/ALLOWED_ORIGINS to iscope and restart the API.
- 2026-11-05: Fixed login bounce (`safeNext` no longer returns auth pages) and autofill-disabled Sign in.
- 2026-11-05: Added `local/` memory + handoff and the always-apply agent-handoff rule.
- 2026-11-05: Optional note/link when adding a Scope or Revision (create `reference`).
- 2026-11-04: Notes and links after a scope exists; Note/Link switch animation + `w-fit`.
