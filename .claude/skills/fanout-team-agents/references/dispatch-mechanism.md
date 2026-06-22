# Dispatch Mechanism — Paths, Signals, and the Validator

Deeper companion to the body's "How it works" digest. Covers the two ways a fanout gets dispatched, what stays centralized regardless of path, the six `FANOUT_REQUESTED:` signal shapes with their payload semantics, and the orchestrator-side validator that keeps a malformed signal loud.

## Two dispatch paths: direct nesting (primary) and the orchestrator signal (fallback)

Since Claude Code **v2.1.172** a sub-agent holding `Agent` can spawn nested sub-agents. The splittable `/dev` agents (`pm`, `lead`, `qa`, `engineer`, plus `team-codebase-explorer`, `team-best-practice-researcher`, `team-code-reviewer`) **self-dispatch helpers directly** — no round-trip through the orchestrator. This is the **primary** path. (Other `team-*` review workers stay read-only with no `Agent`.)

The **orchestrator-mediated signal** (`FANOUT_REQUESTED:`, below) is retained as the **fallback** — for an agent that would rather the orchestrator dispatch, and as the path for **implement-fanout**, where the orchestrator's *background* phase-engineers + phase-granular `state.json > impl_phases_done` resume are wanted (a self-spawning engineer uses foreground instead — see `engineer.md`).

## What stays centralized regardless of path (the real invariants)

A sub-agent still **cannot call `AskUserQuestion`** (only the orchestrator asks the user — genuine ambiguity returns a `BLOCKER:`), and **`state.json` stays single-writer** — helpers return findings or write only their own disjoint files; they never write `state.json` or the calling agent's artifact. Helpers also do **not** re-escalate: one level of split (a helper handed a sub-scope does the work directly).

## The `FANOUT_REQUESTED:` return-prefix convention

When a /dev sub-agent (`pm`, `lead`, `qa`, `engineer`) decides fanout is warranted, it returns control to the orchestrator with a line prefixed `FANOUT_REQUESTED:` carrying the request shape. The orchestrator parses the line, dispatches the workers in parallel via `Agent(...)` calls (one per worker, all in the same message so they run concurrently), collects the returns, and re-spawns the calling sub-agent with the workers' outputs included in the prompt for synthesis.

Six documented shapes:

```
FANOUT_REQUESTED: review
FANOUT_REQUESTED: security:<bucket-list>
FANOUT_REQUESTED: plan:<point-list>
FANOUT_REQUESTED: test:<category-list>
FANOUT_REQUESTED: implement:<parallel-phase-list>
FANOUT_REQUESTED: research:<question-list>
```

- `review` — no payload; orchestrator dispatches the **tiered** review-focused `team-*` workers against the diff when review fanout is warranted (core 3 lenses at M-tier/moderate, the full 6 only at L/high-stakes — the orchestrator picks the count from `state.json > size`).
- `security:auth,crypto` — comma-separated bucket names from the security trigger list; orchestrator spawns one `team-code-reviewer` per bucket with a focused threat-model prompt scoped to that bucket's paths.
- `plan:webhook-ingest,billing-api` — comma-separated integration-point names from `spec.md > Constraints > Integration points`; orchestrator spawns `team-codebase-explorer` and `team-best-practice-researcher` per point — but skips the `team-codebase-explorer` for any point the push-based plan-prep already mapped, re-dispatching only the residual `team-best-practice-researcher` (the dedup guard in `orchestrator.md` step 8, so push-then-pull never re-explores the same point).
- `test:unit,integration` — comma-separated test categories; orchestrator spawns one `team-pr-test-analyzer` per category against the slice of the diff that category covers.
- `implement:phase-1,phase-2` — comma-separated labels of the **parallel** phases (never the integration phase) from a **feat** `plan.md`'s `Parallelizable: yes` phases. Orchestrator first gates on `Type==feat` and re-verifies the phases' `Files touched (exclusive)` sets are pairwise-disjoint with `Depends on: none` (refuses + falls back to single-pass otherwise), then spawns one **write-only** `engineer` (Parallel phase variant) per phase in the **background**, and finally re-spawns the calling engineer in the **Integration variant** to wire shared glue, install deps, run every `verify:`, and tick the ACs. The parallel phase-engineers do not verify or tick `spec.md` — qa (step 5) and review (step 6) are the catch for what the deferred verify loop would have caught. Resume is phase-granular via `state.json > impl_phases_done`, not sub-step.
- `research:codebase-auth-flow,best-practice-oauth-callbacks` — comma-separated kebab-case question slugs. `codebase-*` routes to `team-codebase-explorer`; `best-practice-*` routes to `team-best-practice-researcher`. If a slug has no prefix, the orchestrator picks the narrower worker and may dispatch both only when the question explicitly needs repo facts and external guidance. Then it re-spawns the calling agent with the worker findings — for `pm` (which writes a draft `spec.md` *before* requesting research, per `pm.md` Steps step 6), the re-spawn re-reads that draft and refines it in place, so nothing requirement-bearing is re-passed in the prompt; for a main-agent spec-prep dispatch the findings feed the subsequent `pm` spawn.

## Validating the signal (orchestrator-side)

The orchestrator MUST validate every sub-agent return whose first line starts with `FANOUT_REQ` (case-insensitive). The allowlist is the exact set:

```text
^FANOUT_REQUESTED: (review|security:[a-z0-9,\-]+|plan:[a-z0-9,\-]+|test:[a-z0-9,\-]+|implement:[a-z0-9,\-]+|research:[a-z0-9,\-]+)$
```

Any return whose first line matches the case-insensitive `FANOUT_REQ` prefix but fails the strict regex is a **BLOCKER** — the orchestrator surfaces via `AskUserQuestion` rather than silently falling through to non-fanout. This makes typo failure modes (`FANOUTREQUESTED:` missing underscore, `Fanout_Requested:` case-mixed prefix, trailing junk, missing space after the colon) loud instead of silent. Full parser shape lives in `.claude/orchestrator.md > Fanout dispatch`.
