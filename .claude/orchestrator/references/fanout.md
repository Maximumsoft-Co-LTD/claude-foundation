# Orchestrator reference — Fanout dispatch

> Loaded on demand by `.claude/orchestrator.md` when a worker's first line is `FANOUT_REQUESTED:`, or the changed-repo set is > 1. Implement consumer contract → `implement-fanout.md`; multi-repo surface fanout → `surface-fanout.md`. A single-repo XS/S run with no fanout signal needs none of these.

## Dispatch model

Main agent + `pm`/`lead`/`qa`/`engineer` can request parallel team-agent fanout. Full pattern: `.claude/skills/fanout-team-agents/SKILL.md`; this is the consumer-side contract. **Direct nesting is primary (v2.1.172+)** — those workers + self-splitting `team-*` hold `Agent` and self-dispatch helpers (each has a "Recruit help…" section), so a worker may already have fanned out. **Prefer it for all read/research fanouts (plan/review/security/test)** — one spawn vs the signal's *double* spawn (worker → signal → dispatch → re-spawn to synthesise); a too-expensive fanout still fires via direct nesting, never single-pass. The `FANOUT_REQUESTED:` signal is the **fallback** (worker prefers you dispatch) and earns its keep for **background implement-fanout** (phase-granular `impl_phases_done` resume) + as the **registry-fallback**. You still lead **plan-prep push (step 8)** — `lead` dedups against it.

## Signal recognition

After every sub-agent return, scan the **first line**: case-insensitive `FANOUT_REQ` → validate against the regex; `BLOCKER:` → surface to user; `SIZE_UPGRADE:`/`FIELD_UPGRADE:` → `## Size-aware execution` (`FIELD_UPGRADE` also: record `field=brownfield`, backfill understand/lock artifacts to owners); else → success. Before advancing, run the step's **Return check** if defined — **only** on the primary worker return (`pm`/`lead`/`engineer`/`qa`/`retro`), never intermediate `team-*`; it's a presence/shape tripwire (one corrective re-spawn, then `AskUserQuestion`), not a quality review.

```text
^FANOUT_REQUESTED: (review|security:[a-z0-9,\-]+|plan:[a-z0-9,\-]+|test:[a-z0-9,\-]+|implement:[a-z0-9,\-]+|research:[a-z0-9,\-]+)$
```

A first line matching `FANOUT_REQ` but **not** this regex (typos/casing/payload errors, e.g. `FANOUTREQUESTED:`, `FANOUT_REQUESTED: REVIEW`, `FANOUT_REQUESTED: review extra`, `FANOUT_REQUESTED: foo`) is a **BLOCKER** — surface via `AskUserQuestion` with the offending line + the 6 valid shapes (the regex alternatives). Never silently fall through.

## Fanout points (steps 6–13)

**Every fanout point:** (a) honours gated `state.json > fanout_plan.<phase>` (gate-steerable `review`/`security`/`test`/`implement`): `off`→single-pass, `on`→fan out past the heuristic, subject to feasibility guardrails + size-tier (a forced `on` at XS/S → `SIZE_UPGRADE` prompt); no entry → the step's heuristic decides. (b) prefers direct nesting for read/research. (c) appends one `state.json > fanout_log` entry `{phase, eligible, fired, path∈direct|signal|single, n, reason}` (re-read array first, same discipline as `impl_phases_done`) — broader than the gated plan (spec-prep 6 + plan 8 carry no `fanout_plan` key) so `retro` sees gated-intent-vs-actual.

Each shape dispatches **its own** worker set (this table is authoritative); each prompt is **self-contained** (no inherited context) — scope (paths/diff), goal (1 sentence), constraints (what NOT to do), output shape (from `.claude/agents/team-<role>.md`). **Dispatch all workers in one orchestrator message** (concurrent only within one turn; sequential turns aren't parallel).

| Step / shape | Eligible when | Dispatch |
|---|---|---|
| **6 — spec-prep** (main-agent-led, opt-in, no signal) | 2+ of {existing code named, integration points in disjoint surfaces, APIs, security paths, unfamiliar domain terms, 2+ independent research Qs} **and** research substantial; always single-pass XS/S + pure-greenfield | One `team-codebase-explorer` per codebase Q + one `team-best-practice-researcher` per best-practice Q; else main agent interviews off its own read |
| **7 — `research:<question-list>`** (`pm` signal) | pm needs research after drafting | One `team-codebase-explorer` per `codebase-*` Q + one `team-best-practice-researcher` per `best-practice-*` Q. pm returns the signal **after a draft `spec.md`** (draft-first); dispatch, then re-spawn pm to read its draft + findings and refine in place |
| **8 — plan** (`plan:<point-list>` signal + push-prep) | S/M/L existing-code, independently-researchable points clearing the cost bar; single-pass XS / pure-greenfield / one change / **`context_built` (context.md already maps current state — pass its path to `lead`, don't re-spawn explorers)** | **(a) Push-prep (preferred):** before `lead`, one `team-codebase-explorer` (haiku) per integration point for M/L with ≥2 points **in disjoint surfaces**, then spawn `lead` once with findings. **(b) Pull fallback:** `lead` returns the signal for what prep missed (usually best-practice); dispatch the residual `team-best-practice-researcher` (skip explorer for points push-prep mapped) + re-spawn `lead` |
| **10 — `implement:<parallel-phase-list>`** (`engineer` Mode A, **feat-only**) | plan declares ≥2 `Parallelizable: yes` phases | Gate `Type==feat`, verify pairwise-disjoint, write-only phase-engineers (background) → foreground integration engineer. **Full 5-substep consumer contract → `implement-fanout.md > Orchestrator consumer contract`** |
| **11 — `test:<category-list>`** (`qa`) | ≥2 of {unit, integration, e2e} **and** any category has enough tests to repay coordination | One `team-pr-test-analyzer` per category |
| **12 — `review`** (`lead` Mode B) | non-trivial diff (large, cross-module, critical, type/contract/test-sensitive, or uncertain) clearing the cost bar; single-pass small/low-risk | Tiered review workers: **core 3** at M/moderate, **full 6** at L/high-stakes (= `team-code-reviewer`, `team-code-simplifier`, `team-comment-analyzer`, `team-pr-test-analyzer`, `team-silent-failure-hunter`, `team-type-design-analyzer`) |
| **13 — `security:<bucket-list>`** (`lead` Mode C) | ≥2 buckets trip **and** per-bucket work substantial; single-pass one bucket / quick checks | One `team-code-reviewer` per bucket, focused threat-model prompt scoped to that bucket's paths |

**Multi-repo control-plane run (`state.repos` size > 1):** an orthogonal **surface** axis splits test (11)/review (12)/security (13) **per repo** — orchestrator-led, no signal (you know the repo list at dispatch). Full contract → `surface-fanout.md`.

## Registry preflight — decide once, record, thread

`team-*` is **session-scoped**: files created/edited mid-session aren't discoverable until restart, so a spawn can fail `Agent type 'team-<role>' not found`. Handle **once per run**; **never let `not found` retreat to single-pass**.
- **First `team-*` dispatch is the probe** → record `state.json > team_registry`: `"live"` if it resolves, `"inline-fallback"` on `not found` (no fanout → stays `null`); later fanouts read it without re-probing.
- **On `inline-fallback`, reissue inline** — every spawn `subagent_type="general-purpose"` + `model="sonnet"` (Case 6 blocks an unpinned general-purpose spawn; the sonnet floor governs the fallback even for a `haiku`-tier role) + the worker's role contract (`.claude/agents/team-<role>.md`) read into the prompt; parallelism preserved (one message, N calls); record actual `subagent_type` per spawn for the `Dispatched-as:` map.
- **Thread it** — every `pm`/`lead`/`qa` spawn carries `team_registry: <live|inline-fallback|unknown>`. (`engineer`'s implement helpers are `engineer`-type — registry-exempt; pass it to `engineer` only if it may recruit read-only `team-*` helpers.) While `unknown`, the worker tries `team-*`, falls to inline on `not found`, **reports the path used**; on any such return while `null`/`unknown`, write that value before the next spawn. Session restart also refreshes the registry (user action). Full caveat: `.claude/skills/fanout-team-agents/SKILL.md > Operational caveats`.

## Re-spawn for synthesis

When every worker returns, re-spawn the calling sub-agent (`pm`/`lead`/`qa`/`engineer`) with: the workers' outputs concatenated (one labelled block each); a `Dispatched-as:` map (`team-<role> → <actual subagent_type>`) for the mandatory provenance line on each `### team-<role>` subsection (`.workflow/_templates/review.md > Per-agent findings`); and only genuinely **prompt-only** context (the re-spawn inherits none — prefer durable artifacts: `pm` re-reads its draft `spec.md`; `lead`/`qa`/`engineer` disk inputs carry requirements, so re-pass only e.g. review findings being addressed). The re-spawned sub-agent does the synthesis (spec discovery / plan current-state + research notes; per-agent sections + its own plan-adherence/AC/coverage/integration pass).
