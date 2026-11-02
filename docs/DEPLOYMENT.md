# Deployment

The application ships as one Node process (`apps/api/dist/server.js`) that answers `/api/*` and, when `WEB_DIST` is set, serves the built web app for every other path. A MySQL 8 / MariaDB 10.6+ **or PostgreSQL 14+** database is the only external dependency.

## Topologies

| Topology | How | When |
| --- | --- | --- |
| **Single container** (recommended) | `docker build -t scope-checklist .`; run with the environment below. The image serves SPA + API on `PORT`. | Most deployments. Put TLS termination (nginx, Caddy, a cloud load balancer) in front. |
| **API + static host** | Deploy `apps/api` (dist + `db/migrations` + production deps) with `WEB_DIST` unset; publish `apps/web/dist` from nginx or a CDN; proxy `/api` to the Node process. | When the frontend must live on a CDN or an existing web server. |
| **Local trial** | `docker compose up --build` → <http://localhost:4000> (add `-f docker-compose.yml -f docker-compose.postgres.yml` for PostgreSQL) | Trying the production build with MySQL or PostgreSQL on a workstation. Uses `ALLOW_INSECURE_PRODUCTION=true`; never reuse that setting for real users. |

If the web app is served from another origin than the API, set `ALLOWED_ORIGINS` to that origin (CORS + CSRF allow-list) and keep `APP_URL` pointing at the web app so e-mailed links are correct. Same-origin deployment needs neither.

## Environment

All variables are documented in [`apps/api/.env.example`](../apps/api/.env.example). The production-relevant ones:

| Variable | Production value |
| --- | --- |
| `NODE_ENV` | `production` — enables the start-up checks below and `SESSION_SECURE=true` by default. |
| `PORT` | Listening port (default 4000). |
| `APP_URL` | Public **https** URL of the web app; embedded in reset/invitation e-mails and used as the default CSRF origin. |
| `ALLOWED_ORIGINS` | Comma-separated origins allowed to call the API with cookies. Default `APP_URL`. |
| `DB_CLIENT` | `mysql` or `postgres`. SQLite is refused in production unless `ALLOW_SQLITE_IN_PRODUCTION=true` (single-user pilots). |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_DATABASE` | Database connection (`DB_PORT` defaults to 3306 / 5432, `DB_USER` to `root` / `postgres` per client). The database must exist; tables are created by migrations. `DB_PASSWORD` must be non-empty. |
| `DATABASE_URL` | PostgreSQL only. `postgres://user:password@host:5432/db` as handed out by managed hosts; when set it replaces the `DB_*` connection fields (and satisfies the password check). |
| `DB_SSL` | PostgreSQL only. `false` (default), `true` (TLS, server certificate verified) or `no-verify` (TLS without verification — managed hosts with self-signed chains). |
| `SESSION_SECURE` | `true` — cookie is `Secure` and the API sends `Strict-Transport-Security`. |
| `AUTH_PROVIDER` | `session` (built-in e-mail + password, default) or `clerk`. Unset with `CLERK_SECRET_KEY` present means `clerk`. |
| `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY` | Clerk only. Written by `npx -y clerk@latest env pull` in `apps/api` (the API loads `apps/api/.env`). Production refuses `sk_test_`/`pk_test_` keys. The web build needs the same publishable key as `VITE_CLERK_PUBLISHABLE_KEY`. |
| `CLERK_CLOCK_SKEW_MS` | Clerk only. Allowed drift between the server clock and Clerk's when checking token `nbf`/`exp` (default 60000, max 300000). Clerk's SDK default of 5 s is tighter than many hosts manage; keep the host on NTP regardless — when tokens are rejected for clock reasons the API logs `[clerk] … the server clock is probably off`. |
| `CLERK_JWT_KEY` | Optional, recommended. The instance's PEM "JWT public key" (Dashboard → API keys). Session tokens are then verified locally — no JWKS fetch, no dependency on Clerk being reachable per request. Quote the value so the line breaks survive (`\n` escapes also work). |
| `SESSION_TTL_DAYS`, `SESSION_COOKIE`, `PASSWORD_RESET_TTL_MINUTES` | Defaults are fine (14 days, `scope_session`, 60 minutes). |
| `EXPORT_TIMEZONE` | IANA zone printed on "checked at" timestamps when a browser sends none (`Asia/Manila`). |
| `PRODUCTIVITY_WEIGHTS` | Optional. Points per activity bucket for Admin → Productivity, e.g. `tasksCompleted=8,comments=2`; unlisted buckets keep their defaults (completed 5, checked 3, created 2, everything else 1). Buckets: `tasksCompleted`, `tasksChecked`, `tasksCreated`, `tasksUpdated`, `comments`, `exports`, `other`. A typo or non-integer refuses start-up. |
| `WEB_DIST` | Path to `apps/web/dist` to serve the SPA from the API (`/app/apps/web/dist` in the image). |
| `TRUST_PROXY` | Number of reverse proxies in front of the process (default 1) so client IPs and `https` detection are right. |
| `LOG_REQUESTS` | `true` for one access-log line per request (method, path, status, duration; never bodies or query strings). |

### Start-up checks

With `NODE_ENV=production` the server refuses to start (exit code 1, problems listed on stderr) when: `APP_URL` is not `https://`, `ALLOWED_ORIGINS` contains a localhost origin, `SESSION_SECURE` is not `true`, `DB_CLIENT=mysql` with an empty `DB_PASSWORD`, `DB_CLIENT=postgres` with neither `DB_PASSWORD` nor `DATABASE_URL`, or `DB_CLIENT=sqlite` without `ALLOW_SQLITE_IN_PRODUCTION=true`. An unknown `DB_CLIENT` or `DB_SSL` value is refused in every environment. In every environment it also refuses `AUTH_PROVIDER=clerk` without both Clerk keys, and in production Clerk development keys.

### Clerk — development

1. Sign in to the CLI from your own terminal: `npx -y clerk@latest auth login`.
2. Link the repository to the application and pull the development keys: `npx -y clerk@latest link --app <app_id>`, then `cd apps/api && npx -y clerk@latest env pull --file .env` and put the same publishable key in `apps/web/.env.local` as `VITE_CLERK_PUBLISHABLE_KEY`. Optionally add the instance's JWT public key as `CLERK_JWT_KEY`.
3. Bring existing accounts across: `npm run clerk:import -w @scope/api` (add `-- --dry-run` first; `-- --admin you@example.gov.ph` runs the administrator seeder for a real inbox before linking). Imported users set a password through Clerk's "Forgot password" on first sign-in.

### Clerk — production

Development instances show a "Development mode" badge, use Clerk's shared OAuth credentials and only work on `localhost`. Production needs the application's **production instance** on a domain you own:

1. `npx -y clerk@latest deploy --domain scope.example.gov.ph` creates the production instance and prints the DNS records (Frontend API, account portal, e-mail) to add at your DNS provider; `npx -y clerk@latest deploy status --wait` polls until DNS, SSL and e-mail DNS are verified. Hosting-provider URLs (`*.vercel.app`, `*.ondigitalocean.app`) are not accepted — it must be your domain.
2. Social providers you keep need your own OAuth client ID/secret (Google, GitHub, …); e-mail sign-in needs nothing. The `deploy` flow collects them, or use Dashboard → SSO connections.
3. Production keys are a different set (`pk_live_` / `sk_live_`) **and the production instance has its own JWT public key** — the development PEM will not verify production tokens. Fetch them with `npx -y clerk@latest env pull --instance prod --print` and hand them to the host's secret store; never into a committed file.
4. Build the web bundle with the live publishable key (`docker build --build-arg VITE_CLERK_PUBLISHABLE_KEY=pk_live_… .` or `VITE_CLERK_PUBLISHABLE_KEY` in the build environment) and run the API with `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `CLERK_JWT_KEY`. Keep `APP_URL` (and `ALLOWED_ORIGINS`) exact: tokens are only accepted when their `azp` matches one of them.
5. Bootstrap the first administrator *before* anyone signs in: `node dist/scripts/seed-admin.js --email you@example.gov.ph` (no password under Clerk). Then sign up through Clerk with that e-mail; the account is linked on the first request.
6. Keep the host clock on NTP. Clerk tokens are valid for 60 s from `iat − 10 s`; a host more than `CLERK_CLOCK_SKEW_MS` (60 s) off rejects every sign-in with `401 unauthenticated`, and the API logs `[clerk] … the server clock is probably off`.
7. When the web app and the API are on different origins, list the web origin in `ALLOWED_ORIGINS`; the CORS preflight allows the `Authorization` header.

Switching back is one setting: `AUTH_PROVIDER=session` re-enables the password endpoints (Clerk-created accounts have no usable password; an administrator sends them a reset link).

## Database

- **Create the database** (MySQL: `utf8mb4`; PostgreSQL: `UTF8`, the default) and a user with DDL rights for the first boot. Migrations run automatically on start (`apps/api/db/migrations`, tracked in the `migrations` table); they are plain SQL and additive, and the same files run on SQLite, MySQL and PostgreSQL. To run them separately: `node dist/scripts/migrate.js` (from `apps/api`).
- **PostgreSQL specifics**: the API connects with `pg` and adapts the shared SQL itself (`$n` placeholders, `RETURNING id`, `TIMESTAMP`/`BOOLEAN`/`JSONB`/`BIGSERIAL` column types), so no PostgreSQL-only migration files exist. Point it at the server with `DB_CLIENT=postgres` plus either `DATABASE_URL` or the `DB_*` fields; set `DB_SSL=true` for a managed host (`no-verify` when its certificate chain is private). The user needs `CREATE` on the database's `public` schema (PostgreSQL 15+ no longer grants it to every role — `GRANT ALL ON SCHEMA public TO scope;` as the owner, or make the application user the database owner). Store time in UTC: columns are `TIMESTAMP` without zone and the application writes UTC strings, the same convention as on MySQL.
- **First administrator**: `SEED_ADMIN_PASSWORD='…' node dist/scripts/seed-admin.js --email you@example.gov.ph --name "Your Name"` (from `apps/api`; `npm run db:seed:admin -w @scope/api -- --email …` in a checkout). It creates the account, or promotes an existing one to administrator, and is safe to re-run; the password comes from `SEED_ADMIN_PASSWORD` so it stays out of shell history. Under the Clerk provider no password is needed — the person signs in through Clerk with that e-mail. `seed-user.js` / `db:seed:user` (`SEED_USER_*`) creates a regular account the same way without opening public registration. There is no public bootstrap endpoint on purpose.
- **Do not run the development seeder** (`dist/scripts/seed.js`) against a real database. It creates four sample accounts with the password `password`.
- **Backups**: `mysqldump --single-transaction scope_checklist` or `pg_dump --format=custom scope_checklist` on a schedule; the schema has no external files. Historical tables (`activity_logs`, `admin_audit_logs`, `project_invitations`, `exports`) are append-only and soft-deleted rows (`deleted_at`) are never purged by the application.
- **Rollback**: deploy the previous image; migrations are forward-only and never drop or rename columns within a release, so an older build keeps working against a newer schema.

## Reverse proxy

Terminate TLS at the proxy and forward to the Node process. Example nginx server block:

```nginx
server {
    listen 443 ssl http2;
    server_name scope.example.gov.ph;
    # ssl_certificate / ssl_certificate_key …

    client_max_body_size 1m;            # API JSON bodies are capped at 256 kB anyway

    location / {
        proxy_pass         http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }
}
```

`X-Forwarded-Proto` and `X-Forwarded-For` are required: the API uses them (through `TRUST_PROXY`) for the secure cookie and for per-IP rate limits.

## Operations

- **Health**: `GET /api/health` → `200 {"status":"ok","db":"ok"}`; `503 unavailable` when the database does not answer. The Docker image declares a `HEALTHCHECK` on it.
- **Shutdown**: `SIGTERM`/`SIGINT` stop accepting connections, let in-flight requests finish (10 s grace), close the database pool and exit 0 — safe for rolling restarts.
- **Logs**: stdout/stderr only. Lines are prefixed `[api]`, `[db]`, `[mail]`, `[http]`. Unhandled errors are logged with a stack on the server and returned to clients as `500 server_error` with a generic message and no details.
- **Rate limits**: in-process fixed windows per IP — register and forgot-password 10 / 15 min, reset-password and invitation redemption 20 / 15 min, login 5 failures per e-mail+IP / 15 min. They are per process; move to a shared store (Redis) if you run more than one replica and need the limits to be global.
- **E-mail**: the shipped `ConsoleMailService` prints reset and invitation links to the log. For real delivery implement `MailService` (one `send()` method) for your provider (SMTP, SES, SendGrid…) and construct it in `server.ts`. Until then operators can copy the link from the log.
- **Scaling**: the process is stateless apart from the in-memory rate limiters; sessions live in the database, so several replicas behind one load balancer work.

## Security checklist

- [ ] `NODE_ENV=production`, https `APP_URL`, `SESSION_SECURE=true` (the server enforces all three).
- [ ] Strong, unique `DB_PASSWORD`; the DB user is scoped to the one database; the database port is not public.
- [ ] TLS terminated at the proxy with `X-Forwarded-Proto` set; HSTS is sent by the API when `SESSION_SECURE=true`.
- [ ] The development seeder has never been run against the production database (no `maya@infosoft.ph` etc. accounts).
- [ ] The first administrator was created with `seed-admin.js` and verified in Admin → Users; no unexpected account is `admin`.
- [ ] Clerk (if used): production instance on your domain with DNS verified (`clerk deploy status`), `pk_live_`/`sk_live_` keys and the **production** JWT public key on the host, the live publishable key baked into the web build, `APP_URL`/`ALLOWED_ORIGINS` exactly matching the site origin, no `.env` with development keys on the server.
- [ ] Host clock synchronised with NTP (token verification, OTP codes and TLS all depend on it).
- [ ] Secrets (`DB_PASSWORD`, `CLERK_SECRET_KEY`) live in the host's secret store or environment — the Docker image contains no `.env` file.
- [ ] Backups scheduled and a restore has been rehearsed.
- [ ] `apps/web/.env.production` sets `VITE_API_URL=/api` (or your API origin) so the mock API and sample fixtures are excluded from the build.
- [ ] A real `MailService` is wired, or operators know that reset links appear in the server log.

## Continuous integration

`.github/workflows/ci.yml` runs on every push and pull request: `npm ci`, `npm run typecheck`, `npm test` (API feature + unit tests, web unit tests), `npm run build`, then boots the bundled server with `WEB_DIST` and checks `/api/health` and an SPA route, verifies that the production config gate refuses plain-http and development Clerk keys, and finally builds the Docker image. `npm run check` runs the first three steps locally.
