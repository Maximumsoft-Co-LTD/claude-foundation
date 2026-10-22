# Candidate smoke: `497ab55fb` vs v3.6.7 vs no harness — 2026-10-22

**Status:** observed smoke evidence, n=1, five scenarios, reported per task. Not the
full paid checkpoint and not repeated assurance. No release decision is recorded
here. [ภาษาไทย](scenario-smoke-candidate-497ab55fb-2026-10-22.th.md)

## Scope and conditions

| Item | Value |
|---|---|
| Candidate | Clean `497ab55fbd5caa8425f8c9b697c0db4a3d64bc71` (decision-first approval page with type cards, `data-fix`/`security`/`cicd` work types, required answers with `none:`/`unknown:` reasons, High/Critical undo rule, path-risk note) |
| Previous | Clean `a8d3d4b770d7396a73a8dd69dc0fd23ae50e49b4` (tag `v3.6.7`), separate worktree with `npm ci` and its own installer |
| No harness | `--arm baseline` from the candidate tree: same seed, oracle, model and ceilings, no Change Loop |
| Model | `claude-sonnet-5-5` via `ANTHROPIC_MODEL`, same for all arms |
| Scenarios | `owner-only-delete`, `idempotent-refund`, `speed-up-search`, `regression-fix-with-fixes`, `tiny-feature` |
| Repeats | One per cell; arm order rotated per scenario (interleaved). The first cell (candidate, `owner-only-delete`) was run by hand with the same command; the other 14 by a sequential driver |
| Authority | User cap US$40, one repeat per cell, five scenarios. The driver refused any run whose ceiling would take measured spend past the cap |
| Review | The consumer lab authorizes main-session self-review and Land inside its disposable workspace, so no independent reviewer ran and no reviewer cost is in these numbers |
| Host | Claude Code only. OpenCode, Cursor and Gemini were not exercised |

Per-run ceilings came from the matrix: US$5 for `tiny-feature`, US$3 for the other four.

## Results

All 15 cells reached their hidden oracle pass, and every cell's `strictPass` is true
(project command, clean install and post-install project command all pass).
Candidate and previous cells reached `archived`; the no-harness arm has no lifecycle.

| Arm | Cost | Wall time | Model requests | Tool calls |
|---|---|---|---|---|
| Candidate | US$2.3035 | 587.8 s | 66 | 110 |
| v3.6.7 | US$2.1904 | 553.2 s | 63 | 106 |
| No harness | US$1.1949 | 238.0 s | 39 | 66 |

- Candidate vs v3.6.7: +5.2% cost, +6.2% time, +4.8% requests, +3.8% tool calls. With
  n=1 this is within run-to-run noise (the per-task rows below move in both
  directions); it shows no clear regression, not a measured slowdown or speedup.
- Candidate vs no harness: 1.93× cost, 2.47× time, 1.69× requests. This is the
  harness's overhead on small tasks; the time ratio is higher than the 1.98× of the
  2026-10-21 smoke on a different candidate and sample.
- Measured spend US$5.6888 of the US$40 cap; every cost was measured from the host
  result envelope, none estimated.

## Results by task

Cost is US$, time is wall seconds, oracle is passed/total cases. "vs v3.6.7" compares the
candidate with the previous release on that task only.

### 1. `owner-only-delete` (authorization boundary; matrix risk high; 9 oracle cases)

| Arm | Cost | Time | Requests | Tool calls | Oracle |
|---|---|---|---|---|---|
| Candidate | 0.3978 | 158.3 | 10 | 19 | 9/9 |
| v3.6.7 | 0.4382 | 92.6 | 15 | 24 | 9/9 |
| No harness | 0.1719 | 24.9 | 5 | 8 | 9/9 |

vs v3.6.7: cost −9.2%, time +71.0%, requests 10 vs 15. Cheaper and fewer requests but
slower; with one run per cell the wall-time gap cannot be attributed to the change.
The host stream contains the new High-risk undo repair message
(`scratch.undo is required for risk level High…`), twice, so the rule returned a
repair to the agent; the run still archived with 9/9. This and `idempotent-refund`
are the two scenarios the matrix rates high risk.

### 2. `idempotent-refund` (idempotent retry write; matrix risk high; 12 oracle cases)

| Arm | Cost | Time | Requests | Tool calls | Oracle |
|---|---|---|---|---|---|
| Candidate | 0.6626 | 237.1 | 17 | 32 | 12/12 |
| v3.6.7 | 0.6014 | 289.5 | 14 | 27 | 12/12 |
| No harness | 0.4008 | 99.0 | 10 | 24 | 12/12 |

vs v3.6.7: cost +10.2%, time −18.1%, requests 17 vs 14. The same undo repair message
appears twice in the host stream. It is the most expensive and the longest task in
every arm.

### 3. `speed-up-search` (behavior-preserving performance; matrix risk medium; 11 oracle cases)

| Arm | Cost | Time | Requests | Tool calls | Oracle |
|---|---|---|---|---|---|
| Candidate | 0.4484 | 73.0 | 16 | 21 | 11/11 |
| v3.6.7 | 0.3510 | 60.0 | 10 | 18 | 11/11 |
| No harness | 0.2481 | 54.7 | 11 | 13 | 11/11 |

vs v3.6.7: cost +27.7%, time +21.8%, requests 16 vs 10. The largest candidate increase
of the five tasks. It did not hit the undo message. The cause was not investigated
and a single run cannot separate it from variance; it is the first row to repeat if
a repeat is authorized.

### 4. `regression-fix-with-fixes` (regression of a prior change; matrix risk low; 10 oracle cases)

| Arm | Cost | Time | Requests | Tool calls | Oracle |
|---|---|---|---|---|---|
| Candidate | 0.4285 | 71.0 | 14 | 24 | 10/10 |
| v3.6.7 | 0.4271 | 61.5 | 14 | 23 | 10/10 |
| No harness | 0.1851 | 27.6 | 7 | 12 | 10/10 |

vs v3.6.7: cost +0.3%, time +15.5%, requests equal.

### 5. `tiny-feature` (tiny greenfield feature; matrix risk low; 8 oracle cases)

| Arm | Cost | Time | Requests | Tool calls | Oracle |
|---|---|---|---|---|---|
| Candidate | 0.3661 | 48.4 | 9 | 14 | 8/8 |
| v3.6.7 | 0.3726 | 49.7 | 10 | 14 | 8/8 |
| No harness | 0.1890 | 31.8 | 6 | 9 | 8/8 |

vs v3.6.7: cost −1.7%, time −2.5%, requests 9 vs 10.

## Limits

- Five of 28 paid scenarios; high-risk and multi-repository rows were not run. This
  is an exception-level smoke, not the all-scenario checkpoint in
  [RELEASING.md](../../RELEASING.md).
- None of the five scenarios was built to exercise the new work types (`data-fix`,
  `security`, `cicd`) or the newly required `modelCard.evaluation`,
  `experimentDesign` guardrails/stop rules and `infraPlan.costDelta`. The only new
  rule seen in the evidence is the High/Critical undo repair, in the two candidate runs
  the matrix rates high risk (the other three, rated medium or low, did not show it). Whether the new work types and `none:`/`unknown:` answers behave
  well with a live agent is untested here; `ml-eval-threshold` and `security-hotfix`
  would test it.
- The undo repair was identified from its message in the host stream. The text the
  agent wrote to resolve it and the number of repair rounds were not inspected.
- Self-review inside the disposable lab means the review cost and independence of a
  real project are not represented.
- n=1 per cell: per-task differences in either direction are not stable results.
- Claude Code only.

## Raw evidence

Per-run bundles (scorecards, manifests, `integrity.json`, host streams, delivered
patches), the sequential driver `run-e2e.mjs` and its `driver.log` are archived
outside Git and disposable state:

```text
~/.local/share/changeloop/benchmarks/2026-10-22-candidate-497ab55fb-vs-v3.6.7-vs-noharness.tar.gz
sha256 bcc8f02cb0314d509fcacbc84f2659bcf8a6d98984ade2b5c9aa8df323698761
```

The archive holds 828 files, including 15 per-run `integrity.json` indexes that
content-bind each run's artifacts. Each run's manifest records its source commit
(`497ab55fb…` for the candidate and no-harness arms, `a8d3d4b77…` for v3.6.7),
`dirty: false`, and the frozen seed digest.

## Reproduce

```bash
# zero-cost gate first
npm run bench:openspec-native:sentinel
# one cell: candidate, then add --arm baseline for the no-harness arm
ANTHROPIC_MODEL=claude-sonnet-5-5 node .claude/tests/bench/openspec-native/lab.mjs \
  --scenario owner-only-delete --output-root <results>/candidate
```

The previous release arm runs the same command from a worktree of `v3.6.7` after
`npm ci`. Paid runs need explicit user authority and a spend cap.
