# Orchestrator reference — State-discipline edge cases

> Loaded on demand by the main agent (`.claude/orchestrator.md`). The core single-writer rule + hook enforcement stay inline in `## State discipline`; this holds the corner cases — **background spawns** (state writes not hook-enforced), **git worktrees / concurrent runs** (`CLAUDE_DEV_RUN_ID` scoping). Read it only when you spawn background workers or run `/dev` inside a worktree / two runs at once.

**A background spawn you then stop working for is a dead run.** The notification that
carries a background completion can only arrive in a *later* turn, and headless
`claude -p` — every `/dev` bench run, every CI/cron invocation — has no later turn.
So "spawn in background, end the message, wait for the notification" terminates the
pipeline silently: the envelope is healthy, the exit code is 0, `state.json` has no
`done_at`, and the runner records `incomplete_at_<step>` — a worker's finished
artifacts are abandoned with the turn that was waiting for them.

Rule: **the phase worker is always foreground.** Background is for the fanout shapes
that name it (`implement-fanout.md > Dispatch parallel, background, one message`), and
those keep the orchestrator working — verifying writes, folding state — until the last
completion lands. If you catch yourself about to explain that you are waiting, you
have already lost the run: spawn foreground instead.

**Structured terminal return.** Before a phase worker call, main writes
`worker_lifecycle.status=started` with worker/phase/start time. Until the worker
returns, main performs no reads, tests, reviews, or edits on its owned tree. The
worker's first terminal line is exactly one of `DONE:`, `BLOCKER:`, `FAILED:`,
`SIZE_UPGRADE:`, `FIELD_UPGRADE:`, `PROFILE_UPGRADE:`, or `RISK_UPGRADE:` and its
body names completed task/AC ids, changed files, commands/results, remaining gaps,
and `CONTEXT:` facts. Main folds the return once, sets terminal time/status, then
returns lifecycle to `idle`. No terminal return means no phase transition.

**Background spawns are exempt from the marker.** An `Agent` call with `run_in_background: true` returns a launch ack, not a worker return, so `dev-state-mark.sh` doesn't touch the marker (else a one-message background batch self-blocks). The flip side: a background *completion* is a task notification firing no PostToolUse — so state-discipline is **not** hook-enforced for background workers. Write `state.json` yourself when each completion notification lands, before acting on its result.

**Git worktrees / concurrent runs.** The hooks resolve `.workflow/` against `$CLAUDE_PROJECT_DIR` (the main checkout), **not** a `git worktree` — so inside a worktree whose `.workflow/` differs, the marker-freshness check is unreliable. Supported path: run `/dev` from the main checkout. If you must run inside a worktree, or run two `/dev` runs at once, export `CLAUDE_DEV_RUN_ID=<id>` so the guard scopes its check to your run (without it, the guard uses the single active run and fails open when 0 or ≥2 are active). Fail-open means the Case 3 state-freshness block is silently OFF for **every** run in that situation — single-writer discipline is then enforced only by you, so treat every worker return as an immediate write-state-now obligation.

**Context-ledger fold (mechanics).** Each `CONTEXT: path#anchor — fact` line in a worker's return (load-bearing only — invariant · entry point · gotcha) → append/supersede under `.workflow/<id>/context.md > ## Discovered` in the same turn as the state write. First fact with no `context.md` → create it from `_templates/context.md` (header + ledger section) — any size, any field. Workers never write the ledger. After Implement, entries touching changed files are stale — mark or prune on fold; the diff wins.
