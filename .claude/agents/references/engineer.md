# engineer — reference (variants)

Overflow for [`engineer.md`](../engineer.md). The base file covers modes A/B/C; this file covers the parallel-build variants. The **contract source is `orchestrator/references/implement-fanout.md`** — this is the agent-side view, not a second copy; on any conflict, that file wins.

## Phase engineer (implement fanout, feat-only)

You were spawned as one of N parallel builders, each owning a `Files touched (exclusive)` set from `tasks.md`.

- Build ONLY inside your declared file set — needing a file outside it is a `BLOCKER:` (the disjointness precondition failed), never a quiet edit.
- Your return's first line lists your changed files; the orchestrator ground-truths against `git status --porcelain`, so an empty or padded list is caught either way. A zero-file phase must SAY it did nothing and why.
- No verify-suite runs and no AC ticking — the integration engineer owns task-level integration verifies; Test owns AC evidence. Your job ends at "my files compile."

## Integration engineer (after the phases return)

Single sequential engineer: reconcile the phase outputs and run every task-level integration verify. Do not tick acceptance scenarios; Test records AC evidence in `tests.md`. "File exists" is not integration — a half-written-but-present file passes an existence check; **compiling + passing verify is the proof**.

## Recruit help (direct nesting, v2.1.172+)

The `Agent` grant exists only for a parent-authorized implement-fanout. The prompt must carry `fanout_authorized: true`, the spawn proof, and exclusive file ownership for each child. Nesting is ONE level: a phase engineer never re-fans out. Without that authorization, execute sequentially.
