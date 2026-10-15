# Paid E2E after the evidence-gate and cross-change rollup change — 2026-10-15

[ภาษาไทย](scenario-pstack-gates-2026-10-15.th.md)

The landed but uncommitted `change-pstack-agent` (benchmark evidence, typed
access allow/deny, `financial` risk signal, draft `constraints`/`fixes`,
`outcomes`/`lessons`, review finding codes, hypothesis `experimentKeys`) was
exercised by all eleven paid scenarios twice: once on the host default model
and once with `claude-sonnet-5-5` pinned. With Sonnet, **10/11 scenarios reach
strict delivery**, including Tracker at 33/33 for the first time in any
retained cohort. Order/inventory again archives with three unchecked tasks.
This is dirty-source evidence, n=1 per row; it is not a release checkpoint or
a stable speed claim.

## Execution boundary

- Source: commit `0bd8c578ea1410d59b3606ad468ae6c3be579a63` plus the uncommitted
  change diff (`source.patchDigest`
  `sha256:6561c777e083eae6582562fc9b563a8bcb308633de5b456b824a7…`, identical in
  every run of both rounds). `source.dirty: true`.
- Deterministic gates first: full registered suite 227/227 suites in the main
  checkout after Land; zero-cost sentinel pass on all 12 rows.
- User-authorized total: US$100. Per-run cost ceilings came from an
  experiment-only copy of the matrix (round 1: 9 USD each, tiny-feature 5,
  order-inventory 10 — sum 96; round 2: 8 each, tiny-feature 4, order-inventory 9
  — sum 85, within the remaining allowance). Other matrix budgets unchanged.
- Claude Code 2.1.300, Node v26.3.0, macOS 26.7 arm64. tiny-feature ran alone
  first as the paid sentinel; the remaining ten ran four at a time.
- Round 2 pins the model through an experiment-only runner wrapper that adds
  `--model claude-sonnet-5-5` to the host and to scorecard provenance; the
  repository runner, fixtures and oracles were not edited. Streams observe the
  requested model in every Sonnet run. Round 1 had no pin; every stream shows
  `claude-opus-5-5`.
- Measured host CLI cost: round 1 **US$10.9925**, round 2 **US$6.0070**, total
  **US$16.9995**. No run has an unknown cost. Independently billed reviewer cost
  was not measured; these are CLI envelope values, not an invoice.

## Results

Cells are runner wall seconds / measured host cost / oracle score. The
baseline column is the same-day clean-source Sonnet run before this change
([2026-10-15 paid E2E](continuity-paid-e2e-2026-10-15.md), source
`6211780127a69c2166d61a24cf8eed8a3ce3f20e`, Claude Code 2.1.299).

| Scenario | Baseline (Sonnet, before) | Round 2 (Sonnet, after) | Round 1 (Opus, after) |
|---|---|---|---|
| tiny-feature | 92.9 / $0.3715 / 8/8 | 49.7 / $0.3479 / 8/8 | 61.7 / $0.7025 / 8/8 |
| bare-node-boundary | 51.8 / $0.3438 / 6/6 | 44.9 / $0.3283 / 6/6 | 103.5 / $0.7947 / 6/6 |
| typescript-react-state | 51.8 / $0.3435 / 6/6 | 41.4 / $0.3200 / 6/6 | 79.4 / $0.6194 / 6/6 |
| python-api-validation | 41.2 / $0.3373 / 5/5 | 46.4 / $0.3356 / 5/5 | 62.6 / $0.7118 / 5/5 |
| database-migration-rollback | 72.9 / $0.3463 / 6/6 | 89.1 / $0.3443 / 6/6 | 101.5 / $0.7417 / 6/6 |
| refactor-no-reproduction | 60.1 / $0.3616 / 6/6 | 60.7 / $0.3784 / 6/6 | 74.6 / $0.7283 / 6/6 |
| multi-service-event-flow | 95.2 / $0.3626 / 6/6 | 119.6 / $0.4368 / 6/6 | 161.8 / $0.7693 / 6/6 |
| notes-api | 163.8 / $0.4604 / 13/13 | 148.5 / $0.5446 / 13/13 | 209.8 / $1.0614 / 13/13 |
| cart-coupons | 140.6 / $0.5978 / 11/11 | 119.4 / $0.5314 / 11/11 | 120.1 / $0.9344 / 11/11 |
| project-tracker-api | 337.5 / $0.9487 / 32/33, proven | 471.3 / $1.2208 / **33/33, archived** | 395.4 / $1.9736 / 32/33, proven |
| order-inventory | not run | 593.8 / $1.2189 / 19/19, incomplete | 520.7 / $1.9554 / 19/19, incomplete |

Every archived success in both rounds passes the pre-Land oracle, measured
quality, ordinary project command, clean installation and post-install tests
with zero pending tasks.

Against the baseline, the nine scenarios that succeed in both sum to 719.7 s
versus 770.3 s wall and US$3.5673 versus US$3.5248 cost. All ten shared rows
sum to 1191.0 s versus 1107.8 s and US$4.7881 versus US$4.4735; the difference
is dominated by Tracker continuing through Land. The Opus round costs roughly
twice the Sonnet round with identical outcomes apart from Tracker. With n=1,
different host versions and non-interleaved batches, none of these
differences is a causal or stable performance claim.

## Per-scenario comparison across cohorts

All columns use `claude-sonnet-5-5`, n=1. Cells are seconds / host cost /
oracle. No-harness values come from the
[no-harness comparison](scenario-benchmark-no-harness-2026-10-08.md) and v3.6.3
from the [candidate checkpoint](scenario-checkpoint-v3.6.3-2026-10-11.md); both
report host seconds, while the two right-hand columns use the runner
stopwatch. The verdict compares this version with the same-day pre-change
source; differences within ±10% are treated as similar.

| Scenario | No harness | v3.6.3 | Before change | This version | Versus before change |
|---|---|---|---|---|---|
| tiny-feature | 51.1 / $0.19 / 8/8 | 33.7 / $0.29 / 8/8 | 92.9 / $0.37 / 8/8 | 49.7 / $0.35 / 8/8 | Better: time −47%, cost similar (−6%) |
| bare-node-boundary | 41.7 / $0.22 / 6/6 | 50.6 / $0.34 / 6/6 | 51.8 / $0.34 / 6/6 | 44.9 / $0.33 / 6/6 | Better: time −13%, cost similar |
| typescript-react-state | 28.9 / $0.17 / 6/6 | 42.5 / $0.32 / 6/6 | 51.8 / $0.34 / 6/6 | 41.4 / $0.32 / 6/6 | Better: time −20%, cost similar (−7%) |
| python-api-validation | 23.9 / $0.17 / 5/5 | 39.5 / $0.31 / 5/5 | 41.2 / $0.34 / 5/5 | 46.4 / $0.34 / 5/5 | Slightly worse: time +13%, cost same |
| database-migration-rollback | 62.9 / $0.21 / 6/6 | 80.8 / $0.32 / 6/6 | 72.9 / $0.35 / 6/6 | 89.1 / $0.34 / 6/6 | Worse: time +22%, cost same |
| refactor-no-reproduction | 33.8 / $0.16 / 6/6 | 45.3 / $0.32 / 6/6 | 60.1 / $0.36 / 6/6 | 60.7 / $0.38 / 6/6 | Similar (+1% / +5%) |
| multi-service-event-flow | 37.0 / $0.19 / 6/6 | 96.7 / $0.35 / 6/6 | 95.2 / $0.36 / 6/6 | 119.6 / $0.44 / 6/6 | Worse: time +26%, cost +20% |
| notes-api | 124.1 / $0.43 / 13/13 | 135.2 / $0.50 / 13/13 | 163.8 / $0.46 / 13/13 | 148.5 / $0.54 / 13/13 | Mixed: time similar (−9%), cost +18% |
| cart-coupons | 76.2 / $0.32 / 11/11 | 103.7 / $0.50 / 11/11 | 140.6 / $0.60 / 11/11 | 119.4 / $0.53 / 11/11 | Better: time −15%, cost −11% |
| project-tracker-api | 187.2 / $0.63 / 32/33 failed | 390.0 / $1.11 / 32/33 failed | 337.5 / $0.95 / 32/33 failed | 471.3 / $1.22 / **33/33** | Better: first pass (time +40%, cost +29% because it continues through Land and delivery checks) |
| order-inventory | — | — | — (2026-10-12 audit: 490 / $2.08 / 19/19 incomplete) | 593.8 / $1.22 / 19/19 incomplete | Same outcome; unchecked archived tasks remain |

Versus the pre-change source: five better, three worse, one mixed and two
unchanged; no scenario lost oracle score. Swings of ±20–25% are within the
observed single-run variance (tiny-feature alone has ranged from 33.7 s to
92.9 s on unchanged code), and this change does not touch these scenarios'
main path, so the time differences are not attributed to it without repeats.

## Evidence-gate scenarios (three arms)

Four new paid scenarios target the new gates: `owner-only-delete`
(allow/deny), `idempotent-refund` (financial), `speed-up-search` (benchmark)
and `regression-fix-with-fixes` (`fixes`). Prompts state only product
requirements. Each ran twice per arm with `claude-sonnet-5-5`, concurrency six
with arms interleaved in every batch: no harness, the pre-change commit
`0bd8c578` (a detached worktree with the same benchmark files), and this
version. Cells are passing runs / mean seconds / mean host cost.

| Scenario | No harness | Before change | This version |
|---|---|---|---|
| owner-only-delete | 2/2 / 24.1 / $0.177 | 2/2 / 46.8 / $0.340 | 2/2 / 41.9 / $0.323 |
| idempotent-refund | 2/2 / 77.6 / $0.324 | 2/2 / 158.8 / $0.516 | 2/2 / 201.6 / $0.534 |
| speed-up-search | 2/2 / 51.3 / $0.243 | 2/2 / 62.6 / $0.369 | 2/2 / 66.4 / $0.364 |
| regression-fix-with-fixes | 2/2 / 28.1 / $0.186 | 0/2 (9/10, `CASE_UPPER_BOUNDARY`) / 61.1 / $0.488 | 1/2 (one 9/10, same case) / 51.3 / $0.405 |

Measured cost of these 24 runs: US$8.5385, none unknown.

**No new gate fired in any run.** No Change Loop draft declared
`riskSignals`, an `access` tag or `fixes`; the owner-only permission change
compiled as rapid, low risk, with no review. The gates are opt-in through typed
declarations, and the agent does not make them unprompted, so this version
behaves like the pre-change source on these tasks. Outcome differences are
therefore not attributed to the gates. Both harness arms twice fixed only the
reported 1000-point boundary and missed the analogous 5000 boundary, while the
no-harness arm fixed both; this is a scoping observation, n=2.

## Findings

1. **Tracker passed `CASE_TESTS_EXIST` once.** v3.6.0–v3.6.3, the same-day
   baseline and this change's Opus round all stop at 32/33. One Sonnet pass
   does not show the test-adequacy defect fixed; this change does not alter
   test-count guidance. Repeat before drawing a conclusion.
2. **Order/inventory archive ledger still retains three unchecked tasks** in
   both rounds (T001–T003, repository-scoped, no root), matching the
   [2026-10-12 audit](scenario-order-inventory-2026-10-12.md). The product oracle
   passes 19/19 and quality is measured; the strict outcome stays
   `incomplete`, correctly. The archive/ledger defect remains open.
3. **No regression attributable to the change was observed.** Every scenario
   that delivered before delivers after, with the same oracle scores.

## Retained runs

Raw bundles stay under the Git-ignored
`.claude/tests/bench/results/openspec-native-lab/`; each has `manifest.json`,
`source.patch` and `integrity.json`. SHA-256 prefixes of `integrity.json`:

| Scenario | Round 1 run | Round 2 run |
|---|---|---|
| tiny-feature | `tiny-feature-1792041025597` `d9f7e717061d3317` | `tiny-feature-1792042487696` `699897fc832254e5` |
| bare-node-boundary | `…-1792041152349` `20ed84eb1532ac13` | `…-1792042550610` `7f52a6661066f1d1` |
| typescript-react-state | `…-1792041152415` `aa2ec94d25bd8bfb` | `…-1792042550606` `a94e253392d174a9` |
| python-api-validation | `…-1792041152375` `f4b01c9e3fc355ff` | `…-1792042550607` `a4acfc567ba694c0` |
| database-migration-rollback | `…-1792041152378` `812d80276af09aa8` | `…-1792042550606` `5d513e4abe24a4e8` |
| refactor-no-reproduction | `…-1792041282239` `d6d07069c94805e3` | `…-1792042652128` `0b1c9e81b2ec58e8` |
| multi-service-event-flow | `…-1792041282220` `a5377dd03338ed46` | `…-1792042652128` `2c9b0aa726f51ea7` |
| notes-api | `…-1792041282236` `c7bcd6cb3632627f` | `…-1792042652128` `7f81e105ebb41a6b` |
| cart-coupons | `…-1792041282215` `4423f29a39201812` | `…-1792042652128` `e894e9ef3fb74491` |
| project-tracker-api | `…-1792041524609` `0f73cced15cd774b` | `…-1792042813142` `536e7272e8b1efdd` |
| order-inventory | `…-1792041524832` `76b48f53d8195497` | `…-1792042813297` `8874407246180269` |

Resume: commit the change, then repeat the Sonnet round on the clean commit for
checkpoint-grade evidence; investigate the order/inventory archived ledger.
