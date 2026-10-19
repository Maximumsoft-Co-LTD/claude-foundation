# Candidate checkpoint after v3.6.5 — 2026-10-19

[ภาษาไทย](scenario-checkpoint-candidate-9f1c09bf2-2026-10-19.th.md)

Candidate `9f1c09bf2` is v3.6.5 plus seven commits: the single Land gate, the
blocking policy, the scratch router approval package and preview, and role
lanes. All 28 paid scenarios ran once in each of two arms: Change Loop and
no-harness. Strict delivery is **27/28**. `dependency-upgrade` stops at
`building`, and that is a **checkpoint blocker**. Total wall time against the
[v3.6.5 checkpoint](scenario-checkpoint-v3.6.5-2026-10-18.md) is **+0.5%**
(3281.2 s vs 3266.2 s), and host cost is +0.9%. n=1 per row, so this is a
smoke check, not a stable speed claim.

## Execution boundary

- Clean `9f1c09bf2` (`source.dirty: false`, matrix
  `sha256:4522698635406f02…`). The full suite passed 251/251 on its second
  run. On the first run, one test (`notification deduplication is serialized
  across processes`) dropped a session under full-suite load. That suite then
  passed 5/5 on its own. The zero-cost sentinel passed 29/29.
- `ANTHROPIC_MODEL=claude-sonnet-5-5`, Claude Code 2.1.302, Node v26.11.1,
  macOS 26.7 arm64. Every row ran one at a time with unchanged matrix budgets.
  The Change Loop arm ran first, then the no-harness arm (`--arm baseline`).
  The two arms were not interleaved.
- The v3.6.5 column reuses the retained checkpoint. It has the same model, CLI,
  Node and budgets, but it ran as a separate batch on `078e10ba8` and
  `90cd46364`. It was not rerun.
- Stop rule set by the maintainer: pause before continuing whenever a row is
  more than 30% slower than v3.6.5. This applied to the Change Loop arm only;
  no-harness results were only recorded. The rule paused the run on three rows,
  and the maintainer chose to continue each time.
- Spend authority: US$100. Measured host cost: **US$21.3012** in total,
  US$13.5432 for Change Loop and US$7.7579 for no-harness.

## Results

Cells are runner wall seconds. "vs v3.6.5" is the change in Change Loop wall
time. "×NH" is Change Loop wall time divided by no-harness wall time. Unless a
note says otherwise, every Change Loop row is `completed` and archived with the
full oracle score.

| Scenario | Change Loop | v3.6.5 | vs v3.6.5 | No-harness | ×NH | CL cost | NH cost | Oracle CL / NH |
|---|---|---|---|---|---|---|---|---|
| bare-node-boundary | 73.2 | 55.8 | **+31.2%** | 46.1 | 1.59 | $0.3899 | $0.2263 | 6/6 / 6/6 |
| typescript-react-state | 52.6 | 45.6 | +15.3% | 26.7 | 1.97 | $0.3613 | $0.1746 | 6/6 / 6/6 |
| python-api-validation | 76.5 | 65.7 | +16.4% | 25.2 | 3.04 | $0.3397 | $0.1691 | 5/5 / 5/5 |
| database-migration-rollback | 80.5 | 84.8 | −5.1% | 38.7 | 2.08 | $0.3640 | $0.2030 | 6/6 / 6/6 |
| refactor-no-reproduction | 82.8 | 41.5 | **+99.5%** | 33.2 | 2.49 | $0.4003 | $0.1984 | 6/6 / 6/6 |
| multi-service-event-flow | 104.2 | 116.9 | −10.9% | 35.9 | 2.90 | $0.3950 | $0.2055 | 6/6 / 6/6 |
| tiny-feature | 46.3 | 65.1 | −28.9% | 29.5 | 1.57 | $0.3640 | $0.1841 | 8/8 / 8/8 |
| notes-api | 156.5 | 138.3 | +13.2% | 107.0 | 1.46 | $0.6031 | $0.4211 | 13/13 / 13/13 |
| cart-coupons | 103.9 | 116.2 | −10.6% | 74.4 | 1.40 | $0.5462 | $0.3086 | 11/11 / 11/11 |
| project-tracker-api | 438.0 | 400.3 | +9.4% | 681.7 | 0.64 | $1.0418 | $0.8613 | 33/33 / 33/33 (NH project command failed) |
| order-inventory | 603.0 | 508.2 | +18.7% | 281.9 | 2.14 | $1.3814 | $0.8303 | 19/19 / 19/19 |
| owner-only-delete | 87.5 | 85.0 | +3.0% | 26.3 | 3.33 | $0.3702 | $0.1844 | 9/9 / 9/9 |
| idempotent-refund | 191.5 | 182.3 | +5.0% | 75.5 | 2.53 | $0.5741 | $0.3340 | 12/12 / 12/12 |
| speed-up-search | 60.9 | 57.8 | +5.3% | 53.6 | 1.14 | $0.3983 | $0.2352 | 11/11 / 11/11 |
| regression-fix-with-fixes | 52.6 | 79.0 | −33.4% | 26.1 | 2.02 | $0.3988 | $0.1704 | 10/10 / 10/10 |
| library-cli-flag | 66.4 | 41.3 | **+60.8%** | 29.3 | 2.27 | $0.4481 | $0.1841 | 8/8 / 8/8 |
| platform-migration | 59.1 | 60.6 | −2.5% | 55.4 | 1.07 | $0.4089 | $0.2544 | 10/10 / 10/10 |
| webhook-integration | 160.4 | 343.0 | −53.2% | 73.6 | 2.18 | $0.5309 | $0.2930 | 13/13 / 13/13 |
| config-flag | 70.7 | 81.5 | −13.3% | 41.3 | 1.71 | $0.3350 | $0.2226 | 11/11 / 11/11 |
| dependency-upgrade | 90.9 | 79.7 | +14.1% | 38.9 | 2.34 | $0.4599 | $0.2281 | **failed at `building`** / 8/8 (NH project command failed) |
| deprecate-option | 105.1 | 98.1 | +7.2% | 64.8 | 1.62 | $0.4825 | $0.2759 | 8/8 / 8/8 |
| infra-config | 66.1 | 98.4 | −32.8% | 51.7 | 1.28 | $0.4306 | $0.2466 | 9/9 / 9/9 |
| add-metrics | 52.6 | 65.0 | −19.1% | 37.6 | 1.40 | $0.3453 | $0.2124 | 8/8 / 8/8 |
| privacy-erasure | 79.0 | 64.9 | +21.7% | 38.3 | 2.06 | $0.4174 | $0.2130 | 9/9 / 9/9 |
| feature-experiment | 72.5 | 73.4 | −1.3% | 48.9 | 1.48 | $0.4476 | $0.2295 | 8/8 / 8/8 |
| client-version-gate | 99.3 | 80.3 | +23.7% | 50.5 | 1.97 | $0.4847 | $0.2531 | 9/9 / 9/9 |
| ml-eval-threshold | 69.4 | 61.1 | +13.6% | 43.4 | 1.60 | $0.4371 | $0.2293 | 9/9 / 9/9 |
| security-hotfix | 79.7 | 76.5 | +4.2% | 40.2 | 1.98 | $0.3871 | $0.2094 | 9/9 / 9/9 |
| **Total** | **3281.2** | **3266.2** | **+0.5%** | **2175.6** | **1.51** | **$13.5432** | **$7.7579** | CL 27/28 |

`time-gate.mjs` medians: rapid **2.03×** against a 1.5× target, which **fails**
(4 paired rows); standard **1.69×** against a 1.8× target, which passes (22
paired rows). Neither median counts the two rows whose no-harness run failed.

## Findings

1. **The dependency-upgrade failure exposes a harness gap that predates this
   candidate.**
   - Sandbox setup (`npm ci`) runs only when the sandbox is created
     (`workflow/sandbox-runtime.mjs`).
   - `retryFailedSandboxSetups` reruns setup only when it failed.
   - The only check that compares manifests and lockfiles is `postLandInstall`
     (`workflow/apply-runtime.mjs:37`), and it runs after Land.
   - So after Build changes `package.json`, verification runs against stale
     `node_modules`. The v3.6.5 run passed only because the agent ran
     `npm install --offline` itself.
   - In this run the agent tried `ln -sfn ../vendor/slugkit-2.0.0
     node_modules/slugkit` instead. `obviousWorkspaceEscape`
     (`core/shell-mutation-policy.mjs:265`) refused it, because it flags any
     `..` operand without resolving it, even though the target is inside the
     sandbox.
   - The refusal text suggests editing `foundation.json`, so the agent stopped
     to ask the user. That contradicts harness-owned setup recovery. The seven
     commits did not change these files.
2. **The rows over 30% look like model-path variance, not harness cost.**
   - `bare-node-boundary` used the same 18-call sequence in both versions, with
     the same per-call harness time. Its API time rose from 49 s to 71 s.
   - `refactor-no-reproduction` sent `change start --through` without
     `--approve-spec`, which `cli-router.mjs:131` blocks; that check predates
     v3.6.5. It also split the test-writing step, for 12 requests against 7.
     The retained `8410d517c` run of this row took 84.0 s with the same
     pattern, so v3.6.5's 41.5 s was the outlier.
   - `library-cli-flag` used 15 requests against 8 and was not hit by the
     approval block. v3.6.4 took 56.8 s on this row. Its turns were not
     analysed.
3. **What the commits measurably add.**
   - The `change start --template` output grows by about 1.5 KB.
   - `change start` prints one extra `approval package:` line.
   - In these rows, neither adds turns, and the input-token effect is below 1%.
4. **The rapid-tier no-harness ratio misses its target** (2.03× against 1.5×).
   This is recorded for the decision, not used as a stop rule.

## Dependency-upgrade rerun after the fix

- `e1518a1` changes how setup works. Setup records a digest of `package.json`
  and the lockfiles. Every `exec`, task check and proof run now reruns that
  setup when the digest changes during Build. The borrow refusal no longer
  suggests editing `foundation.json`.
- Gates before the rerun: the full suite passed and the website build passed.
  On clean `f3ad30df0`, the sentinel passed 29/29.
- The paid rerun was one run on `f3ad30df0` (`source.dirty: false`). Result:
  `completed`, archived, 0 pending tasks, oracle 8/8, 70.3 s, US$0.4423
  measured, 12 requests.
- During the run, the agent never installed or linked dependencies itself, and
  reached proven with a single `advance --through proven`.
- The recorded setup digest (`sha256:df125ccc…`) differs from the seed
  manifest digest (`sha256:5eca5cd7…`). So the harness reinstalled after the
  edit.
- This clears the checkpoint blocker for this row with n=1. The other 27 rows
  ran on `9f1c09bf2`. The fix only changes behaviour when a Build edits the
  manifest or lockfile, and in the matrix only dependency-upgrade does.
- Measured spend for the whole checkpoint, including the rerun:
  **US$21.7435**.

```text
~/.local/share/changeloop/benchmarks/2026-10-19-rerun-dependency-upgrade-f3ad30df0.tar.gz
sha256 65d1911a6761e27409104ffa7c23a17deb1dc26ee57048d29d490b0c74b0e92c
```

## Retained runs

```text
~/.local/share/changeloop/benchmarks/2026-10-19-candidate-9f1c09bf2.tar.gz
sha256 f33eddc21992cae8472f9d9766ec8e19c771295ceb382cc7ca95360bbebafe3d
```

The archive contains `checkpoint-9f1c09bf2-candidate/` and
`checkpoint-9f1c09bf2-baseline/`: 56 run bundles, each with its
`integrity.json`.

Resume:

1. Done in `e1518a1`: dependency refresh during Build and the refusal text.
   The `ln` operand check is unchanged, because the isolation rule
   deliberately refuses links.
2. Done: `dependency-upgrade` reached `archived` on clean `f3ad30df0`.
3. Repeat `refactor-no-reproduction`, `library-cli-flag` and
   `bare-node-boundary` before claiming a speed difference.
4. Decide whether the rapid-tier ratio blocks release.
