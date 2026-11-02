# Architecture

## Goals

1. Frontend, backend, database and export are independent modules.
2. One API contract consumed by both React and Vue code.
3. No framework-specific database logic in the business layer.
4. Standard SQL types; PostgreSQL and Laravel Eloquent migration must be trivial.
5. The backend is replaceable (Node today → Laravel later) without a frontend rewrite.
6. A shared design system keeps React and Vue components visually identical.

## Workspace

npm workspaces monorepo.

| Package              | Purpose                                                                          |
| -------------------- | -------------------------------------------------------------------------------- |
| `@scope/web`         | React 19 primary frontend, with Vue 3 modules compiled by the same Vite build.   |
| `@scope/contracts`   | TypeScript types for every entity and request payload. Framework-free.           |
| `@scope/api`         | Node 22+/Express 5 REST API implementing `ScopeApi` over the SQL schema below.   |

Root scripts: `npm run dev` (both apps), `npm run typecheck`, `npm test`, `npm run build`, `npm run check` (all three), `npm run db:*`. Deployment artifacts: `Dockerfile` (single container serving SPA + API), `docker-compose.yml` (API + MySQL trial; `docker-compose.postgres.yml` override swaps in PostgreSQL), `.github/workflows/ci.yml` — see [`DEPLOYMENT.md`](DEPLOYMENT.md).

## Frontend

### Layers

```
Pages (modules/*)  →  Store (zustand)  →  services/api (ScopeApi)  →  mock | http
                   ↘  design-system primitives
```

- **`services/api/types.ts`** declares `ScopeApi`. Components never call fetch; they call store actions, which call `api`. `services/api/index.ts` selects `httpApi` when `VITE_API_URL` is set and the in-memory `mockApi` otherwise. Both throw `ApiError` (`status`, `code`, `message`, `fields[]`) so forms can show server validation inline.
- **`services/api/httpApi.ts`** is a thin `fetch` wrapper: `credentials: "include"` (session cookie), `X-Requested-With` header (CSRF marker), envelope unwrapping. A 401 on any authenticated call notifies `onUnauthorized` subscribers; the store resets and the route guard redirects to sign-in.
- **`store/useAppStore.ts`** holds the session (`currentUser`, `bootState`: `idle | loading | ready | unauthenticated | error`) plus normalised server data (`projects`, `sectionsByProject`, `tasksByProject`, …) and performs optimistic mutations. Project statistics are recomputed locally (`lib/stats.ts`) so dashboards update instantly; the server remains the source of truth and reconciles on response.
- **`lib/permissions.ts`** mirrors the backend's project-role rules (`canEditProject`, `canManageMembers`) so viewers see disabled controls. The API enforces the same rules; the client copy only shapes the UI.
- **`design-system/`** contains tokens (`tokens.css`) and primitives. Tailwind v4 reads the tokens via `@theme`, so both React (`className`) and Vue (`class`) use the same utilities.

### Vue modules

Vue is used for clearly scoped, independently mounted modules — not interleaved with React in the same tree.

- `vue/mount.ts` creates a Vue app inside a host element and exposes `update(props)` / `unmount()`.
- `vue/VueMount.tsx` is the React bridge component.
- `modules/collaboration/activity-feed/ActivityFeed.vue` is the first module (recent activity feed), rendered in the dashboard bento card and the Activity page.

Vue modules import only from `@scope/contracts` and `lib/` — never from React code.

### Routing

| Route                                   | Page             |
| --------------------------------------- | ---------------- |
| `/`                                     | Dashboard (bento) |
| `/projects`                             | Project list     |
| `/projects/:projectUuid`                | Project workspace |
| `/projects/:projectUuid/sections/:uuid` | Section drill-in |
| `/activity?project=&type=&page=`        | Paged, filterable activity history (filters live in the URL) |
| `/invitations`                          | Pending invitations addressed to me (accept / decline) |
| `/invitations/:token`                   | Target of the e-mailed invitation link; accepts on arrival |
| `/profile`                              | Profile (name, change password, sign out; administrators also get a link to `/admin`) |
| `/admin`, `/admin/users`, `/admin/productivity`, `/admin/projects`, `/admin/audit`, `/admin/errors` | Administration (admins only): system statistics, user directory + account sheet, productivity ranking (`?period=`), every project incl. deleted ones, admin audit log, error log (`?source=`, detail panel with stack trace). Filters and `?page=` live in the URL |
| `/login`, `/register`, `/forgot-password` | Public auth pages (signed-in users are redirected to the app) |
| `/reset-password?token=`                | Choose a new password from the e-mailed link |

Query parameters: `?task=<uuid>` opens the task detail sheet from any page; `?q=` is the shared search term; `/login?next=<path>` returns the user to where they were after signing in (same-origin paths only).

**Guards** (`app/guards.tsx`): `RequireAuth` wraps the app shell — it resolves the session once (`GET /auth/me`), shows a splash while loading, a retry screen if the API is unreachable, and redirects to `/login?next=` when unauthenticated. `RedirectIfAuthenticated` wraps the public pages. `RequireAdmin` wraps `/admin/*` and sends non-administrators to the dashboard; the API enforces the same check independently.

**Robustness**: the whole tree sits under a route `errorElement` (`app/ErrorPage.tsx`) — a render error, a failed lazy chunk after a redeploy ("A new version is available") or an unknown route error shows a plain explanation with Reload / Go to dashboard instead of a blank screen; details are logged to the console only. The administration module is loaded on demand (`route.lazy` → `modules/admin/index.ts`), so regular users never download it. `AppShell` sets `document.title` per page, renders a keyboard-only "Skip to content" link targeting `<main id="main">`, and shows an offline notice (`lib/useOnline.ts`) while the browser reports no connection.

**Accessibility and responsiveness** (verified at 390 / 768 / 1280): no horizontal page overflow (filter strips scroll on their own), every control has an accessible name, focus is visible (`:focus-visible` accent ring), dialogs and sheets trap focus and close on Escape, status/alert regions announce form results, touch targets are at least 32 px with `touch-action: manipulation`, and all motion falls back to fades under `prefers-reduced-motion`.

### Signature interactions

- **Slide to drill in** — `app/layout/PageTransition.tsx` computes route depth; deeper routes slide in from the right, shallower from the left, lateral moves fade.
- **Rise for task** — `design-system/BottomSheet.tsx`. Mobile: grabber, rounded top corners, dimmed backdrop, drag-to-dismiss, snap points (`snapPoints` as viewport fractions), visual-viewport tracking for the on-screen keyboard, focus trap, Escape to close, body scroll lock. Desktop: the same component renders as a side `panel` or centred `dialog`.
- **Confetti on completion** — `design-system/Confetti.tsx` + `lib/useCompletionCelebration.ts`. When a project's completion crosses into 100% while the user is on its page (project workspace or dashboard), a canvas burst erupts from the progress card and a polite status message announces it; each checklist section gets a smaller burst from its own progress bar (section card) or ring (section page) when its last task is resolved. Section bursts are driven by unfiltered completion so a "Done" filter never triggers them. Opening something that is already complete does not fire; nothing is drawn under reduced motion.
- **Data that sweeps in** — `design-system/Progress.tsx`. Every data visual animates twice: a 0.9 s ease-out *fill* the first time it appears (progress bars and rings grow from empty, `Meter` chart bars from zero width, `AnimatedNumber` counts up from 0) and a quick spring or 0.4 s glide afterwards when the value changes (ticking a task, switching the productivity period), so updates never reset to zero. Rows in charts and rankings stagger with a per-row `delay` (`index * 0.04–0.06`); the productivity ranking additionally uses `staggerChildren` + `riseIn` and `layout="position"` so rows reorder smoothly. `Meter` is decorative (`aria-hidden`; the row text carries the figure) and `AnimatedNumber` exposes only the final value to assistive tech (`sr-only`). Under `prefers-reduced-motion` all of them render the final state instantly.
- Framer Motion is configured with `reducedMotion="user"` and CSS transitions are neutralised under `prefers-reduced-motion`.

## Backend (`apps/api`)

### Layers

```
HTTP (Express)                       Domain                         Data
routes.ts → controllers/*  →  services/*  →  repositories/*  →  db/ (sqlite | mysql | postgres driver)
            validate.ts (zod)     errors.ts      models.ts (row → contract mappers)
            middleware/           (DomainError)
```

- **Controllers** are thin: validate the request (`http/validate.ts`, the Form-Request equivalent), call one service method, write the envelope (`http/response.ts`). They never touch SQL.
- **Services** own business rules: `AuthService` (register/login/logout/profile/password/reset), `ProjectService` (visibility + role checks, project create/update/status/soft-delete with the default "General" section), `ChecklistService` (sections incl. rename/delete/reorder, tasks, ticks, status changes, reorder, comments, activity logging), `MembershipService` (invitations by e-mail with hashed tokens, accept/decline/revoke, role changes, remove/leave, ownership transfer), `ActivityService` (recent feed and paged history with `type` → action mapping), `ExportService` (authorizes, builds the `ChecklistDocument`, resolves the template, calls the `DocumentGenerator`, logs `export.generated`), `AdminService` (admin-only: system statistics, user directory and account controls, all-projects registry with restore, audit log; every method starts with `assertAdmin`), `ErrorLogService` (records API 5xx and web-reported crashes; admin-only listing and detail), `ClerkAuthService` + `ClerkDirectory` (Clerk provider only: maps verified Clerk sessions to local accounts and wraps the Clerk Backend API).
- **Repositories** encapsulate SQL per aggregate and return typed rows; `domain/models.ts` maps rows to the `@scope/contracts` shapes so internal `id`s never leave the process.
- **Database** (`db/`): one `Queryable` interface (`query`, `queryOne`, `execute`, `transaction`) with three drivers — `node:sqlite` (`DatabaseSync`, zero-install default for development), `mysql2` pool (MySQL 8 / MariaDB) and `pg` pool (PostgreSQL 14+). `DB_CLIENT` selects the driver. Repositories write one MySQL-flavoured SQL dialect (`?` placeholders, `LOWER(col) LIKE ?`, inline `LIMIT/OFFSET`, `insertId` from `execute`); the PostgreSQL driver (`db/drivers/postgres.ts`) adapts it on the way out — `?` → `$n` (`toPositionalPlaceholders`, quote-aware), `INSERT … RETURNING id` to populate `insertId`, `rowCount` → `affectedRows` — and on the way back registers result parsers so rows look the same as from the other drivers (`DATE`/`TIMESTAMP` as `'YYYY-MM-DD[ HH:MM:SS]'` strings, `COUNT`/`SUM` as numbers, JSON as text for the models' `parseJsonColumn`). Transactions are `BEGIN`/`COMMIT`/`ROLLBACK` on one pooled client; `DATABASE_URL` or the `DB_*` fields plus `DB_SSL` configure the pool.
- **Migrations** are plain SQL files in `apps/api/db/migrations`, written in MySQL syntax with a handful of dialect tokens (`{{PK}}`, `{{FK}}`, `{{JSON}}`, `{{BOOL}}`, `{{ENGINE}}`) rendered per driver by `db/migrator.ts` (PostgreSQL: `BIGSERIAL PRIMARY KEY`, `BIGINT`, `JSONB`, `BOOLEAN`; it also rewrites `DATETIME` → `TIMESTAMP` and `{{BOOL}} … DEFAULT 0/1` → `FALSE/TRUE` so the files stay MySQL-shaped). Scripts are split into statements by `splitStatements`, which drops `--` comments so prose punctuation never breaks a statement. Applied files are recorded in a `migrations` ledger table; the server applies pending migrations on boot. Seeding is explicit: `db/seeders/dev.ts` loads the development fixtures and refuses to run in production; `db/seeders/accounts.ts` (`seedAdmin`, `seedUser` — the `AdminSeeder`/`UserSeeder` equivalents, exposed as `db:seed:admin` / `db:seed:user`) creates single real accounts in any environment, validates input with the registration schemas, promotes but never demotes, never changes an existing name or password, and is idempotent.
- **Response envelope**: `{ success: true, data, meta? }` or `{ success: false, error: { code, message, fields? } }`. Paged lists keep `data` as the item array and put `{ page, perPage, total, totalPages }` in `meta` (`okPage()`). `DomainError` subclasses (`ValidationError` 422, `UnauthorizedError` 401, `ForbiddenError` 403, `NotFoundError` 404, `ConflictError` 409, `TooManyRequestsError` 429) map directly; anything else is logged with context, recorded in `error_logs` for administrators (see *Error log* below) and returned as a generic 500.
- **Mail** is behind a `MailService` interface. Development uses `ConsoleMailService`, which prints reset and invitation links on the API terminal; a real provider plugs in without touching `AuthService` or `MembershipService`.

### REST routes

All routes are under `/api`; public identifiers are `uuid`s.

| Method | Path                                   | Notes                                             |
| ------ | -------------------------------------- | ------------------------------------------------- |
| GET    | `/auth/provider`                       | Public: `{ provider: "session" \| "clerk" }`      |
| POST   | `/auth/register`, `/auth/login`        | Set the session cookie; 201/200 with `User`. `409 auth_managed_externally` (as are `password`, `forgot-password`, `reset-password`) under Clerk |
| POST   | `/auth/logout`                         | Revoke session, clear cookie                      |
| GET    | `/auth/me`                             | Current `User` or 401                             |
| PATCH  | `/auth/profile`                        | `{ name?, email? }`                               |
| POST   | `/auth/password`                       | `{ currentPassword, newPassword }`; revokes other sessions |
| POST   | `/auth/forgot-password`                | Always 202 (no account enumeration)               |
| POST   | `/auth/reset-password`                 | `{ token, password }`                             |
| GET/POST | `/projects`                          | Visible projects / create (owner + "General" section) |
| GET    | `/projects/:uuid`                      | 404 when not visible (never 403 — hides existence) |
| PATCH  | `/projects/:uuid`                      | Strict body `{ name?, description?, startDate?, deadline?, status? }`; `status` is owner/admin only; logs `project.updated` / `project.status_changed` |
| DELETE | `/projects/:uuid`                      | Owner/admin only; soft delete (members, tasks and history retained); logs `project.deleted` |
| GET/POST | `/projects/:uuid/sections`           | POST body `{ title, description?, kind? }` — `kind` is `scope` (default) or `revision` |
| POST   | `/projects/:uuid/sections/reorder`     | `{ orderedSectionUuids }`; foreign uuids ignored  |
| PATCH/DELETE | `/sections/:uuid`                | `{ title?, description?, kind? }`; delete soft-deletes the section and its tasks, 409 for the last section of a project |
| GET/POST | `/projects/:uuid/tasks`              |                                                   |
| POST   | `/projects/:uuid/tasks/reorder`        | `{ sectionUuid, orderedTaskUuids }`               |
| PATCH/DELETE | `/tasks/:uuid`                   | Strict body; `developerChecked`/`clientChecked` booleans are stamped server-side; delete is soft |
| GET/POST | `/tasks/:uuid/comments`              | Viewers may comment                               |
| GET    | `/activity?project=&limit=`            | Scoped to visible projects (recent feed)          |
| GET    | `/activity?project=&type=&page=&perPage=` | Paged history; `type` ∈ `all, tasks, checks, comments, members, project`; `perPage` ≤ 100; paging in `meta` |
| POST   | `/errors`                              | `ClientErrorReport` from the web app (`message`, optional `name`, `stack`, `path`, `context`); 202, works signed out; 30 per IP / 10 min |
| GET/POST | `/projects/:uuid/invitations`        | Owner/admin. Create: `{ email, role: editor \| viewer }`; 422 on `email` if already a member or already pending; e-mails `${APP_URL}/invitations/<token>` |
| DELETE | `/projects/:uuid/invitations/:uuid`    | Revoke a pending invitation (409 once answered)   |
| PATCH  | `/projects/:uuid/members/:uuid`        | `{ role: editor \| viewer }`; owner/admin; the owner's row is 409 |
| DELETE | `/projects/:uuid/members/:uuid`        | Owner/admin removes another member (self → 409, owner → 409) |
| POST   | `/projects/:uuid/members/leave`        | Editors/viewers leave; owners 409                 |
| POST   | `/projects/:uuid/members/transfer`     | `{ memberUuid }`; owner/admin; previous owner becomes editor |
| GET    | `/invitations`                         | Pending invitations for the signed-in e-mail      |
| POST   | `/invitations/:uuid/accept`, `/invitations/:uuid/decline` | Invitee only (403 names the invited address); returns the `Project` on accept |
| POST   | `/invitations/accept-token`            | `{ token }` from the e-mail link; 400 `invalid_token` when unknown or used |
| GET    | `/export-templates`                    | Document templates (default first); no layout JSON is exposed |
| POST   | `/projects/:uuid/exports`              | Any member. Strict body `{ sectionUuids?, includeDescriptions?, includeCheckDetails?, includeChart?, templateUuid?, timeZone? }` (`includeSignature?` is still accepted for older clients and ignored). **Success body is the `.docx` file** (`Content-Disposition: attachment`, `X-Export-Template/Sections/Tasks` headers); errors keep the JSON envelope. Logs `export.generated` |
| GET    | `/admin/stats`                         | Admin only (all `/admin/*` routes: 401 anonymous, 403 non-admin). `AdminStats` aggregates |
| GET    | `/admin/users?search=&role=&status=&page=&perPage=` | Paged `AdminUser` directory; `role` ∈ `all, admin, user`; `status` ∈ `all, active, disabled` |
| PATCH  | `/admin/users/:uuid`                   | Strict `{ name?, email?, role? }`; own role 409; last enabled admin 409; audits `user.updated` / `user.role_changed` |
| POST   | `/admin/users/:uuid/disable`, `/enable` | Disable revokes sessions and blocks login (403 `account_disabled`); self / last admin 409 |
| POST   | `/admin/users/:uuid/revoke-sessions`   | Sign the account out everywhere (caller's current session kept) |
| POST   | `/admin/users/:uuid/password-reset`    | 202; mails the reset link; 409 for disabled accounts |
| GET    | `/admin/projects?search=&status=&page=&perPage=` | Every project (`AdminProject` adds `deletedAt`); `status` ∈ `all, active, completed, archived, deleted`; search by project or owner name |
| POST   | `/admin/projects/:uuid/restore`        | Clears `deleted_at`; 409 if not deleted; logs `project.restored` (activity + audit) |
| GET    | `/admin/audit?page=&perPage=`          | Paged `AdminAuditEntry` list, newest first       |
| GET    | `/admin/productivity?period=`          | `AdminProductivity`: every account ranked by weighted activity (`7d` / `30d` / `90d` / `all`, default `30d`) |
| GET    | `/admin/errors?source=&search=&page=&perPage=` | Paged `AdminErrorLog` list, newest first; `source` ∈ `all, api, web`; search over message, code and path |
| GET    | `/admin/errors/:uuid`                  | One entry including the stack trace and context  |
| GET    | `/health`                              |                                                   |

### Authentication and authorization

- **Provider switch** (`AUTH_PROVIDER`, default `session`; `clerk` when Clerk keys are present): exactly one principal resolver is mounted — the cookie session below, or the Clerk token resolver. Everything after `req.auth` (roles, memberships, `assertAdmin`, project rules) is identical for both. `GET /auth/provider` tells the web app which one is active.
- **Sessions**: a random 32-byte token in an `httpOnly`, `SameSite=Lax` cookie (`scope_session`); only its SHA-256 hash is stored in `sessions`. Sliding 14-day expiry, touched at most every 5 minutes. Nothing is stored in browser local storage.
- **Clerk** (`AUTH_PROVIDER=clerk`): the browser signs in through Clerk's components and sends `Authorization: Bearer <Clerk session token>` on every call (`services/auth/externalAuth.ts` installs the token source; the token is fetched per request, never stored). `http/middleware/clerk.ts` verifies it with `@clerk/backend` behind a `ClerkTokenVerifier` interface — locally against the instance's public key when `CLERK_JWT_KEY` is set (issuer must be the Frontend API encoded in the publishable key, `azp` must be `APP_URL` or an allowed origin), otherwise via the JWKS fetched with the secret key — and `ClerkAuthService` maps the Clerk user to a local account: already linked by `users.clerk_user_id` → as is; same e-mail → linked on first sign-in (this is how imported and pre-existing accounts come across); otherwise a new account with the default role, just as `/auth/register` did (`password_hash` holds a non-scrypt sentinel so the built-in login can never accept it). Each Clerk session gets a *mirror row* in `sessions` keyed by `sha256("clerk:" + sid)`, so "last seen", the admin directory and "revoke sessions" keep their meaning; the row is only trusted when it belongs to the same Clerk user the token names. Disabled accounts are refused with `401 account_disabled` even with a valid token; a Clerk user without an e-mail is `401 unknown_identity`. Admin *disable* and *revoke sessions* also end the user's sessions at Clerk through `ClerkDirectory` (the only place the Backend API is called; `ClerkBackendDirectory` is the SDK implementation, tests use an in-memory one). The password endpoints (`register`, `login`, `password`, `forgot-password`, `reset-password`) answer `409 auth_managed_externally`; `logout` drops the mirror row and the browser ends the Clerk session. `npm run clerk:import -w @scope/api` creates/links Clerk users for every local account (our `uuid` as Clerk `external_id`, no password — people choose one through Clerk's reset flow, since scrypt hashes cannot be imported) and `--admin <email>` guarantees an administrator account for a real inbox.
- **Passwords**: scrypt with per-user salt (`scrypt$N$r$p$salt$hash`). Minimum 8 characters.
- **Login throttle**: 5 failed attempts per e-mail+IP in 15 minutes → 429.
- **Password reset**: single-use token (hashed at rest, 60-minute TTL), mailed as `${APP_URL}/reset-password?token=…`; a successful reset revokes every session for the user.
- **CSRF**: state-changing requests must carry an allow-listed `Origin` (`ALLOWED_ORIGINS`, default `APP_URL`) or the `X-Requested-With: XMLHttpRequest` header. Safe methods are unrestricted.
- **Disabled accounts**: `users.disabled_at` is set by an administrator. A disabled account cannot sign in (403 `account_disabled`), its sessions stop resolving (they are also deleted at the moment of disabling), and forgot-password requests for it are ignored (still 202). Accounts are disabled rather than deleted so authorship and history stay intact.
- **Administration**: all `/admin/*` routes require `role = admin`, checked in `AdminService` on every call. Administrators cannot change their own role or disable themselves, and the last enabled administrator can be neither demoted nor disabled. Every administrative action is appended to `admin_audit_logs` with the acting user, target and a short `meta` (e.g. `{ from, to }` for role changes); project restores are also written to the project's activity log.
- **Roles**: `users.role` is `admin` or `user`. Admins see every project. Everyone else sees projects where they have a `project_members` row (`owner`, `editor`, `viewer`). Owners and editors mutate; viewers read and comment. Project status changes, project deletion and membership management (invite, revoke, change role, remove, transfer ownership) are reserved for the owner (and admins); any editor or viewer may leave. Invitations are addressed to an e-mail and can only be accepted by an account with that e-mail. Invisible projects return 404. The frontend mirrors these rules in `lib/permissions.ts` to hide controls; the API remains the source of truth.
- **Invitation tokens**: random 32-byte token, only its SHA-256 hash stored in `project_invitations.token_hash`; cleared when the invitation is accepted, declined or revoked. Invitations are never deleted.

### Configuration

Environment variables (see `apps/api/.env.example`): `NODE_ENV`, `PORT` (4000), `APP_URL`, `ALLOWED_ORIGINS`, `DB_CLIENT` (`sqlite` | `mysql` | `postgres`), `DB_FILE`, `DB_HOST/PORT/USER/PASSWORD/DATABASE`, `DATABASE_URL`, `DB_SSL`, `SESSION_COOKIE`, `SESSION_TTL_DAYS`, `SESSION_SECURE`, `PASSWORD_RESET_TTL_MINUTES`, `EXPORT_TIMEZONE` (`Asia/Manila`), `WEB_DIST`, `LOG_REQUESTS`, `TRUST_PROXY`, `ALLOW_SQLITE_IN_PRODUCTION`, `ALLOW_INSECURE_PRODUCTION`. Development runs with no `.env` at all (SQLite file under `apps/api/storage/`). `productionConfigProblems()` lists unsafe combinations and `server.ts` refuses to start in production while any exist (see [`DEPLOYMENT.md`](DEPLOYMENT.md)).

### Hardening

- **Headers** on every response: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: same-origin`, `Permissions-Policy` (camera/microphone/geolocation off), `Cache-Control: no-store`, no `X-Powered-By`; `Strict-Transport-Security` when `SESSION_SECURE=true`. HTML served from `WEB_DIST` also carries a strict `Content-Security-Policy` (`default-src 'self'`, `frame-ancestors 'none'`, …).
- **Rate limits** (`middleware/rateLimit.ts`, in-process fixed window per IP, `RateLimit-*` and `Retry-After` headers, 429 `too_many_requests`): register and forgot-password 10 / 15 min; reset-password and invitation token redemption 20 / 15 min. Login keeps its own 5-failures-per-e-mail+IP throttle. Replace with a shared store if more than one replica must share limits.
- **Bodies**: JSON only, 256 kB cap (413), malformed JSON → 400 `invalid_json`.
- **Health**: `GET /api/health` pings the database — `200 {status:"ok", db:"ok"}` or `503 unavailable`.
- **Process**: `trust proxy` from `TRUST_PROXY`; optional access log (`[http] METHOD path status ms`, never bodies or query strings); keep-alive/headers timeouts set for proxies; `SIGTERM`/`SIGINT` drain in-flight requests for up to 10 s, close the database and exit 0; uncaught exceptions trigger the same shutdown.
- **Static serving** (`middleware/static.ts`, only when `WEB_DIST` is set): `/assets/*` immutable for a year, other files one hour, every non-`/api` navigation gets `index.html` with `no-store` + CSP; requests for missing files with an extension or JSON-only clients still get 404.
- **Build**: `npm run build` bundles the API (and `@scope/contracts`) into `apps/api/dist` with `express`, `mysql2`, `pg`, `docx`, `zod`, `@clerk/express` as the only runtime dependencies; the web build made with `VITE_API_URL` set excludes the mock API and its sample fixtures.

### Testing

Node's built-in runner (`node --test`) with `tsx` — no extra framework. `npm test` at the root runs both workspaces.

- `apps/api/test/*.test.ts` — **feature tests** start the real Express app over HTTP (`startTestServer()` in `test/helpers.ts`: in-memory SQLite by default — or a real PostgreSQL server with `TEST_DB_CLIENT=postgres` and `TEST_DATABASE_URL`, each test server in its own schema — migrations + development seed, capturing mail service, cookie-jar client; CI runs the suite on both). They cover authentication and sessions (CSRF, CORS, throttle, headers, reset flow), projects/sections/tasks and permissions, invitations and membership, DOCX export (headers, ZIP magic, options, validation), the admin area (roles, disable/enable, restore, audit) and **unit tests** for pure helpers (hashing, SQL rendering, date helpers, validation, document model, template parsing, progress chart breakdown and PNG rasterising).
- `apps/web/test/*.test.ts` — unit tests for `lib/` (stats, dates, permissions, routes, `ApiError`) and the mock API's rule enforcement, which doubles as a contract check for the UI's optimistic behaviour.
- Tests use the seeded sample accounts only; nothing touches a file database.

### Laravel migration path

The layering is deliberately the Laravel shape: controllers ↔ Controllers, `validate.ts` ↔ Form Requests, services ↔ Services/Actions, repositories ↔ Repositories/Eloquent, migrations ↔ migrations, `dev.ts` ↔ seeders, `DomainError` ↔ exception handler, envelope ↔ API resources. The SQL schema uses standard types (`BIGINT UNSIGNED`, `VARCHAR`, `DATETIME`, `DATE`, `JSON`, `TINYINT(1)`), `*_at` timestamps and `deleted_at` soft deletes, so the same tables map onto Eloquent models with no renames. Sanctum cookie sessions replace `sessions` one-for-one because the frontend already relies on an httpOnly cookie rather than a bearer token.

## Database

Normalised relational schema; standard SQL types only; integer PKs internally, `uuid` columns for all public identifiers. Implemented by the migrations in `apps/api/db/migrations` (`0001_create_users`, `0002_create_projects`, `0003_create_checklists`, `0004_create_activity_and_templates`, `0005_admin_accounts_and_audit`); `sessions` and `password_resets` support authentication.

```
users                 id, uuid, name, email, password_hash, role, avatar_url, disabled_at, clerk_user_id (nullable, unique), timestamps, deleted_at
sessions              id, user_id→users, token_hash (unique), ip_address, user_agent, created_at, last_seen_at, expires_at
password_resets       id, user_id→users, token_hash (unique), expires_at, used_at, created_at
projects              id, uuid, owner_id→users, name, description, status, start_date, deadline, timestamps, deleted_at
project_members       id, uuid, project_id→projects, user_id→users, role, joined_at   (unique project_id+user_id)
project_invitations   id, uuid, project_id, email, role, status, invited_by→users, token_hash, created_at, responded_at
checklist_sections    id, uuid, project_id, title, description, kind ('scope' | 'revision'), position, completed_at (set when every task is resolved, cleared when work reopens), timestamps, deleted_at
tasks                 id, uuid, project_id, section_id, title, description, status (varchar, see below),
                      developer_checked_by→users (nullable), developer_checked_at (nullable),
                      client_checked_by→users (nullable), client_checked_at (nullable),
                      due_date, priority, assignee_id→users, position, timestamps, deleted_at
task_comments         id, uuid, task_id, author_id→users, body, timestamps, deleted_at
activity_logs         id, uuid, project_id, actor_id→users, action, subject, meta (json, nullable), created_at
export_templates      id, uuid, name, description, is_default, definition (json), timestamps
admin_audit_logs      id, uuid, actor_id→users, action, target_type (user | project), target_uuid, subject, meta (json, nullable), created_at
error_logs            id, uuid, source (api | web), status (nullable), code, message, stack, method, path, actor_id→users (nullable), user_agent, context (json, nullable), created_at
```

Indexes: every `uuid` (unique), every FK, `tasks(section_id, position)`, `tasks(assignee_id)`, `tasks(due_date)`, `activity_logs(project_id, created_at)`, `project_invitations(email, status)`, `admin_audit_logs(created_at)`, `admin_audit_logs(target_type, target_uuid)`, `error_logs(created_at)`, `error_logs(source, created_at)`.

Soft deletes (`deleted_at`) on user-authored records preserve history and auditability. Activity logs, admin audit logs and error logs are append-only. Soft-deleted projects can be restored by an administrator (`POST /admin/projects/:uuid/restore`); nothing is purged.

### Task status and "Checked by"

Each task mirrors one row of the scope document:

- **Checked by — Developer / Client.** Two independent ticks. Ticking stores the acting user and the server time (`*_checked_by`, `*_checked_at`); clearing nulls both and writes a `task.unchecked` activity, so history survives in `activity_logs`. Clients never send the user or timestamp; the API derives them from the session.
- **Remarks.** `tasks.status` is one of: `not_started`, `in_development`, `for_qa`, `for_revision`, `done_for_production`, `for_user_acceptance`, `done`, `for_beta_testing`, `completed`, `on_hold`, `not_applicable` (see `TASK_STATUSES` in `@scope/contracts`). Labels and colours live in `apps/web/src/lib/taskStatus.ts`. Every change writes `task.status_changed` with `{ from, to }`.
- **Progress.** A task counts as resolved when its status is `done_for_production`, `done`, `completed` or `not_applicable` (`RESOLVED_TASK_STATUSES`). Project and section percentages use that rule; the ticks do not affect progress.

Role gating (only developer-side members tick Developer, only client-side members tick Client) is a Phase 4 authorization rule; today any owner/editor may tick either box and viewers may tick neither.

## Export

```
ExportService ─▶ buildChecklistDocument(project, sections, tasks, options) ─▶ ChecklistDocument
              ─▶ parseTemplateDefinition(export_templates.definition)      ─▶ ExportTemplateDefinition
              ─▶ DocumentGenerator.generate(document, template)            ─▶ { buffer, contentType, extension }
```

Everything lives in `apps/api/src/domain/export/` and knows nothing about HTTP or SQL:

- **`document.ts`** — the `ChecklistDocument` model (title, description, owner, dates, numbered sections, items with status and both "checked by" records, options, who generated it) and `buildChecklistDocument`, which groups tasks under their sections preserving stored positions. Each `DocumentSection` carries its `kind` and `completedAt`; scope sections and revisions are numbered independently (1, 2, … and R1, R2, …) and `sectionsOfKind(doc, kind)` splits them for the generator and the charts. Also `documentFileName` (`<slug>-scope-checklist-<date>.docx`).
- **`chart.ts`** — the progress chart. `statusBreakdown({ sections })` counts the items of the given sections per status (largest first, ties in contract order) and the resolved share using `RESOLVED_TASK_STATUSES`; `renderPieChartPng(slices)` rasterises a pie (clockwise from 12 o'clock, anti-aliased by super-sampling edge pixels only, transparent background) and encodes it as PNG with nothing but `node:zlib` — no native canvas, headless browser or image library, so the API still runs anywhere Node runs. Labels are deliberately not drawn into the bitmap; the generator prints them as real text next to the image.
- **`template.ts`** — `ExportTemplateDefinition`: page size/orientation/margins, font, colours, column widths, every label (including `revisions`, `revisionProgress`, the `revisionPrefix` "R" used to number revision sections and `revisionAsOf`, printed beside a finished revision's title with its completion date), per-status labels and fills, a `header` block for the letterhead (`logo` — a PNG file name resolved in the API's `assets/` directory, or an absolute path, empty to omit — `logoWidthPt`, the bold `organisation` lines, the `documentTitle` "Purchase Order Checklist" and the `connector` "FOR"), a `chart` block (`enabled`, `sizePt`, slice `colors` per status — the same hues as the status dots in the web app), checkbox glyphs and footer switches. `DEFAULT_TEMPLATE_DEFINITION` is the "checked-by-table" layout; `parseTemplateDefinition` deep-merges a stored (possibly partial or legacy) JSON definition over it, so a template row can override just `colors.headerFill` or the labels. Templates are data: changing the look never touches checklist code.
- **`DocumentGenerator.ts`** — the `DocumentGenerator` interface and `DocxDocumentGenerator` (library: `docx`; constructed with `{ assetsDir, log }` — `app.ts` passes `apps/api/assets`). Output: a centred letterhead (logo image read once per file name and cached, falling back to no logo with a logged warning if the file is missing; organisation lines in bold; the document title; "FOR"; the bold project name), the description left-aligned with continuation lines indented, then the **scope**: an optional **Progress** block (heading, "N% complete · r resolved of t items", then a borderless two-cell table holding the pie image — `ImageRun`, rendered at 3 px/pt — and a legend of colour swatch, status label, count and share in slice order; skipped when `includeChart` is false, the template disables it or there are no items) and one table whose two-row header ("Checked by → Developer | Client", "Item Description", "Remarks") repeats on every page, a numbered section row kept with its first item, one row per task with real Word checkbox content controls (plus the logged date, time and name under a tick, unless the export sets `includeCheckDetails: false` or the template's `checkbox.showCheckedAt` is off), the status label in a tinted Remarks cell, rows that cannot split across pages. When the export includes revision sections, a **Revisions** block follows with its own "Revision progress" chart counting revision items only and one table per revision, each opened by a full-width banner row — "Revision as of July 17, 2026" (from `completedAt`, in the export's time zone) once finished, the revision's title until then — in place of the numbered section row; an export of revisions only skips the empty scope table. The page ends with a footer carrying the generation date and "Page X of Y". A PDF or HTML generator would implement the same interface.

`ExportService` authorizes through `ProjectService.requireViewable` (viewers may export — it is a read), validates the selected sections against the project (422 on `sectionUuids`), resolves the template (`templateUuid` or the default), applies the requested IANA `timeZone` (falls back to `EXPORT_TIMEZONE`), generates, and records `export.generated` with `{ template, sections, tasks, partial }` — the activity log is the export history. Files are generated on demand and streamed; nothing is stored.

The frontend's `ExportPreviewSheet` renders the same structure as HTML from the same data (sections, tasks, options) — the letterhead (the logo is served from `apps/web/public/infosoft-logo.png`, a copy of the API asset), the progress block as an inline SVG pie with the same ordering and colours (`ProgressChartPreview`), the scope table and, when revision sections are selected, the Revisions heading with its own chart and one banner-topped table per revision — lets the user pick sections/options/template, calls `exportProject` and saves the returned blob (`lib/download.ts`). Status labels come from `TASK_STATUS_LABELS` in `@scope/contracts` so the preview, the UI chips and the document always agree.

## Administration

```
AdminController → AdminService.assertAdmin(actor) → StatsRepository | UserRepository | ProjectRepository | AdminAuditRepository
                                                   ↘ AuthService.sendPasswordReset  (reuses the forgot-password mail)
```

- **Statistics** (`StatsRepository.systemStats`) are computed with a handful of parallel aggregate queries at request time — counts over users, sessions (active in the last 7 days), projects by state (including deleted and overdue), tasks by status, memberships, pending invitations, comments, exports (from `activity_logs`) and recent activity. No denormalised counters are stored.
- **User directory** (`UserRepository.page`) joins the aggregates each row needs (last seen, owned projects, memberships) in one paged query with optional search, role and enabled/disabled filters. Mutations go through `AdminService`, which applies the self/last-admin rules, keeps e-mails unique, revokes sessions when disabling and records the audit entry in the same transaction.
- **Project registry** (`ProjectRepository.pageAll`) is the only read path that includes soft-deleted projects. Restore clears `deleted_at` and logs `project.restored` to both the project's activity and the audit log; archiving, completing and deleting reuse the ordinary project endpoints because administrators already satisfy their owner check.
- **Audit log** (`admin_audit_logs`) is append-only and separate from project activity because its subjects (accounts, roles, sessions) are not scoped to a project. Each entry carries the acting user, `action`, `target_type`/`target_uuid`, a display `subject` and a small `meta` object.
- **Error log** (`error_logs`, `ErrorLogRepository` + `ErrorLogService`) collects failures from two sources. *API*: the Express `errorHandler` accepts a `record` hook; every unhandled exception and every `DomainError` with a 5xx status is persisted with status, code, message, stack, method, path (query string dropped), the signed-in actor and user agent — expected 4xx outcomes are not errors and are not stored. Persisting is best-effort and never changes the response (recorder failures go to the server log). *Web*: `POST /errors` accepts a `ClientErrorReport` from the browser, signed in or not, rate-limited per IP; the web app sends it from the route `ErrorPage` (render crashes), `window.onerror` and `unhandledrejection` (`lib/errorReporting.ts`), skipping `ApiError`s (already known server-side), 404 route responses and stale-chunk reloads, de-duplicating by message per page load and capping at ten reports. Long fields are truncated by the repository (`message` 2 000, `stack` 8 000, `context` 4 000 chars). Entries are never edited or deleted; stack traces are visible only to administrators through `/admin/errors` and never in API responses to end users. `AdminStats.errors` carries the total and the 24-hour / 7-day counts for the Overview.
- **Productivity** (`StatsRepository.productivity` + `AdminService.productivity`) is derived from `activity_logs` at request time — nothing extra is stored. Every actor's entries inside the look-back window are grouped by action and mapped to a bucket by `productivityBucket()` in `@scope/contracts` (`task.status_changed` counts as *completed* only when `meta.to` is a resolved status, otherwise as an update), then scored by the service with `productivityScore()` using the deployment's weights (`config.productivity.weights`, from `PRODUCTIVITY_WEIGHTS` — defaults `completed 5 · checked 3 · created 2 · update/comment/export/other 1`; the repository returns unscored counts). The response carries the weights in use so the UI legend always matches the numbers; a malformed override is reported by the start-up configuration gate. Active days (`COUNT(DISTINCT` date`)`), distinct projects and last activity ride along in the same grouped query. Status-change rows are classified in JavaScript rather than with dialect-specific JSON SQL so SQLite and MySQL behave identically. The weights and the mapping live in the contracts package so the API, the mock API and the UI's legend agree; every account is returned (idle ones with zero counts) so administrators also see who has been inactive.
- **Frontend** (`modules/admin/`): page-local paged fetching through `api` with filters and the page in the URL (`usePagedQuery`, `useListParams`), a shared `Pagination` primitive, a `UserDetailSheet` whose actions each confirm before calling the API, and `AdminProductivityPage` (period switch in `?period=`, leader card, relative-score bars with a per-bucket breakdown, idle accounts, scoring legend; the Overview shows the top three for the last 30 days). The `RequireAdmin` guard hides the area from regular users; the API remains the authority.
