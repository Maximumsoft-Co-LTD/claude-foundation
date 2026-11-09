# Scenario checkpoint: v3.6.11 candidate `ca200a3` — 2026-11-09

**Status:** complete. Observed paid evidence for the release checkpoint of
[RELEASING.md](../../RELEASING.md), n=1 per lane: 30 of 31 lanes passed; the
failing lane (`project-tracker-api`, `CASE_TESTS_EXIST`) also fails at v3.6.8 and
v3.6.9. **Release decision:** the user approved publishing v3.6.11 from this
candidate as an explicit exception to that checkpoint blocker, because the
failure predates the candidate and is not a regression.

## Scope and conditions

| Item | Value |
|---|---|
| Candidate | `ca200a3a` on `main` (`fix(harness): one visual repair round per prove pass`) |
| Lanes | All 31 paid rows of `openspec-native-matrix.json`, run in sequence, one disposable consumer each |
| Authority | User approved the full paid checkpoint with a US$60 total cap |
| Zero-cost gates | `npm run bench:openspec-native:sentinel` pass; `npm run release:preflight` `publicationReady: true` (advisory `release-portfolio-not-ready`) |
| Working tree | Clean at the start of run 1. During run 2 the checkout gained files not part of the candidate (`CLAUDE.md` edit, `REVIEW.md`, `.github/CODEOWNERS`, `openspec/incidents/`, `openspec/lessons.md`); none is installed into a lab consumer |
| Raw evidence | Outside Git: `.claude/tests/bench/results/openspec-native-lab/<lane>-<run-id>/` |
| Cost source | Host result envelopes only. The `visual` reviewer runs as a separate process whose cost is not measured |

## Run 1 — host default model `claude-opus-5-5` (stopped by the user)

The host default model had changed since the
[2026-11-02 comparison](scenario-paid-e2e-v3.6.8-v3.6.9-baseline-review-2026-11-02.md),
which used `claude-sonnet-5-5`. The user stopped this run after 11 lanes to rerun
on Sonnet so the comparison matches. These rows are reference only, not
checkpoint evidence. A twelfth lane (`order-inventory-lifecycle`) was
interrupted; its partial cost is unknown.

| lane | v3.6.8 (sonnet) | v3.6.9 (sonnet) | baseline-review (sonnet) | candidate (opus) |
|---|---|---|---|---|
| tiny-feature | ✓ $0.41 65s | ✓ $0.39 52s | ✓ $0.24 62s | ✓ $0.84 92s |
| bare-node-boundary | ✓ $0.42 71s | ✓ $0.43 61s | ✓ $0.28 66s | ✓ $0.91 110s |
| typescript-react-state | ✓ $0.38 63s | ✓ $0.37 55s | ✓ $0.24 67s | ✓ $0.80 77s |
| python-api-validation | ✓ $0.47 100s | ✓ $0.40 76s | ✓ $0.23 45s | ✓ $0.76 80s |
| database-migration-rollback | ✓ $0.41 114s | ✓ $0.38 99s | ✓ $0.30 55s | ✓ $0.95 146s |
| refactor-no-reproduction | ✓ $0.39 54s | ✓ $0.41 60s | ✓ $0.27 67s | ✓ $0.78 94s |
| multi-service-event-flow | ✓ $0.44 96s | ✓ $0.48 102s | ✓ $0.29 80s | ✓ $1.04 150s |
| notes-api | ✓ $0.60 189s | ✓ $0.63 183s | ✓ $0.53 138s | ✓ $1.47 251s |
| cart-coupons | ✓ $0.69 158s | ✓ $0.64 168s | ✓ $0.38 100s | ✓ $0.36 228s |
| project-tracker-api | ✗ $1.45 790s | ✗ $1.56 521s | ✓ $0.85 433s | ✓ $2.33 563s |
| order-inventory | ✓ $1.30 537s | ✓ $1.20 519s | ✓ $0.91 343s | ✓ $2.45 646s |
| **11 lanes** | **10/11, $6.96** | **10/11, $6.89** | **11/11, $4.52** | **11/11, $12.67** |

Measured spend: US$12.67. Request counts were similar to the earlier run (for
example 10 against 11 on `typescript-react-state`), so the cost difference
follows the model price, not more harness work. Because the model differs, these
rows do not support a cost or speed claim against the earlier versions.

## Run 2 — `ANTHROPIC_MODEL=claude-sonnet-5-5`

Ran 2026-11-09T09:50Z–12:30Z, all 31 lanes in sequence, stop threshold US$42
(US$60 cap minus run 1); the threshold was not reached. Every lane reported
`claude-sonnet-5-5`. Times are scorecard `wallMs` (host only), matching the
2026-11-02 report.

| lane | v3.6.9 (sonnet) | baseline-review (sonnet) | candidate (sonnet) |
|---|---|---|---|
| bare-node-boundary | ✓ $0.43 61s | ✓ $0.28 66s | ✓ $0.42 102s |
| typescript-react-state | ✓ $0.37 55s | ✓ $0.24 67s | ✓ $0.43 90s |
| python-api-validation | ✓ $0.40 76s | ✓ $0.23 45s | ✓ $0.38 76s |
| database-migration-rollback | ✓ $0.38 99s | ✓ $0.30 55s | ✓ $0.50 125s |
| refactor-no-reproduction | ✓ $0.41 60s | ✓ $0.27 67s | ✓ $0.44 65s |
| multi-service-event-flow | ✓ $0.48 102s | ✓ $0.29 80s | ✓ $0.43 104s |
| tiny-feature | ✓ $0.39 52s | ✓ $0.24 62s | ✓ $0.35 90s |
| notes-api | ✓ $0.63 183s | ✓ $0.53 138s | ✓ $0.64 221s |
| cart-coupons | ✓ $0.64 168s | ✓ $0.38 100s | ✓ $0.62 137s |
| project-tracker-api | ✗ $1.56 521s | ✓ $0.85 433s | ✗ $1.88 2695s (32/33, `CASE_TESTS_EXIST`) |
| order-inventory | ✓ $1.20 519s | ✓ $0.91 343s | ✓ $1.41 586s |
| order-inventory-lifecycle | ✓ $3.01 1590s | — | ✓ $4.84 2432s |
| owner-only-delete | ✓ $0.47 100s | ✓ $0.23 40s | ✓ $0.44 102s |
| idempotent-refund | ✓ $0.57 183s | ✓ $0.40 126s | ✓ $0.57 190s |
| speed-up-search | ✓ $0.45 70s | ✓ $0.31 77s | ✓ $0.49 110s |
| regression-fix-with-fixes | ✓ $0.46 69s | ✓ $0.24 56s | ✓ $0.53 135s |
| library-cli-flag | ✓ $0.41 66s | ✓ $0.28 64s | ✓ $0.40 78s |
| platform-migration | ✓ $0.44 82s | ✓ $0.27 79s | ✓ $0.55 110s |
| webhook-integration | ✓ $0.51 175s | ✓ $0.36 94s | ✓ $0.52 170s |
| config-flag | ✓ $0.46 102s | ✓ $0.30 88s | ✓ $0.50 110s |
| dependency-upgrade | ✓ $0.51 104s | ✗ $0.27 56s | ✓ $0.52 125s |
| deprecate-option | ✓ $0.53 118s | ✓ $0.35 96s | ✓ $0.53 101s |
| infra-config | ✗ $0.38 61s | ✓ $0.35 95s | ✓ $0.42 51s |
| add-metrics | ✓ $0.43 68s | ✓ $0.28 64s | ✓ $0.44 55s |
| privacy-erasure | ✓ $0.42 83s | ✓ $0.27 60s | ✓ $0.47 72s |
| feature-experiment | ✓ $0.40 96s | ✓ $0.29 84s | ✓ $0.42 67s |
| client-version-gate | ✓ $0.66 289s | ✓ $0.33 98s | ✓ $0.49 100s |
| ml-eval-threshold | ✓ $0.46 66s | ✓ $0.28 79s | ✓ $0.45 65s |
| security-hotfix | ✓ $0.43 101s | ✓ $0.32 109s | ✓ $0.43 80s |
| visual-prototype-match | — | — | ✓ $0.50 81s |
| visual-prototype-drift | — | — | ✓ $0.51 103s |
| **total** | **27/29, US$17.89** | **27/28, US$9.64** | **30/31, US$21.49** |

- **Delivery checks:** every passing lane reached `archived` and passed the hidden
  oracle, clean install, and the post-install project command.
  `project-tracker-api` stopped at `proven`, failed only `CASE_TESTS_EXIST`, and
  its clean install did not run.
- **Against v3.6.9 on the 29 shared lanes:** 28 of 29 pass (v3.6.9: 27 of 29);
  `infra-config` now passes and `project-tracker-api` fails as before. Measured cost on shared lanes is US$20.48 against US$17.89
  (+14%), most of it in `order-inventory-lifecycle` (+US$1.83).
- **`visual-prototype-drift`** archived without a `visual-drift` question: the
  reviewer judged the forbidden banner a minor, spec-required difference, as in
  the earlier dedicated run.
- **Spend:** run 1 US$12.67 + run 2 US$21.49 = US$34.16 measured, within the
  US$60 authorization, plus the unmeasured `visual` and configured-reviewer cost.

## Timing investigation (first 10 Sonnet lanes)

The driver's per-lane seconds include lab setup, clean install, and oracle; the
2026-11-02 report used the scorecard `wallMs`. On `wallMs`, most lanes are 1.0–1.7×
v3.6.9, not 3×.

| lane | v3.6.9 wall / harness | candidate wall / harness | output tokens v3.6.9 → candidate |
|---|---|---|---|
| bare-node-boundary | 61 / 4 s | 102 / 15 s | 5856 → 5918 |
| typescript-react-state | 55 / 4 s | 90 / 10 s | 3939 → 4537 |
| tiny-feature | 52 / 4 s | 90 / 28 s | 4420 → 4887 |
| database-migration-rollback | 99 / 39 s | 125 / 63 s | 5090 → 6282 |
| python-api-validation | 76 / 20 s | 76 / 24 s | 4620 → 4777 |
| cart-coupons | 168 / 5 s | 137 / 6 s | 15721 → 15376 |
| project-tracker-api | 521 / 150 s | 2695 / 223 s | 4747 → 15493 |

- **Model time:** non-harness time rose with near-equal output tokens (e.g.
  `bare-node-boundary` 57 → 88 s), which points to slower model responses during
  this run rather than more work. Not proven; API latency was not measured.
- **Harness time:** small lanes gained 6–24 s. In `tiny-feature` the Prove step ran
  the configured AI reviewer inline (model `haiku`, 10.5 s, US$0.057, outside the
  host cost). The 2026-11-02 bundle kept only scorecards, so whether v3.6.9 ran the
  same reviewer is unknown. The candidate's only reviewer change is one `export`.
- **`project-tracker-api`:** 34 minutes passed between `change start` and the
  first recorded `advance`. The host's `advance --through proven` exceeded the
  host's 600 s Bash limit, was moved to the background and killed; a second
  `advance --through build` hit the 300 s limit. The host then waited with blocked
  `sleep` and a malformed Monitor call. The killed advance left no operation
  record, so what it was running is unknown. The oracle failed only
  `CASE_TESTS_EXIST` (32/33), as in v3.6.8 and v3.6.9.

## Wasted host tool calls (first 11 Sonnet lanes)

A scan of `host.stream.jsonl` found 28 wasted calls in 281 (10%); 14 were in
`project-tracker-api`. Without it: 14 in 220 (6%), close to the 5% of the
2026-11-02 harness arms. No wasted call involved the visual check, and no lane
ran a `visual` provider or bound a prototype.

| count | kind | owner |
|---|---|---|
| 8 | `rtk find` rejected `-not`/`-prune` | machine RTK hook, not the harness |
| 8 | `ls -R` of guessed directories (exit 1) | agent exploration |
| 4 | compound command needs approval | lab allowlist (same for every arm) |
| 3 | host Bash timeout on `advance`/`exec` | harness: long `advance` exceeds the host limit |
| 2 | same file range read twice | agent |
| 3 | blocked `sleep`, malformed `Monitor`, unavailable `Grep` | agent waiting on the stuck `advance` |

**Known issue (decided: fix after v3.6.11):** a long `advance` can exceed the
host's Bash time limit and is killed without an operation record. It should
return a `WORKING` action before the host limit. Fixing it now would invalidate
this checkpoint's evidence.

## Limits

- n=1 per lane; small differences are noise.
- Run 1 and run 2 differ in model; only run 2 is compared with the 2026-11-02 data.
- Reviewer (`visual`) cost is outside the measured spend.
