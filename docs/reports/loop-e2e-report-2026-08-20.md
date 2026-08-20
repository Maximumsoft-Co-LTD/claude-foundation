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

## Finding 2 — Land-time re-prove deadlocks on the review wave cap

After Prove passed, `/land` applied the change; applying (product files +
packet bookkeeping) moves the workspace hash, so `land advance` demands one
fresh prove. The fresh `proof advance` then *itself creates a review request
and prescribes the exact command* `authority run <change> --request <id>`,
which the authority layer refuses:

```
BLOCKED: REVIEW_ROUTE_COMPLETE: 2/2 delivered AI review wave(s) are complete.
```

The proof layer demands evidence the authority layer refuses to produce —
with `foundation.json` already at `review.independence: "self"` and
`diversity: "single-model"` (the shipped defaults). Every default-config
consumer whose change consumed both review waves during Prove hits this wall
at Land: the only exits are a human-recorded review or leaving the change
un-archived. The land-phase agent diagnosed the same dead end and refused to
fabricate, which is the guard working as designed — but the route contradiction
between `proof advance` (creates request, prescribes `authority run`) and
`authority run` (`REVIEW_ROUTE_COMPLETE`) looks like a genuine defect.
Deterministic CLI reproduction (no model involved): sandbox sync → proof
advance → run the prescribed authority command.

Candidate directions: bind review receipts to the reviewed content fingerprint
rather than the full workspace hash (bookkeeping writes should not invalidate
a delivered verdict), or exempt Land's apply-induced hash move from re-review
when the product delta is byte-identical to the reviewed delta.

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
