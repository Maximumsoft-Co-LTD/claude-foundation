# Dispatch Mechanism — Paths, Signals, and the Validator

Deeper companion to the body's "How it works" digest. Covers the two ways a fanout gets dispatched, what stays centralized regardless of path, the one `FANOUT_REQUESTED: implement:` signal shape with its payload semantics, and the orchestrator-side validator that keeps a malformed signal loud.

## Two dispatch paths: authorized direct nesting and implement orchestration

Since Claude Code **v2.1.172** a sub-agent holding `Agent` can spawn nested sub-agents. It may do so only when the parent prompt passes `fanout_authorized: true`, a named spawn proof, and disjoint child scopes. Tool availability, size, and worker heuristics do not grant permission. Other `team-*` review workers stay read-only with no `Agent`.

The **orchestrator-mediated signal** (`FANOUT_REQUESTED:`, below) is retained **only** as the path for **implement-fanout**, where the orchestrator's *background* phase-engineers + phase-granular `state.json > impl_phases_done` resume are wanted (a self-spawning engineer uses foreground instead — see `engineer.md`). Every other read/research fanout (spec-research, plan, test, review, security) direct-nests only — there is no signal escape for those; a worker that genuinely can't nest returns `BLOCKER:` naming why instead of falling back to a signal.

## What stays centralized regardless of path (the real invariants)

A sub-agent still **cannot call `AskUserQuestion`** (only the orchestrator asks the user — genuine ambiguity returns a `BLOCKER:`), and **`state.json` stays single-writer** — helpers return findings or write only their own disjoint files; they never write `state.json` or the calling agent's artifact. Helpers also do **not** re-escalate: one level of split (a helper handed a sub-scope does the work directly).

## Worker-side nesting contract (canonical)

Every splittable worker's "Recruit help" section points HERE — this is the single copy of the mechanics. The agent file keeps only its role's split criterion and cap; a change to this contract lands once, in this section.

- **Split test:** the scope separates into non-overlapping sub-areas where no finding changes another — otherwise stay serial.
- **Authorization test:** parent prompt contains `fanout_authorized: true`, the proof, and the proposed child scopes. Missing any field → stay serial; do not infer permission.
- **Dispatch:** spawn ALL helpers in ONE message (they run in parallel); each prompt is self-contained — the sub-scope, the worker's own output template to return, `repo_root` + `branch`, and the stop-line.
- **Stop-line (last line of every helper prompt, verb adapted to the role):** `You are a nested helper: <do> this one sub-scope directly and do NOT spawn further agents.` One level of split, never deeper.
- **Caps are role-owned:** each agent file states its own N (helpers alive at once, not total).
- **Merge:** the recruiting worker synthesises helper returns into its OWN single return/artifact — helper output is evidence, never the deliverable; raw helper text is never relayed upward.
- **Registry miss** (a named `team-*` comes back `not found`): inline-fallback per the signal section below — `general-purpose` at the floor model (`CLAUDE_DEV_FLOOR_MODEL`, default sonnet), flagging the tier change when the role is haiku-pinned. A miss never retreats to a single serial pass.

## The `FANOUT_REQUESTED:` return-prefix convention

When `engineer` (Mode A, feat-only) decides implement-fanout is warranted, it returns control to the orchestrator with a line prefixed `FANOUT_REQUESTED:` carrying the request shape. The orchestrator parses the line, dispatches the parallel phase-engineers in the background via `Agent(...)` calls (one per phase, all in the same message so they run concurrently), collects the returns, and re-spawns the calling `engineer` (Integration variant) with the phase outputs included in the prompt for synthesis.

**One documented shape** (v2.8.0 cut — retired the other five: `review`, `security:<bucket-list>`, `plan:<point-list>`, `test:<category-list>`, `research:<question-list>`; every splittable worker now direct-nests those itself, per the `Worker-side nesting contract` above):

```
FANOUT_REQUESTED: implement:<parallel-phase-list>
```

- `implement:phase-1,phase-2` — comma-separated labels of the **parallel** phases (never the integration phase) from a **feat** `plan.md`'s `Parallelizable: yes` phases. Orchestrator first gates on `Type==feat` and re-verifies the phases' `Files touched (exclusive)` sets are pairwise-disjoint with `Depends on: none` (refuses + falls back to single-pass otherwise), then spawns one **write-only** `engineer` (Parallel phase variant) per phase in the **background**, and finally re-spawns the calling engineer in the **Integration variant** to wire shared glue, install deps, run every `verify:`, and tick the ACs. The parallel phase-engineers do not verify or tick `spec.md` — qa (Test) and review (Review) are the catch for what the deferred verify loop would have caught. Resume is phase-granular via `state.json > impl_phases_done`, not sub-step.

A worker returning any of the five retired shapes gets ONE corrective re-spawn ("dispatch helpers yourself per the `Worker-side nesting contract`"); a second such signal is a `BLOCKER`.

## Validating the signal (orchestrator-side)

The orchestrator MUST validate every sub-agent return whose first line starts with `FANOUT_REQ` (case-insensitive). The allowlist is the exact set:

```text
^FANOUT_REQUESTED: implement:[a-z0-9,\-]+$
```

Any return whose first line matches the case-insensitive `FANOUT_REQ` prefix but fails the strict regex is a **BLOCKER** — the orchestrator surfaces via `AskUserQuestion` rather than silently falling through to non-fanout. This makes typo failure modes (`FANOUTREQUESTED:` missing underscore, `Fanout_Requested:` case-mixed prefix, trailing junk, missing space after the colon) loud instead of silent, and it also catches a worker still emitting one of the five retired shapes (`review`, `security:`, `plan:`, `test:`, `research:`) — those no longer match, so they hit the same corrective-re-spawn path as a typo. Full parser shape lives in `.claude/orchestrator.md > Fanout dispatch`.
