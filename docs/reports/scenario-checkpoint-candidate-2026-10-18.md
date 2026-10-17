# Release candidate checkpoint after v3.6.3 — 2026-10-18

[ภาษาไทย](scenario-checkpoint-candidate-2026-10-18.th.md)

Clean candidate `8410d517cea3c3f1a9d60c3c1a62e1c2c7742d5b` ran every paid
scenario in the matrix (28) once with `claude-sonnet-5-5`. **27/28 reach strict
delivery.** Order/inventory archives with oracle 19/19 but keeps three
unchecked tasks, the known archived-ledger defect, so its strict outcome is
`incomplete`. Project tracker passes 33/33. Dependency upgrade, which failed
only with the harness before this candidate, now passes after Land installs
dependencies in the target. On the ten scenarios shared with v3.6.3, the
candidate takes 44% more wall time and 27% more host cost, with identical
oracle scores. n=1 per row, so this is a smoke check, not a stable speed claim.

## Execution boundary

- Source: `8410d517c` on `main`, `source.dirty: false` in every run.
  It contains everything since v3.6.3 listed under `[Unreleased]` in the
  changelog, plus a test-only dashboard fix.
- Deterministic gates first: the full registered suite passed 241/241 and the
  zero-cost sentinel passed. The first attempt on `94996e3d4` stopped
  at the full suite before any paid run. A presence test counted two heartbeats
  that straddled a minute boundary under suite load. The test-only fix made
  `8410d517c`, and the gates then passed.
- Model pinned through `ANTHROPIC_MODEL=claude-sonnet-5-5`; Claude Code
  2.1.302, Node v26.11.1, macOS 26.7 arm64. Matrix budgets unchanged.
- Concurrency: one run at a time per arm. The first ten candidate runs ran beside
  the ten v3.6.3 runs (two runs at once). The remaining eighteen candidate runs
  ran alone. The v3.6.3 comparison is therefore interleaved; the no-harness
  column is a separate batch.
- Reference: tag `v3.6.3` (`055770b23`) in a detached worktree with its own lab
  and matrix. Fixtures and oracles of its ten paid scenarios are byte-identical
  to the candidate's (no changes under their task directories since v3.6.3).
- No-harness column: the 2026-10-16 baseline arm on `main` (23 rows); the five
  evidence-gate and order/inventory rows have no baseline run.
- Measured host cost: candidate 28 runs **US$15.1315**, the failed first
  feature-experiment attempt US$0.3029, v3.6.3 ten runs US$4.5552; total
  **US$19.9896**. Infra-config's candidate cost comes from foundation metrics,
  not a host envelope; every other value is a CLI envelope, not an invoice.
  Reviewer cost was not measured separately.

## Results

Cells are runner wall seconds / measured host cost / oracle score. Every
archived row except order/inventory also passes measured quality, the ordinary
project command, clean installation and post-install tests, with zero pending
tasks.

| Scenario | Candidate | v3.6.3 | No harness (2026-10-16) |
|---|---|---|---|
| bare-node-boundary | 81.5 / $0.4488 / 6/6 | 53.1 / $0.3607 / 6/6 | 60.3 / $0.1980 / 6/6 |
| typescript-react-state | 42.5 / $0.3624 / 6/6 | 70.2 / $0.3832 / 6/6 | 32.6 / $0.1785 / 6/6 |
| python-api-validation | 67.4 / $0.4090 / 5/5 | 50.3 / $0.3739 / 5/5 | 26.3 / $0.1710 / 5/5 |
| database-migration-rollback | 113.4 / $0.4307 / 6/6 | 78.3 / $0.3509 / 6/6 | 46.9 / $0.2147 / 6/6 |
| refactor-no-reproduction | 82.3 / $0.4469 / 6/6 | 46.6 / $0.3477 / 6/6 | 26.5 / $0.1757 / 6/6 |
| multi-service-event-flow | 108.2 / $0.4440 / 6/6 | 84.0 / $0.3564 / 6/6 | 37.1 / $0.2216 / 6/6 |
| tiny-feature | 89.3 / $0.4997 / 8/8 | 45.0 / $0.3355 / 8/8 | 38.2 / $0.2065 / 8/8 |
| notes-api | 160.0 / $0.6557 / 13/13 | 133.9 / $0.5637 / 13/13 | 115.0 / $0.4360 / 13/13 |
| cart-coupons | 192.7 / $0.5768 / 11/11 | 83.3 / $0.4779 / 11/11 | 69.4 / $0.3139 / 11/11 |
| project-tracker-api | 557.3 / $1.5270 / 33/33 | 393.1 / $1.0053 / 33/33 | 296.8 / $0.8661 / 33/33 |
| order-inventory | 574.1 / $1.2965 / 19/19, **3 unchecked tasks** | — | — |
| owner-only-delete | 105.6 / $0.4508 / 9/9 | — | — |
| idempotent-refund | 267.1 / $0.6226 / 12/12 | — | — |
| speed-up-search | 106.1 / $0.4940 / 11/11 | — | — |
| regression-fix-with-fixes | 115.9 / $0.4726 / 10/10 | — | — |
| library-cli-flag | 56.8 / $0.3858 / 8/8 | — | 51.4 / $0.1910 / 8/8 |
| platform-migration | 94.1 / $0.4719 / 10/10 | — | 58.4 / $0.2653 / 10/10 |
| webhook-integration | 161.2 / $0.5370 / 13/13 | — | 62.0 / $0.2822 / 13/13 |
| config-flag | 110.4 / $0.5106 / 11/11 | — | 56.8 / $0.2373 / 11/11 |
| dependency-upgrade | 117.0 / $0.5349 / 8/8 | — | 54.8 / $0.2410 / 8/8 |
| deprecate-option | 126.8 / $0.4985 / 8/8 | — | 79.3 / $0.2928 / 8/8 |
| infra-config | 96.3 / $0.2590 (foundation metrics) / 9/9 | — | 71.4 / $0.2667 / 9/9 |
| add-metrics | 85.8 / $0.4661 / 8/8 | — | 54.4 / $0.2475 / 8/8 |
| privacy-erasure | 74.0 / $0.4251 / 9/9 | — | 47.0 / $0.2163 / 9/9 |
| feature-experiment | 87.1 / $0.4395 / 8/8 (second attempt) | — | 48.4 / $0.2402 / 8/8 |
| client-version-gate | 111.4 / $0.5103 / 9/9 | — | 62.4 / $0.2847 / 9/9 |
| ml-eval-threshold | 120.5 / $0.5135 / 9/9 | — | 53.3 / $0.2442 / 9/9 |
| security-hotfix | 102.1 / $0.4415 / 9/9 | — | 54.0 / $0.2176 / 9/9 |

Totals:

- **Versus v3.6.3, ten shared rows:** 1494.8 s and US$5.8011 against 1037.8 s
  and US$4.5552 (+44% time, +27% cost). Both pass 10/10, and Tracker passes
  33/33 in both. Only typescript-react-state is faster on the candidate.
- **Versus no harness, 23 shared rows:** 2838.3 s and US$11.7949 against
  1502.7 s and US$6.2090 (1.89× time, 1.90× cost). Oracle 23/23 in both.

## Findings

1. **Feature-experiment stopped once at Change.** The first attempt
   (`feature-experiment-1792258405144`) compiled the spec, then the agent ended
   its turn asking the user to approve it. It cited a judgment call of its own:
   user ids `0` or `NaN` count as signed in. `advance` returned no `ASK_USER`,
   and the four earlier runs of this scenario on 2026-10-16 all archived 8/8.
   Recorded as `task-oracle-unavailable` at `change`. One selective rerun
   archived 8/8. This is agent variance at the approval gate, n=1, not a
   harness regression, but it can recur.
2. **Order/inventory's archived ledger keeps three unchecked tasks**, as in the
   [2026-10-12 audit](scenario-order-inventory-2026-10-12.md) and the
   [2026-10-15 rounds](scenario-pstack-gates-2026-10-15.md). The product oracle
   passes, and the strict outcome stays `incomplete`. This remains a checkpoint
   blocker under [RELEASING.md](../../RELEASING.md) unless the maintainer
   records an exception.
3. **The post-Land dependency install closes the dependency-upgrade failure.**
   The scenario archives with clean-install checks passing; before this change
   it failed only with the harness, because the target lacked the new
   dependencies after Land.
4. **The candidate is slower and costlier than v3.6.3.** Earlier same-day
   batches traced most of the increase to added Change and review work: the
   v5 change packet, review policy and evidence gates. Single-run spreads of
   about 13–21% were observed on unchanged code, so per-row differences are not
   attributed without repeats.

## Retained runs

Raw bundles stay under the Git-ignored lab results directories and are
archived outside Git and disposable state:

```text
~/.local/share/changeloop/benchmarks/2026-10-18-candidate-8410d517c.tar.gz
sha256 2babbd878e4ad3ccd559826b1e0ae5e7b96ead1851d700cee321ef0bd4d2771d
```

The archive holds 29 candidate bundles (including the failed attempt), ten
v3.6.3 bundles, the comparison JSON and both progress logs. SHA-256 prefixes of
each `integrity.json`:

| Scenario | Candidate run | integrity | v3.6.3 run | integrity |
|---|---|---|---|---|
| bare-node-boundary | `bare-node-boundary-1792255727483` | `f1f9a1b2933da3c8` | `bare-node-boundary-1792255603037` | `fea1b65823fa3d4a` |
| typescript-react-state | `typescript-react-state-1792255820081` | `f9d58af3f7c5297a` | `typescript-react-state-1792255667066` | `67db82e9824d7761` |
| python-api-validation | `python-api-validation-1792255873164` | `06b412a7cea4725f` | `python-api-validation-1792255748768` | `4f04a04a7a57bd00` |
| database-migration-rollback | `database-migration-rollback-1792255949345` | `3cf7100d003a821d` | `database-migration-rollback-1792255807234` | `549e728481ec2225` |
| refactor-no-reproduction | `refactor-no-reproduction-1792256073889` | `af687be9cf933f69` | `refactor-no-reproduction-1792255896184` | `e843d352e9245fbf` |
| multi-service-event-flow | `multi-service-event-flow-1792256166065` | `e8fdc43c02777823` | `multi-service-event-flow-1792255952255` | `27ffa315038777e5` |
| tiny-feature | `tiny-feature-1792256284927` | `1936267aee53cb3c` | `tiny-feature-1792256047861` | `3d111a9c44ccc4d4` |
| notes-api | `notes-api-1792256385128` | `4e1c9e0b41516407` | `notes-api-1792256103483` | `ecb081e87af1378e` |
| cart-coupons | `cart-coupons-1792256555851` | `4070107b688f57b0` | `cart-coupons-1792256248062` | `fe4ebde69a1aeeae` |
| project-tracker-api | `project-tracker-api-1792256759754` | `d31ec2afcff925ed` | `project-tracker-api-1792256342902` | `6ec5c8e4cf7e98fa` |
| order-inventory | `order-inventory-1792259015095` | `46a2df3a9216822a` | — | — |
| owner-only-delete | `owner-only-delete-1792259636060` | `443b4e833cb6b138` | — | — |
| idempotent-refund | `idempotent-refund-1792259752871` | `252edf06fae3bc85` | — | — |
| speed-up-search | `speed-up-search-1792260033495` | `cce7019dc0e8285b` | — | — |
| regression-fix-with-fixes | `regression-fix-with-fixes-1792260152448` | `451730ab8c13a1ed` | — | — |
| library-cli-flag | `library-cli-flag-1792257339776` | `ab24b9f6d84ec3ca` | — | — |
| platform-migration | `platform-migration-1792257407571` | `3d42cbd97fbda50c` | — | — |
| webhook-integration | `webhook-integration-1792257512705` | `474c32570dbaa73a` | — | — |
| config-flag | `config-flag-1792257687132` | `4cd6b7ccf8cb8051` | — | — |
| dependency-upgrade | `dependency-upgrade-1792257809484` | `f5c88680aefe6c7d` | — | — |
| deprecate-option | `deprecate-option-1792257938555` | `00b5c325729708d7` | — | — |
| infra-config | `infra-config-1792258078667` | `41ff2d5bf04e0c61` | — | — |
| add-metrics | `add-metrics-1792258222208` | `84b6fd7fdc5314a0` | — | — |
| privacy-erasure | `privacy-erasure-1792258320627` | `6b8d6d0dbc80c41a` | — | — |
| feature-experiment | `feature-experiment-1792258879985` | `d08a9fc360b3d2d1` | — | — |
| feature-experiment (failed first attempt) | `feature-experiment-1792258405144` | `64f85f1845f3304d` | — | — |
| client-version-gate | `client-version-gate-1792258457680` | `acae571fb94f4515` | — | — |
| ml-eval-threshold | `ml-eval-threshold-1792258580127` | `a5e374730e6a3250` | — | — |
| security-hotfix | `security-hotfix-1792258710947` | `debd6e40e37673b1` | — | — |

Resume: fix the order/inventory archived ledger and rerun that row, or record
a maintainer exception for it, before publication. Repeat rows before claiming
a speed difference.
