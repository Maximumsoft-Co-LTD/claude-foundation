# Paid E2E: v3.6.8 vs v3.6.9 vs no-harness review — 2026-11-02

**Status:** observed paid evidence, n=1 per cell, all 29 paid lanes. 28 lanes ran in
all three arms; `order-inventory-lifecycle` ran in v3.6.9 only. Reported per lane;
no repeated assurance and no release decision. v3.6.9 was published earlier under
an explicit exception (see [release status](user-scenario-release-status.md)); this
run did not precede that release. [ภาษาไทย](scenario-paid-e2e-v3.6.8-v3.6.9-baseline-review-2026-11-02.th.md)

## Scope and conditions

| Item | Value |
|---|---|
| Arms | Change Loop at tag `v3.6.8` (`0848e86f4`), Change Loop at tag `v3.6.9` (`62ce54106`), and `--arm baseline-review` (no harness; plain implementation plus one independent self-review pass) run from the `v3.6.9` tree |
| Lanes | All 29 paid lanes of `openspec-native-matrix.json` at `v3.6.9`. `order-inventory-lifecycle` does not exist at `v3.6.8` and the baseline arm refuses lifecycle lanes, so it has one arm |
| Repeats | One per lane and arm. Arms of one lane ran concurrently; lanes ran in sequence |
| Model | Host default `claude-sonnet-5-5` for implementation; same matrix ceilings for every arm |
| Authority | User approved the full 29-lane, three-arm run and extended the cap beyond US$100; this run applied a US$150 hard stop. Measured spend US$42.60, all from host result envelopes |
| Source | Temporary Git worktrees at the two tags with the repository `node_modules` linked in; the lab installs each tree into a disposable consumer |
| Host | Claude Code only, on one macOS machine whose global RTK hook was active in the spawned hosts (see Limits) |
| Raw evidence | Outside Git: `.claude/tests/bench/results/paid-e2e-v3.6.8-v3.6.9-baseline-review-2026-11-02/` (per-run scorecards, `state.json`, driver and scan scripts) |

## Results: 28 lanes in all three arms

| arm | oracle pass | cost total | cost median | wall median | requests median |
|---|---|---|---|---|---|
| v3.6.8 | 27/28 | US$15.07 | US$0.45 | 99 s | 11 |
| v3.6.9 | 26/28 | US$14.88 | US$0.45 | 96 s | 11 |
| baseline-review | 27/28 | US$9.64 | US$0.29 | 79 s | 10 |

| lane | v3.6.8 | v3.6.9 | baseline-review |
|---|---|---|---|
| tiny-feature | ✓ $0.41 65s | ✓ $0.39 52s | ✓ $0.24 62s |
| bare-node-boundary | ✓ $0.42 71s | ✓ $0.43 61s | ✓ $0.28 66s |
| typescript-react-state | ✓ $0.38 63s | ✓ $0.37 55s | ✓ $0.24 67s |
| python-api-validation | ✓ $0.47 100s | ✓ $0.40 76s | ✓ $0.23 45s |
| database-migration-rollback | ✓ $0.41 114s | ✓ $0.38 99s | ✓ $0.30 55s |
| refactor-no-reproduction | ✓ $0.39 54s | ✓ $0.41 60s | ✓ $0.27 67s |
| multi-service-event-flow | ✓ $0.44 96s | ✓ $0.48 102s | ✓ $0.29 80s |
| notes-api | ✓ $0.60 189s | ✓ $0.63 183s | ✓ $0.53 138s |
| cart-coupons | ✓ $0.69 158s | ✓ $0.64 168s | ✓ $0.38 100s |
| project-tracker-api | ✗ $1.45 790s | ✗ $1.56 521s | ✓ $0.85 433s |
| order-inventory | ✓ $1.30 537s | ✓ $1.20 519s | ✓ $0.91 343s |
| owner-only-delete | ✓ $0.49 132s | ✓ $0.47 100s | ✓ $0.23 40s |
| idempotent-refund | ✓ $0.66 335s | ✓ $0.57 183s | ✓ $0.40 126s |
| speed-up-search | ✓ $0.46 100s | ✓ $0.45 70s | ✓ $0.31 77s |
| regression-fix-with-fixes | ✓ $0.45 104s | ✓ $0.46 69s | ✓ $0.24 56s |
| library-cli-flag | ✓ $0.43 72s | ✓ $0.41 66s | ✓ $0.28 64s |
| platform-migration | ✓ $0.43 69s | ✓ $0.44 82s | ✓ $0.27 79s |
| webhook-integration | ✓ $0.52 168s | ✓ $0.51 175s | ✓ $0.36 94s |
| config-flag | ✓ $0.49 127s | ✓ $0.46 102s | ✓ $0.30 88s |
| dependency-upgrade | ✓ $0.53 99s | ✓ $0.51 104s | ✗ $0.27 56s |
| deprecate-option | ✓ $0.53 133s | ✓ $0.53 118s | ✓ $0.35 96s |
| infra-config | ✓ $0.42 73s | ✗ $0.38 61s | ✓ $0.35 95s |
| add-metrics | ✓ $0.44 61s | ✓ $0.43 68s | ✓ $0.28 64s |
| privacy-erasure | ✓ $0.41 84s | ✓ $0.42 83s | ✓ $0.27 60s |
| feature-experiment | ✓ $0.47 69s | ✓ $0.40 96s | ✓ $0.29 84s |
| client-version-gate | ✓ $0.48 103s | ✓ $0.66 289s | ✓ $0.33 98s |
| ml-eval-threshold | ✓ $0.43 74s | ✓ $0.46 66s | ✓ $0.28 79s |
| security-hotfix | ✓ $0.45 90s | ✓ $0.43 101s | ✓ $0.32 109s |

`order-inventory-lifecycle`: v3.6.9 ✓ US$3.01, 1590 s. No other arm could run it.

## Failures

- **`project-tracker-api`, v3.6.8 and v3.6.9:** both reached `proven` with proof
  passing and stopped at `awaiting-user`; the hidden oracle scored 32/33, failing
  only `CASE_TESTS_EXIST`. Identical in both versions, so not introduced by
  v3.6.9. Why the required tests were absent was not investigated. The baseline
  arm passed.
- **`infra-config`, v3.6.9:** the agent drafted the change, `start --through proven`
  was blocked for lacking `--approve-spec`, and the agent stopped to ask for spec
  approval. The workflow stayed at `change`, so the oracle was `unavailable`
  (`task-oracle-unavailable`). This is the documented authority boundary, not a
  harness fault. One occurrence in 28 v3.6.9 runs; whether the v3.6.9 approval-page
  note made agents more cautious is a hypothesis, not shown. Not repeated.
- **`dependency-upgrade`, baseline-review:** `CASE_TESTS_PASS` failed (7/8): the
  project's tests did not pass after the upgrade.
- **`client-version-gate`, v3.6.9:** passed but took 289 s against 103 s for
  v3.6.8 (US$0.66 vs US$0.48). The log was not examined.

## What the data supports

- v3.6.9 shows no cost or time difference from v3.6.8 beyond noise at n=1 (equal
  medians; per-lane differences move both ways).
- The harness arms cost about 1.5× the cost and 1.2× the wall time of the
  no-harness review arm at the median. The ratio is largest on small lanes
  (`owner-only-delete` 2.5× wall) where fixed harness work dominates.
- Correctness is close across arms (27, 26, 27 of 28); each arm failed different
  lanes except the shared `project-tracker-api` pair.

## Tool-call errors (log scan)

Scanning `host.stream.jsonl` for the 38 runs completed at that point: harness arms
581 calls, 30 errors (5%); baseline-review 221 calls, 53 errors (24%). About 20 of
the harness errors were a `find` with `-prune`/`-not` used to list files: denied
with "requires approval" at v3.6.8, and "rtk find does not support compound
predicates" at v3.6.9. Baseline errors were mostly compound shell commands denied
by the lab's narrow allowlist. Time lost per error was not measured.

## Limits

- n=1 per cell; no repeat of any failing lane. Small differences are noise.
- The lab's permission allowlist and the machine's RTK hook shaped the tool errors
  above and are inside every arm's time and cost. They are not harness behavior.
- The baseline arm ran from the `v3.6.9` tree, so it does not isolate harness
  version; it has no harness installed.
- The v3.6.9 lifecycle result has no matched arm.
- This is not the all-lane release checkpoint of [RELEASING.md](../../RELEASING.md)
  for a new candidate, and it does not change the recorded status of v3.6.9.
- Scorecard cost is the host result envelope only; no dollars were derived.
