# syntax=docker/dockerfile:1

# ---- dependencies -----------------------------------------------------------
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---- build ------------------------------------------------------------------
FROM deps AS build
COPY . .
# Placeholders only: nothing connects to the database at build time.
ENV NEXT_TELEMETRY_DISABLED=1 \
    DATABASE_URL=postgres://build:build@localhost:5432/build \
    BETTER_AUTH_SECRET=build-time-placeholder-not-used-at-runtime
RUN npx next build

# ---- migrations / seed (one-shot job; has dev tooling) ----------------------
FROM deps AS migrate
COPY drizzle ./drizzle
COPY scripts ./scripts
COPY src/server/db ./src/server/db
COPY src/server/domain ./src/server/domain
COPY tsconfig.json drizzle.config.ts ./
CMD ["npx", "tsx", "scripts/migrate.ts"]

# ---- runtime ----------------------------------------------------------------
FROM node:22-bookworm-slim AS app
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN groupadd --system --gid 1001 app && useradd --system --uid 1001 --gid app app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
