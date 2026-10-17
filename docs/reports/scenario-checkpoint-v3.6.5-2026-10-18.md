# v3.6.5 candidate checkpoint — 2026-10-18

[ภาษาไทย](scenario-checkpoint-v3.6.5-2026-10-18.th.md)

The v3.6.5 candidate narrows the start template's `input-domain` guidance and
lists the coverage rows each risk requires
([investigation](../../openspec/investigations/v364-slowdown.report.md)). A
declared `fixes` now also requires input-boundary coverage. All 28 paid
scenarios reach **strict delivery 28/28**. Against the
[v3.6.4 checkpoint](scenario-checkpoint-candidate-2026-10-18.md) the same 28
rows take **18% less wall time and 12% less host cost**. On the ten scenarios
shared with v3.6.3, the gap falls from +44% time and +28% cost to **+9% and
+6%**. n=1 per row, so this is a smoke check, not a stable speed claim.

## Execution boundary

- Candidate `078e10ba8` (template change) ran the full suite (242/242), the
  zero-cost sentinel, and all 28 paid scenarios one at a time with
  `ANTHROPIC_MODEL=claude-sonnet-5-5`, `source.dirty: false`.
- Regression-fix-with-fixes failed there, at oracle 9/10 with
  `CASE_UPPER_BOUNDARY`. With `input-domain` narrowed, the draft declared no
  risk and covered only the reported 1000-point boundary. `90cd46364` made a
  declared `fixes` require input-boundary coverage. The full suite passed
  242/242 and the sentinel passed. That scenario was rerun twice on clean
  `90cd46364`, and both runs scored 10/10.
- The fix changes only drafts that declare `fixes`. In the matrix, only
  regression-fix-with-fixes does. The other 27 rows come from `078e10ba8`.
- The v3.6.4 column is the retained v3.6.4 checkpoint: 26 rows from
  `8410d517c` and two multi-repository rows from `dde4a619e`. It used the same
  model and fixtures, but it is a separate batch, not interleaved.
- Claude Code 2.1.302, Node v26.11.1, macOS 26.7 arm64. Matrix budgets are
  unchanged.
- Measured host cost for all 30 runs: **US$14.5801**. Security-hotfix's cost
  comes from foundation metrics, not a host envelope.

## Results

Cells are runner wall seconds / measured host cost / oracle score. Every row
is `completed`, archived, with zero pending tasks, and passes the ordinary
project command and clean install.

| Scenario | v3.6.5 candidate | v3.6.4 |
|---|---|---|
| bare-node-boundary | 55.8 / $0.3821 / 6/6 | 81.5 / $0.4488 / 6/6 |
| typescript-react-state | 45.6 / $0.3627 / 6/6 | 42.5 / $0.3624 / 6/6 |
| python-api-validation | 65.7 / $0.3803 / 5/5 | 67.4 / $0.4090 / 5/5 |
| database-migration-rollback | 84.8 / $0.3623 / 6/6 | 113.4 / $0.4307 / 6/6 |
| refactor-no-reproduction | 41.5 / $0.3544 / 6/6 | 82.3 / $0.4469 / 6/6 |
| multi-service-event-flow | 116.9 / $0.5170 / 6/6 | 103.6 / $0.4886 / 6/6 |
| tiny-feature | 65.1 / $0.3753 / 8/8 | 89.3 / $0.4997 / 8/8 |
| notes-api | 138.3 / $0.5442 / 13/13 | 160.0 / $0.6557 / 13/13 |
| cart-coupons | 116.2 / $0.5515 / 11/11 | 192.7 / $0.5768 / 11/11 |
| project-tracker-api | 400.3 / $1.0108 / 33/33 | 557.3 / $1.5270 / 33/33 |
| order-inventory | 508.2 / $1.2004 / 19/19 | 570.4 / $1.4103 / 19/19 |
| owner-only-delete | 85.0 / $0.3763 / 9/9 | 105.6 / $0.4508 / 9/9 |
| idempotent-refund | 182.3 / $0.5610 / 12/12 | 267.1 / $0.6226 / 12/12 |
| speed-up-search | 57.8 / $0.3601 / 11/11 | 106.1 / $0.4940 / 11/11 |
| regression-fix-with-fixes | 79.0 / $0.5105 / 10/10 | 115.9 / $0.4726 / 10/10 |
| library-cli-flag | 41.3 / $0.3539 / 8/8 | 56.8 / $0.3858 / 8/8 |
| platform-migration | 60.6 / $0.4132 / 10/10 | 94.1 / $0.4719 / 10/10 |
| webhook-integration | 343.0 / $0.6715 / 13/13 | 161.2 / $0.5370 / 13/13 |
| config-flag | 81.5 / $0.4216 / 11/11 | 110.4 / $0.5106 / 11/11 |
| dependency-upgrade | 79.7 / $0.4687 / 8/8 | 117.0 / $0.5349 / 8/8 |
| deprecate-option | 98.1 / $0.5415 / 8/8 | 126.8 / $0.4985 / 8/8 |
| infra-config | 98.4 / $0.4227 / 9/9 | 96.3 / $0.2590 (foundation metrics) / 9/9 |
| add-metrics | 65.0 / $0.4325 / 8/8 | 85.8 / $0.4661 / 8/8 |
| privacy-erasure | 64.9 / $0.3923 / 9/9 | 74.0 / $0.4251 / 9/9 |
| feature-experiment | 73.4 / $0.4547 / 8/8 | 87.1 / $0.4395 / 8/8 |
| client-version-gate | 80.3 / $0.3923 / 9/9 | 111.4 / $0.5103 / 9/9 |
| ml-eval-threshold | 61.1 / $0.4012 / 9/9 | 120.5 / $0.5135 / 9/9 |
| security-hotfix | 76.5 / $0.2104 (foundation metrics) / 9/9 | 102.1 / $0.4415 / 9/9 |
| **Total** | **3266.2 / $13.4255 / 28/28** | **3999.0 / $15.2899 / 28/28** |

Ten rows shared with v3.6.3: 1130.2 s and US$4.8407, against 1037.8 s and
US$4.5552 for v3.6.3.

## Findings

1. **The narrowed guidance removes most of the v3.6.4 overhead.** 22 of 28
   rows are faster. Project tracker drops by 157 s and cart-coupons by 77 s.
2. **Narrowing alone lost the analogous boundary in the regression fix.**
   Requiring input-boundary coverage for `fixes` restored it (10/10 twice)
   without adding review.
3. **Webhook-integration is slower** (161 → 343 s). That row declares a real
   external integration. One run cannot separate a cause from the
   single-run spread already observed.

## Retained runs

```text
~/.local/share/changeloop/benchmarks/2026-10-18-candidate-v3.6.5-90cd46364.tar.gz
sha256 d6146fc80a846550eb3a1a8f3864ccbf947b4fa8c194d53979291df034ebb2fe
```

SHA-256 prefixes of each `integrity.json`:

| Run | Source | Oracle | integrity |
|---|---|---|---|
| bare-node-boundary-1792270917710 | 078e10ba8 | 6/6 | `17d4e30fe7e9f884` |
| typescript-react-state-1792270984523 | 078e10ba8 | 6/6 | `8f93459800caa60c` |
| python-api-validation-1792271039993 | 078e10ba8 | 5/5 | `de16c03aa7541421` |
| database-migration-rollback-1792271117337 | 078e10ba8 | 6/6 | `fef10dd559336cd4` |
| refactor-no-reproduction-1792271213039 | 078e10ba8 | 6/6 | `eb3291393825b5f2` |
| multi-service-event-flow-1792271263651 | 078e10ba8 | 6/6 | `b8b61c5309996449` |
| tiny-feature-1792271392330 | 078e10ba8 | 8/8 | `b8989375dd600029` |
| notes-api-1792271468921 | 078e10ba8 | 13/13 | `94b788a2b45a69bb` |
| cart-coupons-1792271618029 | 078e10ba8 | 11/11 | `5429dbdb1fcf6241` |
| project-tracker-api-1792271746426 | 078e10ba8 | 33/33 | `99c863e7e2c0f005` |
| order-inventory-1792272170127 | 078e10ba8 | 19/19 | `b0d0ba44d9f32f5c` |
| owner-only-delete-1792272758633 | 078e10ba8 | 9/9 | `e3661bd391bd5e35` |
| idempotent-refund-1792272853826 | 078e10ba8 | 12/12 | `d5f214cb5ecfa158` |
| speed-up-search-1792273048903 | 078e10ba8 | 11/11 | `76ab2a4d75330b74` |
| regression-fix-with-fixes-1792273119137 (failed) | 078e10ba8 | 9/10 | `0e6bac8606874666` |
| regression-fix-with-fixes-1792275689749 | 90cd46364 | 10/10 | `a4d222a39bd7ca42` |
| regression-fix-with-fixes-1792275821409 | 90cd46364 | 10/10 | `3516d1bee79ebda4` |
| library-cli-flag-1792273200323 | 078e10ba8 | 8/8 | `a1e5b06347d1e0f4` |
| platform-migration-1792273252100 | 078e10ba8 | 10/10 | `665dd27f44a9ef3e` |
| webhook-integration-1792273323383 | 078e10ba8 | 13/13 | `0336b00a6634842b` |
| config-flag-1792273680713 | 078e10ba8 | 11/11 | `0028f364fce32e76` |
| dependency-upgrade-1792273774234 | 078e10ba8 | 8/8 | `c435b18085d308c5` |
| deprecate-option-1792273865656 | 078e10ba8 | 8/8 | `3a62413eef659c76` |
| infra-config-1792273975347 | 078e10ba8 | 9/9 | `526235b6d279747d` |
| add-metrics-1792274085901 | 078e10ba8 | 8/8 | `6767456df9668e2c` |
| privacy-erasure-1792274162198 | 078e10ba8 | 9/9 | `d7b0546e613794d0` |
| feature-experiment-1792274236811 | 078e10ba8 | 8/8 | `174dcbda9e77311a` |
| client-version-gate-1792274321019 | 078e10ba8 | 9/9 | `d352a15cc96ffe92` |
| ml-eval-threshold-1792274412226 | 078e10ba8 | 9/9 | `be70cefc1656de98` |
| security-hotfix-1792274484078 | 078e10ba8 | 9/9 | `e095d907ff81f5a9` |

Resume: repeat rows before claiming a speed difference; inspect
webhook-integration if it stays slow.
