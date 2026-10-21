# Candidate smoke: `2af6788` vs v3.6.6 vs no harness — 2026-10-21

**Status:** observed smoke evidence, n=1, five scenarios. Not the full paid
checkpoint and not repeated assurance. [ภาษาไทย](scenario-smoke-candidate-2af6788-2026-10-21.th.md)

## Scope and conditions

| Item | Value |
|---|---|
| Candidate | Clean `2af6788` (eight fixes for non-Claude hosts: reviewer fallback, Codex API-key readiness, next commands, `current`, installer unships harness tests, error examples, host identity) |
| Previous | Clean `f63e34e86` (v3.6.6), separate worktree with its own installer |
| No harness | `--arm baseline` from the candidate tree: same seed, oracle, model and ceilings, no Change Loop |
| Model | `claude-sonnet-5-5` via `ANTHROPIC_MODEL`, same for all arms |
| Scenarios | `owner-only-delete`, `idempotent-refund`, `speed-up-search`, `regression-fix-with-fixes`, `tiny-feature` |
| Repeats | One per cell; arm order rotated per scenario (interleaved) |
| Authority | User cap US$100, one repeat per cell |
| Host | Claude Code only. OpenCode, Cursor and Gemini were not exercised |

## Results

Oracle: all 15 cells passed their hidden oracle (arm × scenario, 5/5 each).

| Arm | Cost | Wall time | Model requests | Tool calls |
|---|---|---|---|---|
| Candidate | US$2.1226 | 542.4 s | 60 | 102 |
| v3.6.6 | US$2.1940 | 603.7 s | 60 | 98 |
| No harness | US$1.0936 | 273.5 s | 35 | 56 |

- Candidate vs v3.6.6: −3.3% cost, −10.2% time, equal requests. With n=1 this is
  within run-to-run noise; it shows no regression, not an improvement.
- Candidate vs no harness: 1.94× cost, 1.98× time. This is the harness's review
  and Land overhead on small tasks, consistent with earlier rapid-tier ratios.
- Measured spend ≈ US$5.41 of the US$100 cap. The first v3.6.6 attempt failed
  before any model call (its worktree had no `node_modules`); it cost nothing and
  was rerun after `npm ci`.

## Limits

- Five of 28 paid scenarios; high-risk and multi-repository rows were not run.
- The fixes target non-Claude hosts (issue: ~70% wasted loops on OpenCode). This
  Claude Code smoke cannot show that benefit.
- Raw bundles are archived outside Git, sha256
  `e770de234ab9228d75d61c63299823fb15c47d07f0122619c40b99b3325bcf35`
  (`ab-c-phase1-2af6788-vs-f63e34e86-vs-noharness.tgz`).

## Release decision

The maintainer instructed a release of v3.6.7 after this smoke. This is an
explicit exception to the all-scenario checkpoint in
[RELEASING.md](../../RELEASING.md), not a change to it.
