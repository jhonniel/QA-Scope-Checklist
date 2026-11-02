# qac.poolreno.com — production deployment

One Linux host running Docker: the application container (API + built web app) and a PostgreSQL 16 container on a private compose network, with nginx on the host terminating TLS for `https://qac.poolreno.com` and proxying to `127.0.0.1:4000`.

| File | Purpose |
| --- | --- |
| `api.env.example` | Production environment, pre-filled for this domain and PostgreSQL. Copy to `api.env` (git-ignored) and fill in the secrets. |
| `docker-compose.yml` | `api` (image built from this repository) + `db` (postgres:16-alpine, persistent volume). |
| `nginx.conf` | Server block: http → https redirect, Let's Encrypt paths, proxy headers the API relies on. |

General reference: [`docs/DEPLOYMENT.md`](../../docs/DEPLOYMENT.md).

## 1. Prerequisites

- DNS: an `A` (and, if available, `AAAA`) record for `qac.poolreno.com` pointing at the host.
- Host: Docker Engine with the compose plugin, nginx, certbot (`python3-certbot-nginx`), NTP enabled (`timedatectl` → *System clock synchronized: yes*). Clerk token checks and TLS depend on the clock.
- Ports 80 and 443 open to the internet; 4000 and 5432 **not** exposed (the compose file binds the API to loopback and does not publish PostgreSQL).

## 2. Environment

```bash
git clone <repository> scope-checklist && cd scope-checklist/deploy/qac.poolreno.com
cp api.env.example api.env
chmod 600 api.env
```

Edit `api.env`:

- `DB_PASSWORD` — a strong, unique password (for example `openssl rand -base64 32`). It initialises the PostgreSQL container on first start and is what the API connects with. Changing it later means also changing it inside PostgreSQL (`ALTER USER scope PASSWORD '…'`).
- Sign-in, pick one:
  - **Clerk** (the project's default in development): create the production instance for this domain — `npx -y clerk@latest deploy --domain qac.poolreno.com`, add the DNS records it prints, `npx -y clerk@latest deploy status --wait`. Then `npx -y clerk@latest env pull --instance prod --print` and paste `CLERK_PUBLISHABLE_KEY` (`pk_live_…`), `CLERK_SECRET_KEY` (`sk_live_…`), the production instance's **JWT public key** into `CLERK_JWT_KEY`, uncomment `AUTH_PROVIDER=clerk`, and put the publishable key in `VITE_CLERK_PUBLISHABLE_KEY` as well (it is compiled into the web bundle). Development keys (`pk_test_`/`sk_test_`) are refused in production.
  - **Built-in e-mail + password**: leave the four Clerk values empty. Nothing else to do.

Everything else is already set for this host (`APP_URL=https://qac.poolreno.com`, `SESSION_SECURE=true`, `TRUST_PROXY=1`, `DB_CLIENT=postgres`, `EXPORT_TIMEZONE=Asia/Manila`). The API lists any unsafe setting and refuses to start until it is fixed.

## 3. Start

```bash
docker compose --env-file api.env up -d --build
docker compose --env-file api.env logs -f api      # wait for "[db] applied N migration(s)" and the listening line
curl -s http://127.0.0.1:4000/api/health          # {"status":"ok","db":"ok"}
```

Migrations run on boot; the database is created by the postgres image with the application user as owner, so no manual `CREATE DATABASE` / `GRANT` is needed.

## 4. TLS and nginx

```bash
sudo cp nginx.conf /etc/nginx/sites-available/qac.poolreno.com
sudo ln -s /etc/nginx/sites-available/qac.poolreno.com /etc/nginx/sites-enabled/
sudo certbot --nginx -d qac.poolreno.com
sudo nginx -t && sudo systemctl reload nginx
```

If certbot has not run yet, comment out the four `ssl_*` lines first, reload, run certbot, then restore them. Check `https://qac.poolreno.com/api/health` from outside and that the response carries `Strict-Transport-Security`.

## 5. First administrator

Before anyone signs in:

```bash
# built-in sign-in
docker compose --env-file api.env exec -e SEED_ADMIN_PASSWORD='…' api node dist/scripts/seed-admin.js --email you@poolreno.com --name "Your Name"
# Clerk (no password — the person signs up through Clerk with this e-mail and is linked on first request)
docker compose --env-file api.env exec api node dist/scripts/seed-admin.js --email you@poolreno.com --name "Your Name"
```

Safe to re-run; it promotes an existing account instead of duplicating it. **Never** run `dist/scripts/seed.js` (development fixtures) against this database.

## 6. Operations

- **Update**: `git pull && docker compose --env-file api.env up -d --build` — the new container applies pending migrations on boot; migrations are additive, so the previous image keeps working if you roll back (`docker compose --env-file api.env up -d` after checking out the previous commit).
- **Backup** (schedule it, e.g. a daily cron):
  `docker compose --env-file api.env exec -T db pg_dump -U scope --format=custom scope_checklist > scope_$(date +%F).dump`
  Restore with `pg_restore -U scope -d scope_checklist --clean --if-exists` into a running `db` container. Rehearse one restore.
- **Logs**: `docker compose --env-file api.env logs -f api` (`[api]`, `[db]`, `[http]` prefixes; no bodies). Password-reset and invitation links appear in this log until a real `MailService` is wired.
- **Health**: `GET /api/health`; the container also has a `HEALTHCHECK`.
- **Stop**: `docker compose --env-file api.env down` keeps the `postgres-data` volume; add `-v` only to destroy the database.

## 7. Go-live checklist

- [ ] `api.env` has a strong `DB_PASSWORD`, mode 600, and is not in git (`git status` shows nothing under `deploy/`).
- [ ] `https://qac.poolreno.com` loads, `/api/health` is `ok`, HSTS header present, http redirects to https.
- [ ] Clerk (if used): `clerk deploy status` verified, live keys + production JWT key in `api.env`, the same publishable key baked into the build, no development keys on the host.
- [ ] Administrator seeded and visible in Admin → Users; no sample accounts (`maya@infosoft.ph` etc.) exist.
- [ ] Backup cron in place and a restore tested.
- [ ] `apps/api/assets/infosoft-logo.png` (and `apps/web/public/infosoft-logo.png`) replaced with the high-resolution letterhead before the first client export.
