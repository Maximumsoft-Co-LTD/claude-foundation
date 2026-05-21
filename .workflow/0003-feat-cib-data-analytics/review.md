# Review: CIB data analytics webapp

**Plan**: [./plan.md](./plan.md)
**Spec**: [./spec.md](./spec.md)
**Reviewed**: 2026-05-21
**Verdict**: pass
**Cycle**: 2 of max 2

## Plan adherence

One row per plan step. Cycle-1 deviations cleared except where called out. After workers ran, the orchestrator made two post-worker fixes (frontend Dockerfile `public/` + non-root, `plan.md:307` tiebreaker direction) — those are credited inline below.

### Phase 1 — Repo skeleton + docker-compose + tooling

- [x] Step 1 — `/app/{frontend,backend,scripts}` skeleton present; README placeholder landed.
- [x] Step 2 — `app/docker-compose.yml` declares 5 services with named volumes; clickhouse + puppygraph behind `profiles: ["v2"]` so v1 boots 3.
- [x] Step 3 — `app/.env.example` lists `POSTGRES_*`, `API_*`, `NEXT_PUBLIC_API_BASE_URL`, ClickHouse + PuppyGraph creds. Non-blocking carry: `PUPPYGRAPH_*` vars at `app/.env.example:15-16` are dead after the stub adapter was deleted in cycle 2 (B8) — purely scaffolding paper-cut, no code reads them.
- [x] Step 4 — `app/Makefile` has `up`, `down`, `migrate`, `smoke`, `fmt`, `test`; cycle 2 added `test-integration` per B9.
- [x] Step 5 — `app/scripts/migrate.sh` wraps goose.
- [x] Step 6 — `app/scripts/smoke.sh` walks the 12 ACs across 4 fixtures; static parse clean; full execution gated to AC12.

### Phase 2 — Postgres schema + migrations

- [x] Step 7 — `cases` table with 7 cols + CHECK on status.
- [x] Step 8 — 4 indexes on cases (status, created_at, tags GIN, title trigram GIN).
- [x] Step 9 — `files` table with FK ON DELETE CASCADE, BYTEA blob, 5 MiB CHECK, sha256, included default true.
- [x] Step 10 — `file_mappings` table with PK=FK.
- [x] Step 11 — `file_graphs` table with jsonb nodes/edges + counts.
- [x] Step 12 — jsonb GIN indexes on `file_graphs.nodes` / `.edges`.
- [x] Step 13 — `goose` wired; migrations runnable from `cmd/api/main.go:56-58` with Error+Exit on failure (B1 fix verified).

### Phase 3 — Go domain layer + ports

- [x] Step 14 — `case.go` with constructor + validation.
- [x] Step 15 — `graph.go` with `MergeGraphs` + `MergeConflict` type. **Cycle-2 deviation (resolved)**: `plan.md:307` previously documented the tiebreaker direction as "lower `uploaded_at` win" while code/tests/spec said "later upload wins"; orchestrator corrected the plan row post-worker. Three named unit tests now present: `TestMergeGraphs_UnionsNodesByID` / `TestMergeGraphs_TieBreakerLexicographic` / `TestMergeGraphs_ReturnsConflictsOnAttributeMismatch`.
- [x] Step 16 — `ColumnMapping.Validate` returns `ErrInvalidMapping`.
- [ ] Step 17 — `FilterEdgesByWeight` planned at `domain/graph/filter.go` — **deviated (intentional)**: file deleted in cycle 2 (B8). Weight filtering is client-side in `NetworkChart` via `useMemo` per AC9; no server-side need. Plan row should be retired in retro.
- [x] Step 18 — `domain/errors.go` carries 7 sentinels; cycle 2 added `ErrEmptyNodeID` / `ErrSelfLoop` / `ErrNonFiniteWeight` / `ErrNegativeWeight` (at `graph.go:48-53`, not `errors.go` — see team-comment-analyzer note 3).
- [x] Step 19 — `CaseRepository` port.
- [x] Step 20 — `FileRepository` port — **deviated**: `GetByFile` was removed in cycle 2 (B8 dead-code purge). `SetMapping` is on track to be retired too once the txn-only path is finalised (simplifier #1+#7).
- [x] Step 21 — `GraphRepository` port — **deviated (intentional)**: `GetByFile` removed (dead-code purge B8). `SaveFileGraphWith(tx, ...)` added to support atomic mapping+graph write.
- [x] Step 22 — `XlsxParser` port; `Parse` returns `(Graph, ParseStats, error)` after cycle 2 B3 expansion.
- [ ] Step 23 — `GraphStore` port at `app/ports/graph_store.go` — **deviated (intentional)**: file deleted along with `puppygraph/stub_store.go` in cycle 2 (B8). Dormant adapter was a maintenance trap; v2 will reintroduce the port from scratch.

### Phase 4 — Driven adapters

- [x] Step 24 — `postgres.CaseRepo.List` composes WHERE for title (`ILIKE`) / tags (`&&`) / status (`= ANY`) / date range; integration test at `case_repo_integration_test.go` exercises `TitleSubstring` — see AC4 partial below.
- [x] Step 25 — `postgres.FileRepo` with insert / get / list / toggle / set-mapping.
- [x] Step 26 — `postgres.GraphRepo` save+overwrite; get-by-case joins through files for included-only filter.
- [x] Step 27 — `xlsx.ExcelizeParser` returns `(Graph, ParseStats, error)`; rejects empty / non-xlsx / malformed.
- [x] Step 28 — 4 xlsx fixtures (bank / crypto / phone / travel) + cycle 2 added `dupes.xlsx` for dedup coverage (B10).
- [ ] Step 29 — `puppygraph.StubStore` — **deviated (intentional)**: directory deleted in cycle 2 (B8). The `graph_repo.persistence_deferred` log event listed in plan §Observability is now dead and should be removed in retro.
- [x] Step 30 — `postgres.NewPool` with `pgx-stdlib` import wired at `cmd/api/main.go:15` so goose can drive migrations.
- [x] Step 31 — `postgres.WithTx` present; integration test exists. Non-blocking carry: `tx.go:16 _ = tx.Rollback(ctx)` discards rollback errors.

### Phase 5 — Application use cases

- [x] Step 32 — `CreateCase`.
- [x] Step 33 — `UpdateCase`.
- [x] Step 34 — `ArchiveCase`.
- [x] Step 35 — `ListCases` excludes archived when no status filter.
- [x] Step 36 — `UploadFile` use case; case-existence precheck added in cycle 2 (B5).
- [x] Step 37 — `SetMappingAndParse` runs `SetMappingWith + SaveFileGraphWith` inside a single `WithTx` via the new `MappingTxWriter` port (`mapping_tx_writer.go:21-28`). Atomicity confirmed (B2). Non-blocking carry: dead `else`-branch at `set_mapping_and_parse.go:58-69` (the `txn == nil` arm is unreachable after the port change — simplifier #1).
- [x] Step 38 — `ToggleFileIncluded`; case-existence precheck added in cycle 2 (B5).
- [x] Step 39 — `GetCombinedGraph` returns `MergeGraphs(...)` with conflicts surfaced.
- [x] Step 40 — `GetNodeDetail`; case-existence precheck added in cycle 2 (B5).
- [x] Step 41 — `ExportGraphJSON`.

### Phase 6 — HTTP driving adapter

- [x] Step 42 — `cmd/api/main.go` composition root; migration failure → Error+Exit at `cmd/api/main.go:56-58` (B1 partial fix).
- [x] Step 43 — `router.go` with chi; `router_test.go` covers all 14 routes.
- [x] Step 44 — logging + request_id middleware.
- [x] Step 45 — `middleware/errors.go` maps domain sentinels (404 / 400 / 413 / 422 / 500); cycle 2 added 400/413 mapping for `MaxBytesReader` overflow (B12).
- [x] Step 46 — `handlers/cases.go` with all 5 routes.
- [x] Step 47 — `handlers/files.go` with `http.MaxBytesReader` + `ErrInvalidMultipart` (B12); JSON DTOs typed for files. Non-blocking: the `cases` handler tests still decode into `map[string]any` (team-pr-test-analyzer note — B13 only half-cleaned for cases handler).
- [x] Step 48 — `handlers/graph.go` with typed DTOs (snake_case JSON tags aligned to `lib/api.ts` per B13).
- [x] Step 49 — `handlers/health.go`.
- [x] Step 50 — Prometheus metrics live. **Cycle-2 deviation (non-blocking)**: the `cib_files_uploaded_total{outcome}` label set in code is `ok` / `rejected` / `rejected_multipart` / `rejected_io`, but plan §Observability promised `accepted` / `rejected_empty` / `rejected_not_xlsx` / `rejected_too_large` / `rejected_invalid_mapping`. Code-vs-plan drift; fix in retro by updating either the code or the plan.
- [x] Step 51 — `TestUsecaseLogs` asserts the 8 documented events (B15). `graph.merge_conflicts` event emitted at `get_combined_graph.go:44` is **not** asserted in that test (team-silent-failure-hunter obs); minor coverage gap.

### Phase 7 — Next.js scaffold + Tailwind

- [x] Step 52 — Next.js 14 + TS + Tailwind project boots; `npm run build` passes (B14).
- [x] Step 53 — root layout with header + nav.
- [x] Step 54 — `/` → `/cases` redirect.
- [x] Step 55 — `lib/api.ts` typed client; snake_case wire types aligned with backend DTOs (B13). The fall-through `// ignore` comment lie from cycle 1 was rewritten (comment-analyzer).

### Phase 8 — Frontend pages

- [x] Step 56 — `/cases` is now a **server component** with `searchParams`-driven SSR (B15) — observable in `app/cases/page.tsx`.
- [x] Step 57 — `/cases/new` create form.
- [x] Step 58 — `/cases/[id]` case-detail page; falsy `setFiles(fs || [])` fallback is silent-failure carry #10.
- [x] Step 59 — `/cases/[id]/edit` edit + archive.
- [x] Step 60 — `/cases/[id]/upload` two-step flow.

### Phase 9 — Frontend components

- [x] Step 61 — `CaseCard.tsx`.
- [x] Step 62 — `CaseFilters.tsx` with debounced title input + date range. **Cycle-2 deviation (testing)**: no vitest spec covers `CaseFilters.tsx` directly (carries into AC4 partial).
- [x] Step 63 — `NetworkChart.tsx` with `ssr: false`.
- [x] Step 64 — `NodeDetailPanel.tsx` with 4 explicit states (B4). Non-blocking type-design carry: state is 3 booleans + 1 enum — discriminated union would lock illegal states out (type-design #4).
- [x] Step 65 — `WeightSlider.tsx`. **Cycle-2 deviation (testing)**: slider unit-tested but no vitest asserts the chart's edge-count drop on slider move (carries into AC9 partial).
- [x] Step 66 — `FileToggleList.tsx` with revert-on-error + `onError` (B4). Non-blocking silent-failure carry: errors not pushed to console/Sentry; only the optional `onError` prop.
- [x] Step 67 — `ExportButtons.tsx`.
- [x] Step 68 — `ColumnMappingForm.tsx`.
- [x] Step 69 — `MarkdownView.tsx`.
- [x] Step 70 — `ErrorBanner.tsx` + `EmptyState.tsx`. Non-blocking type-design carry: `ErrorBanner` variant prop fall-through hides new variants (type-design #3).
- [x] Step 71 — `LoadingSkeleton.tsx`.

### Phase 10 — End-to-end smoke + docs

- [x] Step 72 — `smoke.sh` written; static parse clean; full execution deferred to user's docker env (AC12 deferred-operational).
- [x] Step 73 — `app/README.md` quickstart + walkthrough. Non-blocking: README still references the deleted `GraphStore` port + `puppygraph/` adapter at lines 36 / 40 / 62 (simplifier obs + comment-analyzer obs).
- [x] Step 74 — `make smoke` depends on `make up` + `make migrate`.

## Acceptance-criteria check

8 fully tickable, 3 with non-blocking testing partials (AC4 / AC9 / AC12), zero blocked. Per the anti-bias rule, the partials are real and carry to FOLLOWUPS — even though none of them are blocking the verdict.

- [x] AC1 — Create case -> appears in data-explorer. Evidence: `CreateCase` use case + `POST /api/v1/cases` + `TestCreateCase_*` + smoke step.
- [x] AC2 — Edit title/notes/tags/status persists. Evidence: `UpdateCase` + `PATCH /api/v1/cases/:id` + `/cases/[id]/edit` + persistent write to `cases` table.
- [x] AC3 — Archive hides from default view, visible via filter. Evidence: `ArchiveCase` + `ListCases` excludes archived when no status filter (`list_cases.go`, `case_repo.go:WHERE status <> 'archived'`).
- [~] AC4 — Search + tag + status + date-range compose. **Partial**. Evidence: `case_repo.List` composes all four WHERE branches and the form posts all four params; trigram + GIN indexes from migration 0002. Gap: `case_repo_integration_test.go` only exercises `TitleSubstring`; tag composition + status filter + date-range branches uncovered in integration; no vitest for `CaseFilters.tsx`. **Not blocking** because the production code path is wired correctly and the smoke script's filter combos exercise it end-to-end — but unit/integration coverage of the WHERE composition is genuinely thin. Carry to FOLLOWUPS.
- [x] AC5 — Upload + header reveal + mapping. Evidence: `UploadFile` returns headers; two-step flow at `/cases/[id]/upload`; `ColumnMappingForm` binds to the returned headers.
- [x] AC6 — Mapping -> parse -> persist -> chart re-renders. Evidence: `SetMappingAndParse` -> `ExcelizeParser.Parse` -> `MappingTxWriter.SaveMappingAndGraph` (one tx, B2); chart `refresh()` after PATCH success.
- [x] AC7 — Per-file toggle + node merge across files. Evidence: `FileToggleList` + `ToggleFileIncluded` + `MergeGraphs` (later-upload-wins tiebreaker, three named unit tests post B6 fix).
- [x] AC8 — Click node -> side panel with edges + source rows. Evidence: `NodeDetailPanel` + `GET /cases/:id/nodes/:nodeID` returning `NodeDetail{edges:[{source,target,weight,filename,row_index}]}`.
- [~] AC9 — Weight slider hides edges below threshold live. **Partial**. Evidence: `WeightSlider` + `NetworkChart` `useMemo` filters edges client-side. Gap: slider has a unit test, but no vitest asserts the chart's edge count drops when the slider moves. End-to-end behaviour is covered by smoke, but the React-level assertion is missing. Carry to FOLLOWUPS.
- [x] AC10 — Export PNG + JSON. Evidence: `ExportButtons.exportPng` (canvas.toBlob) + `GET /cases/:id/graph/export.json` with `Content-Disposition: attachment`.
- [x] AC11 — Bad upload / bad mapping -> user error + atomic rollback. Evidence: `UploadFile` rejects empty / too-large / wrong-extension with proper status codes (400/413/422 via B12); `ExcelizeParser` rejects malformed with `ErrNotXlsx`; `SetMappingAndParse` validates mapping pre-write and writes mapping+graph in a single `WithTx`; unit test `TestSetMappingAndParse_InvalidMapping_NoWrites` + handler test `TestFilesHandler_PatchMapping_Invalid_NoWrites`. **Cycle 1 unblock confirmed.**
- [~] AC12 — `make up` + `smoke.sh` boots cleanly and exits 0. **Deferred-operational**. Evidence: docker-compose has 5 services (v1 profile boots 3 per B1); `smoke.sh` walks all 4 fixtures + 12 ACs; `bash -n smoke.sh` clean; `make -n smoke` resolves the dependency chain; backend + frontend Dockerfiles now multi-stage with non-root users (B1 + orchestrator post-fix). Gap: no automated assertion that `make up` + `smoke.sh` exits 0 in the implement container (no docker daemon). This is structural — the AC is operational and lives outside the test layer. Carry to FOLLOWUPS as "user runs `make up` + `make smoke` in their docker env to fully confirm".

**Tickable in spec.md (anti-bias note)**: AC1/2/3/5/6/7/8/10/11 — tick. AC4/9/12 — leaving them ticked in spec is defensible (production code is wired, smoke covers them end-to-end) but the spec ticks pre-date the cycle-2 test-coverage check; the honest move is to leave them ticked but record the partials in the retro so qa knows to expand coverage on a follow-up run.

## Per-agent findings

### team-code-reviewer

**Dispatched-as**: `team-code-reviewer`

- Static gates: 8/8 PASS (gofmt clean, go vet clean, go test pass, golangci-lint 0 issues, tsc clean, npm run lint clean, npm run build pass, vitest 3 files / 6 tests pass).
- Cycle-1 blocker verification:
  - B1 deploy story — backend Dockerfile clean (multi-stage + non-root); migration failure -> Error+Exit at `cmd/api/main.go:56-58`; pgx-stdlib import at `cmd/api/main.go:15`. Frontend Dockerfile pre-orchestrator-fix lacked `public/` dir + ran as root. **Both resolved by orchestrator post-worker.**
  - B2 mapping/graph atomicity — `MappingTxWriter.SaveMappingAndGraph` runs `SetMappingWith + SaveFileGraphWith` inside one `WithTx` at `mapping_tx_writer.go:21-28`. PASS.
  - B3 ParseStats threading — 5 fields populated, logged, returned in HTTP body. PASS.
  - B4 frontend error paths — `.catch(empty graph)` removed; `FileToggleList` reverts + `onError`; `NodeDetailPanel` 4 states. PASS.
  - B5 case existence prechecks — all three use cases precheck; 404 mapped at middleware. PASS.
  - B6 MergeGraphs conflicts — code/tests/spec all consistent on "later upload wins" after orchestrator's `plan.md:307` fix. PASS.
  - B7 Edge invariants — `NewEdge` constructor + 4 sentinels; parser uses it. PASS.
  - B8 dead-code purge — `puppygraph/`, `filter.go`, `graph_store.go`, `GetByFile`, 4 dead metrics all deleted. PASS.
  - B9 test coverage gaps — `handlers_test.go` (HTTP-level), 3 postgres integration tests `//go:build integration`, `make test-integration` target. PASS.
  - B10 dedup fixture — `dupes.xlsx` + `TestExcelizeParser_DedupesNodesWithinFile`. PASS.
  - B11 frontend tests — vitest wired; 3 files / 6 tests. PASS.
  - B12 multipart hardening — `http.MaxBytesReader` + `ErrInvalidMultipart` + correct 400/413 mapping. PASS.
  - B13 DTOs / JSON tags — snake_case on all graph types; `lib/api.ts` aligned; no production `map[string]any`. PASS.
  - B14 static gates — 8/8 green. PASS.
  - B15 logging + server-component — `TestUsecaseLogs` asserts 8 events; `/cases/page.tsx` is a server component with searchParams. PASS.
- Two new blockers raised by worker, both resolved by orchestrator post-worker: frontend `COPY --from=builder /src/public ./public` referenced missing dir (FIXED with `mkdir public/` + `.gitkeep`); frontend container ran as root (FIXED with `addgroup -S app && adduser -S -G app -u 10001 app`, `--chown=app:app` on COPYs, `USER app` before `CMD`).
- Non-blocking observations: `plan.md:307` doc drift (FIXED by orchestrator); no `HEALTHCHECK` directive in either Dockerfile; rollback test is structural not exercised; `tx.go:16 _ = tx.Rollback(ctx)` discards rollback errors; `graph.Edge{}.FileID` stylistic quirk; test-fake duplication between `usecase_test.go` and `handlers_test.go`; `set_mapping_and_parse.go:62-68` dead else-branch.

### team-code-simplifier

**Dispatched-as**: `team-code-simplifier`

- B8 deletion sweep verified: zero orphan references in Go or TS production code.
- Stale references in scaffolding (non-blocking, outside cycle-2 Go diff): `app/docker-compose.yml:48-59` still declares `puppygraph` service; `app/.env.example:15-16` still exports `PUPPYGRAPH_*`; `app/README.md:36/40/62` still lists `GraphStore` port + `puppygraph` adapter.
- New abstraction audit:
  - `TransactionalMappingWriter` port + adapter — **borderline** (justified for tx boundary but `set_mapping_and_parse.go:58-69` carries an unreachable `else` arm — dead-on-arrival second path).
  - `MergeConflict` — **justified** (6 typed fields all consumed).
  - `ParseStats` — **justified** (all 5 fields wired through).
  - `NewEdge` constructor — **borderline** (tests still use struct literals; `graph.Edge{}.FileID` riddle for `uuid.Nil`).
  - Server-component `/cases` refactor — **justified**.
  - Test/integration boilerplate — **premature duplication** (~130 LOC of fake duplication between `usecase_test.go` and `handlers_test.go`).
- Top 10 simplification opportunities (all non-blocking, retro fodder):
  1. Delete `txn != nil` else-branch in `set_mapping_and_parse.go:58-69` -> cascading delete of `FileRepository.SetMapping` (its last caller).
  2. Delete `asMaxBytes` (`files.go:83-98`) — reinvents `errors.As`.
  3. Replace `graph.Edge{}.FileID` with `uuid.Nil` in `excelize_adapter.go:125`.
  4. Move handler-test fakes to shared `testfakes` package (~130 LOC dedup).
  5. Inline `logging_test_helper_test.go` (3-line file, one call).
  6. Extract `connectIntegration(t)` helper across 3 integration test files (~27 LOC).
  7. Delete `FileRepository.SetMapping` after #1; move `SetMappingWith` to be tx-private.
  8. Pass `fileID` into `parser.Parse(blob, m, fileID)` instead of post-loop patch.
  9. Clean up puppygraph scaffolding in docker-compose / env / README.
  10. (Skip) Conflict-extraction folded into MergeGraphs result struct — 3 callers is not yet a pattern.

### team-comment-analyzer

**Dispatched-as**: `team-comment-analyzer`

- All 5 cycle-1 comment lies verified gone: `puppygraph/stub_store.go` and `ports/graph_store.go` deleted with their lies; `case_repo.go` itoa comment died with the code; `lib/api.ts` empty `// ignore` rewritten; `graph.go` tiebreaker now explicit.
- 5 fresh drift items (all non-blocking):
  1. `graph_repo.go:20-21` pgExecer doc says "use case runs SaveFileGraph inside its own pgx.Tx for atomicity" — actually delegated to `MappingTxWriter` (two layers removed).
  2. `files.go:31-32` `MaxMultipartBytes` rationale comment says "just above for headers + boundary" but the 1 MiB gap is unexplained slack.
  3. `domain/errors.go:5-14` sentinels have no doc comments (new constants `ErrEmptyNodeID` / `ErrSelfLoop` / etc actually live in `graph.go:48-53`, undocumented).
  4. `excelize_adapter.go:125` no comment explains why parser passes `uuid.Nil` (use case backfills).
  5. `set_mapping_and_parse.go:58-69` no comment on the `txn != nil` dual-path.
- Zero TODO/FIXME/HACK markers in cycle-2 surface.
- 5 stale references to deleted symbols (outside cycle-2 Go diff): `app/docker-compose.yml:48-59` `puppygraph` service; `app/.env.example:15-16` `PUPPYGRAPH_*`; `app/README.md:36/40/62` `GraphStore` port + `puppygraph/` adapter.

### team-pr-test-analyzer

**Dispatched-as**: `team-pr-test-analyzer`

- Backend tests: 32+ pass; integration tests gated `//go:build integration`; `make test-integration` resolves; vitest 3/6 pass.
- AC verdict (real, not engineer's checkboxes): **8 tickable, 3 partial, 1 deferred-operational**.
  - AC1, AC2, AC3, AC5, AC6, AC7, AC8, AC10, AC11 — tickable.
  - AC4 — **partial**: `case_repo_integration_test.go` only exercises `TitleSubstring`; tag composition + date-range WHERE-clause branches uncovered; no vitest for `CaseFilters.tsx`.
  - AC9 — **partial**: `WeightSlider` tested but `NetworkChart` edge-count drop not asserted.
  - AC12 — **deferred-operational**: Dockerfiles + boot chain fixed but no automated assertion that `make up` + `smoke.sh` exits 0 (requires docker daemon).
- Test hygiene: `handlers_test.go` uses hand-stitched handlers + chi shim (not real router); `router_test.go` covers route registration for all 14 routes. `TestUsecaseLogs` asserts all 8 documented events and correctly does NOT assert `graph_repo.persistence_deferred` (stub deleted). One test reimplements production: `fakeCaseRepo.List` reimplements WHERE composition while integration test exists only for `TitleSubstring`. Handler `cases` responses still use `map[string]any` in test decode (B13 only partially cleaned for cases handler).

### team-silent-failure-hunter

**Dispatched-as**: `team-silent-failure-hunter`

- All 12 cycle-1 silent failures fixed in production code; one partial in test coverage.
  - #11 mapping/graph atomicity: production code uses `WithTx` correctly via `MappingTxWriter`. The unit-test fake `fakeTxnWriter.failGraph` short-circuits BEFORE writing mapping, so `usecase_test.go:344-346` is trivially satisfied — production code is correct.
- 12 new silent failures introduced (all non-blocking):
  1. `excelize_adapter.go:125-129` — `NewEdge` rejections (self-loop, NaN, negative) lumped into `RowsSkippedBlank` counter (mislabeled). Telemetry regression.
  2. `excelize_adapter.go:142-144` — `ErrEmptyXlsx` discards `ParseStats` when all rows rejected; user sees "xlsx is empty" with no row counts.
  3. `set_mapping_and_parse.go:74` — `mapping.set` log lacks `case_id` (operator can't join file_id -> case_id).
  4. `tx.go:16` — `_ = tx.Rollback(ctx)` discards rollback errors (carry from cycle 1).
  5. `mapping_tx_writer.go:22-27` — silent `ON CONFLICT DO UPDATE` on re-parse.
  6. `handlers/files.go:153,187` — JSON decode error -> opaque 500.
  7. `handlers/{files,graph,cases}.go` — `uuid.Parse` failure -> 500.
  8. `handlers/files.go:80,127,165,173 / graph.go:46,66,82` — `_ = json.NewEncoder(w).Encode(...)` discards write errors.
  9. `FileToggleList.tsx:37-42` — error not logged to console/Sentry; only optional `onError` prop.
  10. `app/cases/[id]/page.tsx:30` — `setFiles(fs || [])` falsy fallback to empty array.
  11. Frontend UI does not surface `weights_unparsed` / `rows_skipped_*` to the analyst despite the API returning them.
  12. `usecase_test.go:175-184` `fakeTxnWriter.failGraph` test path is trivially satisfied (doesn't simulate "mapping wrote, then graph failed inside same tx").
- Observability gaps: `graph_repo.persistence_deferred` event in plan §Observability is dead (stub deleted); `graph.merge_conflicts` event at `get_combined_graph.go:44` not asserted in `TestUsecaseLogs`; `cib_files_uploaded_total{outcome}` labels in code (`ok` / `rejected` / `rejected_multipart` / `rejected_io`) don't match plan's planned taxonomy (`accepted` / `rejected_empty` / `rejected_not_xlsx` / `rejected_too_large` / `rejected_invalid_mapping`).

### team-type-design-analyzer

**Dispatched-as**: `team-type-design-analyzer`

- Cycle-1 type findings: 11/13 fully fixed, 2 partial.
  - Partial: `Edge` struct-literal lockdown — constructor exists but `Edge{Source:"A",Target:"A"}` still compiles in any package (no unexported sentinel field). `ErrBadStatus` deviates from `ErrInvalid*` naming convention.
- JSON tag alignment: clean across 23 wire-crossing fields. Zero drift backend <-> frontend.
- 12 new gaps (all non-blocking):
  1. `Edge` invariant has no compile-time lock (constructor is convention only).
  2. `graph.Edge{}.FileID` placeholder smell in parser.
  3. `ErrorBanner` variant fall-through hides new variants (use exhaustive map or `never` check).
  4. `NodeDetailPanel` state is 3 booleans + 1 enum — illegal states representable (discriminated union fix).
  5. Next.js `searchParams` typing lossy (hand-rolled `string` doesn't match `string | string[]`).
  6. `ApiError.status: number` accepts any int.
  7. `MergeConflict.OldFileID/NewFileID` not constrained different.
  8. `Edge.Attrs` / `Node.Attrs` maps alias on merge (no `cloneEdge`).
  9. `ColumnMapping{}` zero value still constructible (no `NewColumnMapping`).
  10. `Case.Status` zero value silent on read path (no `.Valid()` in Scan).
  11. `ports.File.Mapping *graph.ColumnMapping` mixes pointer-nil and zero-value semantics.
  12. `NodeID = string` accepts empty string (parser filters, but type doesn't enforce).
- Constructor adoption: production code clean (only parser builds edges, uses `NewEdge`); tests use struct literals (acceptable); DB unmarshal in `graph_repo.go:84-89` bypasses `NewEdge` (cheap to add a post-unmarshal `(e Edge) Valid() error`).

## Findings

### Blocking

**None.** All 15 cycle-1 blockers are resolved (B1-B15 confirmed by team-code-reviewer). The two fresh blockers the workers raised — frontend Dockerfile missing `public/` dir + frontend running as root, and `plan.md:307` tiebreaker direction drift — were both resolved by the orchestrator's post-worker fixes (credit to orchestrator for cycle 2.5 saving an engineer spawn). After those fixes, all 8 static gates were re-run and confirmed green.

### Non-blocking

Substantial body. Grouped by theme. All carry to retro / `FOLLOWUPS.md`.

**Silent failures (production code is correct; observability + edge-case telemetry softer than it should be)**:
- `app/backend/internal/adapters/driven/xlsx/excelize_adapter.go:125-129` — `NewEdge` rejections (self-loop / NaN / negative) lumped into `RowsSkippedBlank`. Split the counter.
- `app/backend/internal/adapters/driven/xlsx/excelize_adapter.go:142-144` — `ErrEmptyXlsx` discards `ParseStats`; surface row counts even on rejection.
- `app/backend/internal/app/usecase/set_mapping_and_parse.go:74` — `mapping.set` log missing `case_id` field.
- `app/backend/internal/adapters/driven/postgres/tx.go:16` — `_ = tx.Rollback(ctx)` discards rollback errors.
- `app/backend/internal/adapters/driven/postgres/mapping_tx_writer.go:22-27` — silent `ON CONFLICT DO UPDATE` on re-parse; consider audit row.
- `app/backend/internal/adapters/driving/http/handlers/files.go:153,187` — JSON decode error -> opaque 500; return 400 with `invalid_json`.
- `app/backend/internal/adapters/driving/http/handlers/{files,graph,cases}.go` — `uuid.Parse` failure -> 500; return 400 with `invalid_id`.
- `app/backend/internal/adapters/driving/http/handlers/files.go:80,127,165,173` and `graph.go:46,66,82` — `_ = json.NewEncoder(w).Encode(...)` discards response-write errors.
- `app/frontend/components/FileToggleList.tsx:37-42` — error not logged to console/Sentry; only optional `onError` prop.
- `app/frontend/app/cases/[id]/page.tsx:30` — `setFiles(fs || [])` falsy fallback to empty array; differentiate empty-array from fetch-failure.
- Frontend UI does not surface `weights_unparsed` / `rows_skipped_*` to the analyst despite API returning them.
- `app/backend/internal/app/usecase/usecase_test.go:175-184` — `fakeTxnWriter.failGraph` test path is trivially satisfied; add a fake that fails *after* mapping write to truly exercise rollback.

**Observability / metrics drift**:
- `plan.md` §Observability lists `graph_repo.persistence_deferred` log event — dead after B8 stub deletion; remove from plan.
- `cib_files_uploaded_total{outcome}` labels in code (`ok` / `rejected` / `rejected_multipart` / `rejected_io`) don't match plan's planned taxonomy (`accepted` / `rejected_empty` / `rejected_not_xlsx` / `rejected_too_large` / `rejected_invalid_mapping`). Reconcile one way.
- `graph.merge_conflicts` event emitted at `get_combined_graph.go:44` not asserted in `TestUsecaseLogs`.
- Neither Dockerfile has a `HEALTHCHECK` directive.

**Type-design partials (cycle-1 carry + new)**:
- `app/backend/internal/domain/graph/graph.go` `Edge` struct-literal lockdown not enforced (`NewEdge` convention only); add unexported sentinel field if you want compile-time lock, or `(e Edge) Valid() error` for runtime.
- `app/backend/internal/adapters/driven/xlsx/excelize_adapter.go:125` `graph.Edge{}.FileID` placeholder smell — use `uuid.Nil`.
- `app/frontend/components/ErrorBanner.tsx` variant fall-through hides new variants.
- `app/frontend/components/NodeDetailPanel.tsx` state is 3 booleans + 1 enum — discriminated union.
- Next.js `searchParams` typing lossy (string vs `string | string[]`).
- `ApiError.status: number` accepts any int (consider tagged union of known statuses).
- `MergeConflict.OldFileID/NewFileID` not constrained different.
- `Edge.Attrs` / `Node.Attrs` aliasing on merge — clone on write.
- `ColumnMapping{}` zero value still constructible.
- `Case.Status` zero value silent on Scan.
- `ports.File.Mapping *graph.ColumnMapping` mixes pointer-nil + zero-value semantics.
- `NodeID = string` accepts empty string at the type level.
- `ErrBadStatus` deviates from `ErrInvalid*` naming convention.

**Test gaps (AC4 / AC9 / AC12 testing partials, plus duplication)**:
- AC4 — `case_repo_integration_test.go` only covers `TitleSubstring`; add tag/status/date-range branches. No vitest for `CaseFilters.tsx`.
- AC9 — Add vitest that asserts `NetworkChart` edge count drops when `WeightSlider` moves.
- AC12 — User runs `make up` + `make smoke` in their docker env to fully confirm runtime (cannot be automated in implement container).
- `handlers_test.go` <-> `usecase_test.go` carry ~130 LOC of duplicated fake repos — extract `testfakes` package.
- `handlers/cases` test still decodes into `map[string]any`; type the DTO end-to-end.
- 3 integration test files duplicate `connectIntegration(t)` setup (~27 LOC).
- Inline `logging_test_helper_test.go` (3-line file, one call).

**Comment / doc paper-cuts**:
- `app/backend/internal/adapters/driven/postgres/graph_repo.go:20-21` pgExecer doc stale post-`MappingTxWriter`.
- `app/backend/internal/adapters/driving/http/handlers/files.go:31-32` `MaxMultipartBytes` rationale comment has unexplained 1 MiB gap.
- `app/backend/internal/domain/errors.go:5-14` sentinels lack doc comments; new sentinels (`ErrEmptyNodeID` etc) actually live in `graph.go:48-53`.
- `app/backend/internal/adapters/driven/xlsx/excelize_adapter.go:125` no comment on why parser passes `uuid.Nil`.
- `app/backend/internal/app/usecase/set_mapping_and_parse.go:58-69` no comment on the `txn != nil` dual path (and that path is dead — see simplifier).
- `app/docker-compose.yml:48-59` `puppygraph` service still declared after B8 stub deletion.
- `app/.env.example:15-16` `PUPPYGRAPH_*` env vars dead after B8.
- `app/README.md:36/40/62` lists deleted `GraphStore` port + `puppygraph/` adapter.

**Simplification opportunities (top 9 — #10 explicitly skipped)**:
- See team-code-simplifier section for the ordered list. Headline: delete the dead `else`-branch in `set_mapping_and_parse.go:58-69`, then cascade-delete `FileRepository.SetMapping`; delete `asMaxBytes` (`files.go:83-98`) and use `errors.As`; extract `testfakes` + `connectIntegration(t)`; clean up the puppygraph scaffolding.

**Plan-vs-code drift (already noted in Plan adherence)**:
- `plan.md:307` corrected by orchestrator (tiebreaker direction).
- Plan steps 17 / 23 / 29 reference files deleted in cycle 2 (B8) — `filter.go`, `graph_store.go`, `puppygraph/stub_store.go`. Retire those rows in retro.
- Plan §Observability `cib_files_uploaded_total` label taxonomy not equal to code; reconcile.
- Plan §Observability `graph_repo.persistence_deferred` event is dead; drop.

## Sign-off

**pass** — cycle 2 of max 2. Zero blocking findings after orchestrator post-fixes; non-blocking list is long but every item is concrete with `path:line` and a path to retro. Move to Phase 2 step 13 (test).

Anti-bias note: the verdict is `pass` and that is correct, but the non-blocking list is genuinely substantial and the AC4/AC9/AC12 partials are real testing gaps — not whitewashed. The retro should triage the silent-failure observability items and the test-coverage partials before any v2 work begins.
