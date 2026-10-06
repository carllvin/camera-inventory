# Camera Inventory

Equipment management for camera departments: delivery and return notes, multi-rental-house
projects, cases, AI-assisted recognition and a complete audit trail.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for architecture, data model and roadmap.

**Status:** Phase 6 complete: delivery and return notes are read by Claude (or entered by hand), reviewed and confirmed — including partial returns. Projects, rental houses, equipment, cases/templates, photos, search and scanning work without AI.

## Run with Docker (self-hosted)

One file: [`compose.yaml`](compose.yaml) — two containers, Postgres and the app, both pulled as ready-made
images (`ghcr.io/carllvin/camera-inventory`, built by GitHub Actions for amd64 and arm64 on every push to `main`).
Nothing is built on your server and there are no one-off helper containers: when the app starts it applies
pending database migrations and makes the storage volume writable for itself.

1. Create a stack in Dockge (or a folder with `compose.yaml`) and paste [`compose.yaml`](compose.yaml).
2. Put the settings into `.env` next to it — template: [`compose.env.example`](compose.env.example)
   (`POSTGRES_PASSWORD`, `BETTER_AUTH_SECRET`, `PUBLIC_URL`; optional `ANTHROPIC_API_KEY`, `BRAVE_SEARCH_API_KEY`).
3. Deploy (`docker compose up -d`) and open `http://<server>:3000`. Updating: Dockge "Update"
   (`docker compose pull && docker compose up -d`).

While the repository is private, the server must log in to `ghcr.io` once (personal access token with `read:packages`).

HTTPS (needed on phones for the camera/scanner): put your existing reverse proxy (Nginx Proxy Manager,
Traefik, Caddy …) in front of port 3000 and set `PUBLIC_URL=https://…`.

The first person to sign up creates the workspace and becomes its owner. Add the rest of the team under
**Settings → Team**, then set `ALLOW_SIGNUP=false`.

### AI reading of delivery notes

Set `ANTHROPIC_API_KEY` in `.env` (create a key at console.anthropic.com) and redeploy. Uploaded PDFs/photos are then
read by Claude (`claude-opus-5-5`, change with `AI_MODEL` / `AI_EFFORT`); every line is matched against your equipment
and **nothing changes until a person confirms the reviewed delivery note**. Without a key, documents are uploaded and the
lines are entered by hand. Typical cost: a few cents per delivery note.

With AI reading the project can be left on "Detect from document": the production title, the rental house's project
number and the customer are compared with your open projects, and only a clear match is used. An unknown production is
offered as "Create project" (prefilled with name, production company and rental period) — it is only created when you
click. Confirming a note saves the rental house's project number on the project, so later notes match by number.

### Standard equipment catalog

About 1,200 equipment types from the common manufacturers — cameras (ARRI, Sony, RED, Canon, Blackmagic,
Panasonic, Nikon, Fujifilm, Z CAM, Kinefinity, DJI, Phantom …), lenses with one type per focal length (ARRI,
ZEISS, Cooke, Leitz, Canon, Sigma, Angénieux, Fujinon, Atlas, Vantage Hawk, Laowa, Sirui, DZOFilm, Blazar …),
lens control, matte boxes and filters, monitors, wireless video, timecode, batteries and chargers, media,
support and cables — with the aliases and part numbers rental houses use on delivery notes. Researched against
manufacturer and dealer listings; discontinued models that are still rented are marked as such.

Offered when a workspace is created, or later under **Settings → Standard equipment catalog** per area. Types
you already have are skipped and never changed; types imported under a name a later catalog version corrected
are renamed only if nobody edited them. Everything is recorded in the history. The data lives in
`src/server/catalog/data/*.json` — corrections are welcome there or directly in the app.

Equipment types are chosen with a search field (manufacturer, model, alias, part number; words in any order,
typos tolerated), so even thousands of types stay quick to pick.

### Reference images

On an equipment type, **Choose image / Change image** opens the picker: image search results (set `BRAVE_SEARCH_API_KEY`,
ranked by Claude when `ANTHROPIC_API_KEY` is set, best one marked *suggested*), **Open in Google Images** + paste the image
address, or upload. Chosen images are downloaded into your own storage with their source; earlier images stay in the history.
**Find automatically** applies an image only when the AI is confident (badge *auto-selected*).

### Backups

Two volumes hold everything: `pgdata` (database) and `storage` (photos and documents).

```bash
docker compose exec -T postgres pg_dump -U camera camera_inventory > backup-$(date +%F).sql
docker run --rm -v camera-inventory_storage:/data -v "$PWD":/backup alpine tar czf /backup/storage-$(date +%F).tgz -C /data .
```

(The volume name is `<stack name>_storage`; check with `docker volume ls`.)

The app runs as uid 1001. On every start it makes the `storage` volume writable for that user, so a
volume or bind-mounted folder created by root (e.g. restored from a backup) does not break uploads.

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
| `npm run test:e2e` | Browser tests (Playwright) against a running app with demo data (set `PW_CHROMIUM_PATH` to use a preinstalled Chromium) |
| `npm run typecheck` | TypeScript check |

## Demo data

Workspace "Nordlicht Camera Department":

- **Feature Film X** (shooting): equipment from ARRI Rental, MBF Filmtechnik and Marek; four cases (A-Cam case 7/8); a partial return to MBF (including a bulk split of BNC cables); open missing/damage issues; one delivery note waiting for review.
- **Commercial — Nordic Coast** (closed): fully returned. Its ALEXA 35 (SN 35-10421) was reused on Feature Film X, with continuous history.
- **Music Video — Night Drive** (planning): no rentals yet.
