# Camera Inventory: Architecture & Plan

## 1. Phase 1: Repository analysis

| Question | Finding |
|---|---|
| Existing structure | The repository was **empty**: no commits, no files. |
| Existing technologies | None. |
| Existing functionality | None. |
| Reusable code | Nothing to reuse. Everything below is a greenfield decision. |
| Available infrastructure (dev container) | Node 22, npm/pnpm, PostgreSQL 16 (with `pg_trgm`, `unaccent`, `citext`), Docker CLI, Chromium/Playwright. |

## 2. Architecture

One TypeScript codebase, split into layers that do not import "upwards":

```
src/
  app/                 UI: Next.js App Router (React Server Components, mobile-first)   [Phase 3]
  server/
    domain/            Business services: the ONLY code that mutates inventory.          [Phase 3]
                       Each service: validate (zod) → transaction → write rows → write audit events.
    auth/              Session + workspace context (Better Auth, Drizzle adapter)        [Phase 3]
    storage/           StorageProvider interface: local-disk (dev) / S3-compatible (prod) [Phase 5]
    ai/                DocumentExtractor + VisionRecognizer interfaces;                  [Phase 5/7]
                       MockProvider (dev/tests) + Claude provider (server-side key only)
    search/            Trigram/alias search across entities                              [Phase 3]
    db/
      schema/          Drizzle table definitions (source of truth for types)              [done]
      seed/            Demo data                                                          [done]
      client.ts        Connection factory
drizzle/               SQL migrations (generated + hand-written integrity triggers)       [done]
tests/                 Vitest integration tests against a real Postgres                   [done]
```

**Stack**

| Concern | Choice | Why |
|---|---|---|
| Frontend + backend | **Next.js 16 (App Router), React 19, TypeScript strict** | One deployable unit. Server Components keep DB/AI keys on the server. Server Actions for the web UI, plus a versioned `/api/v1` route layer over the same domain services for future native apps and integrations. |
| UI | Tailwind CSS + accessible headless components (Radix/shadcn pattern) | Fast, consistent, mobile-first. |
| Database | **PostgreSQL 16** | Relational integrity (composite FKs, partial unique indexes, deferred constraint triggers), `pg_trgm` fuzzy search, JSONB for AI payloads. |
| ORM / migrations | **Drizzle ORM + drizzle-kit** | Typed SQL with no runtime magic. Migrations are plain SQL files that get reviewed and committed. |
| Auth | **Better Auth** (email/password first, OAuth/magic link later) | The schema's `user/session/account/verification` tables already match its Drizzle adapter. |
| Object storage | `StorageProvider` with two drivers: local volume (default for single-server Docker) and S3-compatible (MinIO / AWS S3 / R2) | Documents and photos go in a private bucket. The DB stores only keys, and downloads use short-lived signed URLs. |
| AI | Provider interfaces plus a Mock provider, with a Claude provider (vision + native PDF input) | Replaceable. Keys stay server-side. Raw AI output is stored verbatim on the document. AI results are always advisory. |
| Tests | Vitest (integration against real Postgres), Playwright for E2E later | Constraints are tested where they live. |

**Request flow for any inventory change**

```
UI (form / scan review) ──► server action / API route
   └─► auth: resolve user + workspace + role  (ctx)
        └─► domain service(ctx, input)
             ├─ zod validation
             ├─ db.transaction:
             │    ├─ read current state (FOR UPDATE where needed)
             │    ├─ write rows
             │    └─ write audit_event(s) with a shared correlation_id
             └─ return typed result
```

AI never calls a domain service directly. It produces a proposal (`document_line` rows, and in Phase 7 detection rows), the user reviews it, and the confirmation is what calls the domain service.

## 3. Database model (Phase 2, implemented)

```
workspace ─┬─ workspace_member ── user (session, account, verification)
           ├─ project ─┬─ project_rental_house ── rental_house
           │           ├─ equipment_case ── case_expected_item
           │           └─ (documents, issues, assignments …)
           ├─ category (self-tree)
           ├─ equipment_type ── photo(kind=reference)
           ├─ equipment_item ─┬─ project_assignment (history of project stints)
           │                  └─ photo
           ├─ case_template ── case_template_item
           ├─ document ─┬─ document_file
           │            └─ document_line (extracted line + match + user decision)
           ├─ issue
           └─ audit_event (append-only)
```

### Key decisions

* **Item vs. type.** `equipment_type` is the product (ARRI ALEXA 35, with aliases, specs, category and reference photos). `equipment_item` is the physical object (serial, asset number, barcode, owner rental house, current project/case, status, condition).
* **Tracking modes.** `serialized` items always have quantity = 1. `bulk` items carry a quantity (12 × BNC). A partial return of a bulk item **splits** it: the returned units become their own row with `split_from_item_id`, so quantities are conserved and each part has its own history.
* **Status vs. condition.** `status` is lifecycle/location (`available`, `on_project`, `in_use`, `ready_for_return`, `missing`, `returned`). `condition` is physical state (`ok`, `minor_wear`, `damaged`, `defective`, `unknown`).
* **Project history.** `project_assignment` has one row per stint of an item on a project, with delivery and return documents. A project's relationship to a rental house is never "closed": what is still on the project is derived from the open items.
* **Workspace isolation in the DB.** Every business table has `workspace_id`, and cross-table references are **composite FKs `(workspace_id, x_id)`**, so a row can never point into another workspace, even if application code has a bug. Postgres RLS can be layered on later.
* **Audit log.** `audit_event` stores timestamp, actor (user/system/ai), action, entity, denormalized subject columns (project, item, case, document, issue, rental house) for single-query timelines, `changes` (`{field: {from, to}}`), metadata and `correlation_id`. `bigserial` ids give a stable order.
* **Search.** A trigger maintains `search_text` (lower-case, accent-free, aliases included, serials also compacted) with GIN trigram indexes, so "angenieux optimo", "A35" and "sn77812" all match.
* **Concurrency / offline-readiness.** UUID keys (client-generatable) and a `version` column on items for optimistic locking and future sync.

### Mandatory rules and where they are enforced

| Rule | Enforcement |
|---|---|
| Item in at most one active project | Single `equipment_item.project_id`. Partial unique index: one open `project_assignment` per item. A deferred constraint trigger keeps the two consistent at commit. |
| Item in at most one case | Single `equipment_item.case_id`. |
| Cases belong to projects; an item's case is on the item's project | `equipment_case.project_id NOT NULL`; composite FK `equipment_item(project_id, case_id) → equipment_case(project_id, id)`. |
| Returning removes the item from the project | CHECK: `returned`/`available` ⇒ `project_id IS NULL`; on-project statuses ⇒ `project_id IS NOT NULL`. |
| Returning does not delete the item | Items are never deleted (no delete path; FKs from history are RESTRICT). `project_assignment` rows cannot be deleted (trigger). |
| History must not be deleted | `audit_event` UPDATE/DELETE/TRUNCATE are rejected by trigger. |
| Never silently merge two physical items | Unique `(workspace, type, upper(serial))`, unique asset number per owner, unique barcode. A conflicting import has to become an explicit issue. |
| AI suggestions require confirmation | `document.status` workflow plus `document_line.resolution` (default `pending`). Only the confirm service writes inventory. Confirmed documents must be linked to a project (CHECK). |
| Never mark missing from image recognition alone | `missing` is set only by the user-driven status service. AI events are `actor_type = 'ai'` and do not mutate items (enforced in the service layer, Phase 7). |
| Unlimited rental houses per project | `project_rental_house` plus a per-item `rental_house_id`. |
| Category tree stays valid | Trigger blocks cycles; sibling names unique. |

## 4. Implementation phases

1. **Analysis.** Done (this document).
2. **Data model.** Done: schema, 3 migrations, seed, 21 integration tests.
3. **Core app.** Done: Next.js 16 app with Better Auth (email/password, onboarding, team management with roles), desktop sidebar plus mobile bottom navigation with Scan, domain services with audit (projects, rental houses, categories, equipment types and items), global search (aliases, typos, compact serials), project pages with filters and tabs, equipment detail with timeline, QR/barcode lookup, Docker Compose stack: one `compose.yaml` with Postgres and the app image from GHCR; the container entrypoint (`docker/entrypoint.mjs`) fixes storage ownership, applies migrations under an advisory lock and then drops to uid 1001.
4. **Cases.** Done: case pages with expected vs. packed (type lines, category lines incl. subcategories, bulk quantities, extras), packing by scan/code or picker with explicit moves between cases and "needed" suggestions, editable expected contents, templates (CRUD, save case as template), photos for cases/items/equipment types, case history. Storage layer (local volume or S3/MinIO) and image normalization (EXIF rotation, GPS stripped, thumbnails) were pulled forward from Phase 5.
5. **Delivery notes.** Done: upload (PDF/photos, type sniffing, duplicate warning by file hash and by rental house + number), background AI reading (`after()`, retryable, stale jobs released), Claude provider behind `DocumentExtractor` (structured output, adaptive thinking, server-side refusal fallback, typed errors) with a manual provider when no key is set, matching (serial → asset → catalog/aliases → fuzzy type; conflicts never auto-resolved), review UI with original file viewer, manual lines, confirm (reuse/create items, bulk vs. serialized, assignments linked to the document, single correlation id), discard. The reference-image picker from section 6 is implemented (Brave search + Claude ranking, Google button, paste URL with SSRF-safe download, upload, auto-pick); manufacturer-page discovery via Claude web search is not built yet.
6. **Return notes.** Done: same upload/reading/review pipeline; matching only against equipment on the document's project (reviewer choice → serial/asset → type, with a unique item auto-matched and several items left for the reviewer); discrepancies for unknown equipment, items on other projects, already returned, wrong rental house, duplicate serials and over-quantities; "report as issue" per line; overview of what stays on the project; `confirmReturn` (case cleared, assignment closed with the note, bulk partial returns split the item, relationship to the rental house never closed).
   *Project detection* (follow-up): the project may be left empty at upload; after reading, `findProjectForDocument` tries the rental house's project number (`project_rental_house.order_reference`, saved on confirm) → Claude's pick from the open-project list / exact title or code → similar title with a clear margin. Only a single clear match is applied (`document.project_source = 'detected'`); otherwise the reviewer picks a project or creates one prefilled from the document. A hand-picked project that disagrees with the document produces a warning, never a switch.
   *Standard catalog* (follow-up): data in `src/server/catalog/data/<area>.json` (entries + compact `lensSeries`, expanded per focal length by `standard-catalog.ts`; `formerly` keeps corrected model names), v3 ≈1,600 types researched per area in two rounds. `importStandardCatalog` (admin; skips entries known by manufacturer+model, name, a long alias or a former name, archived types included; renames untouched catalog-created types to corrected names; creates missing categories by name; batched inserts; one `catalog.imported` event plus one event per type under a shared correlation id). Type selection everywhere uses `TypePicker` → `/api/equipment-types/search` (all words, compact/alias/typo matching); the type list is paged with in-use types first. *Bulk images:* `image_job` / `image_job_item` (migration 0007) hold a background run of `autoPickImage` over a fixed list of types (in-use first); heartbeat → stale runs become "interrupted" and can be resumed; three consecutive errors stop a run; not-confident results form the manual review list.
7. **Vision.** Photo capture, recognition interface (type, serial/asset OCR, quantity), comparison against expected case contents, advisory review UI, return-check events.
8. **Polish.** Loading, empty and error states, accessibility, performance, image handling.
9. **Tests.** Domain-service unit/integration tests, security (workspace isolation, roles), Playwright E2E of the core flows.

## 5. Risks and open decisions

| # | Topic | Recommendation / question |
|---|---|---|
| 1 | **Hosting** | **Decided: self-hosted Docker.** `docker compose` with `app` (Next.js standalone), `worker` (background jobs for AI extraction/recognition, pg-boss on Postgres), `postgres`, `minio` (S3-compatible storage) and a reverse proxy with TLS. Storage code stays on the S3 API, so moving to R2/S3 later only changes configuration. |
| 2 | **AI provider and keys** | **Decided: Claude**, behind `DocumentExtractor`/`VisionRecognizer`. `ANTHROPIC_API_KEY` lives only in the server/worker environment. The mock provider is still used in tests and when no key is set. |
| 3 | **Long-running AI jobs** | Extraction can take 10–60 s. Phase 5 starts with async processing plus a status poll. Add a Postgres-backed queue (pg-boss) if needed. |
| 4 | **Serial OCR reliability** | Engraved or tiny serial plates will often fail. The UI must make manual correction fast. AI stays advisory. |
| 5 | **Reference images** | **Decided:** see section 6. |
| 6 | **Global equipment catalog** | Equipment types are workspace-scoped for now (isolation first). A shared global catalog can be added later as a separate table that workspace types link to. |
| 7 | **Document language** | Delivery notes are often German ("Lieferschein", "Stück"). Extraction prompts and matching should be multilingual. |
| 8 | **Same serial, different rental house** | Treated as the same physical item only if type and serial match. Owner changes are flagged as a `serial_conflict` issue for the user, never merged automatically. |
| 9 | **Roles** | `owner/admin/member/viewer` per workspace. Fine-grained per-project permissions are deferred. |

## 6. Reference images (decided, built with Phase 5)

Reference images belong to the **equipment type** (choose once, every ALEXA 35 shows it). Physical items only carry photos the crew takes (damage, labels, case contents).

**Automatic selection**

1. Candidates come from the manufacturer's product page (found via Claude web search; product images read from the page) and the **Brave Image Search API** (official API, own key).
2. Claude vision ranks candidates: exact product, shown alone, clean background, no watermark, not rigged.
3. The best candidate is downloaded into MinIO with `source_url`/attribution and applied with an "auto-selected" badge. Below the confidence threshold: no image, "choose image" prompt.

**Picker on the equipment-type page ("Change image")**

* Grid of cached candidates, suggested one marked, source domain under each thumbnail, editable query with "search again" and "load more".
* **Open in Google Images**: opens real Google results in a new tab with the query pre-filled (Google cannot be embedded and has no usable official API; scraping services such as SerpAPI are deliberately not used).
* **Paste image URL** (e.g. copied from Google Images) and **Upload / take photo**.
* Choosing an image downloads it server-side; the previous image stays in the photo history; an audit event records the change.

**Safety**: server-side fetching only accepts image content types, caps size, follows a limited number of redirects and refuses private/loopback addresses (SSRF). Thumbnails are served through our own proxy, never hotlinked.

**Schema addition (Phase 5)**: `image_candidate` cache table (equipment type, query, source, URL, thumbnail, rank/score, fetched_at).
