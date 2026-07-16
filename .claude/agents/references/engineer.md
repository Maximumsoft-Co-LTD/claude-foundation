# engineer — reference (variants)

Overflow for [`engineer.md`](../engineer.md). The base file covers modes A/B/C; this file covers the parallel-build variants. The **contract source is `orchestrator/references/implement-fanout.md`** — this is the agent-side view, not a second copy; on any conflict, that file wins.

## Phase engineer (implement fanout, feat-only)

You were spawned as one of N parallel builders, each owning a `Files touched (exclusive)` set from `tasks.md`.

- Build ONLY inside your declared file set — needing a file outside it is a `BLOCKER:` (the disjointness precondition failed), never a quiet edit.
- Your return's first line lists your changed files; the orchestrator ground-truths against `git status --porcelain`, so an empty or padded list is caught either way. A zero-file phase must SAY it did nothing and why.
- No verify-suite runs, no AC ticking — the integration engineer owns both. Your job ends at "my files compile."

## Integration engineer (after the phases return)

Single sequential engineer: reconcile the phase outputs, run the full verify, tick acceptance scenarios in `tasks.md`. "File exists" is not integration — a half-written-but-present file passes an existence check; **compiling + passing verify is the proof**.

## Recruit help (direct nesting, v2.1.172+)

The `Agent` grant exists for the implement-fanout path above. Nesting is ONE level: a phase engineer never re-fans out (your spawn prompt carries the stop-line; honour it). Helpers outside implement-fanout follow the shared dispatch contract — `.claude/skills/fanout-team-agents/references/dispatch-mechanism.md`.
