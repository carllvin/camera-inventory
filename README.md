# Camera Inventory

Equipment management for camera departments: delivery and return notes, multi-rental-house
projects, cases, AI-assisted recognition and a complete audit trail.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for architecture, data model and roadmap.

**Status:** Phase 3 complete: usable without AI (projects, rental houses, categories, equipment, search, scan by code).

## Run with Docker (self-hosted)

### Option A: ready-made images (Dockge, Portainer, …)

GitHub Actions builds `ghcr.io/carllvin/camera-inventory` (+ `-migrate`) for amd64 and arm64 on every push to `main`.
Use [`deploy/dockge/compose.yaml`](deploy/dockge/compose.yaml) and [`deploy/dockge/.env.example`](deploy/dockge/.env.example):
paste both into a new Dockge stack, fill in the secrets, deploy. Updates are a click on "Update".
While the repository is private, the server must log in to `ghcr.io` once (personal access token with `read:packages`).

### Option B: build from source


```bash
cp deploy/.env.example .env      # set POSTGRES_PASSWORD, BETTER_AUTH_SECRET, PUBLIC_URL
docker compose up -d --build     # Postgres + migrations + app on :3000
docker compose run --rm migrate npm run db:seed   # optional demo data
```

For phones on set you need HTTPS (browsers only allow the camera on secure origins):
set `DOMAIN` and `PUBLIC_URL=https://…` in `.env` and start with `docker compose --profile proxy up -d --build`
(Caddy fetches certificates automatically; see `deploy/Caddyfile` for LAN-only setups).

The first person to sign up creates the workspace and becomes its owner. Add the rest of the team under
**Settings → Team**, then set `ALLOW_SIGNUP=false`.

## Local development

### Requirements

- Node.js ≥ 22
- PostgreSQL ≥ 15 (16 recommended), with the `pg_trgm` and `unaccent` extensions available (both ship with the standard contrib package)

### Setup

```bash
npm install
cp .env.example .env            # adjust DATABASE_URL / TEST_DATABASE_URL

# create role + databases (example for a local Postgres)
sudo -u postgres psql -c "create user camera with password 'camera' createdb;"
sudo -u postgres psql -c "create database camera_inventory owner camera;"
sudo -u postgres psql -c "create database camera_inventory_test owner camera;"

npm run db:migrate              # apply migrations
npm run db:seed                 # load demo data (only into an empty database)
npm run dev                     # http://localhost:3000
```

Demo logins (password `camera-demo`): `alex@nordlicht.example` (owner), `mira@…` (admin), `jonas@…` (member), `sam@…` (viewer).

### Scripts

| Script | Purpose |
|---|---|
| `npm run db:generate` | Generate a migration from schema changes (`src/server/db/schema`) |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:seed` | Load demo data into an empty database |
| `npm run db:reset` | **Dev only:** drop everything, migrate, seed |
| `npm run dev` / `build` / `start` | Next.js dev server / production build / production server |
| `npm test` | Integration tests (recreates the schema in `TEST_DATABASE_URL`) |
| `npm run test:e2e` | Browser tests (Playwright) against a running app with demo data |
| `npm run typecheck` | TypeScript check |

## Demo data

Workspace "Nordlicht Camera Department":

- **Feature Film X** (shooting): equipment from ARRI Rental, MBF Filmtechnik and Marek; four cases (A-Cam case 7/8); a partial return to MBF (including a bulk split of BNC cables); open missing/damage issues; one delivery note waiting for review.
- **Commercial — Nordic Coast** (closed): fully returned. Its ALEXA 35 (SN 35-10421) was reused on Feature Film X, with continuous history.
- **Music Video — Night Drive** (planning): no rentals yet.
