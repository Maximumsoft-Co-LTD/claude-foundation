---
name: fanout-team-agents
description: Use when a /dev phase has 2+ independent sub-investigations that can run in parallel — spec research, best-practice research, codebase exploration across disjoint integration points, code review, security buckets, test categories, or plan phases that write to disjoint files. The pattern lets the orchestrator dispatch focused team-agent workers and a /dev sub-agent synthesise the findings into a single artifact.
---

# Fanout team agents

## Overview

Pattern for the `/dev` workflow: when a phase has 2+ independent sub-investigations, investigate in parallel — one focused worker per domain, each with its own self-contained context, dispatched concurrently, results integrated by the caller.

The workers are the `team-<role>` agents under `.claude/agents/` (manifest at `.claude/agents/TEAM.md`):

- `team-codebase-explorer` — read-only pre-diff exploration: entry points, current flow, invariants, blast radius, existing patterns.
- `team-best-practice-researcher` — focused best-practice research: official docs, standards, current framework/API/security/testing guidance.
- `team-code-reviewer` — diff review against CLAUDE.md, bugs, quality (confidence ≥ 80).
- `team-pr-test-analyzer` — test coverage gaps + brittleness.
- `team-silent-failure-hunter` — silent failures, broad catches, unjustified fallbacks.
- `team-type-design-analyzer` — invariants, encapsulation, illegal-state-unrepresentable.

This body is the **decision digest** — *when* to fan out and the invariants that always hold. The dispatch mechanism, the per-repo axis, the run procedure, and the anti-patterns live in the reference files (listed at the end); pull the one that matches the work.

## When to use

`/dev` is **single-pass-first** (the canonical stance lives in `.claude/orchestrator.md > Single-pass-first`): each phase **defaults to a single sequential pass**, and fans out only when its sub-investigations are independent, write disjoint scope, AND the parallel work is substantial enough to clear the cost guardrail (coordination + N× worker cold-start + synthesis must cost less than the wall-clock saved). The **Trigger** column below is the bar that must be cleared to make a fanout *eligible* — clearing it does not fire the fanout automatically; the `Don't use when` list and the cost test still decide. The bias is single-pass; fanout is the justified exception when the work is genuinely large and splittable:

| Phase / mode | Owner sub-agent | Default | Fan out only when (the eligibility bar) |
|--------------|-----------------|-----------|---------|
| Review | `lead` (Mode B) | **single-pass** | the diff is genuinely large, cross-module, or type/contract/test-infra-changing — big enough that six independent specialist passes repay their cost (the most expensive fanout in the system; small/moderate low-risk diffs stay single-pass) |
| Security | `lead` (Mode C) | **single-pass** | the diff trips ≥ 2 distinct sensitive-paths buckets AND each is substantial (a single bucket, or a quick multi-bucket check, stays single-pass) |
| Interview + Spec — spec prep / research | main agent; `pm` direct-nests | **single-pass** | 2+ of {existing code, APIs, security-sensitive paths, unfamiliar domain, 2+ independent research questions} hold AND the research is substantial (always single-pass for XS/S and pure-greenfield) |
| Plan | `lead` (Mode A) | **single-pass** | ≥ 2 independently-researchable integration points **in disjoint surfaces** (separate modules/folders/repos — not raw point count) whose research is genuinely substantial; dispatch both codebase and best-practice workers per point (single-pass for XS/S, pure-greenfield, one point, several points in one cohesive module, or a handful of quick reads) |
| Test | `qa` | **single-pass** | the plan spans ≥ 2 of {unit, integration, e2e} AND any category has ≥ 3 tests (single-pass below that bar) |
| Implement | `engineer` (Mode A) | **single-pass** | **feat-only, L-tier** (Phases exist only on L plans >12 steps): `plan.md` declares ≥ 2 `Parallelizable: yes` phases with disjoint `Files touched (exclusive)` + `Depends on: none`, plus a sequential integration phase (orchestrator re-verifies disjointness before dispatch). When the plan ships those markers, the decomposition is already done — fan out. |

**Don't use when** (these guardrails, plus the cost test, decide whether a phase clears its eligibility bar — stay single-pass unless ALL clear):
- Sub-investigations are related (one finding might invalidate another).
- The work needs full-system context to make sense.
- Workers would interfere (edit the same files, depend on each other's outputs).
- Scope is small enough that a single pass is cheaper than coordinating workers.

## How it works (the shape, in one screen)

- **Two dispatch paths.** The splittable agents (`pm`, `lead`, `qa`, `engineer`, plus `team-codebase-explorer`/`team-best-practice-researcher`/`team-code-reviewer`) **self-dispatch helpers directly** — the primary path since Claude Code v2.1.172. The `FANOUT_REQUESTED: implement:` orchestrator signal is the **fallback**, restricted to implement-fanout — the only signal shape. → `references/dispatch-mechanism.md`
- **Multi-repo runs add a per-repo "surface" axis** — split the read-and-judge phases (test/review/security) per repo, orchestrator-owned. → `references/surface-fanout.md`
- **The run procedure** — identify independent domains (independence + disjoint scope) → construct self-contained, scoped prompts → parallel dispatch (all `Agent(...)` calls in **one** message, else not parallel) → the caller **synthesises** the findings into one artifact. → `references/running-a-fanout.md`

**Invariants that hold on every path:** a sub-agent **cannot call `AskUserQuestion`** (genuine ambiguity returns a `BLOCKER:`); **`state.json` stays single-writer** (helpers return findings or write only their own disjoint files — never `state.json` or the caller's artifact); helpers do **not** re-escalate (one level of split). Fanout output is **additive** — it never replaces the calling sub-agent's own synthesis pass (the anti-bias rule in `WORKFLOW.md` still binds `lead`).

## References

Read the one that matches the work; you don't need all three upfront.

- `references/dispatch-mechanism.md` — the two dispatch paths (direct nesting vs the `FANOUT_REQUESTED:` fallback), what stays centralized regardless of path, the one signal shape with full payload semantics, and the orchestrator-side signal validator (the exact allowlist regex).
- `references/surface-fanout.md` — the per-repo (multi-repo control-plane) axis: when it fires, how the coordinator nests `general-purpose` helpers, why not to naively compose axes, the unified synthesis, and the read-and-judge-only scope boundary (no auto-fix path in non-primary repos).
- `references/running-a-fanout.md` — the 4-step procedure (identify → prompt → dispatch → integrate) with worked examples and the guard-hook reality, the session-scoped registry caveat + inline fallback, and the full anti-pattern list (3 upstream + 5 /dev-specific).
