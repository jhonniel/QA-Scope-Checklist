# Agent memory (durable)

Tracked in git — commit/push with the branch when the user asks. Long-lived decisions, preferences, and pitfalls — not the current task. No secrets.

## Preferences

- npm workspaces: `apps/web` (React 19 + Vite), `apps/api` (Express 5), `packages/contracts`.
- Domain-Driven Design. Controllers thin; services hold business logic; repositories own data access.
- Validate request bodies with zod in `apps/api/src/http/validate.ts`. Public IDs are `uuid` only — never expose database primary keys.
- Schema changes are additive Laravel-style SQL migrations under `apps/api/db/migrations/`. Do not rewrite history; do not run `npm run db:fresh` against the user's database or production.
- Tests for new logic. API feature tests use in-memory SQLite by default (`TEST_DB_CLIENT=postgres` is opt-in and isolated).
- Throwaway files only in `%TEMP%`. Preserve backward compatibility unless the user approves a break.
- Code identifiers stay `section*` even when the UI says “Scope” / “Revision”.
- Do not commit unless the user asks. Do not push, redeploy qac, or delete Clerk code unless asked.

## Decisions

- Sign-in is built-in e-mail + password (`AUTH_PROVIDER=session`). Clerk is opt-in only. If Clerk is used, the app is `app_3LXQ5GBmNC2mHMcrdj031ZRsCoJ`. Never print `CLERK_SECRET_KEY`.
- Production host is `iscope.poolreno.com` (+ alias `qac.poolreno.com`) + PostgreSQL. Dev seeder must not run against production. Production env comes from `deploy/qac.poolreno.com/`, not `apps/api/.env.example`.
- CSRF allow-list is `APP_URL` / `ALLOWED_ORIGINS`. A 403 on `POST /auth/login` with no account message is almost always a missing origin (site renamed, env still on the old host). Same-origin through nginx is also accepted via forwarded Host.
- Scopes and revisions share `checklist_sections`. Notes and links live in `section_references` (`kind`: `note` | `link`). Activity: `section.note_added`, `section.link_added`, `section.reference_deleted`.
- Creating a section may include an optional `reference` on `CreateSectionInput`. `UpdateSectionInput` omits `reference` — attach more notes/links through the references API after the section exists.
- Shared UI for the Note / Link switch is `apps/web/src/modules/checklist/SectionReferenceFields.tsx` (used by the add-scope form and the section page).
- Note / Link segmented control uses `w-fit` and a unique `layoutId` so the sliding pill does not collide with Scope / Revision.
- Project share: `projects.share_enabled` / `share_token`, `checklist_sections.public_visible`. Editors use `GET|PATCH /projects/:uuid/share`. Guests use `GET /share/:token` and `PATCH /share/:token/tasks/:taskUuid`. Activity `project.share_updated`.

## Pitfalls

- `npm run db:fresh` drops every table and loads sample accounts. It is refused in production and on non-SQLite. Use `npm run db:migrate` on MySQL/PostgreSQL.
- Web `VITE_API_URL=/api` in development talks to the real local API, not `mockApi`. Mock tests still cover the in-memory API.
- Link bodies are normalized with `normalizeHttpUrl` (bare hosts get `https://`). `javascript:` and other schemes are rejected.
- Field errors for a reference on create are nested: `reference.body`, `reference.title`. Standalone add-reference errors use `body` / `title`.
- Two `SegmentedControl`s on the add form need different `layoutId`s (`add-section-kind` vs `add-section-reference-kind`).
- Seeded local passwords are `password`. Do not copy production env or Clerk secrets into these notes.
- `/` is the sign-in page (landing page removed). `safeNext` must reject `/`, `/login`, `/register`, `/forgot-password`, and `/reset-password` or a successful login sends the user back to sign-in. Default fallback is `/dashboard`.
- Login Sign in must stay enabled even when React state is empty — browser autofill often skips `onChange`. Use `onInput` as well.
- Bulk remarks on a scope: pick tasks (row checkbox at the **end** of the row / Select all at the **end** of the toolbar), then `Set status…` on the left. API `POST /projects/:uuid/tasks/status` with `{ sectionUuid, status, taskUuids }`. Viewers cannot.
- Public share uses a dedicated `share_token` (not the project uuid). Nothing is public until a scope/revision is ticked. Guests tick Client on the list and read the task description under the title; they cannot open a task, clear a member Client check, or touch Developer. Emails are stripped on the public snapshot.
- Task rows show `description` under the title for both signed-in lists and the public share. Rows with no description stay title-only.
