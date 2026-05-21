# Review: CIB data analytics webapp

**Plan**: [./plan.md](./plan.md)
**Spec**: [./spec.md](./spec.md)
**Reviewed**: 2026-05-21
**Verdict**: fix-required
**Cycle**: 1 of max 2

## Plan adherence
One row per plan step. No skipping rows. Deviation needs a one-line reason.

### Phase 1: Repo skeleton + docker-compose + tooling
- [x] Step 1 — implemented as planned (workspace skeleton present under `/app/`).
- [ ] Step 2 — **deviated: `docker-compose.yml` declares `build:` blocks for `api` and `web` services but the referenced Dockerfiles (`app/backend/Dockerfile`, `app/frontend/Dockerfile`) do not exist. `docker compose build` fails; `make up` cannot satisfy AC12.**
- [x] Step 3 — implemented (`.env.example` present with required vars).
- [x] Step 4 — implemented (Makefile has the required targets).
- [ ] Step 5 — **deviated: `scripts/migrate.sh` shell parses but the `goose` binary is not installed in any image and there is no install step anywhere. Script will fail at runtime.**
- [ ] Step 6 — **deviated: `smoke.sh` shell parses but its first migration step (`make migrate`) depends on step 5's broken chain.**

### Phase 2: Postgres schema + migrations
- [x] Step 7 — implemented (cases migration matches schema spec).
- [x] Step 8 — implemented (trigram + GIN indexes present).
- [x] Step 9 — implemented (files migration with FK + size CHECK).
- [x] Step 10 — implemented (file_mappings PK=FK + headers jsonb).
- [x] Step 11 — implemented (file_graphs jsonb columns present).
- [x] Step 12 — implemented (jsonb GIN indexes present).
- [ ] Step 13 — **deviated: `goose` is referenced in `go.mod` and `migrations/README.md` but never invoked at runtime. `cmd/api/main.go:110` calls `pgxgoose.OpenDBWithDriver("postgres", dsn)` which uses `sql.Open("pgx", ...)` and there is no `_ "github.com/jackc/pgx/v5/stdlib"` import anywhere. Migration is a no-op that silently errors at boot. See Findings > Blocking #1.**

### Phase 3: Go domain layer + ports
- [x] Step 14 — implemented (`Case` value object + tests).
- [ ] Step 15 — **deviated: tiebreaker direction is inverted vs. plan and risk table. Plan / `Risks` row 3 say "lower `uploaded_at` wins" (earlier-file authority); `graph.go:37-41` + `graph_test.go` pin "later wins". Pick one, fix the other; update comment + risk row.**
- [x] Step 16 — implemented (`ColumnMapping.Validate` + tests).
- [ ] Step 17 — **skipped: `FilterEdgesByWeight` exists in `filter.go` + has a unit test but is NEVER CALLED. Weight filtering is done client-side in `NetworkChart.tsx:21`. The function is dead code; either delete or wire on the server side.**
- [ ] Step 18 — **deviated: sentinel set duplicates — `ErrInvalidStatus` is declared in both `errors.go:12` and `case.go:39` (as `ErrBadStatus`). One is dead.**
- [x] Step 19 — implemented (CaseRepository port).
- [x] Step 20 — implemented (FileRepository port).
- [ ] Step 21 — **deviated: `GraphRepository.GetByFile` has no production caller in the use cases; only `GetByCase` is used. Dead port method.**
- [x] Step 22 — implemented (XlsxParser port).
- [ ] Step 23 — **deviated: `GraphStore` port + `puppygraph.StubStore` constructed in main.go but never injected (`main.go:64-65` does `_ = store`). Stub doc comment lies ("logs once at startup"); the log lives inside `Publish` which is never called.**

### Phase 4: Driven adapters
- [ ] Step 24 — **blocked: `case_repo.go` implementation exists, but the `-tags=integration` postgres test prescribed in the verify clause is NOT IMPLEMENTED. No tests live under `internal/adapters/driven/postgres/`. The real WHERE-clause composition path is uncovered; only a fake repo's reimplementation is tested. AC4's blocking gap traces here.**
- [ ] Step 25 — **blocked: `file_repo.go` implementation exists, but no integration tests. The header-stash + mapping-decode duplication at `file_repo.go:69-78` / `:106-115` is uncovered (and silently swallows `json.Unmarshal` errors at lines 70/107).**
- [ ] Step 26 — **blocked: `graph_repo.go` implementation exists, but no integration tests. `GetByCase` returns `(nil, nil)` for a missing caseID, which the handler renders as `200 {"Nodes":null,"Edges":null}` — silent failure (see Findings > Blocking #5).**
- [x] Step 27 — implemented (`excelize_adapter.go` + tests against 4 fixtures + error cases).
- [x] Step 28 — implemented (4 xlsx fixtures present in `testdata/`).
- [ ] Step 29 — **deviated: `StubStore` is constructed but never invoked. The promised "logs once at startup" log line never fires. See step 23.**
- [x] Step 30 — implemented (`postgres.NewPool` helper present).
- [ ] Step 31 — **deviated: `postgres.WithTx` helper exists at `tx.go:10` but is NEVER CALLED. The integration test promised for the rollback path is also missing. This is the AC11 blocking gap (see Findings > Blocking #2).**

### Phase 5: Application use cases
- [x] Step 32 — implemented (`CreateCase` + tests).
- [x] Step 33 — implemented (`UpdateCase` + tests).
- [x] Step 34 — implemented (`ArchiveCase` + tests).
- [x] Step 35 — implemented (`ListCases` + tests).
- [x] Step 36 — implemented (`UploadFile` + tests with the four rejection paths).
- [ ] Step 37 — **deviated: `set_mapping_and_parse.go:46-50` issues two separate `pool.Exec` calls (mapping write, then graph write) with NO transaction wrapping. Plan verify clause prescribed "ok path + invalid-mapping rollback path asserts no file_mappings/file_graphs row written" — only the pre-write validation path is tested. Mid-write failure (e.g., SaveFileGraph errors) leaves an orphan mapping row. This is the AC11 blocking gap.**
- [x] Step 38 — implemented (`ToggleFileIncluded` + tests).
- [x] Step 39 — implemented (`GetCombinedGraph` + merge test).
- [ ] Step 40 — **deviated: `GetNodeDetail` returns `ErrFileNotFound` at `get_node_detail.go:50` for a missing node id. Should return a new `ErrNodeNotFound` sentinel. Test exercises only the happy path; missing-node branch is uncovered.**
- [x] Step 41 — implemented (`ExportGraphJSON` + shape test; thin, see non-blocking).

### Phase 6: HTTP driving adapter
- [ ] Step 42 — **deviated: `cmd/api/main.go:56-58` downgrades migration failure to `logger.Warn` and the server keeps serving against a schema-less DB. Combined with the missing pgx-stdlib driver import (step 13), the whole boot chain silently produces a broken stack. See Findings > Blocking #1.**
- [ ] Step 43 — **deviated: `router_test.go` exists but covers only `/healthz` and `/metrics` (2 of 12+ routes). Plan verify clause: "asserts each route registered." The `/api/v1/cases/...` family is unverified.**
- [x] Step 44 — implemented (logging + request_id middleware with tests).
- [x] Step 45 — implemented (error mapping middleware + test).
- [ ] Step 46 — **blocked: `handlers/cases.go` implementation exists; no `TestCasesHandler` tests exist. Five-route verify clause unsatisfied.**
- [ ] Step 47 — **blocked: `handlers/files.go` implementation exists; no `TestFilesHandler` tests exist. The upload-ok / mapping-ok / mapping-invalid-no-write verify clause is unsatisfied. Multipart size cap at `files.go:46` uses `io.LimitReader` (silent truncation) instead of `http.MaxBytesReader`.**
- [ ] Step 48 — **blocked: `handlers/graph.go` implementation exists; no `TestGraphHandler` tests exist.**
- [x] Step 49 — implemented (`handlers/health.go` exists; non-blocking nit: nil-pool guard returns 200 — see non-blocking findings).
- [ ] Step 50 — **deviated: metrics package exists at `internal/adapters/driving/http/metrics/metrics.go` but 4 of 6 metrics are NEVER OBSERVED in production code (`CasesGauge`, `FilesUploaded`, `ParseDuration`, `DBQueryDuration`). Only `CombinedGraphNodes` + `CombinedGraphEdges` are set. Plan verify clause "`grep -c '^cib_' >= 5`" passes only because the declarations exist; the actual signal is dead.**
- [ ] Step 51 — **skipped: `usecase/logging.go` exists with the helpers; `TestUsecaseLogs` prescribed by the verify clause is NOT IMPLEMENTED. No assertion that the eight events emit on their happy paths.**

### Phase 7: Next.js scaffold + Tailwind
- [x] Step 52 — implemented (`package.json` + Tailwind + Next + TS config); `npm run build` passes.
- [x] Step 53 — implemented (root layout + nav).
- [x] Step 54 — implemented (`page.tsx` redirect).
- [x] Step 55 — implemented (`lib/api.ts` typed client); minor: error-decode duplication (non-blocking).

### Phase 8: Frontend pages
- [ ] Step 56 — **deviated: `app/cases/page.tsx` is FULLY CLIENT-RENDERED. Plan: "server-render initial list, client-side filter form re-fetches on change." No server-side initial fetch; first paint is the loading skeleton. Loses the no-JS-flash benefit the spec UX constraint values.**
- [x] Step 57 — implemented (`/cases/new` create form + redirect on success).
- [ ] Step 58 — **deviated: case-detail page works but `.catch(() => ({Nodes: [], Edges: []}))` at `page.tsx:30` swallows graph fetch errors into an empty graph — backend 500 looks identical to "no edges yet" empty state. See Findings > Blocking #4.**
- [x] Step 59 — implemented (`/cases/[id]/edit` + archive button).
- [x] Step 60 — implemented (two-step upload + mapping flow).

### Phase 9: Frontend components
- [x] Step 61 — implemented (`CaseCard.tsx`); minor: status-pill class triplet duplicated with case-detail page.
- [ ] Step 62 — **deviated: `CaseFilters.tsx:69-77` uses `type="date"` controlled with full RFC3339 strings. Native `<input type="date">` expects `yyyy-mm-dd` only; the browser will reject / blank the value. Filter never applies as the user expects.**
- [x] Step 63 — implemented (`NetworkChart.tsx` with `react-force-graph-2d` dynamic import + client-side weight filter).
- [ ] Step 64 — **deviated: `NodeDetailPanel.tsx:46-66` collapses "errored" and "empty" and "populated" into one rendering, so a 404 from the missing-node path shows as a normal empty panel.**
- [x] Step 65 — implemented (`WeightSlider.tsx`); minor: same debounce-eslint-disable shape as `CaseFilters` (extract `useDebouncedEffect`).
- [ ] Step 66 — **deviated: `FileToggleList.tsx:27-30` calls `setIncluded` outside a try/catch. PATCH failure leaves the UI in a mismatched state with no error surfaced (silent failure).**
- [x] Step 67 — implemented (`ExportButtons.tsx` for PNG + JSON); thin coverage — no automated assertion that PNG is ≥ 1 KB or that JSON parses.
- [x] Step 68 — implemented (`ColumnMappingForm.tsx`); mapping is now validated twice (use case + parser). Pick one.
- [x] Step 69 — implemented (`MarkdownView.tsx` with sanitiser).
- [x] Step 70 — implemented (`ErrorBanner.tsx` + `EmptyState.tsx`).
- [x] Step 71 — implemented (`LoadingSkeleton.tsx`).

### Phase 10: End-to-end smoke + docs
- [ ] Step 72 — **blocked: `smoke.sh` content is plausible, but the whole chain (Dockerfiles → goose binary → pgx-stdlib import → in-process migration) is broken three ways above. Smoke cannot run end-to-end. AC12 fails.**
- [x] Step 73 — implemented (README with 6+ sections).
- [x] Step 74 — implemented (`make smoke` Makefile target).

## Acceptance-criteria check
Engineer ticked 12 / 12. Re-verification per the anti-bias rule and worker fanout: **6 covered, 4 thin, 2 with blocking gaps, AC12 fails on infra.** Unticked count below: **3** (AC4, AC11, AC12).

- [x] **AC1** — Create-case: `CreateCase` use case + POST `/api/v1/cases` + `/cases/new` page; covered by `usecase_test.go::TestCreateCase_*`. Evidence: `app/backend/internal/app/usecase/create_case.go`, `app/frontend/app/cases/new/page.tsx`.
- [x] **AC2** — Edit case: `UpdateCase` + PATCH route + edit page. Persistence verified by repo write path. Evidence: `app/backend/internal/app/usecase/update_case.go`, `app/frontend/app/cases/[id]/edit/page.tsx`. Thin: no end-to-end "refresh + restart" assertion (smoke is blocked).
- [x] **AC3** — Archive: `ArchiveCase` use case + `ListCases` excludes archived. Evidence: `app/backend/internal/app/usecase/archive_case.go`, `list_cases.go`, `case_repo.go`. Thin: no integration test on `case_repo.List` filter composition.
- [ ] **AC4** — **BLOCKING GAP. Filter composition and search are covered only by a fake repo's reimplementation (`list_cases_test.go`); the real `postgres.CaseRepo.List` WHERE-clause path is UNTESTED (plan step 24 `-tags=integration` test missing). Plus `CaseFilters.tsx:69-77` controls `<input type="date">` with RFC3339 strings — the date-range filter never actually applies in-browser. Filter composition is plausible but unverified end-to-end.**
- [x] **AC5** — Two-step upload + mapping flow: `UploadFile` returns headers; `/cases/[id]/upload` drives `ColumnMappingForm`. Evidence: `app/backend/internal/app/usecase/upload_file.go`, `app/frontend/app/cases/[id]/upload/page.tsx`, `app/frontend/components/ColumnMappingForm.tsx`. Non-blocking: mapping validated twice; weight column required-in-types but optional-in-spec.
- [x] **AC6** — Parse + persist + re-render: `SetMappingAndParse` → `ExcelizeParser.Parse` → `GraphRepo.SaveFileGraph`; chart `refresh()` after PATCH. Evidence: `set_mapping_and_parse.go`, `excelize_adapter.go`, `graph_repo.go`. Thin: `GetByCase` returns `(nil, nil)` for missing caseID — silently shows empty graph (see Blocking #5).
- [x] **AC7** — Per-file include/exclude + node merge: `FileToggleList` + `ToggleFileIncluded` + `MergeGraphs`. Evidence: `graph.go:37-41`, `usecase_test.go::TestMergeGraphs`. Non-blocking: merge tiebreaker direction inverted vs. plan/risk table; silent attr overwrite on conflict (Plan risk #3 partially mishandled — see Blocking #6).
- [x] **AC8** — Node-detail panel: `GetNodeDetail` + `/cases/:id/nodes/:nodeID` + `NodeDetailPanel.tsx`. Evidence: `get_node_detail.go`, `NodeDetailPanel.tsx`. Thin: returns wrong sentinel (`ErrFileNotFound`) for missing node; missing-node path not tested; panel doesn't distinguish error vs. empty.
- [x] **AC9** — Weight slider live update: `WeightSlider` + client-side `useMemo` filter in `NetworkChart`. Evidence: `WeightSlider.tsx`, `NetworkChart.tsx:21`. Thin: no automated test of live edge-count drop; `FilterEdgesByWeight` server fn is dead code; edge weight permits NaN / negative / Inf.
- [x] **AC10** — PNG + JSON export: `ExportButtons.exportPng` + `/cases/:id/graph/export.json`. Evidence: `ExportButtons.tsx`, `handlers/graph.go`. Thin: zero coverage on PNG export at any layer; JSON shape test only checks `len > 0`; if `GetByCase` returns `(nil, nil)` the user downloads an empty file as if it were the truth.
- [ ] **AC11** — **BLOCKING GAP. The pre-write validation rollback path is covered (`TestSetMappingAndParse_InvalidMapping_NoWrites`), but the mid-write rollback path is NOT TRANSACTIONAL: `set_mapping_and_parse.go:46-50` issues two independent `pool.Exec` calls and the `postgres.WithTx` helper at `tx.go:10` is never used. If `SaveFileGraph` fails, the mapping row remains. No `TestSetMappingAndParse_GraphSaveFails_RollsBackMapping` test exists. The "no half-written file row" promise of the criterion is unmet.**
- [ ] **AC12** — **BLOCKING GAP. The stack does not boot cleanly via `make up` because: (a) `docker-compose.yml` references `app/backend/Dockerfile` and `app/frontend/Dockerfile` which do not exist; (b) the `goose` binary is referenced by `scripts/migrate.sh` but is not installed in any image; (c) `cmd/api/main.go:110` calls `pgxgoose.OpenDBWithDriver("postgres", dsn)` which calls `sql.Open("pgx", dsn)` — there is no `_ "github.com/jackc/pgx/v5/stdlib"` import anywhere, so the call returns `sql: unknown driver "pgx"`; (d) `main.go:56-58` downgrades the migration failure to `logger.Warn` and keeps serving against a schema-less DB. The smoke script is consequently unrunnable. The engineer's "runtime-verify deferred to user's docker-compose env" rider does not cover these — they are static, not environmental.**

## Per-agent findings
All six dispatches were real `team-<role>` agents; no fallback fired. Each subsection holds the worker's raw findings; the consolidated synthesis sits in `Findings` below.

### team-code-reviewer
**Dispatched-as**: `team-code-reviewer`

- `go build ./...` PASS, `go vet ./...` PASS, `go test ./...` PASS.
- `golangci-lint run ./...` FAIL — 7 issues (6 errcheck on deferred `Close`, 1 ineffassign at `case_repo.go:94`).
- `npx tsc --noEmit` PASS; `npm run build` PASS (6 routes); `npm run lint` not wired (`next lint` prompts interactively, no `.eslintrc`).
- Blocking — `cmd/api/main.go:110` — `pgxgoose.OpenDBWithDriver("postgres", dsn)` internally calls `sql.Open("pgx", dsn)`; no `_ "github.com/jackc/pgx/v5/stdlib"` import; combined with `main.go:57` downgrade to `Warn`, server boots against schema-less DB.
- Blocking — `docker-compose.yml:18-21,30-33` — no Dockerfiles for `api` or `web` services.
- Blocking — `app/backend/internal/app/usecase/set_mapping_and_parse.go:46-50` — non-atomic mapping + graph write; `postgres.WithTx` at `tx.go:10` unused.
- Blocking — `app/scripts/smoke.sh:13` and `app/scripts/migrate.sh` — `goose` binary not installed anywhere.
- `internal/app/usecase/get_node_detail.go:50` — wrong sentinel: returns `ErrFileNotFound` for missing node id.
- `internal/adapters/driven/postgres/case_repo.go:94` — ineffectual `idx++` after last branch.
- `internal/adapters/driven/postgres/case_repo.go:122-133` — handrolled `itoa`; replace with `strconv.Itoa`.
- `internal/adapters/driving/http/handlers/files.go:36` — `ParseMultipartForm` doesn't bound upload size.
- `app/backend/cmd/api/main.go:64-65` — `puppygraph.StubStore` constructed then `_ = store` thrown away.
- `app/backend/internal/adapters/driving/http/metrics/metrics.go` — `CasesGauge`, `FilesUploaded`, `ParseDuration`, `DBQueryDuration` declared but never observed; only `CombinedGraphNodes/Edges` set.
- `app/frontend/components/CaseFilters.tsx:69-77` — `type="date"` controlled with RFC3339 strings; browser will reject.
- `app/frontend/lib/api.ts:54-62` — Graph types have no JSON tags (PascalCase on the wire) while the rest of the API is snake_case.
- `app/backend/internal/app/usecase/set_mapping_and_parse.go:31` — mapping validated twice.
- `app/backend/internal/domain/graph/graph.go:37-41` vs `plan.md:308` — tiebreaker direction mismatched.
- `app/frontend/app/cases/page.tsx` — fully client-rendered; plan step 56 asked for server-render initial list.
- `app/backend/internal/domain/errors.go:12` and `case.go:39` — duplicate `ErrInvalidStatus` vs `ErrBadStatus` sentinels.
- `excelize_adapter.go:27,57` and `handlers/files.go:45` — six unchecked `Close` errors (golangci-lint errcheck).
- `router.go:50-61` — CORS `Allow-Origin: *` baked in (acceptable for v1 local-only).

### team-code-simplifier
**Dispatched-as**: `team-code-simplifier`

- Blocking — `internal/domain/graph/filter.go` — `FilterEdgesByWeight` is unreachable; weight filtering is client-side in `NetworkChart.tsx:21`.
- Blocking — `app/backend/cmd/api/main.go:64-65` — `puppygraph.StubStore` constructed then `_ = store`. `puppygraph/` + `ports/graph_store.go` are v2 placeholders with zero v1 callers.
- Blocking — `internal/adapters/driven/postgres/case_repo.go:122-133` — handrolled `itoa` reinvents `strconv.Itoa`.
- `ports/graph_repository.go:13` + `graph_repo.go:41-60` — `GraphRepository.GetByFile` has no production caller.
- `domain/errors.go:12` — `ErrInvalidStatus` never returned. Delete + mapper branch + test row.
- `metrics/metrics.go` — 4 of 6 metrics never set.
- `metrics/` subpackage exists only to break a long-gone import cycle; collapse to `handlers/metrics.go`.
- `GetCase` use case is a pure pass-through; either inline or add a "deliberately thin; reserved for read-side authz" comment.
- `handlers/files.go:21` — `FilesHandler` reaches `ports.FileRepository` directly for `List`; either route all reads through use cases or none.
- `lib/api.ts:20-29` and `:111-118` — error-response decoding duplicated.
- `postgres/file_repo.go:69-78` and `:106-115` — header stash + mapping decode scan duplicated.
- `CaseCard.tsx:15-22` and `cases/[id]/page.tsx:54-61` — status-pill class triplet duplicated.
- `WeightSlider.tsx:13-22` and `CaseFilters.tsx:18-35` — same debounce shape + same eslint-disable. Extract `useDebouncedEffect`.

### team-comment-analyzer
**Dispatched-as**: `team-comment-analyzer`

- Blocking — `puppygraph/stub_store.go:1-5` — comment lies ("logs once at startup"); the `sync.Once`-guarded log is inside `Publish`, which is never called.
- Blocking — `ports/graph_store.go:11-13` — same "logs once at startup" lie.
- `domain/graph/graph.go:37-40` — "lexicographic" tiebreaker doesn't specify direction; test pins "later wins". Replace with `lexicographically greater file id wins`.
- `postgres/case_repo.go:126` — "we never reach beyond ~6 placeholders" hand-wave on `itoa` fast-path.
- `lib/api.ts:26` — empty `// ignore` content-free.
- Orphaned TODOs: none.
- Positive: `file_repo.go:37` comment explains a non-obvious choice; keep.

### team-pr-test-analyzer
**Dispatched-as**: `team-pr-test-analyzer`

- Go: 32/32 PASS. Frontend: 0 tests (no test runner configured).
- `gofmt -l` flags 5 unformatted files: `handlers/files.go`, `usecase/create_case.go`, `usecase/list_cases.go`, `usecase/update_case.go`, `usecase_test.go`. Engineer's lint bypass leaked.
- Verdict: 12/12 ticked by engineer is over-claimed. Real: 6 covered, 4 thin, 2 with blocking gaps.
- Blocking — AC11 rollback incomplete + untested for mid-write failure (`set_mapping_and_parse.go:46-50` not transactional; `WithTx` unused). Add `TestSetMappingAndParse_GraphSaveFails_RollsBackMapping`.
- Blocking — AC4 real filter / composition path uncovered. Plan step 24's `-tags=integration` `TestCaseRepo` not implemented. Only the fake repo's reimplementation is tested.
- Blocking — within-file duplicate-row coverage missing. Parser's within-file node-dedup at `excelize_adapter.go:117-124` exercised only incidentally. No fixture with duplicate `(source, target)` rows.
- Blocking — no frontend tests at all. AC9 / AC10 / AC8 / AC4 / AC5 have no automated coverage. PNG export at `ExportButtons.tsx::exportPng` has zero coverage at any layer.
- Blocking — HTTP handlers (`cases.go`, `files.go`, `graph.go`) have zero tests. Plan steps 46–48 prescribed `TestCasesHandler/TestFilesHandler/TestGraphHandler` — none implemented. `router_test.go` only covers `/healthz` + `/metrics`, NOT the `/api/v1/cases/...` family.
- Non-blocking — `TestExportGraphJSON_Shape` only checks `len > 0`; per-edge attrs round-trip not asserted.
- Non-blocking — `TestFilterEdgesByWeight` single threshold; no boundary tests (and the function is dead anyway).
- Non-blocking — `TestGetNodeDetail_AttachesEdges` happy path only; missing-node returns wrong sentinel.
- Non-blocking — `itoa` in `case_repo.go` untested.
- Non-blocking — `router_test.go` thin (2 routes vs. plan's 12+).
- Non-blocking — `TestUsecaseLogs` from plan step 51 missing.

### team-silent-failure-hunter
**Dispatched-as**: `team-silent-failure-hunter`

- Blocking — `excelize_adapter.go:97-105` — rows with missing/short source/target columns silently dropped. No log, no count, no return.
- Blocking — `excelize_adapter.go:106-113` — unparseable weight cell silently falls back to 1.0. `ParseFloat` error explicitly discarded. Thai-locale comma (`"5,000"`), currency (`"฿5000"`), any non-ASCII numeric becomes weight=1.0.
- Blocking — `set_mapping_and_parse.go:46-50` — two non-transactional writes (same as code-reviewer #3, test-analyzer AC11).
- Blocking — `file_repo.go:70,107` — `_ = json.Unmarshal(...)` swallows corrupt `header_names` errors. Corrupt stored headers → `f.Headers` nil → `Validate(nil)` → `ErrMappingSourceMissing`. User sees the wrong error.
- Blocking — `graph_repo.go:62-90` — `GetByCase` returns `(nil, nil)` for non-existent caseID (no precheck). Handler returns 200 with `{"Nodes":null,"Edges":null}`. Frontend shows empty-state. Same on `ExportGraphJSON`.
- Blocking — `handlers/files.go:46` — `io.LimitReader(file, maxUploadBytes)` silently truncates. Today masked by `MaxFileBytes=5MiB < maxUploadBytes=6MiB`; latent.
- Blocking — `handlers/files.go:36-39` — `ParseMultipartForm` errors → opaque 500. Should map `http.MaxBytesError` → 413, multipart errors → 400.
- Blocking — `graph.go:54-68` — conflicting node attrs silently overwritten. Plan risk #3 headline. No `MergeConflict` returned, no log, no surface in node-detail.
- Blocking — `cmd/api/main.go:56-58` — migration failure → `logger.Warn` + server keeps serving (same as code-reviewer #1).
- Blocking — `app/frontend/app/cases/[id]/page.tsx:30` — `.catch(() => ({Nodes: [], Edges: []}))` collapses graph fetch errors into empty graph.
- Blocking — `app/frontend/components/FileToggleList.tsx:27-30` — `setIncluded` not in try/catch. Failure leaves UI in mismatched state.
- Blocking — `get_node_detail.go:49-51` — `ErrFileNotFound` returned for missing node (wrong sentinel).
- Non-blocking — `excelize_adapter.go:133-135` — `ErrEmptyXlsx` used for both "file empty" and "mapping produced no edges."
- Non-blocking — `excelize_adapter.go:28-31,58-61` — multi-sheet workbook silently uses sheets[0]; no warning when `len(sheets) > 1`.
- Non-blocking — `tx.go:15-19` — `tx.Rollback` error silently discarded.
- Non-blocking — `file_repo.go:38-43` — `ON CONFLICT DO NOTHING` on file_mappings insert; surfaces nothing on conflict.
- Non-blocking — `handlers/files.go:45` — `defer file.Close()` ignores close error.
- Non-blocking — `health.go:24-28` — `if h.pool != nil` makes nil pool return 200; should 503.
- Non-blocking — `graph.go:84-93` — `cloneNode` produces `Attrs == nil` when both sides nil → JSON `"Attrs": null` vs `"Attrs": {}` inconsistency.
- Non-blocking — `set_mapping_and_parse.go:49` + `graph_repo.go:31-37` — no per-file edge dedup; identical rows produce identical edges.
- Non-blocking — `lib/api.ts:22-27,113-117` — response-body parse error swallowed in error path.
- Non-blocking — `NodeDetailPanel.tsx:46-66` — collapses empty into populated.
- Non-blocking — mapping validation runs twice (use case + parser).
- Non-blocking — `handlers/cases.go:93-101` — invalid `from`/`to` silently ignored; should be 400.
- Non-blocking — `lib/api.ts:9` — `NEXT_PUBLIC_API_BASE_URL` silently falls back to localhost in prod.

### team-type-design-analyzer
**Dispatched-as**: `team-type-design-analyzer`

- Blocking — `graph.go:17-24` — `Edge` permits self-loops (`Source == Target`). Parser creates them. Add `NewEdge` enforcing `src != tgt`.
- Blocking — `graph.go:17-24` — `Edge.Weight` permits negative + NaN + Inf. `FilterEdgesByWeight` short-circuits on `min <= 0`; NaN compares always-false → silently disappears at min>0.
- Cross-boundary drift (latent blocking) — Combined graph `Node`/`Edge` use PascalCase (no JSON tags); rest of API is snake_case. TS matches by accident.
- Cross-boundary drift — `CaseFile.mapping` uses PascalCase on `ColumnMapping`; `setMappingReq` *input* uses snake_case (`source_col`). Inconsistent within the same resource.
- Cross-boundary drift — `WeightCol string` (Go) vs `weight_col: string` (TS, required); spec says weight is optional. Should be `*string` + `string | null`.
- Cross-boundary drift — `Edge.Attrs map[string]string` in Go, missing from TS `GraphEdge`. UI cannot see edge attrs.
- `Edge.FileID uuid.UUID` — zero `uuid.Nil` is meaningful; assigned post-loop in `set_mapping_and_parse.go:43-45`; if skipped, merge tiebreaker picks Nil first.
- `graph.go:10-15` — `NodeID = string` with no validation. Empty string would merge all empty-id nodes.
- `mapping.go:13-36` — `ColumnMapping{}` zero value constructible; type says "any string is valid SourceCol" which is wrong.
- `case.go:11-35` — `Case.Status` zero value `""` is accepted by Scan (no `.Valid()` check); hand-edited DB rows with `status='frozen'` deserialize silently.
- `case.go:27-83` — `Title`, `Notes` not bounded; `Tags` permits duplicates / whitespace.
- `file_repository.go:12-24` — `ports.File` invariants enforced exactly once in `UploadFile.Run`; should be a domain type with constructor.
- `handlers/files.go:58,114` — `map[string]any` upload + parse responses. Replace with named structs.
- `NetworkChart.tsx:8,18,52,54` — 5 `any` casts around `react-force-graph-2d`.
- `Case.CreatedAt`, `UpdatedAt time.Time` — zero value is `0001-01-01T00:00:00Z`; not a separate sentinel from "unset."
- `setMappingReq.SourceCol/TargetCol/WeightCol string` — `{"source_col": ""}` decodes and then fails `Validate` with `ErrMappingSourceMissing` (a HEADER error misclassifying a REQUEST error).
- `MergeGraphs:69` — appends Edges by value but `Edge.Attrs` is a reference map; downstream mutation aliases.
- `MergeGraphs:41-49` — no edge dedup.
- `case_repo.go:122-133` — handrolled `itoa` (also flagged by code-reviewer and simplifier).

## Findings

### Blocking
Deduped + prioritized across the six worker reports. Every item below traces back to at least one AC gap or one plan-step deviation.

1. **AC12 boot chain broken three ways → `cmd/api/main.go:110` + `main.go:57` + `docker-compose.yml:18-21,30-33` + `app/scripts/migrate.sh`** — (a) no `_ "github.com/jackc/pgx/v5/stdlib"` import anywhere, so `pgxgoose.OpenDBWithDriver("postgres", dsn)` errors with `sql: unknown driver "pgx"`; (b) the failure is downgraded to `logger.Warn` and the server keeps serving against a schema-less DB; (c) `app/backend/Dockerfile` + `app/frontend/Dockerfile` do not exist so `docker compose build` fails; (d) the `goose` binary is referenced by `scripts/migrate.sh` but is not installed in any image. Fix: add the pgx-stdlib blank import; promote migration failure to `logger.Error` + `os.Exit(1)`; add multi-stage Dockerfiles for `api` and `web`; bake `goose` into the api image OR run migrations purely in-process via the (now-functioning) `pgxgoose` path. (Targets AC12, plan steps 2, 5, 13, 42.)

2. **AC11 transaction gap → `app/backend/internal/app/usecase/set_mapping_and_parse.go:46-50`** — `SetMapping` write and `SaveFileGraph` write are two independent `pool.Exec` calls; the `postgres.WithTx` helper at `tx.go:10` exists but is never used. `SaveFileGraph` failure leaves an orphan mapping row. The promised "rolls back the partial parse (no half-written file row)" cannot be honoured. Plan verify clause's rollback test exists only for the pre-write validation path. Fix: wrap the two writes in `postgres.WithTx`; add `TestSetMappingAndParse_GraphSaveFails_RollsBackMapping`. (Targets AC11, plan steps 31, 37.)

3. **Silent-failure cluster on the xlsx parse path → `excelize_adapter.go:97-105` + `:106-113`** — Rows with missing/short source/target columns are silently dropped; unparseable weight cells silently default to 1.0 (Thai-locale `"5,000"`, currency `"฿5000"`, any non-ASCII numeric all become weight=1.0). User uploads 100 rows, sees `edge_count: 84`, assumes duplicates; reality is 16 dropped. High-value real relationships render at the noise weight and get filtered out by the slider. Fix: track + return `rows_seen` / `rows_emitted` / `rows_skipped_*` / `weights_unparsed`; surface in upload-result response and `file.parsed` log fields; consider rejecting on `weights_unparsed > 0` as `ErrInvalidMapping` with the offending row index.

4. **Frontend silent failures → `app/cases/[id]/page.tsx:30` + `FileToggleList.tsx:27-30` + `NodeDetailPanel.tsx`** — `.catch(() => ({Nodes: [], Edges: []}))` collapses a 500 from the graph fetch into the "no edges yet" empty state; toggling a file's include flag has no try/catch around `setIncluded` so a PATCH failure leaves the UI in a mismatched state with no error; node-detail panel collapses error / empty / populated into one rendering. Fix: remove the swallow-`.catch`, surface via `ErrorBanner`; wrap `FileToggleList`'s mutation in try/catch with revert-on-error; distinguish three states in `NodeDetailPanel`.

5. **`GraphRepository.GetByCase` returns `(nil, nil)` for missing caseID → `graph_repo.go:62-90`** — handler renders `200 {"Nodes":null,"Edges":null}`; frontend shows "no edges yet — upload a file" empty state; `ExportGraphJSON` downloads an empty file as if it were the truth. No `ErrCaseNotFound` is returned. Fix: precheck `caseRepo.Get` → `ErrCaseNotFound` → 404; same for `ExportGraphJSON` path. Add integration test for the missing-case branch.

6. **`MergeGraphs` silent attribute overwrite — Plan risk #3 headline → `graph.go:54-68`** — When two files give the same node id different attributes, the later file's attrs silently overwrite the earlier's. No log, no `MergeConflict` return, no surface in `NodeDetailPanel`. For an investigative tool this is exactly the lead the analyst must not lose. Additionally, the tiebreaker direction implemented ("later wins") is inverted vs. plan + `Risks` row 3 ("lower `uploaded_at` wins"). Fix: pick a direction and align plan/code/test/comment; return `[]MergeConflict` from `MergeGraphs`; surface conflicts in `NodeDetailPanel` + export JSON; log at Info.

7. **Edge invariants missing → `graph.go:17-24`** — `Edge` permits self-loops (`Source == Target`); parser builds them. `Edge.Weight` permits negative / NaN / Inf; `FilterEdgesByWeight` short-circuits on `min <= 0` and NaN compares always-false (silently disappears for min>0). Fix: `NewEdge` constructor enforcing `src != tgt` and `Weight >= 0 && !math.IsNaN(Weight) && !math.IsInf(Weight, 0)`.

8. **Dead-code mass blocking review confidence → `puppygraph/stub_store.go` + `ports/graph_store.go` + `domain/graph/filter.go` + 4 metrics in `metrics.go` + `GraphRepository.GetByFile`** — `StubStore` constructed then discarded (`main.go:64-65`) so its self-documenting log line never fires; `FilterEdgesByWeight` is never called (filtering is client-side); 4 of 6 metrics are declared but never observed; `GetByFile` has no production caller. Fix: either wire each piece into a real path or delete + adjust plan steps 17, 21, 23, 29, 50.

9. **HTTP handler and postgres adapter test gaps → plan steps 24, 25, 26, 43, 46, 47, 48** — `TestCaseRepo` / `TestFileRepo` / `TestGraphRepo` (all `-tags=integration`) missing; `TestCasesHandler` / `TestFilesHandler` / `TestGraphHandler` missing; `router_test.go` covers 2 of 12+ routes. The real WHERE-clause path (AC4), the real multipart upload path (AC5/AC11), and the export+node-detail paths (AC8/AC10) are uncovered by anything except fake-repo reimplementations.

10. **Within-file duplicate-row coverage gap → `excelize_adapter.go:117-124`** — Plan risk #3 was interpreted only at the cross-file merge layer; within-file node-dedup is exercised only incidentally. No fixture asserts node count vs. unique-set on a fixture with duplicate `(source, target)` rows. Fix: add a `dupe_rows.xlsx` fixture + assertion.

11. **No frontend tests at all** — AC4 (filter UI), AC5 (upload + mapping), AC8 (panel), AC9 (slider live update), AC10 (PNG export) have zero automated coverage. PNG export at `ExportButtons.tsx::exportPng` has no coverage at any layer. Frontend has no test runner configured. Fix: at minimum, wire a smoke that asserts the relevant `data-testid`s render + clicks the PNG button + asserts the download blob's MIME type.

12. **Multipart upload silent failures → `handlers/files.go:36-39` + `:46`** — `ParseMultipartForm` errors map to opaque 500 via the default mapper branch (should be 400 for malformed multipart, 413 for `http.MaxBytesError`). `io.LimitReader(file, maxUploadBytes)` silently truncates instead of erroring on oversize (today masked because `MaxFileBytes < maxUploadBytes`, but the moment either is bumped, silent corruption). Fix: wrap `r.Body` in `http.MaxBytesReader`; add `ErrInvalidMultipart` sentinel; map both correctly.

13. **JSON casing drift across the API boundary → backend `Node`/`Edge`/`ColumnMapping` field tags vs. `lib/api.ts`** — Backend `Graph` types have no JSON tags so PascalCase ships on the wire while the rest of the API is snake_case; TS matches by accident. The moment any contributor adds `json:"source"` etc., the frontend breaks. `setMappingReq` *input* is snake_case but `CaseFile.mapping` *output* is PascalCase — inconsistent within the same resource. `WeightCol` is required-in-TS but optional-in-spec. Fix: add `json:"..."` tags on every domain type that crosses HTTP; converge on snake_case; make `weight_col` `*string` + `string | null`.

14. **Verify claims partial / lint bypass leaked → `gofmt -l` flags 5 unformatted files; `golangci-lint run ./...` fails 7 issues; `npm run lint` not wired** — Engineer ticked all ACs but the underlying static-quality gate is not green. `handlers/files.go`, `usecase/create_case.go`, `usecase/list_cases.go`, `usecase/update_case.go`, `usecase_test.go` are not gofmt-clean. Six unchecked `Close` errors + one ineffassign at `case_repo.go:94`. No `.eslintrc` exists so `npm run lint` prompts interactively. Fix: `gofmt -w` the five files; address the 6 errcheck + 1 ineffassign; commit `.eslintrc` and wire `npm run lint` non-interactively.

15. **Plan-step skips / blocks summary (impacts review confidence on all ACs)** — Step 17 dead code, step 23 / 29 dead stub, step 24 / 25 / 26 missing integration tests, step 31 helper exists but unused, step 37 not transactional, step 43 router test 2-of-12+, steps 46–48 handler tests missing, step 50 metrics 4-of-6 dead, step 51 `TestUsecaseLogs` missing, step 56 client-rendered instead of server-rendered. Engineer must address each on cycle 2 with a row-by-row reply.

### Non-blocking
These do not block ship on their own; carry into retro + FOLLOWUPS.

- `get_node_detail.go:50` — `ErrNodeNotFound` sentinel missing; currently returns `ErrFileNotFound`. → add sentinel + map to 404 + add test row.
- `case_repo.go:122-133` — handrolled `itoa`; replace with `strconv.Itoa`.
- `case_repo.go:94` — ineffectual `idx++` after last branch.
- `internal/domain/errors.go:12` + `case.go:39` — duplicate `ErrInvalidStatus` vs `ErrBadStatus`; drop one.
- `lib/api.ts:20-29` + `:111-118` — extract `throwIfNotOk` helper.
- `postgres/file_repo.go:69-78` + `:106-115` — extract `scanFile`.
- `CaseCard.tsx:15-22` + `cases/[id]/page.tsx:54-61` — extract `statusBadgeClasses`.
- `WeightSlider.tsx:13-22` + `CaseFilters.tsx:18-35` — extract `useDebouncedEffect`.
- `metrics/` subpackage — collapse into `handlers/metrics.go`.
- `GetCase` use case — add a one-line "deliberately thin; reserved for read-side authz" comment or inline it.
- `handlers/files.go:21` — make read paths symmetric (all through use cases or none).
- `puppygraph/stub_store.go:1-5` + `ports/graph_store.go:11-13` — fix the "logs once at startup" comment, OR (preferred) delete the dormant scaffold and the comment with it.
- `domain/graph/graph.go:37-40` — tiebreaker comment should say `lexicographically greater file id wins` (or whatever direction is chosen after Blocking #6).
- `postgres/case_repo.go:126` + `lib/api.ts:26` — non-substantive / content-free comments; rewrite or drop.
- `usecase_test.go:358-374 TestExportGraphJSON_Shape` — assert per-edge attrs round-trip, not only `len > 0`.
- `filter_test.go:5-21` — boundary tests (and only if `FilterEdgesByWeight` survives; see Blocking #8).
- `usecase_test.go:376-402 TestGetNodeDetail_AttachesEdges` — add missing-node branch.
- `case_repo.go:122-133` — `itoa` untested.
- `router_test.go` — expand from 2 routes to the full 12+ from plan step 43.
- `TestUsecaseLogs` from plan step 51 — add.
- `excelize_adapter.go:133-135` — `ErrMappingProducedNoEdges` separate from `ErrEmptyXlsx`.
- `excelize_adapter.go:28-31,58-61` — warn when `len(sheets) > 1`.
- `tx.go:15-19` — log `tx.Rollback` errors.
- `file_repo.go:38-43` — surface conflict on `ON CONFLICT DO NOTHING`.
- `handlers/files.go:45` — `defer file.Close()` ignores close error.
- `health.go:24-28` — nil pool should 503 not 200.
- `graph.go:84-93` — `cloneNode` consistent `Attrs: {}` vs `null`.
- `set_mapping_and_parse.go:49` + `graph_repo.go:31-37` — per-file edge dedup.
- `lib/api.ts:22-27,113-117` — response-body parse error swallowed in error path.
- `NodeDetailPanel.tsx:46-66` — error / empty / populated distinction (also blocking-adjacent via #4).
- mapping validation runs twice (use case + parser) — pick one source of truth.
- `handlers/cases.go:93-101` — invalid `from`/`to` should be 400.
- `lib/api.ts:9` — `NEXT_PUBLIC_API_BASE_URL` silent localhost fallback in prod.
- `Case.CreatedAt/UpdatedAt time.Time` zero value — add explicit "unset" sentinel or use `*time.Time`.
- `setMappingReq` request-body validation should be `ErrInvalidRequest`, not `ErrMappingSourceMissing` (which is a header error).
- `MergeGraphs:69` — `Edge.Attrs` map aliasing risk.
- `MergeGraphs:41-49` — no edge dedup.
- `NodeID = string` validation; `ColumnMapping{}` zero-value constructible; `Case.Status` Scan without `.Valid()`; `Title`/`Notes`/`Tags` bounds; `ports.File` invariants — collected type-design hygiene, pick the highest-payoff ones.
- `handlers/files.go:58,114` — `map[string]any` upload + parse responses; replace with named structs.
- `NetworkChart.tsx:8,18,52,54` — 5 `any` casts around `react-force-graph-2d`; type the wrapper.
- `router.go:50-61` — CORS `Allow-Origin: *` baked in; v1 OK, surface as a v2 follow-up.

## Sign-off
needs-another-round → loop back to engineer for cycle 2.

Cycle 1 verdict: **fix-required**. 15 blocking findings, 3 unticked ACs (AC4, AC11, AC12). Engineer's 12/12 tick was over-claimed; the synthesis above shows 6 covered, 3 thin (AC2, AC3, AC9, AC10 — counted as covered above but called out), and 3 with blocking gaps. Cycle 2 expectations: address every blocking row in this `review.md`; the four convergent items (AC12 boot chain, AC11 transaction, silent-failure cluster, `MergeGraphs` attr overwrite) are the floor for a pass.
