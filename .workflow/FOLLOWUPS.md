# Follow-ups

Items surfaced by past `retro` runs that didn't fit in their original scope. `retro` appends. `pm` reads on every new interview and asks the user whether any open item is now in scope. When a run consumes a follow-up, `retro` marks its status `consumed-by: <run-id>` and leaves the row in place for auditability.

## Open

<!-- First retro appends here. Use F0001 as the first ID. -->

| ID | From run | Item | Type hint | Priority | Status |
|----|----------|------|-----------|----------|--------|
| F0001 | 0002-feat-fanout-team-research | Pre-create stub `team-*.md` at install-time OR document "session restart required after first install" prominently — first-run UX today is the inline-fallback, not real parallel dispatch. | chore | high | open |
| F0002 | 0002-feat-fanout-team-research | Single source of truth for the `FANOUT_REQUESTED:` allowlist regex — currently duplicated in `SKILL.md:150` and `.claude/orchestrator.md:100`. | refactor | med | open |
| F0003 | 0002-feat-fanout-team-research | Roster of 6 team-agent names duplicated across 5 places (`SKILL.md:16-21`, `TEAM.md:17-22`, `lead.md:77`, `review.md` template, `WORKFLOW.md:88`). Refactor to single canonical roster + references. | refactor | med | open |
| F0004 | 0002-feat-fanout-team-research | `implement:<phase-list>` fanout shape races `state.json` Case 3 guard. Drop the shape, relax guard, or namespace `state.json` per-phase. | refactor | high | open |
| F0005 | 0002-feat-fanout-team-research | `1a.` step numbering at `lead.md:77/110/52`, `qa.md:32`, `engineer.md:27` breaks the flat 1..N pattern. Renumber or move to bulleted sub-steps. | chore | low | open |
| F0006 | 0002-feat-fanout-team-research | `model:` YAML field inconsistent across the 6 team forks (2 `opus`, 4 `inherit`). Pick one. | chore | low | open |
| F0007 | 0002-feat-fanout-team-research | `When to invoke` section present in 4/6 team forks. Either all or none. | chore | low | open |
| F0008 | 0002-feat-fanout-team-research | Plan step 3 verify-clause `grep -E "too.broad\|no constraint\|vague output"` is case-sensitive; substance starts with capitals. False-fail risk. | fix | low | open |
| F0009 | 0002-feat-fanout-team-research | Candidate AC11 (signal validator as a runnable hook) and AC12 (registry-refresh discipline as a preflight) for a follow-up `/dev` run. | feat | med | open |
| F0010 | 0002-feat-fanout-team-research | `WORKFLOW.md:148` agent-map row understates the return path (says "to the calling /dev sub-agent for synthesis"; real path is sub-agent → orchestrator → re-spawn). | docs | low | open |
| F0011 | 0002-feat-fanout-team-research | `SKILL.md:53-65` has both code block and bullet list explaining the same 5 shapes — pick one. | chore | low | open |
| F0012 | 0002-feat-fanout-team-research | `TEAM.md:22-23` 7th bullet (`team-dispatching-skill-source`) conflates pattern-source with agent-fork under the `^- team-` shape. Sub-section the pattern source. | docs | low | open |
| F0013 | 0002-feat-fanout-team-research | Plan step 19's verify-clause still cites `smoke-review.md`; AC10 evidence correctly cites `review.md`. Spec-vs-plan coherence drift. | fix | low | open |
| F0014 | 0002-feat-fanout-team-research | Add `.workflow/*/.last_worker_return` (engineer's ship-note marker file) to `.gitignore`. | chore | low | open |
| F0015 | 0002-feat-fanout-team-research | Trigger-heuristic syntax drifts across the 5 fanout callsites (`≥ 2 independent`, `≥ 2 distinct`, `≥ 2 of {…}`). Normalize phrasing. | chore | low | open |
| F0016 | 0002-feat-fanout-team-research | Dropped skill candidate `fanout-smoke-test` — runnable assertion that the fanout pipeline produces a real parallel dispatch (not silent inline-fallback). Revisit if AC10 regresses or registry-not-refreshed bites again. See `retro.md > Skill candidates` for the pre-built handoff prompt. | feat | low | open |
| F0017 | 0002-feat-fanout-team-research | Dropped skill candidate `validate-fanout-signal` — PostToolUse hook that validates `FANOUT_REQUESTED:` returns against the strict allowlist regex and BLOCKERs on mismatch. Closes the prose-only enforcement gap with `dev-agent-guard.sh`. Revisit if a signal-typo silent-failure happens. See `retro.md > Skill candidates` for the pre-built handoff prompt. | feat | low | open |
| F0018 | 0003-feat-cib-data-analytics | `app/backend/internal/adapters/driven/xlsx/excelize_adapter.go:24,54` — `excelize.OpenReader` invoked without `UnzipSizeLimit` / `UnzipXMLSizeLimit`. 5 MiB xlsx whose `sharedStrings.xml` decompresses to multi-GB will OOM the API. Add `excelize.Options{UnzipSizeLimit: 50<<20, UnzipXMLSizeLimit: 50<<20}` + `ErrXlsxTooComplex` sentinel mapped to 413. | fix | high | open |
| F0019 | 0003-feat-cib-data-analytics | `app/backend/internal/adapters/driving/http/router.go:52` — `Access-Control-Allow-Origin: *` for all routes including mutating endpoints. With v1 no-auth, any drive-by web page can hit a localhost API. Tighten to `http://localhost:3000` for v1; revisit at v2 auth. | fix | high | open |
| F0020 | 0003-feat-cib-data-analytics | `app/backend/cmd/api/main.go:88` — `Addr: ":" + port` = `0.0.0.0:8080`. Anyone on the same LAN / VPC can hit the unauthenticated API. Default to `127.0.0.1:` + port; gate all-interfaces bind behind explicit `API_BIND=0.0.0.0:8080` env documented as v2-only. | fix | high | open |
| F0021 | 0003-feat-cib-data-analytics | `app/backend/cmd/api/main.go:34` — silent DSN fallback to `postgres://cib:cib@localhost:5432/cib?sslmode=disable` when `DATABASE_URL` unset. Fail fast: log `database_url.missing` + `os.Exit(1)`. Dev defaults belong in `.env.example`, not the binary. | fix | low | open |
| F0022 | 0003-feat-cib-data-analytics | `app/.env.example:1-2,15-16` — ships `POSTGRES_PASSWORD=cib` + dead `PUPPYGRAPH_PASSWORD=puppygraph123`. Replace passwords with `__change_me__`; drop the `PUPPYGRAPH_*` rows (dead post-B8). | fix | low | open |
| F0023 | 0003-feat-cib-data-analytics | `app/backend/internal/adapters/driving/http/handlers/{files,cases,graph}.go` — `json.NewDecoder.Decode` and `uuid.Parse` errors map to opaque 500. Map `*json.SyntaxError` / `*json.UnmarshalTypeError` / `io.ErrUnexpectedEOF` to 400 with `"invalid request body"`; map `uuid.Parse` errors to 400 with `"invalid_id"`. Both in `middleware/errors.go`. | fix | low | open |
| F0024 | 0003-feat-cib-data-analytics | All non-upload JSON handlers — no `http.MaxBytesReader` body cap. Slow-loris client can hold goroutines open; combined with no rate limit a small DoS amplifier. Wrap every JSON handler body with `http.MaxBytesReader(w, r.Body, 256<<10)`. | fix | low | open |
| F0025 | 0003-feat-cib-data-analytics | `app/backend/internal/adapters/driving/http/router.go` — no security headers. Add `securityHeaders` middleware setting `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`. Configure CSP on Next.js via `next.config.js` headers. | chore | low | open |
| F0026 | 0003-feat-cib-data-analytics | `app/backend/internal/adapters/driving/http/router.go` — no rate limiting. With no-auth + 5 MiB uploads, an attacker can fire unlimited xlsx uploads. Add per-IP token bucket on `POST /api/v1/cases/:id/files` via `chi/middleware.Throttle` or `ulule/limiter` (e.g. 10 uploads / minute / IP). | feat | low | open |
| F0027 | 0003-feat-cib-data-analytics | `app/backend/internal/adapters/driving/http/handlers/handlers_test.go` — handler tests use a hand-stitched chi shim instead of the real router. Switch to `httptest.NewServer(router.New(...))` so route registration + middleware chain are exercised end-to-end. | refactor | med | open |
| F0028 | 0003-feat-cib-data-analytics | AC12 docker-runtime smoke is deferred-operational (no docker daemon in implement container). User runs `make -C app up && make -C app smoke` locally once and confirms exit 0 to flip AC12 from "deferred" to "green." | chore | low | open |
| F0029 | 0003-feat-cib-data-analytics | 3 postgres integration test files (`case_repo_integration_test.go`, `file_repo_integration_test.go`, `graph_repo_integration_test.go`) duplicate the `DATABASE_URL` env-read + `t.Skip` boilerplate (~27 LOC). Extract `connectIntegration(t)` helper. | refactor | low | open |
| F0030 | 0003-feat-cib-data-analytics | `app/backend/internal/app/usecase/usecase_test.go` and `app/backend/internal/adapters/driving/http/handlers/handlers_test.go` carry ~130 LOC of duplicated fake repositories. Extract a shared `testfakes` package. | refactor | low | open |
| F0031 | 0003-feat-cib-data-analytics | Type-design tightening cluster: (a) `Edge` struct-literal lockdown — add unexported sentinel field or `(e Edge) Valid()` runtime check at `graph_repo.go` unmarshal; (b) `NodeDetailPanel` state is 3 booleans + 1 enum — refactor to discriminated union; (c) Next.js `searchParams` typing lossy (`string` vs `string | string[]`); (d) `ColumnMapping{}` zero value constructible — add `NewColumnMapping` constructor + private field; (e) `Case.Status` zero value silent on Scan path — call `.Valid()` post-Scan. | refactor | low | open |
| F0032 | 0003-feat-cib-data-analytics | Silent-failure observability cluster: (a) `excelize_adapter.go:125-129` lumps `NewEdge` rejections (self-loop / NaN / negative) into `RowsSkippedBlank` counter — split into `RowsSkippedSelfLoop` / `RowsSkippedNonFiniteWeight` / `RowsSkippedNegativeWeight`; (b) `excelize_adapter.go:142-144` `ErrEmptyXlsx` discards `ParseStats` when all rows rejected — surface row counts; (c) `set_mapping_and_parse.go:74` `mapping.set` log missing `case_id`; (d) `tx.go:16` `_ = tx.Rollback(ctx)` discards rollback errors — log at Warn for non-`pgx.ErrTxClosed`; (e) `mapping_tx_writer.go:22-27` silent `ON CONFLICT DO UPDATE` on re-parse — audit row or `file_graphs_history` table. | fix | med | open |
| F0033 | 0003-feat-cib-data-analytics | Frontend doesn't render `weights_unparsed` / `rows_skipped_*` from the API's `ParseStats` response — analyst can't see what got dropped during upload. Add a "parse stats" callout to the post-upload screen showing the 5 counters. | feat | low | open |
| F0034 | 0003-feat-cib-data-analytics | Plan-vs-code drift cleanup: (a) `plan.md` steps 17 / 23 / 29 reference files deleted in cycle 2 (B8) — retire the rows or annotate as intentionally deleted; (b) `plan.md` §Observability lists `graph_repo.persistence_deferred` event — dead post-B8, drop; (c) `cib_files_uploaded_total{outcome}` label taxonomy in code (`ok`/`rejected`/`rejected_multipart`/`rejected_io`) ≠ plan's planned taxonomy (`accepted`/`rejected_empty`/`rejected_not_xlsx`/`rejected_too_large`/`rejected_invalid_mapping`) — reconcile one way; (d) `graph.merge_conflicts` event emitted at `get_combined_graph.go:44` not asserted in `TestUsecaseLogs` — add the assert. | docs | low | open |
| F0035 | 0003-feat-cib-data-analytics | Workflow-internal: formalise "orchestrator commits per phase in ephemeral containers" in `.claude/agents/engineer.md > Mode C`. Run 0003 deviated from the canonical "engineer commits at ship" because the container is ephemeral and the stop-hook fires on uncommitted state. Decide whether to document the orchestrator-incremental-commit pattern or to tighten engineer to commit at every phase boundary. | docs | med | open |

## Closed

Items consumed by a later run. Keep these — they're the audit trail.

<!-- `retro` moves rows here when a later run consumes the item, or when the user marks `wont-do`. -->

| ID | From run | Item | Consumed by | Date consumed |
|----|----------|------|-------------|---------------|

## Conventions

- **ID** — `F` + 4-digit counter, monotonically increasing across all retros. `retro` reads this file to pick the next number.
- **From run** — the `NNNN-type-slug` of the run that surfaced the item.
- **Type hint** — what *kind* of `/dev` run would consume this. Not binding; `pm` can override after interview.
- **Priority** — `low | med | high`. `high` is reserved for known-broken behaviour or security carry-over from `security.md`.
- **Status** — `open | in-progress | consumed-by:<run-id> | wont-do (reason)`.
- Move rows from `Open` to `Closed` when status becomes `consumed-by:…` or `wont-do`.
