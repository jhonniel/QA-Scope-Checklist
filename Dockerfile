# syntax=docker/dockerfile:1.7
#
# Single-container deployment: the API serves the built web app from WEB_DIST.
# Sign-in is e-mail + password only (no Clerk in this image).
#   docker build -t scope-checklist .
#   docker run --env-file deploy/qac.poolreno.com/api.env -p 4000:4000 scope-checklist
# See docs/DEPLOYMENT.md and deploy/<host>/ (PostgreSQL). Do not use apps/api/.env.example —
# that file defaults DB_CLIENT=sqlite for local development; production refuses it.
# No .env file is copied into the image (.dockerignore); runtime secrets arrive through the environment.

ARG NODE_VERSION=24

# ---------- build: compile contracts, API bundle and web assets ----------
FROM node:${NODE_VERSION}-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
RUN npm ci --ignore-scripts

COPY . .
# Built-in e-mail + password login. Do not pass a Clerk publishable key into this image.
ENV VITE_CLERK_PUBLISHABLE_KEY=""
RUN npm run build

# ---------- runtime: production dependencies of the API only ----------
FROM node:${NODE_VERSION}-alpine AS runtime
ENV NODE_ENV=production \
    PORT=4000 \
    WEB_DIST=/app/apps/web/dist \
    LOG_REQUESTS=true \
    DB_CLIENT=postgres \
    AUTH_PROVIDER=session
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
RUN npm ci --omit=dev --ignore-scripts --workspace apps/api && npm cache clean --force

COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/db apps/api/db
COPY --from=build /app/apps/api/assets apps/api/assets
COPY --from=build /app/apps/web/dist apps/web/dist

RUN mkdir -p apps/api/storage && chown -R node:node /app
USER node
WORKDIR /app/apps/api

EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT}/api/health || exit 1

# Migrations run on boot (see src/server.ts); the process exits non-zero on unsafe production config.
CMD ["node", "dist/server.js"]
