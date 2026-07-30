# Running a Fanout — The 4-Step Procedure, Caveats, and Anti-Patterns

Deeper companion to the body's "How it works" digest. The full procedure for executing a fanout once the When-to-use bar is cleared, the one registry constraint that actually bit on the first live run, and the anti-patterns.

## 1. Identify independent domains

Two checks before fanning out:
- **Independence** — can each worker reach a verdict without reading the others' outputs? If finding A could change finding B, the domains are not independent and fanout is the wrong tool.
- **Disjoint scope** — do the workers touch overlapping files or symbols? If two workers would edit/analyse the same lines, dispatch sequentially or merge them into one worker.

Examples:
- *Review fanout* — when multiple substantial, independent lenses have bounded inputs and the parent authorizes fanout, review-focused `team-*` agents can inspect them in parallel. Size sets the cap/depth, not authorization. A coherent diff stays single-pass at any size.
- *Security buckets* — `auth` and `crypto` buckets touch different files (or different sections of the same file). One worker per bucket with a bucket-scoped path filter.
- *Spec prep* — one worker explores the existing checkout flow while another researches current payment-provider webhook verification rules. The outputs shape the interview questions and `spec.md > Discovery notes`.
- *Plan integration points* — fan out when the points sit in **disjoint surfaces** (separate modules/folders/repos) and can be researched independently — **not** for ≥ 2 points inside one cohesive module, which is a single serial `lead` walk. For each disjoint point, pair a `team-codebase-explorer` current-state pass with a `team-best-practice-researcher` best-practice pass. If `webhook-ingest` and `billing-api` both hinge on the same `users/repo.ts` contract, that shared surface is not disjoint — merge their codebase exploration into one pass but keep external best-practice research separate if the sources differ.

**Same worker, N instances — the default shape.** Most fanouts spawn **N copies of the *same* `team-*` worker**, one per independent unit: one `team-codebase-explorer` per integration point, one `team-code-reviewer` per security bucket, one `team-pr-test-analyzer` per test category. Only the 6-lens review fanout mixes *different* workers. N is the count of genuinely independent units — cap at the concurrency limit (≈ 6) and group beyond it; never spawn N for N's sake. Horizontal scaling is first-class, not a one-of-each constraint. The plan's `## Fanout plan` records this N up front (`.claude/orchestrator/references/fanout-dispatch.md`).

## 2. Construct focused prompts

Each worker prompt is **self-contained** — it inherits nothing from the calling sub-agent's context. The orchestrator constructs the prompt from scratch and includes:

- **Scope** — exactly which files / paths / diff slice the worker should analyse. Cite by path.
- **Goal** — one sentence on what the worker is producing (e.g., "report silent failures in this diff against the project's logging conventions").
- **Constraints** — what the worker must NOT do (touch files outside scope, refactor production code, exceed N findings).
- **Output shape** — the exact section structure expected. For team-`<role>` workers, this is the agent file's documented output format (already in the YAML/body of `.claude/agents/team-*.md`).

When an authorized review fanout runs, each prompt carries only its diff/lens slice, the relevant project rules, and the required result shape.

## 3. Parallel dispatch (orchestrator-owned)

The orchestrator dispatches all workers in the **same message** — Claude Code's `Agent` tool runs them concurrently when multiple invocations appear in one assistant turn. Sequential `Agent` calls across multiple turns are *not* parallel.

```
# orchestrator does, in one message:
Agent(subagent_type="team-codebase-explorer", prompt=<focused-prompt-1>)
Agent(subagent_type="team-best-practice-researcher", prompt=<focused-prompt-2>)
Agent(subagent_type="team-code-reviewer", prompt=<focused-prompt-3>)
Agent(subagent_type="team-pr-test-analyzer", prompt=<focused-prompt-4>)
Agent(subagent_type="team-silent-failure-hunter", prompt=<focused-prompt-7>)
Agent(subagent_type="team-type-design-analyzer", prompt=<focused-prompt-8>)
```

**Guard-hook reality** (read the hook, not the prose around it): `.claude/hooks/dev-agent-guard.sh` (referenced from `.claude/orchestrator.md > State discipline`) does **not** restrict `team-*` spawns. The hook has three cases:

- Case 1 — blocks `subagent_type="orchestrator"` (no such sub-agent exists).
- Case 2 — blocks `subagent_type="general-purpose"` only when the description prefix names one of the 5 /dev workers (the "knowing but not complying" fallback).
- Case 3 — enforces `state.json` mtime discipline for the 5 /dev workers (`pm | lead | engineer | qa | retro`) only.

A `team-*` `subagent_type` falls through every case and exits 0 — the guard is not the load-bearing constraint for fanout. (See "Caveat: agent registry is session-scoped" below for the constraint that actually fired on the first live fanout run.)

## 4. Findings integration (sub-agent synthesises)

When all workers return, the orchestrator re-spawns the calling /dev sub-agent with the workers' outputs concatenated into the prompt. The orchestrator MUST also pass a `Dispatched-as:` map (one entry per worker: `team-<role> → <actual subagent_type that ran>`) into the synthesis prompt — without it, the sub-agent cannot fill the mandatory `Dispatched-as:` line on each `### team-<role>` subsection (see `.workflow/_templates/review.md > Per-agent findings`).

The sub-agent then:

- Writes one `### team-<role>` subsection per worker into the target artifact's fanout section (`spec.md > Discovery notes`, `plan.md > Research notes`, or `review.md > Per-agent findings`). The first line of each subsection MUST be `**Dispatched-as**: <subagent_type> (<reason if fallback>)` so a future reader can tell a real `team-*` dispatch from the inline-fallback path.
- Synthesises across workers — same finding reported by two workers = collapse to one bullet citing both; contradictions = surface in the synthesis as a question for the human.
- Writes the sub-agent's own pass (requirements synthesis for `pm`; current-state / approach / risk synthesis for `lead` plan; plan-adherence + acceptance-criteria for `lead` review; coverage table for `qa`; integration pass for `engineer`). The fanout output is **additive** — it does not replace the sub-agent's own discipline (the anti-bias rule in `WORKFLOW.md > Anti-bias rule` still binds `lead`).
- Returns the artifact path + a one-line summary that names the worker count and the count of findings per severity.

Single-pass runs (no fanout) skip the `### team-<role>` subsections entirely — the artifact template marks them as `(present only when fanout ran; omit for single-reviewer runs)` so both shapes stay valid (`AC8` in spec 0002).

## Caveat: agent registry is session-scoped

Claude Code loads the agent registry at **session start** by scanning `.claude/agents/*.md`. Agent files created mid-session (e.g., by the `engineer` worker during a `/dev` run that introduces new `team-*` agents) are **not** discoverable as `subagent_type=<name>` until the session restarts. The first symptom is:

```
Agent type 'team-code-reviewer' not found
```

**Two correct responses** (orchestrator picks at run time):

1. **Session restart** — close and re-open the Claude Code session so the registry picks up the new files. `subagent_type="team-<role>"` works after restart.
2. **Inline fallback** — dispatch via `subagent_type="general-purpose"` with the worker's role contract read inline into the prompt (each `Agent(...)` call reads `.claude/agents/team-<role>.md` end-to-end and passes the body in the prompt) **and `model="sonnet"` set explicitly on every call**. general-purpose has no `model:` frontmatter, so `dev-agent-guard.sh` (Case 6) blocks it unless it is pinned to sonnet — without the pin it would inherit the opus main-session tier. The sonnet floor governs the fallback regardless of the role's own tier: a role's per-agent model (e.g. a `haiku` analyzer) applies only on the live `team-<role>` path, not here. Parallelism is preserved (one `Agent(...)` per worker, same message), and the per-agent findings still land in `review.md > Per-agent findings`. The cost: the dispatched-as type is `general-purpose`, not `team-<role>`, so the review artifact MUST record provenance explicitly via the `Dispatched-as:` line.

The inline-fallback artifact is byte-identical in shape to a real parallel-dispatch artifact. Without provenance markers, a reader can't tell which path ran. A reader who sees `**Dispatched-as**: team-<role>` knows the registry is live. Expect the inline-fallback on first run after install; clean `team-<role>` dispatch after session restart.

**Decide it once, record it (the orchestrator's contract).** The choice between live `team-*` and the inline fallback is made on the run's **first** `team-*` dispatch and recorded in `state.json > team_registry`; every later fanout — the orchestrator's or a self-dispatching worker's (which reads `team_registry` from its prompt) — reuses it without re-probing, and a registry miss **never** downgrades a fanout to single-pass (only the spawn mechanism changes). This is the fix for "fanout silently didn't fire." Full mechanics: `.claude/orchestrator.md > Fanout dispatch > Registry preflight`.

## Anti-patterns

The three failure modes from the upstream skill apply here unchanged:

- **Too broad prompts.** "Review the codebase" → the worker gets lost. Always scope to a specific diff slice, file set, or path range. The team-`<role>` workers will silently expand scope if not constrained — give them the diff and the path filter.
- **No constraints.** A review worker with no "tests are out of scope" constraint will start flagging rewrites of test files you didn't ask about (the review/advisory workers are report-only, so the risk is scope-creep in what they flag, not unwanted edits). State what the worker must NOT cover — every prompt has a one-line constraints stanza.
- **Vague output shape.** "Return your findings" → workers return free-form prose that doesn't merge cleanly. Specify the section shape (the agent files already document this; cite it in the prompt — "return your output in the format documented in your agent file's Output Format section").

Five more apply to `/dev` specifically:

- **Mis-judging whether the work admits fanout — in either direction.** Single-pass-first means a single pass is the default. The **more likely error is over-fanning-out**: firing N workers on a surface a single pass would finish faster — paying coordination + cold-start + synthesis for nothing. The **opposite** error (staying single-pass when large, independent, disjoint domains genuinely exist) leaves parallel wall-clock on the table. Fan out only when a phase clears its eligibility bar AND none of the `Don't use when` guardrails apply AND the work is substantial enough to repay the cost.
- **Forgetting which invariant survived v2.1.172.** It is *not* "sub-agents can't spawn" — splittable agents now self-dispatch directly. The survived invariants: sub-agents **cannot call `AskUserQuestion`** (return a `BLOCKER:` instead), and `state.json` is single-writer. The real error now is leaving parallel work on the table — neither self-dispatching nor signalling `FANOUT_REQUESTED:` when the work is genuinely splittable.
- **Skipping the synthesis pass.** The fanout output is not the artifact. The /dev sub-agent must still synthesise requirements (`pm`), current state and approach (`lead` plan), plan-adherence (`lead` review), acceptance-criteria coverage (`qa`), or phase integration (`engineer`) on its own. The per-agent sections are evidence the sub-agent reads alongside its own pass — they do not replace it.
- **Trusting a disjointness claim for implement fanout.** A plan can *declare* phases parallel and still overlap on a barrel/router/DI/lockfile. The orchestrator MUST compute the pairwise intersection of the `Files touched (exclusive)` sets and refuse fanout (fall back to one sequential engineer) on any overlap or dependency edge. A blindly-trusted declaration is how a shared file gets clobbered by concurrent write-only engineers.
- **Parallelizing the wrong type, or letting phase-engineers verify/tick.** Implement fanout is **feat-only** — `fix` (regression-test-first), `refactor` (characterization-baseline-first), and `spike` (no prod code) have step-1 ordering that parallel disjoint phases break. Phase-engineers are **write-only**: defer task verifies + dep installs to the sequential integration engineer, and AC evidence to Test; nobody mutates spec checkboxes.
