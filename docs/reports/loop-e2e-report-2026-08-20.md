# Full-loop e2e run — 2026-08-20

First live run of `.claude/tests/e2e/loop/run-loop.sh`: one simulated user
drives `/investigate → /change → /build → /prove → /land` over the
`loop/fixture` pricing project, one headless `claude -p` (sonnet) session per
phase, sandbox produced by the real `install.sh <target> --yes` path.

## Verdict

| Phase | Verdict | Cost | Notes |
|---|---|---|---|
| 10 investigate | PASS | $0.31 | note persisted, no change created, src untouched |
| 20 change | PASS | $2.00 | one change agreed and validated, src untouched |
| 30 build | PASS | $0.99 | sandbox-only edits, `proof-readiness` green |
| 40 prove | PASS (attempt 3) | $7.74 total | see finding 1; review wave 1 found a real issue, wave 2 passed |
| 50 land | PARTIAL | $1.58 | fix applied to working tree, archive blocked — finding 2 |

Product outcome was real: `src/pricing.js` boundary `>` → `>=` (one line) plus
12 lines of regression tests; suite green; the runner's hidden `accept.mjs`
(subtotal 100.00 → 90.00, 99.99 unchanged, 150.00 → 135.00) passed against the
landed working tree. Total spend $12.63 across 8 sessions (incl. retries).

## Finding 1 — /prove is not headless-safe (fixed by prompt, worth a rule)

Twice reproduced: the headless prove session dispatched the AI review as a
background authority run and then ended its final reply — a `-p` process exits
on final output, killing the in-flight review, which the harness records as an
infrastructure failure and (correctly) caps. Recovery needed
`authority abort` + `authority reset-infra` with decision refs.

Adding to the phase prompt "never end your reply while a review dispatch or
background task is pending — stay in-session and wait" fixed it on the next
attempt (review wave 1 surfaced a real issue, wave 2 passed cleanly).
Candidate product fix: the prove workflow reference should state this for
non-interactive sessions.

## Finding 2 — proof advance prescribes a command the wave cap refuses

After Prove passed, the land-phase agent created a new product file during
Land (`scripts/run-tests-with-report.mjs`, relocating the test runner out of
`test/` at 16:12 — after both review waves). That legitimately moved the
workspace past its reviewed state, so `land advance` demanded a fresh prove.
The defect is what happened next: `proof advance` *itself created a review
request and prescribed the exact command* `authority run <change> --request
<id>` — which the authority layer then refuses:

```
BLOCKED: REVIEW_ROUTE_COMPLETE: 2/2 delivered AI review wave(s) are complete.
```

The runtime's two subsystems contradict each other: the proof layer demands a
step the authority layer will never execute, and a headless agent following
the prescribed route loops into a wall. The land agent diagnosed the dead end
and refused to fabricate — the guard held — but the honest exit (record an
external/human review via the template) was never the prescribed command.
Deterministic CLI reproduction (no model involved): with two delivered waves,
sandbox sync → proof advance → run the prescribed authority command.

Two contributing causes, one per layer: the land agent edited product code
during Land (an instruction gap — Land applies, it does not implement), and a
latent hash-fragility where a sync-only `state.revision` bump could feed the
snapshot revision marker when `contractRevision` is unset, expiring a review
receipt that has no declared-inputs rebind.

## Fixes applied (2026-08-20, follow-up session)

- `proof-execution-runtime.mjs` — `authorityNext` now checks delivered AI
  waves against `reviewPolicy.maxAiAttempts`; when the route is exhausted it
  prescribes `authority status --request <id> --template` (the external
  recording route) instead of a blocked `authority run`. Verified live against
  the deadlocked sandbox: the prescribed command is now executable.
  Regression: `proof-advance.test.mjs` (exhausted → template, open → run).
- `state-runtime.mjs` / `repository-snapshot.mjs` — the snapshot revision
  marker no longer falls back from `contractRevision` to the sync-counting
  `state.revision`; only a real contract edit shifts snapshot identity.
  Regression: `run-workspace-surface-tests.mjs` (sync-only bump keeps hashes;
  real contract revision still expires workspace and review hashes).
- `review-attempt-store.mjs` — the reset-infra guard for a live dispatch now
  names the lookup (`authority status`) and the abort command instead of the
  bare "complete or abort it".
- `.claude/commands/land.md` — Land now states explicitly: never edit product
  code or the packet during Land; route new work to `handoffs.yaml` or a
  follow-up change.
- `.claude/skills/prove/references/workflow.md` — Finding 1's rule shipped:
  never end the reply while a dispatch or background task is pending.

## Runner defect fixed during the run

`run-loop.sh` called `foundation.mjs proof readiness` / `land check` (CLI
grammar); the entrypoint takes internal names `proof-readiness` / `land-check`.
Fixed in the runner; the BLOCKED message's hint made the correction trivial.

## State

Sandbox kept at a temp path (disposable); change
`fix-loyalty-discount-boundary-so-subtotal-exactly-100-00-receive` remains
active/un-archived there, fix applied, uncommitted. Raw per-phase evidence
under `.claude/tests/e2e/loop/results/loop-20260820-*` (gitignored).
Both findings still need deterministic regressions in the main harness before
any runtime change lands.
