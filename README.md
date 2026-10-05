# Camera Inventory

Equipment management for camera departments: delivery and return notes, multi-rental-house
projects, cases, AI-assisted recognition and a complete audit trail.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for architecture, data model and roadmap.

**Status:** Phase 2 (data model). There is no UI yet.

## Requirements

- Node.js ≥ 22
- PostgreSQL ≥ 15 (16 recommended), with the `pg_trgm` and `unaccent` extensions available (both ship with the standard contrib package)

## Setup

```bash
npm install
cp .env.example .env            # adjust DATABASE_URL / TEST_DATABASE_URL

# create role + databases (example for a local Postgres)
sudo -u postgres psql -c "create user camera with password 'camera' createdb;"
sudo -u postgres psql -c "create database camera_inventory owner camera;"
sudo -u postgres psql -c "create database camera_inventory_test owner camera;"

npm run db:migrate              # apply migrations
npm run db:seed                 # load demo data (only into an empty database)
```

## Scripts

| Script | Purpose |
|---|---|
| `npm run db:generate` | Generate a migration from schema changes (`src/server/db/schema`) |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:seed` | Load demo data into an empty database |
| `npm run db:reset` | **Dev only:** drop everything, migrate, seed |
| `npm test` | Integration tests (recreates the schema in `TEST_DATABASE_URL`) |
| `npm run typecheck` | TypeScript check |

## Demo data

Workspace "Nordlicht Camera Department":

- **Feature Film X** (shooting): equipment from ARRI Rental, MBF Filmtechnik and Marek; four cases (A-Cam case 7/8); a partial return to MBF (including a bulk split of BNC cables); open missing/damage issues; one delivery note waiting for review.
- **Commercial — Nordic Coast** (closed): fully returned. Its ALEXA 35 (SN 35-10421) was reused on Feature Film X, with continuous history.
- **Music Video — Night Drive** (planning): no rentals yet.
