# Scope Checklist

A project-based task checklist system: create projects, organise tasks into checklist sections, record client-requested changes as **revision** sections alongside the agreed scope (each one stamped "Revision as of …" the day it reaches 100%), track completion, collaborate with other users, and export structured checklists as professionally formatted DOCX documents — revisions print in their own block with their own progress chart.

**Current status: all seven phases complete** — authenticated users manage projects and checklists, collaborate through invitations and roles, browse a paged activity history, and export any project (or selected sections) as a formatted DOCX generated server-side from a replaceable template. Administrators get a dashboard with system statistics, a user directory with account controls, a productivity ranking that shows who is doing the work (derived from the activity log over 7/30/90 days or all time), a registry of every project including soft-deleted ones with restore, an append-only audit log, and an error log that captures unhandled API failures and crashes reported by the web app. Sign-in is either the built-in e-mail + password flow or [Clerk](https://clerk.com) (`AUTH_PROVIDER=clerk`; see `docs/DEPLOYMENT.md`), with roles and permissions staying in the application either way. The application is covered by an automated test suite, hardened for production (rate limits, security headers, start-up configuration checks, graceful shutdown) and ships with Docker, docker-compose and CI definitions. See [`docs/PHASES.md`](docs/PHASES.md) for what each phase delivered, [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the technical design and [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) to deploy it.

## Requirements

| Requirement | Development | Production |
| --- | --- | --- |
| **Node.js** | 22.5 or newer (the built-in `node:sqlite` module is used for the zero-install database); Node 24 LTS recommended and used by CI and the Docker image. | Same, or the provided Docker image (`node:24-alpine`). |
| **npm** | 9 or newer (ships with Node; npm workspaces are used). | — |
| **Database** | None — SQLite file under `apps/api/storage/` is created automatically. Optional: MySQL 8 / MariaDB 10.6+ or PostgreSQL 14+. | MySQL 8 / MariaDB 10.6+ **or** PostgreSQL 14+ (SQLite is refused unless explicitly allowed for a single-user pilot). |
| **Sign-in** | Built-in e-mail + password, nothing to set up. Optional: a [Clerk](https://clerk.com) application. | Built-in sessions, or a Clerk production instance on a domain you own. |
| **Other** | A modern browser. Git. | HTTPS in front of the app (nginx/Caddy/load balancer), a clock kept on NTP, outbound e-mail if password resets are used. Docker 24+ if you deploy the image. |

No global tools are needed: everything (`tsx`, `vite`, `esbuild`, test runner) is a local dev dependency.

## Setup

```bash
git clone <repository-url> scope-checklist
cd scope-checklist
npm install        # installs all workspaces: apps/api, apps/web, packages/contracts
npm run db:fresh   # create the SQLite database, run migrations, load sample data
```

That is the whole setup for development. No `.env` is required — every setting has a development default. To change something, copy the templates and edit them (both files are git-ignored):

```bash
cp apps/api/.env.example apps/api/.env             # API: port, database, auth provider, Clerk keys, …
cp apps/web/.env.example apps/web/.env.local       # Web: API URL, Clerk publishable key
```

Windows (PowerShell): use `Copy-Item` instead of `cp`; everything else is identical.

### Setup with MySQL/MariaDB or PostgreSQL instead of SQLite

1. Create an empty database and a user with DDL rights (MySQL: `utf8mb4`; PostgreSQL: default `UTF8`; on PostgreSQL 15+ grant `CREATE` on the `public` schema or make the user the database owner).
2. In `apps/api/.env` set `DB_CLIENT=mysql` or `DB_CLIENT=postgres` plus `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_DATABASE` — or, for PostgreSQL, a single `DATABASE_URL=postgres://user:password@host:5432/db` (add `DB_SSL=true` for managed hosts).
3. `npm run db:fresh` (development) or `npm run db:migrate` (keeps existing data). The same migration files run on all three engines.

### Setup with Clerk sign-in (optional)

1. `npx -y clerk@latest auth login`, then `npx -y clerk@latest link --app <app_id>` in the repository.
2. `cd apps/api && npx -y clerk@latest env pull --file .env` writes `CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY`; put the same publishable key in `apps/web/.env.local` as `VITE_CLERK_PUBLISHABLE_KEY`.
3. Restart `npm run dev`. The API switches to `AUTH_PROVIDER=clerk` automatically when a secret key is present; bring existing accounts across with `npm run clerk:import -w @scope/api`. Details: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md#clerk--development).

## Running

### Development

```bash
npm run dev        # API on http://localhost:4000/api, web app on http://localhost:5173
```

Both processes reload on change (`tsx watch` for the API, Vite for the web). Pending migrations are applied automatically when the API starts. Open <http://localhost:5173> and sign in with any seeded account — the password is `password` for all of them:

| Name          | Email                 | Role  | Projects                                         |
| ------------- | --------------------- | ----- | ------------------------------------------------ |
| Maya Santos   | `maya@infosoft.ph`    | admin | sees everything; "Admin" area in the sidebar     |
| Daniel Reyes  | `daniel@infosoft.ph`  | user  | owns 3 projects, editor on 1                     |
| Priya Nair    | `priya@infosoft.ph`   | user  | owns 1, editor on 1, viewer on 1                 |
| Jonas Lim     | `jonas@infosoft.ph`   | user  | viewer on 1 (read-only + comments)               |

Password-reset e-mails are printed on the API terminal in development. The seed also includes one soft-deleted project ("Legacy Intranet Migration") that administrators can restore from Admin → Projects → Deleted.

To start without the sample data, run `npm run db:migrate` instead of `db:fresh` and create your first administrator with `npm run db:seed:admin -w @scope/api -- --email you@example.com --name "Your Name"` (set the password in `SEED_ADMIN_PASSWORD`).

### Production (without Docker)

```bash
npm ci
npm run build                                   # apps/api/dist (bundled API) + apps/web/dist (static web app)
cd apps/api
node dist/scripts/migrate.js                    # or let the server apply migrations on first boot
SEED_ADMIN_PASSWORD='…' node dist/scripts/seed-admin.js --email you@example.gov.ph --name "Your Name"
node dist/server.js                             # one process answers /api/* and serves the web app when WEB_DIST is set
```

Minimum environment: `NODE_ENV=production`, `APP_URL=https://…`, `SESSION_SECURE=true`, `DB_CLIENT=mysql|postgres` with its connection settings, and `WEB_DIST=../web/dist` to serve the SPA from the same process. The server lists every unsafe or missing setting and refuses to start until they are fixed. Put a reverse proxy with TLS in front and set `TRUST_PROXY` to the number of proxies. The complete environment reference, nginx example, backups and the go-live checklist are in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

### Production with Docker

```bash
docker build -t scope-checklist .                 # one image: API + built web app (add --build-arg VITE_CLERK_PUBLISHABLE_KEY=… for Clerk)
docker compose up --build                         # local trial: API + MySQL on http://localhost:4000
docker compose -f docker-compose.yml -f docker-compose.postgres.yml up --build   # same trial on PostgreSQL
docker compose exec api node dist/scripts/seed-admin.js --email you@example.gov.ph   # first administrator
```

The root compose files are for a local production-like trial (plain http on localhost). Real deployments live under `deploy/<host>/` — see [`deploy/qac.poolreno.com/`](deploy/qac.poolreno.com/README.md) (PostgreSQL 16, nginx + Let's Encrypt): copy `api.env.example` to `api.env`, fill in the secrets, `docker compose --env-file api.env up -d --build`.

### Running tests and checks

```bash
npm test                 # API feature/unit tests (in-memory SQLite) + web unit tests
npm run check            # typecheck + tests + build — what CI runs
TEST_DB_CLIENT=postgres TEST_DATABASE_URL=postgres://… npm test -w @scope/api   # the API suite on a real PostgreSQL server
```

### All scripts

| Command              | What it does                                                        |
| -------------------- | ------------------------------------------------------------------- |
| `npm run dev:api`    | API only (`tsx watch`)                                              |
| `npm run dev:web`    | Web only (Vite)                                                     |
| `npm run build`      | Typecheck + bundle API (`apps/api/dist`) and web (`apps/web/dist`)  |
| `npm run typecheck`  | TypeScript only, both workspaces                                    |
| `npm test`           | API feature/unit tests + web unit tests (`node --test`, in-memory DB) |
| `npm run check`      | Typecheck, tests and build — what CI runs                           |
| `npm run db:migrate` | Apply pending migrations                                            |
| `npm run db:seed`    | Load development fixtures (skips if users already exist)           |
| `npm run db:fresh`   | Drop everything, migrate, seed (development only)                   |
| `npm run db:seed:admin -w @scope/api -- --email … [--name …]` | Create or promote an administrator (any environment; password via `SEED_ADMIN_PASSWORD`, not needed under Clerk) |
| `npm run db:seed:user -w @scope/api -- --email … [--name …]`  | Create a regular account the same way (`SEED_USER_PASSWORD`)        |
| `npm run clerk:import -w @scope/api [-- --dry-run] [-- --admin you@…]` | Create the local accounts in Clerk and link them (Clerk provider only) |
| `npm run preview`    | Serve the web production build locally                              |

## Configuration

Everything is configured through environment variables; the API also reads `apps/api/.env` and Vite reads `apps/web/.env.local`. The most common settings:

| Variable | Where | Purpose |
| --- | --- | --- |
| `PORT` | API | Listening port (default `4000`). |
| `APP_URL`, `ALLOWED_ORIGINS` | API | Public URL of the web app (links in e-mails, CSRF/CORS allow-list). Must be `https://` in production. |
| `DB_CLIENT` | API | `sqlite` (default), `mysql` or `postgres`. |
| `DB_FILE` | API | SQLite file (default `storage/scope.sqlite`, relative to `apps/api`). |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_DATABASE` | API | MySQL/PostgreSQL connection. |
| `DATABASE_URL`, `DB_SSL` | API | PostgreSQL connection string (wins over `DB_*`) and TLS mode (`false`, `true`, `no-verify`). |
| `AUTH_PROVIDER` | API | `session` (default) or `clerk`; unset with `CLERK_SECRET_KEY` present means `clerk`. |
| `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `CLERK_JWT_KEY` | API | Clerk credentials; written by `clerk env pull`. Never commit them. |
| `SESSION_SECURE`, `SESSION_TTL_DAYS` | API | `true` behind HTTPS (required in production); session lifetime. |
| `EXPORT_TIMEZONE` | API | Time zone printed in exported documents (default `Asia/Manila`). |
| `WEB_DIST` | API | Path to `apps/web/dist` to serve the SPA from the API process. |
| `VITE_API_URL` | Web | API base URL (`/api` through the dev proxy or same host; absolute URL when hosted separately). Blank = in-memory mock data, no API needed. |
| `VITE_CLERK_PUBLISHABLE_KEY` | Web | Clerk publishable key; unset = built-in login pages. |

The full list with explanations lives in [`apps/api/.env.example`](apps/api/.env.example) and [`apps/web/.env.example`](apps/web/.env.example); production-specific rules in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

### Letterhead logo

Exported documents open with the Infosoft letterhead. The logo is `apps/api/assets/infosoft-logo.png` (the web preview uses the copy in `apps/web/public/infosoft-logo.png`); the shipped file is a low-resolution placeholder, so replace both with a high-resolution PNG of the same name. The organisation lines, document title and logo width live in the export template (`header` block in `apps/api/src/domain/export/template.ts`).

### Running the UI without the API

Blank `VITE_API_URL` in `apps/web/.env.development` and the web app falls back to the in-memory mock data from Phase 1. Production builds (`apps/web/.env.production`) always target the real API and leave the mock and its sample fixtures out of the bundle.

## Troubleshooting

- **`node:sqlite` not found / syntax error on start** — Node is older than 22.5. Install Node 24 LTS (`node -v` to check).
- **`npm run dev` says port 4000 or 5173 is in use** — stop the other process or set `PORT` in `apps/api/.env` (and `VITE_API_URL` if the web app must reach a different port).
- **"refusing to start — fix the configuration"** — the production gate found an unsafe setting; each problem is listed on stderr with the variable to change.
- **Clerk: "This account cannot be used" or every sign-in returns 401** — the first means no local account matches the Clerk e-mail (run `db:seed:admin` / `db:seed:user` for it); the second is usually the server clock being off — sync the clock (the API logs `[clerk] … the server clock is probably off`).
- **PostgreSQL: "permission denied for schema public"** — PostgreSQL 15+ no longer grants `CREATE` on `public`; `GRANT ALL ON SCHEMA public TO <user>;` or make the user the database owner.
- **Reset the development database** — `npm run db:fresh` drops and recreates everything with sample data (never run against a real database).

## Repository layout

```
apps/
  api/                 Node 22+ / Express 5 REST API (TypeScript)
    assets/            Letterhead logo embedded in exported documents
    db/migrations/     Plain-SQL migrations (MySQL syntax + dialect tokens for SQLite/PostgreSQL)
    src/
      http/            Routes, thin controllers, zod validation, session/CSRF/error middleware
      domain/          Services (business rules), repositories (SQL), models (row → contract mappers)
        export/        Document model, template definition, DOCX generator (no HTTP/SQL)
      db/              Query abstraction, sqlite + mysql + postgres drivers, migrator, seeders
      scripts/         migrate / seed / fresh
    test/              Feature tests over HTTP (in-memory SQLite, or PostgreSQL via TEST_DB_CLIENT) + unit tests
  web/                 React 19 + TypeScript frontend (Vite, Tailwind v4, Framer Motion)
    test/              Unit tests for lib helpers and mock API rules
    src/
      app/             Shell, routing, auth guards, layout (sidebar, top bar, bottom nav, transitions)
      design-system/   Tokens + reusable primitives (Button, BottomSheet, Bento, Progress, ...)
      modules/         Feature modules: auth, dashboard, projects, checklist, collaboration, export, admin
      services/        API contract, HTTP client, in-memory mock
      store/           Zustand application state (session + data)
      vue/             Bridge for independently mounted Vue 3 modules
      lib/             Framework-agnostic helpers (dates, stats, permissions, motion presets)
packages/
  contracts/           Shared domain + API types used by the web app and the API
docs/                  Architecture, phase and deployment documentation
Dockerfile, docker-compose.yml, .github/workflows/ci.yml
```

## Design principles

- **One accent, the rest ink and greys.** Electric indigo for primary actions, active navigation, progress and selection. Everything else is near-black and neutral grey on soft off-white.
- **Slide to drill in.** Navigating deeper (project → section) slides the page horizontally; navigating back slides the other way.
- **Rise for task.** Opening a task raises a bottom sheet with a grabber, snap points and drag-to-dismiss. On desktop the same component docks as a side panel.
- **Bento grid.** Project information is organised into varied-size cards with a clear hierarchy.
- **Reduced motion respected.** All animations fall back to fades when the OS requests reduced motion.

## Security notes

- Sessions are httpOnly, `SameSite=Lax` cookies; tokens are stored hashed. Nothing sensitive is kept in browser storage.
- Passwords are hashed with scrypt. Login attempts are throttled. Password-reset tokens are single-use and expire in 60 minutes.
- Every state-changing request is CSRF-checked (allow-listed `Origin` or `X-Requested-With`).
- The API never exposes database primary keys; all public identifiers are UUIDs. Projects a user cannot see return 404.
- Administrative routes (`/api/admin/*`) are checked server-side on every call; administrators cannot lock themselves out (own role/account and the last enabled admin are protected) and every admin action is written to an append-only audit log. Accounts are disabled, never deleted.
- Public account endpoints (register, forgot/reset password, invitation redemption) are rate limited per IP; responses carry `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, `no-store` and HSTS/CSP in production. Error responses never include stack traces.
