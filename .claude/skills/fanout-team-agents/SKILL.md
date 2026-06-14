---
name: fanout-team-agents
description: Use when a /dev phase has 2+ independent sub-investigations that can run in parallel — spec research, best-practice research, codebase exploration across disjoint integration points, code review, security buckets, test categories, or plan phases that write to disjoint files. The pattern lets the orchestrator dispatch focused team-agent workers and a /dev sub-agent synthesise the findings into a single artifact.
---

# Fanout team agents

## Overview

This skill codifies the parallel-dispatch pattern (originally from the `superpowers > dispatching-parallel-agents` skill) for the `/dev` workflow in this repo. The pattern says: when a single phase has 2+ independent sub-investigations — spec probes, best-practice research questions, different test files, different security buckets, different codebase regions — investigate them in parallel rather than sequentially, by spawning one focused worker per domain and synthesising the returns.

**Core principle**: one worker per independent problem domain, each with its own self-contained context, dispatched concurrently, results integrated by the caller.

The workers in this repo are the `team-<role>` agents under `.claude/agents/` (manifest at `.claude/agents/TEAM.md`):

- `team-codebase-explorer` — read-only pre-diff exploration for spec/plan: entry points, current flow, invariants, blast radius, existing patterns.
- `team-best-practice-researcher` — focused best-practice research for spec/plan: official docs, standards, current framework/API/security/testing guidance.
- `team-code-reviewer` — diff review against CLAUDE.md, bugs, quality (confidence ≥ 80).
- `team-code-simplifier` — clarity/maintainability of recently-modified code.
- `team-comment-analyzer` — comment accuracy + rot-resistance.
- `team-pr-test-analyzer` — test coverage gaps + brittleness.
- `team-silent-failure-hunter` — silent failures, broad catches, unjustified fallbacks.
- `team-type-design-analyzer` — invariants, encapsulation, illegal-state-unrepresentable.

## When to use

`/dev` is **delegation-first** (the canonical stance lives in `.claude/orchestrator.md > Delegation-first`): each phase **defaults to parallel fanout when its sub-investigations are independent**, and stays single-pass only on a feasibility guardrail (coupled domains, non-disjoint scope, cost clearly loses, or type/ordering). No fanout is *forced* on work that doesn't admit it — the **Default** column below is what runs when the **Trigger** holds, and the `Don't use when` list is the filter that decides whether it holds. No single fanout is mandatory on every run, but the *bias* is to fan out whenever the work is genuinely splittable:

| Phase / mode | Owner sub-agent | Default | Trigger (the feasibility filter) |
|--------------|-----------------|-----------|---------|
| Phase 2 step 5 — review | `lead` (Mode B) | **fanout** | non-trivial diff: large, cross-module, critical, type/contract/test-sensitive, or uncertain — deserves independent specialist passes (single-pass only for a genuinely small/low-risk diff) |
| Phase 2 step 6 — security | `lead` (Mode C) | **fanout** | diff trips ≥ 2 distinct sensitive-paths buckets (a single bucket has no independent split — single-pass) |
| Phase 1 step 1 — spec prep / research | main agent; `pm` via return-signal | **fanout** | existing code, APIs, security-sensitive paths, unfamiliar domain terms, or 2+ independent research questions make guessing risky (single-pass only for XS pure-greenfield) |
| Phase 1 step 2 — plan | `lead` (Mode A) | **fanout** | S/M/L existing-code work with independently-researchable integration points; dispatch both codebase and best-practice workers per point (single-pass for XS, pure-greenfield, or one straightforward point) |
| Phase 2 step 7 — test | `qa` | **fanout** | plan spans ≥ 2 of {unit, integration, e2e} AND any category has ≥ 3 tests (single-pass below that bar) |
| Phase 2 step 4 — implement | `engineer` (Mode A) | **fanout** | **feat-only, L-tier** (Phases exist only on L plans >12 steps): `plan.md` declares ≥ 2 `Parallelizable: yes` phases with disjoint `Files touched (exclusive)` + `Depends on: none`, plus a sequential integration phase (orchestrator re-verifies disjointness before dispatch). When the plan ships those markers, fan out — don't sit on it. |

**Don't use when** (these are the feasibility guardrails that decide whether a phase's Trigger genuinely holds — fan out whenever NONE of them apply):
- Sub-investigations are related (one finding might invalidate another).
- The work needs full-system context to make sense.
- Workers would interfere (edit the same files, depend on each other's outputs).
- Scope is small enough that a single pass is cheaper than coordinating workers.

## The third axis: surface (per-repo) fanout

Every row above splits **one repo's** work. The *lens* axis (the 6 review workers, the security buckets) and the *category* axis (the test categories) both fan out **within a single `repo_root`**. A **control-plane run that spans multiple repos** adds an orthogonal **surface** axis: split the three read-and-judge phases — **review** (step 11), **security** (step 12), and **test** (step 13) — **per repo**, so N repos are read in parallel instead of one agent crawling them serially. The repos are the ideal fanout target — separate trees, separate diffs, separate test suites, zero shared state. (**Retro** (step 16) also reads across repos but is **multi-repo-aware single-pass, not surface-fanned**: it synthesises the already-unified per-repo artifact sections and holds no `Agent`.)

This axis is **orchestrator-owned and carries no `FANOUT_REQUESTED:` signal**: no sub-agent discovers it mid-work — the orchestrator already knows the repo list from `state.repos` at dispatch time, so it leads directly (like plan-prep push). The full contract is `.claude/orchestrator.md > Fanout dispatch > Surface (per-repo) fanout`; the load-bearing rules:

- **When** — the changed-repo set (repos in `state.repos`, else `[repo_root]`, that the run actually changed) has size > 1. Size ≤ 1 → single-repo path, unchanged. (Security narrows further to the subset of changed repos that trip sensitive paths.)
- **Background dispatch (following implement-fanout's precedent; safe regardless)** — one `lead`/`qa` per repo, `run_in_background: true`, all in one message. The documented rationale is that a *foreground* batch of these `pm|lead|engineer|qa|retro` `subagent_type`s self-blocks on the 2nd spawn under `dev-agent-guard.sh` Case 3 (the first return touches `.last_worker_return` before the next spawn's pre-check) — inferred from the implement-fanout note, not separately re-verified. It's why review/security/test surface fanout can NOT simply reuse the foreground 6-`team-*` dispatch the lens axis uses (`team-*` types fall through guard Case 3; the 5 /dev workers don't).
- **Don't naively compose the axes** — per-repo reviewers/security-reviewers/testers are single-pass by default. Nesting the lens/bucket/category axis inside each is 6×N agents; reserve the inner axis for a single repo whose own diff is genuinely non-trivial, capped.
- **Synthesis** — a foreground re-spawn (`lead`/`qa` Surface-synthesis variant) writes the single unified `review.md`/`security.md`/`tests.md` with one `### Repo: <path>` subsection per repo plus the GLOBAL anti-bias / AC-coverage walk (security: aggregate verdict = fix-required iff any repo has a `high`). Aggregate verdict/status = pass iff every repo passes; the cycle counter bumps once per fanout, per run.
- **Scope boundary (with a live consequence)** — surface fanout parallelises only the read-and-judge phases; branch/implement/gate/ship stay single-`repo_root` (the diffs across repos already exist by review time). The consequence to hold: `engineer` and ship are `repo_root`-scoped, so a blocking review finding, a failing test, or a `high` security finding in a **non-primary** repo has **no auto-fix path** — the orchestrator surfaces it to the user rather than routing to `engineer` (which would edit the wrong repo). Parallel review can find cross-repo problems faster than this slice can fix them. Full multi-repo targeting (per-repo branch/implement/ship) is a tracked follow-up, not this axis.

## Two dispatch paths: direct nesting (primary) and the orchestrator signal (fallback)

Since Claude Code **v2.1.172** a sub-agent can spawn nested sub-agents if it holds `Agent`. The splittable `/dev` agents are therefore granted `Agent` and **self-dispatch their helpers directly** when their own work is large — `pm`, `lead`, `qa`, `engineer`, plus the self-splitting workers `team-codebase-explorer`, `team-best-practice-researcher`, and `team-code-reviewer`. Each carries a "Recruit help when the work is large" section defining its trigger, helper type, cap, and disjointness rule. This is the **primary** path — no round-trip through the orchestrator. (The other `team-*` review workers stay read-only with no `Agent`.)

The **orchestrator-mediated signal** (`FANOUT_REQUESTED:`, below) is retained as the **fallback** — for an agent that would rather the orchestrator dispatch, and as the path for **implement-fanout**, where the orchestrator's *background* phase-engineers + phase-granular `state.json > impl_phases_done` resume are wanted (a self-spawning engineer uses foreground instead — see `engineer.md`).

**What stays centralized regardless of path** (the real invariants): a sub-agent still **cannot call `AskUserQuestion`** (only the orchestrator asks the user — genuine ambiguity returns a `BLOCKER:`), and **`state.json` stays single-writer** — helpers return findings or write only their own disjoint files; they never write `state.json` or the calling agent's artifact. Helpers also do **not** re-escalate: one level of split (a helper handed a sub-scope does the work directly).

### The `FANOUT_REQUESTED:` return-prefix convention

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

- `review` — no payload; orchestrator dispatches the 6 review-focused `team-*` workers against the diff when review fanout is warranted.
- `security:auth,crypto` — comma-separated bucket names from the security trigger list; orchestrator spawns one `team-code-reviewer` per bucket with a focused threat-model prompt scoped to that bucket's paths.
- `plan:webhook-ingest,billing-api` — comma-separated integration-point names from `spec.md > Constraints > Integration points`; orchestrator spawns `team-codebase-explorer` and `team-best-practice-researcher` per point — but skips the `team-codebase-explorer` for any point the push-based plan-prep already mapped, re-dispatching only the residual `team-best-practice-researcher` (the dedup guard in `orchestrator.md` step 8, so push-then-pull never re-explores the same point).
- `test:unit,integration` — comma-separated test categories; orchestrator spawns one `team-pr-test-analyzer` per category against the slice of the diff that category covers.
- `implement:phase-1,phase-2` — comma-separated labels of the **parallel** phases (never the integration phase) from a **feat** `plan.md`'s `Parallelizable: yes` phases. Orchestrator first gates on `Type==feat` and re-verifies the phases' `Files touched (exclusive)` sets are pairwise-disjoint with `Depends on: none` (refuses + falls back to single-pass otherwise), then spawns one **write-only** `engineer` (Parallel phase variant) per phase in the **background**, and finally re-spawns the calling engineer in the **Integration variant** to wire shared glue, install deps, run every `verify:`, and tick the ACs. The parallel phase-engineers do not verify or tick `spec.md` — review (step 5) and qa (step 7) are the catch for what the deferred verify loop would have caught. Resume is phase-granular via `state.json > impl_phases_done`, not sub-step.
- `research:codebase-auth-flow,best-practice-oauth-callbacks` — comma-separated kebab-case question slugs. `codebase-*` routes to `team-codebase-explorer`; `best-practice-*` routes to `team-best-practice-researcher`. If a slug has no prefix, the orchestrator picks the narrower worker and may dispatch both only when the question explicitly needs repo facts and external guidance. Then it re-spawns the calling agent with the worker findings — for `pm` (which writes a draft `spec.md` *before* requesting research, per `pm.md` Steps step 6), the re-spawn re-reads that draft and refines it in place, so nothing requirement-bearing is re-passed in the prompt; for a main-agent spec-prep dispatch the findings feed the subsequent `pm` spawn.

## The pattern

### 1. Identify independent domains

Two checks before fanning out:
- **Independence** — can each worker reach a verdict without reading the others' outputs? If finding A could change finding B, the domains are not independent and fanout is the wrong tool.
- **Disjoint scope** — do the workers touch overlapping files or symbols? If two workers would edit/analyse the same lines, dispatch sequentially or merge them into one worker.

Examples:
- *Review fanout* — when a diff is large, cross-module, critical, type/contract/test-sensitive, or uncertain, the 6 review-focused `team-*` agents look at the same diff from different lenses (review, simplification, comments, tests, silent failures, type design). The diff is shared, but each lens is independent — they don't need each other's outputs to proceed. Small/low-risk diffs stay single-pass.
- *Security buckets* — `auth` and `crypto` buckets touch different files (or different sections of the same file). One worker per bucket with a bucket-scoped path filter.
- *Spec prep* — one worker explores the existing checkout flow while another researches current payment-provider webhook verification rules. The outputs shape the interview questions and `spec.md > Discovery notes`.
- *Plan integration points* — fan out when the points can be researched independently. For each point, pair a `team-codebase-explorer` current-state pass with a `team-best-practice-researcher` best-practice pass. If `webhook-ingest` and `billing-api` both hinge on the same `users/repo.ts` contract, merge their codebase exploration into one pass but keep external best-practice research separate if the sources differ.

### 2. Construct focused prompts

Each worker prompt is **self-contained** — it inherits nothing from the calling sub-agent's context. The orchestrator constructs the prompt from scratch and includes:

- **Scope** — exactly which files / paths / diff slice the worker should analyse. Cite by path.
- **Goal** — one sentence on what the worker is producing (e.g., "report silent failures in this diff against the project's logging conventions").
- **Constraints** — what the worker must NOT do (touch files outside scope, refactor production code, exceed N findings).
- **Output shape** — the exact section structure expected. For team-`<role>` workers, this is the agent file's documented output format (already in the YAML/body of `.claude/agents/team-*.md`).

When 6-worker review fanout runs, the prompt to each `team-*` is essentially: "Review this diff: `<paste of git diff>`. Apply your responsibilities as documented in your agent file. Return your findings in the section shape your agent file specifies."

### 3. Parallel dispatch (orchestrator-owned)

The orchestrator dispatches all workers in the **same message** — Claude Code's `Agent` tool runs them concurrently when multiple invocations appear in one assistant turn. Sequential `Agent` calls across multiple turns are *not* parallel.

```
# orchestrator does, in one message:
Agent(subagent_type="team-codebase-explorer", prompt=<focused-prompt-1>)
Agent(subagent_type="team-best-practice-researcher", prompt=<focused-prompt-2>)
Agent(subagent_type="team-code-reviewer", prompt=<focused-prompt-3>)
Agent(subagent_type="team-code-simplifier", prompt=<focused-prompt-4>)
Agent(subagent_type="team-comment-analyzer", prompt=<focused-prompt-5>)
Agent(subagent_type="team-pr-test-analyzer", prompt=<focused-prompt-6>)
Agent(subagent_type="team-silent-failure-hunter", prompt=<focused-prompt-7>)
Agent(subagent_type="team-type-design-analyzer", prompt=<focused-prompt-8>)
```

**Guard-hook reality** (read the hook, not the prose around it): `.claude/hooks/dev-agent-guard.sh` (referenced from `.claude/orchestrator.md > State discipline`) does **not** restrict `team-*` spawns. The hook has three cases:

- Case 1 — blocks `subagent_type="orchestrator"` (no such sub-agent exists).
- Case 2 — blocks `subagent_type="general-purpose"` only when the description prefix names one of the 5 /dev workers (the "knowing but not complying" fallback).
- Case 3 — enforces `state.json` mtime discipline for the 5 /dev workers (`pm | lead | engineer | qa | retro`) only.

A `team-*` `subagent_type` falls through every case and exits 0 — the guard is not the load-bearing constraint for fanout. (See `## Operational caveats > Agent registry is session-scoped` below for the constraint that actually fired on the first live fanout run.)

### 4. Findings integration (sub-agent synthesises)

When all workers return, the orchestrator re-spawns the calling /dev sub-agent with the workers' outputs concatenated into the prompt. The orchestrator MUST also pass a `Dispatched-as:` map (one entry per worker: `team-<role> → <actual subagent_type that ran>`) into the synthesis prompt — without it, the sub-agent cannot fill the mandatory `Dispatched-as:` line on each `### team-<role>` subsection (see `.workflow/_templates/review.md > Per-agent findings`).

The sub-agent then:

- Writes one `### team-<role>` subsection per worker into the target artifact's fanout section (`spec.md > Discovery notes`, `plan.md > Research notes`, or `review.md > Per-agent findings`). The first line of each subsection MUST be `**Dispatched-as**: <subagent_type> (<reason if fallback>)` so a future reader can tell a real `team-*` dispatch from the inline-fallback path (see `## Operational caveats > Agent registry is session-scoped`).
- Synthesises across workers — same finding reported by two workers = collapse to one bullet citing both; contradictions = surface in the synthesis as a question for the human.
- Writes the sub-agent's own pass (requirements synthesis for `pm`; current-state / approach / risk synthesis for `lead` plan; plan-adherence + acceptance-criteria for `lead` review; coverage table for `qa`; integration pass for `engineer`). The fanout output is **additive** — it does not replace the sub-agent's own discipline (the anti-bias rule in `WORKFLOW.md > Anti-bias rule` still binds `lead`).
- Returns the artifact path + a one-line summary that names the worker count and the count of findings per severity.

Single-pass runs (no fanout) skip the `### team-<role>` subsections entirely — the artifact template marks them as `(present only when fanout ran; omit for single-reviewer runs)` so both shapes stay valid (`AC8` in spec 0002).

## Operational caveats

### Agent registry is session-scoped

Claude Code loads the agent registry at **session start** by scanning `.claude/agents/*.md`. Agent files created mid-session (e.g., by the `engineer` worker during a `/dev` run that introduces new `team-*` agents) are **not** discoverable as `subagent_type=<name>` until the session restarts. The first symptom is:

```
Agent type 'team-code-reviewer' not found
```

This is exactly what fired on this skill's own first live fanout — the orchestrator dispatched 6 review-focused `team-*` workers, every spawn failed at the registry lookup, and the orchestrator fell back to the inline path documented next.

**Two correct responses** (orchestrator picks at run time):

1. **Session restart** — close and re-open the Claude Code session so the registry picks up the new files. `subagent_type="team-<role>"` works after restart.
2. **Inline fallback** — dispatch via `subagent_type="general-purpose"` with the worker's role contract read inline into the prompt (each `Agent(...)` call reads `.claude/agents/team-<role>.md` end-to-end and passes the body in the prompt). Parallelism is preserved (one `Agent(...)` per worker, same message), and the per-agent findings still land in `review.md > Per-agent findings`. The cost: the dispatched-as type is `general-purpose`, not `team-<role>`, so the review artifact MUST record provenance explicitly via the `Dispatched-as:` line.

The inline-fallback artifact is byte-identical in shape to a real parallel-dispatch artifact. Without provenance markers on each per-agent subsection, a reader cannot tell which path ran — conversely, a reader who sees `**Dispatched-as**: team-<role>` knows the registry is live and the path is the real one. The first real `/dev` run after the install or after this skill ships will hit this; expect the inline-fallback the first time and a clean `team-<role>` dispatch on session restart.

### `FANOUT_REQUESTED:` signal validator (orchestrator-side)

The orchestrator MUST validate every sub-agent return whose first line starts with `FANOUT_REQ` (case-insensitive). The allowlist is the exact set:

```text
^FANOUT_REQUESTED: (review|security:[a-z0-9,\-]+|plan:[a-z0-9,\-]+|test:[a-z0-9,\-]+|implement:[a-z0-9,\-]+|research:[a-z0-9,\-]+)$
```

Any return whose first line matches the case-insensitive `FANOUT_REQ` prefix but fails the strict regex is a **BLOCKER** — the orchestrator surfaces via `AskUserQuestion` rather than silently falling through to non-fanout. This makes typo failure modes (`FANOUTREQUESTED:` missing underscore, `Fanout_Requested:` case-mixed prefix, trailing junk, missing space after the colon) loud instead of silent. Full parser shape lives in `.claude/orchestrator.md > Fanout dispatch`.

## Anti-patterns

The three failure modes from the upstream skill apply here unchanged:

- **Too broad prompts.** "Review the codebase" → the worker gets lost. Always scope to a specific diff slice, file set, or path range. The team-`<role>` workers will silently expand scope if not constrained — give them the diff and the path filter.
- **No constraints.** A `team-code-simplifier` with no "tests are out of scope" constraint will start recommending rewrites of test files you didn't ask about (the review/advisory workers are report-only, so the risk is scope-creep in what they flag, not unwanted edits). State what the worker must NOT cover — every prompt has a one-line constraints stanza.
- **Vague output shape.** "Return your findings" → workers return free-form prose that doesn't merge cleanly. Specify the section shape (the agent files already document this; cite it in the prompt — "return your output in the format documented in your agent file's Output Format section").

### /dev-specific anti-patterns

Beyond the three above, five more apply to /dev specifically:

- **Mis-judging whether the work admits fanout — in either direction.** Delegation-first (`.claude/orchestrator.md > Delegation-first`) means fan out *whenever sub-investigations are independent*, not *always*: below a phase's threshold (coupled domains, non-disjoint scope, cost clearly loses, type/ordering forbids) a single pass is faster and produces a smaller artifact — fanning out there is waste. But the **opposite** error is just as real and now the more likely one under the flipped default: **staying single-pass when independent disjoint domains genuinely exist** leaves parallel wall-clock on the table and defeats the stance. When a phase's Trigger holds and none of the `Don't use when` guardrails apply, the default is to fan out.
- **Forgetting which invariant actually survived v2.1.172.** It is *not* "sub-agents can't spawn" — the splittable agents now hold `Agent` and **self-dispatch helpers directly** (the primary path; `Agent(...)` from those agents works). The invariant that survived is that a sub-agent **cannot call `AskUserQuestion`**: genuine requirement ambiguity returns a `BLOCKER:` for the orchestrator to surface, never a helper. The second rail is single-writer `state.json` (helpers never write it). The real error now is leaving parallel work on the table — *neither* self-dispatching *nor* signalling `FANOUT_REQUESTED:` when the work is genuinely splittable.
- **Skipping the synthesis pass.** The fanout output is not the artifact. The /dev sub-agent must still synthesise requirements (`pm`), current state and approach (`lead` plan), plan-adherence (`lead` review), acceptance-criteria coverage (`qa`), or phase integration (`engineer`) on its own. The per-agent sections are evidence the sub-agent reads alongside its own pass — they do not replace it.
- **Trusting a disjointness claim for implement fanout.** A plan can *declare* phases parallel and still overlap on a barrel/router/DI/lockfile. The orchestrator MUST compute the pairwise intersection of the `Files touched (exclusive)` sets and refuse fanout (fall back to one sequential engineer) on any overlap or dependency edge. A blindly-trusted declaration is how a shared file gets clobbered by concurrent write-only engineers.
- **Parallelizing the wrong type, or letting phase-engineers verify/tick.** Implement fanout is **feat-only** — `fix` (regression-test-first), `refactor` (characterization-baseline-first), and `spike` (no prod code) have step-1 ordering that parallel disjoint phases break. And phase-engineers are **write-only**: running the per-step verify against a sibling's half-written tree lies, and concurrent `spec.md`/lockfile writes race — defer all verify + dep installs + AC-ticking to the one sequential integration engineer.
