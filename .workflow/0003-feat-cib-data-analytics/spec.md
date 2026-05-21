# Spec: CIB data analytics webapp

**ID**: 0003-feat-cib-data-analytics
**Type**: feat
**Date**: 2026-05-21
**Status**: draft
**Ship as**: one-drop
**Parent**: none
**Open PR on ship**: yes   <!-- default-for-feat; user did not explicitly answer — see Open questions #7 -->

## Goal
Ship a webapp that lets a user upload a small xlsx file of CIB raw data and renders a network chart (nodes + edges) of the relationships in that file.

## Users
Analysts working in the **Central Investigation Bureau (กองบังคับการตำรวจสอบสวนกลาง)** context of the Royal Thai Police — the user identified the domain as "กลองตำรวจสอบสวนกลาง" (CIB / Thai police), not Corporate/Investment Banking. MVP is single-user / single-session; no auth or multi-user collaboration in this run. Exact analyst role and operating environment to be confirmed at the gate (see Open questions #4).

## Scope
**In**:
- A webapp lives **in this repo under `/app/`** (workflow scaffolding stays at the repo root).
- Upload form that accepts a small `.xlsx` file (single file, in-memory-feasible scale).
- Parse the uploaded xlsx into "raw data" rows.
- Derive a graph (nodes + edges) from the parsed rows and render it as an interactive **network chart** in the browser.
- A Go backend service handles the parse + graph-derivation work; Next.js (with Tailwind CSS) is the frontend.
- Postgres and ClickHouse are provisioned as the storage layer; PuppyGraph (interpreted from "puppygharp" — see Open questions #1) is the graph-query layer that exposes the underlying SQL stores as a queryable property graph backing the network chart.

**Out (non-goals)**:
- No authentication, login, or user accounts in this MVP.
- No multi-user collaboration, no shared sessions, no roles/permissions.
- No real CIB / police case data, no personal data, no identifiable records shipped in the repo or any sample dataset — synthetic / fake data only. (See Open questions #5.)
- No real-time / streaming ingest — single-file, on-demand upload only.
- No large-file or multi-file ingest in this run ("small xlsx" per the user).
- No analytics features beyond the network chart (no dashboards, no time-series, no exports) in this MVP.
- No production deploy in this run — local dev / containerized runtime only.

## Acceptance criteria
Observable behaviours. `engineer` ticks these as they land; `lead` re-checks during review; `qa` maps each to a specific test in `tests.md`.

- [ ] A user can navigate to the webapp, select a small `.xlsx` file via an upload control, and submit it without the page erroring.
- [ ] After a successful upload, the parsed rows from the xlsx are turned into graph nodes and edges and rendered as a visible network chart in the browser.
- [ ] The Go backend exposes an HTTP endpoint that accepts the uploaded xlsx, parses it, and returns the derived graph (or persists it so the frontend can render it via the graph-query layer) — verified by hitting the endpoint directly with a synthetic xlsx fixture.
- [ ] Uploading an empty xlsx, a non-xlsx file, or a malformed xlsx produces a user-visible error message rather than a crash or a silent failure.

> Row-to-graph mapping rules (which columns become nodes vs edges) are not yet specified — see Open questions #3. Acceptance criteria above will need to be tightened with a concrete mapping convention before the plan can land.

## Constraints
**Tech stack (new app, lives under `/app/` in this repo)**:
- **Frontend**: Next.js + Tailwind CSS.
- **Backend**: Go (Golang) — separate service.
- **Storage**: PostgreSQL (relational) + ClickHouse (columnar / analytics).
- **Graph layer**: PuppyGraph — interpreted from the user's verbatim "puppygharp"; graph-query layer over Postgres + ClickHouse, queryable via openCypher / Gremlin, backs the network chart. **This interpretation is unconfirmed — see Open questions #1.**

**Location constraint**:
- The webapp source MUST live under `/app/` in this repo. The `.workflow/`, `.claude/`, and `WORKFLOW.md` scaffolding at the repo root is unrelated workflow tooling and is not touched by this run.

**Operational constraint**:
- The stack is heavy for a single-file xlsx uploader (5+ runtimes: Next.js, Go, Postgres, ClickHouse, PuppyGraph). The plan step (`lead`) needs to decide whether all five are provisioned in this `/dev` run or whether some are staged later — flagged in Open questions #6 for the gate.

**Data constraint**:
- No real CIB / police / personal data lands in the repo. Any sample dataset for tests or local dev MUST be synthetic.

## Carried-over follow-ups
None. The 17 open items in `.workflow/FOLLOWUPS.md` (F0001–F0017) are all about the `/dev` workflow itself (fanout regex single-source, team-agent roster dedup, install-time UX, etc.) and none are in scope for a CIB webapp build.

## Open questions
Things to confirm before planning. Empty when status = `approved`.

1. **"puppygharp" interpretation.** Parsed as **PuppyGraph** (graph-query layer over Postgres + ClickHouse, openCypher / Gremlin). If the user meant something else (Puppeteer? a typo for a different tool?), the stack and the graph layer change — confirm at the gate.
2. **User / persistence model.** MVP is "import small xlsx → render network chart". Is the import **session-scoped** (in-memory, cleared on refresh) or **persisted** to Postgres / ClickHouse across sessions? The chosen stack includes both DBs, which suggests eventual persistence, but for the MVP it may be deferred. Confirm at the gate.
3. **Network-chart semantics — row-to-graph mapping.** "Network chart for raw data" — which xlsx columns become nodes, which become edges, are edges weighted, do nodes have attributes? The plan needs an example xlsx schema or a "first column = node A, second column = node B" convention before this can be implemented. Tightening required.
4. **User role / auth.** Are the users authenticated CIB analysts, or is the MVP an unauthenticated demo? The chosen MVP scope was the most minimal option, so the spec defaults to **unauthenticated** and lists auth as a non-goal — but confirm at the gate.
5. **No real CIB / police data.** Confirm at the gate that we do not ship any real police data, real personal data, or identifiable case data — the demo dataset (if any) must be synthetic.
6. **Stack is heavy for MVP.** Next.js + Go + Postgres + ClickHouse + PuppyGraph is 5+ runtimes for a single-page xlsx-uploader. The plan (lead) should decide whether to provision all 5 in this `/dev` run or stage the rollout (e.g., MVP with Next.js + Go + in-memory graph first, add Postgres / ClickHouse / PuppyGraph as a follow-up). Confirm at the gate.
7. **Open PR on ship.** Defaulted to `yes` per the feat default rule because the user did not answer this slot. Confirm at the gate.
8. **Tighten acceptance criteria.** Current ACs depend on the row-to-graph mapping (#3) and the persistence model (#2). Once those are pinned, ACs should be revised to assert concrete observable behaviours (e.g., "a 10-row xlsx with columns `source, target, weight` renders 10 edges and N unique nodes").
