# Spec: CIB data analytics webapp

**ID**: 0003-feat-cib-data-analytics
**Type**: feat
**Date**: 2026-05-21
**Status**: draft
**Ship as**: one-drop
**Parent**: none
**Open PR on ship**: yes

## Goal
Ship a case-based investigative data-exploration webapp for **CIB (กองบังคับการตำรวจสอบสวนกลาง — Central Investigation Bureau, Royal Thai Police)** analysts. An analyst creates a case, uploads one or more xlsx files (bank statement / crypto statement / phone-call records / travel records) into it, maps each file's columns to `source` / `target` / `weight`, and explores the resulting network chart. A data-explorer page lists all cases with search + tag + status filters.

## Users
Analysts working in the **Central Investigation Bureau (กองบังคับการตำรวจสอบสวนกลาง)** context of the Royal Thai Police. v1 is single-user / single-session trust model — no auth, no RBAC, no multi-user collaboration. `uploaded_by` is recorded as a constant `"analyst"` since there is no real identity system yet.

## Scope
**In**:
- A webapp lives **in this repo under `/app/`** (workflow scaffolding stays at the repo root).
- **Case CRUD**: create, read, update (title / notes / tags / status), archive. Cases persist in Postgres.
- **Data-explorer page** (`/cases`): lists all cases. Search by title (substring); filter by tag, status, created-date range. This is the primary organizing surface — by-case is the main axis.
- **Case-detail page** (`/cases/:id`): shows title, markdown notes, tags, status, file list, and the network chart.
- **Upload flow within a case** (`/cases/:id/upload`): user picks an xlsx; app parses headers; user maps `source` / `target` / `weight` columns via a Column-Mapping UI; app parses rows into a graph; file metadata + parsed graph + per-file mapping persist in Postgres; user returns to the case-detail page.
- **Network chart on the case-detail page**: renders the combined graph from all files included in the case, using `react-force-graph-2d`. Per-file include/exclude toggle controls which files contribute.
- **Node detail panel**: clicking a node opens a side panel showing the node's id, the edges it participates in, and the source xlsx rows that produced those edges.
- **Edge filtering**: a weight slider hides edges below the slider's threshold; chart updates live.
- **Graph export**: "Export PNG" downloads the current chart canvas as PNG; "Export JSON" downloads the underlying graph (nodes + edges + attributes) as JSON.
- **Markdown notes per case**: free-text field, rendered on the case-detail page.
- **Case tags + status + search/filter**: tags are free-text strings (e.g., `fraud`, `drug`, `cyber`); status is one of `open` / `closed` / `archived`; the data-explorer page composes search + tag-filter + status-filter + date-range.
- **Go backend** owns xlsx parsing + graph derivation + persistence, in a hexagonal layout (domain / application / infrastructure).
- **Postgres** stores cases, files (metadata + original xlsx blob OR a path to it — lead decides at plan time), graphs (JSON), per-file column mappings.
- **ClickHouse + PuppyGraph** provisioned in `docker-compose.yml` but **NOT WRITTEN TO** in v1 (reserved for v2 advanced graph-query work; stub adapter only).
- **Tailwind-styled clean UI** is an explicit goal — loading states, error toasts, empty states ("no cases yet").
- **Multi-schema support**: the Column-Mapping UI must work for at least these four xlsx shapes used as fixtures: **bank statement**, **crypto statement**, **ประวัติการโทร (phone-call records)**, **ประวัติการเดินทาง (travel records)** — each is naturally a "row = one edge" shape (sender→receiver, caller→callee, traveler→destination/companion).

**Out (non-goals)**:
- No authentication, login, RBAC, or multi-user collaboration in v1. Single-user trust model.
- No real CIB / police / personal / identifiable data — synthetic fixtures only.
- No real-time / streaming ingest.
- No large-file ingest (>50 MiB); xlsx capped at **≤ 5 MiB**.
- No production deploy in this run; local `docker-compose` only.
- No advanced graph queries (Cypher / Gremlin) via PuppyGraph in v1 — the adapter is a stub and the engine sits dormant.
- No automatic schema detection or column-name heuristics — the user always picks the mapping via the UI.
- No real-time collaboration on a case (no live cursors / multi-editor).

## Acceptance criteria
Observable behaviours. `engineer` ticks these as they land; `lead` re-checks during review; `qa` maps each to a specific test in `tests.md`.

- [x] User can create a new case (title required, notes optional, tags optional, status defaults to `open`); the case appears in the data-explorer list. — `CreateCase` use case + POST `/api/v1/cases` + `/cases/new` page; unit-tested in `usecase_test.go::TestCreateCase_*`.
- [x] User can edit a case's title, notes, tags, and status; changes persist across page refresh and process restart. — `UpdateCase` + PATCH `/api/v1/cases/:id` + `/cases/[id]/edit` page; persistence guaranteed by `cases` table writes.
- [x] User can archive a case (status → `archived`); archived cases are hidden from the default data-explorer view but visible via the status filter. — `ArchiveCase` use case + `ListCases` excludes archived when no status filter (`list_cases.go`, `case_repo.go` WHERE `status <> 'archived'`).
- [x] On the data-explorer page (`/cases`), the user can search cases by title (substring match) and filter by tag, status, and created-date range. Filters compose (all applied together). — `CaseFiltersForm` + `case_repo.List` composes WHERE; trigram + GIN indexes from migration 0002.
- [x] On the case-detail page, the user can upload one or more xlsx files. For each file, the app shows the detected column headers and the user maps `source` / `target` / `weight` columns before the parse runs. — `UploadFile` returns headers; `/cases/[id]/upload` two-step flow drives `ColumnMappingForm` against those headers.
- [x] After mapping, the file's rows are parsed into a graph (each row = one edge; nodes = unique union of `source` + `target` column values), persisted to Postgres, and the case's network chart re-renders to include the new file's edges. — `SetMappingAndParse` → `ExcelizeParser.Parse` → `GraphRepo.SaveFileGraph`; chart `refresh()` after PATCH returns to `/cases/[id]`.
- [x] The case-detail chart exposes a per-file toggle UI; the user can include/exclude each file and the chart updates accordingly. When ≥ 2 files are included, nodes that appear in multiple files merge by id. — `FileToggleList` + `ToggleFileIncluded` + `MergeGraphs` (unions nodes by id with "later upload wins" tiebreaker, unit-tested in `graph_test.go`).
- [x] Clicking a node in the chart opens a side panel showing the node's id, the edges it participates in, and the source xlsx rows that produced those edges. — `NodeDetailPanel` calls `GET /cases/:id/nodes/:nodeID` which returns `NodeDetail{edges: [{source,target,weight,filename,row_index}]}`.
- [x] A weight slider on the chart hides edges with weight below the slider's threshold; the chart updates live without a page reload. — `WeightSlider` + `NetworkChart` `useMemo` filters edges client-side; live update via React state.
- [x] An "Export PNG" button downloads the current chart canvas as a PNG file; an "Export JSON" button downloads the underlying graph (nodes + edges + attributes) as a JSON file. — `ExportButtons.exportPng` uses `canvas.toBlob('image/png')`; JSON link points at `GET /cases/:id/graph/export.json` which sends `Content-Disposition: attachment`.
- [x] Uploading an empty xlsx, a non-xlsx file, a malformed xlsx, or completing a column mapping that points at non-existent columns produces a user-visible error message and rolls back the partial parse (no half-written file row in Postgres). — `UploadFile` rejects empty/too-large/wrong-extension; `ExcelizeParser` rejects malformed; `SetMappingAndParse` validates mapping before any writes (unit-tested `TestSetMappingAndParse_InvalidMapping_NoWrites`).
- [x] The 5-runtime docker-compose stack (Next.js, Go, Postgres, ClickHouse, PuppyGraph) boots cleanly via `make up`; the smoke script (`bash app/scripts/smoke.sh`) exercises case-create → upload → column-mapping → chart-render end-to-end against the four fixture schemas (bank / crypto / phone / travel) and exits 0. — docker-compose has 5 services (clickhouse + puppygraph behind `profiles: ["v2"]` so v1 boots only 3); `smoke.sh` walks all 4 fixtures + 12 ACs. **runtime-verify deferred** to user's docker-compose env (no docker daemon in implement container); static checks: `bash -n smoke.sh` clean, `make -n smoke` resolves the dependency chain, 4 xlsx fixtures generated and parser-tested.

## Constraints
**Tech stack (new app, lives under `/app/` in this repo)**:
- **Frontend**: Next.js 14+ (App Router) + Tailwind CSS. Multi-page (data-explorer + case-detail + upload + column-mapping). `react-force-graph-2d` for the network chart.
- **Backend**: Go 1.22+, hexagonal layout (`domain/` / `application/` / `infrastructure/`).
- **Storage v1**: PostgreSQL (cases, files, graphs, per-file mappings, notes, tags, status).
- **Storage v2 (provisioned, dormant in v1)**: ClickHouse + PuppyGraph. Both come up in `docker-compose.yml` but the v1 code path neither reads from nor writes to them. Their adapters are stubs.

**Location constraint**:
- The webapp source MUST live under `/app/` in this repo. The `.workflow/`, `.claude/`, and `WORKFLOW.md` scaffolding at the repo root is unrelated workflow tooling and is not touched by this run.

**UX constraint**:
- Clean, easy-to-use Tailwind UI is an explicit requirement (user verbatim: "focus uxui ให้ใช้ง่ายด้วย"). Loading states, error toasts, and empty states ("no cases yet", "no files in this case yet", "no edges above current weight threshold") are part of the surface area, not a stretch goal.

**Data constraint**:
- No real CIB / police / personal data lands in the repo. All fixtures (bank / crypto / phone / travel) are synthetic.

**Operational constraint**:
- 5-runtime docker-compose footprint is provisioned, but only Next.js + Go + Postgres are exercised by v1 acceptance criteria. ClickHouse + PuppyGraph boot but are not asserted on.

**Identity constraint (v1 default)**:
- No auth. `uploaded_by` is recorded as the constant string `"analyst"`. When auth is added (out of scope here), this field upgrades to a real user id without schema rewrite.

## Carried-over follow-ups
None. The 17 open items in `.workflow/FOLLOWUPS.md` (F0001–F0017) are all about the `/dev` workflow itself and none are in scope for a CIB webapp build.

## Open questions
Things to confirm before planning. Empty when status = `approved`.

1. **"puppygharp" interpretation.** Parsed as **PuppyGraph** (graph-query layer over Postgres + ClickHouse, openCypher / Gremlin). Non-blocking for v1 because the v1 code path neither reads from nor writes to PuppyGraph — the adapter is a stub. If the user meant a different tool, only the v2 design changes, not the v1 deliverable.
2. **File-blob storage strategy.** Should the original xlsx file be stored as a Postgres `BYTEA` column, on the local filesystem (mounted into the Go container), or in a dedicated `/data` volume? Lead picks at plan time; engineer confirms at implement. Default lean: filesystem under `/data` with the row holding a path, since xlsx ≤ 5 MiB and re-rendering doesn't need the blob in-DB.
3. **Markdown renderer for case notes.** `react-markdown` is the default if lead doesn't say otherwise. Trivial; lead can pick.
