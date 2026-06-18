# Orchestrator reference — Fanout dispatch

> Loaded on demand by the main agent (`.claude/orchestrator.md`). Open this only when a worker returns a `FANOUT_REQUESTED:` first line, or when the run's changed-repo set is > 1. A single-repo XS/S run with no fanout signal never needs it.

## Fanout dispatch

The main agent and `pm`/`lead`/`qa`/`engineer` can request parallel team-agent fanout (spec research, plan integration points, review, security buckets, test categories, implement phases). Full pattern: `.claude/skills/fanout-team-agents/SKILL.md`; this is the orchestrator's consumer-side contract.

**Direct nesting is the primary path (v2.1.172+).** `pm`/`lead`/`qa`/`engineer` + self-splitting `team-*` hold `Agent` and **self-dispatch helpers directly** (each has a "Recruit help…" section), so a worker may already have fanned out. The `FANOUT_REQUESTED:` contract below is the **fallback** — when a worker prefers you to dispatch, plus the **background implement-fanout** path (phase-granular `impl_phases_done` resume). You still lead **plan-prep push (step 8)** — `lead` dedups against it.

**Prefer direct nesting for read/research fanouts (plan/review/security/test) — it's cheaper.** The signal path is a *double spawn* (worker → `FANOUT_REQUESTED:` → you dispatch → re-spawn worker to synthesise); direct nesting collapses that to one spawn. A fanout too expensive via the signal path fires **via direct nesting**, never drops to single-pass. The signal earns its keep for **background implement-fanout** and as the **registry-fallback**.

### Surface (per-repo) fanout — orchestrator-owned outer loop, no signal

The lens axis (6 review workers / security buckets) and category axis (test categories) split **one repo's** work. A **multi-repo control-plane run** adds a third, orthogonal axis: **surface** — split the read-and-judge phases **review (11), security (12), test (13)** **per repo** so N repos read in parallel. This is **never a `FANOUT_REQUESTED:` signal** — you know the repo list from `state.repos` at dispatch time, so you lead it via **one Surface-coordinator spawn** that nests the per-repo helpers itself. (**Retro (16)** reads across repos too but is **multi-repo-aware single-pass, not surface-fanned** — it synthesises the unified per-repo artifact sections and holds no `Agent`.)

Mechanics (full per-step detail in steps 11/12/13):

- **When.** The changed-repo set (repos in `state.repos`, else `[repo_root]`, this run changed) has size > 1. Size ≤ 1 → single-repo path. (Security narrows to the subset that trips sensitive paths — the *security-review set*.)
- **Dispatch (coordinator nests — foreground, no Case 3, no background).** Spawn **one** foreground `lead` (review/security) / `qa` (test) in its **Surface-coordinator variant**, passing the changed (or tripping) repo list. It **direct-nests one per-repo helper per repo** — `subagent_type="general-purpose"` carrying the agent's **Per-repo variant** contract inlined, scoped via `repo_root=<r>`, **foreground, one message** — then synthesises. Helpers are `general-purpose` **on purpose**: a foreground same-message batch of the 5 /dev-worker types self-blocks on the 2nd spawn under `dev-agent-guard.sh` Case 3, but `general-purpose` falls through it (like the lens axis's `team-*`). **Cap 6** nested helpers; group beyond.
- **No naive composition with the lens/category axes.** Per-repo reviewers/testers are **single-pass** by default — don't nest the 6-lens or per-category fanout inside each (6×N agents). Reserve the inner axis for a single non-trivial repo, within the concurrency cap.
- **Synthesis (same coordinator spawn — no re-spawn).** The coordinator writes the single unified `review.md`/`security.md`/`tests.md` with one `### Repo: <path>` subsection per repo + the global anti-bias / AC-coverage walk (security aggregates `fix-required` iff any repo has a `high`). Note `Dispatched-as: general-purpose` provenance. **Aggregate verdict/status = pass/passing iff every repo passes.** **You** write `state.json` on return. The cycle counter bumps **once per fanout, per run** — never per repo. (Degradation: a coordinator that can't nest reviews the repos sequentially itself, single-pass.)
- **Coupled-change coherence (the one cross-repo check).** Surface fanout's premise is *separate trees, zero shared state* — true for an **independent** change. A **coupled** change (changed repos share a contract this change touches — a proto/schema/IDL bump, a shared client/server signature) breaks it: each helper sees only its own repo and **can't catch a cross-repo skew** (repo A on v2.1, repo B on v2.0). So on a coupled change the coordinator's **synthesis runs a cross-repo coherence check** — the shared contract must be consistent across all repos; a mismatch is **blocking**. An independent change skips it. Same gap in test — qa's synthesis confirms a cross-repo integration test covers the boundary.
- **Non-primary-repo findings dead-end (all three phases).** `engineer`/ship are scoped to `repo_root`, so a blocking review finding / failing test / `high` in a **non-primary** repo has **no auto-fix path** — surface via `AskUserQuestion`, never route to `engineer`. Never downgrade a real `high` to fit the boundary.
- **Resume is fanout-granular, not per-repo.** Review/security/test write no code, so a mid-fanout `--resume` re-runs the whole per-repo batch — there's no `*_repos_done` analog to `impl_phases_done`.

Scope boundary (intentional): surface fanout parallelises only the **read-and-judge** phases + retro's read. The write/ship side (branch/implement/gate/commit) stays single-`repo_root`.

### Recognising the signal

After every sub-agent return, scan the **first line**: (a) case-insensitive `FANOUT_REQ` → fanout signal (validate below); (b) `BLOCKER:` → surface to user; (c) `SIZE_UPGRADE:` → `## Size-aware execution > Size upgrade`; (c′) `FIELD_UPGRADE:` → `## Size-aware execution > Field classification` (record `field=brownfield`, backfill the understand/lock artifacts to their owners); (d) else → success. Before advancing, run the step's **Return check** if defined — **only** on the step's primary worker return (`pm`/`lead`/`engineer`/`qa`/`retro`), never on intermediate `team-*` workers. A Return check is a presence/shape **tripwire**, not a quality review — it fires at most **one** corrective re-spawn, then escalates via `AskUserQuestion`. Validate a fanout signal against the strict allowlist:

```text
^FANOUT_REQUESTED: (review|security:[a-z0-9,\-]+|plan:[a-z0-9,\-]+|test:[a-z0-9,\-]+|implement:[a-z0-9,\-]+|research:[a-z0-9,\-]+)$
```

A first line matching `FANOUT_REQ` but **not** the strict regex (typos, casing, payload-shape errors — `FANOUTREQUESTED:`, `Fanout_Requested:`, `FANOUT_REQUESTED:review`, `FANOUT_REQUESTED: REVIEW`, `FANOUT_REQUESTED: review extra`, `FANOUT_REQUESTED: foo`) is a **BLOCKER** — surface via `AskUserQuestion` with the offending line + the 6 valid shapes. Never silently fall through to non-fanout.

### The 6 documented payload shapes

| Shape | Trigger phase / mode | Dispatch |
|-------|----------------------|----------|
| `FANOUT_REQUESTED: review` | Phase 2 step 11 — `lead` Mode B (eligible for a genuinely non-trivial diff: large, cross-module, critical, type/contract/test-sensitive, or uncertain; single-pass for small/low-risk diffs and any case that fails the cost bar) | Spawn the tiered review workers against the diff: core 3 for M-tier/moderate risk, full 6 only for L/high-stakes |
| `FANOUT_REQUESTED: security:<bucket-list>` | Phase 2 step 12 — `lead` Mode C (eligible when ≥ 2 buckets trip **and** the per-bucket work is substantial; single-pass for one bucket or quick checks) | One `team-code-reviewer` per bucket with a focused threat-model prompt scoped to that bucket's paths |
| `FANOUT_REQUESTED: plan:<point-list>` | Phase 1 step 8 — `lead` Mode A (eligible for S/M/L existing-code work with independently-researchable points that clear the cost bar; single-pass for XS / pure-greenfield / one straightforward change) | For each point: one `team-codebase-explorer` pass for current state + one `team-best-practice-researcher` pass for current best practices — **but skip the `team-codebase-explorer` for any point the push-based plan-prep already mapped; re-dispatch only the residual `team-best-practice-researcher` (see step 8)** |
| `FANOUT_REQUESTED: test:<category-list>` | Phase 2 step 13 — `qa` (eligible when ≥ 2 of {unit, integration, e2e} AND any category has enough tests to repay coordination) | One `team-pr-test-analyzer` per category |
| `FANOUT_REQUESTED: implement:<parallel-phase-list>` | Phase 2 step 10 — `engineer` Mode A (**feat-only**, eligible when the plan declares ≥ 2 `Parallelizable: yes` phases) | **Gate** on `Type==feat`, then **verify** the named phases' `Files touched (exclusive)` are pairwise-disjoint and every `Depends on` is `none` — refuse + fall back to single-pass engineer otherwise. Dispatch one **write-only** `engineer` (Parallel phase variant) per phase **background, one message** (`run_in_background: true` — `dev-state-mark.sh` skips the marker so no Case-3 self-block; write `state.json` + append `impl_phases_done` as each completion lands). Then foreground-spawn `engineer` in the **Integration variant** to wire shared glue + install deps + run every `verify:` + tick ACs. Resume is **phase-granular** (`impl_phases_done`), not sub-step — a mid-phase interrupt re-runs that phase. |
| `FANOUT_REQUESTED: research:<question-list>` | Phase 1 step 7 — `pm` return-signal, plus step 6 spec-prep fanout from the main agent | One `team-codebase-explorer` per `codebase-*` question and one `team-best-practice-researcher` per `best-practice-*` question. on this fallback path pm returns `FANOUT_REQUESTED: research:<…>` **after writing a draft `spec.md`** (draft-first); orchestrator dispatches, then re-spawns pm to **read its own draft `spec.md`** (digest/Q&A already folded in) plus the findings and refine in place — see step 7. |

### Implement-fanout — orchestrator consumer contract (step 10)

The 5 sub-steps the orchestrator runs on a `FANOUT_REQUESTED: implement:<parallel-phase-list>` return (the `engineer`-side build contracts live in `orchestrator/references/implement-fanout.md`):

1. **Gate.** Refuse unless `Type == feat`. A `fix`/`refactor`/`spike` signalling it is a BLOCKER — re-spawn single-pass (their step-1 ordering forbids parallel disjoint phases).
2. **Verify disjointness (don't trust the declaration).** Read each phase's `**Files touched (exclusive):**` + `**Depends on:**` from `plan.md`. Normalize paths (strip leading `./`; case-fold on case-insensitive FS), compute pairwise intersection; any non-empty intersection or any `Depends on` ≠ `none` → **refuse**, re-spawn one sequential `engineer` (plain Mode A), record `notes: "implement fanout refused — <overlap|dependency edge>"`. A shared barrel/router/DI/lockfile in two phases is this case. (File-level only; a parallel phase importing a symbol *defined in* another's exclusive file isn't visible pre-code — the plan's Scaffold + lead self-review guard it at design time, the integration compile catches it at runtime.)
3. **Dispatch parallel, background, one message.** Spawn one `engineer` per phase (prompt: "Mode A, Parallel phase variant — implement Phase N only; write-only; exclusive files = <set>. Build the `test-plan.md` edge cases for this phase's ACs as you implement; do NOT run tests.") with `run_in_background: true`, in one message. Background launch-acks skip the marker (no Case-3 self-block); completions fire no PostToolUse, so **you** write `state.json` as each lands: **re-read `state.json` first**, append each newly-finished phase to `impl_phases_done` (never regenerate). **Only append a phase whose return listed ≥ 1 changed file** — a zero-file return is a silently-failed phase: `BLOCKER:`, re-spawn, never record it.
4. **Verify actual writes, then integrate (foreground).** Once all return, get **ground-truth** paths with `git -C <repo_root> status --porcelain` (not self-reports). Normalize each (strip `./`; case-fold) and assert each changed source path falls inside **exactly one** phase's `Files touched (exclusive)` set (ignore `.workflow/`; integration glue isn't written yet, so a glue-set or no-set path is a violation). Any path in two sets or outside every set is a silent clobber: **BLOCKER** — surface + re-drive, don't integrate over a lost write. Then spawn `engineer` in the **Integration variant** (prompt = every phase's changed-files + `acceptance:`/`partial:`/`needs-dependency:` lines): wires glue, installs the dependency union, runs every `verify:`, ticks ACs — the single point verify + AC-ticking happen.
5. **Then** run the Diff check + AC-progression check on the integration return (not per phase).

**Resume is phase-granular, not sub-step.** On `--resume` with `step=implement` + non-empty `impl_phases_done`, do **not** re-enter from sub-step 1 — use step 10's **Resume guard** (Integration variant, done = `impl_phases_done`, remaining = parallel − done; it skips sub-step 4's write-intersection, reconciling via present-and-compiles + `git status`). A mid-phase interrupt has no finer resume than the phase.

### The dispatch pattern (parallelism)

Once the signal validates, dispatch **all workers in one orchestrator message** — `Agent` runs them concurrently when multiple invocations appear in one turn. Sequential calls across turns are **not** parallel.

```
# In one orchestrator message — example: the review fanout's full 6-worker tier:
Agent(subagent_type="team-code-reviewer",            description="...", prompt=<focused-prompt-1>)
Agent(subagent_type="team-code-simplifier",          description="...", prompt=<focused-prompt-2>)
Agent(subagent_type="team-comment-analyzer",         description="...", prompt=<focused-prompt-3>)
Agent(subagent_type="team-pr-test-analyzer",         description="...", prompt=<focused-prompt-4>)
Agent(subagent_type="team-silent-failure-hunter",    description="...", prompt=<focused-prompt-5>)
Agent(subagent_type="team-type-design-analyzer",     description="...", prompt=<focused-prompt-6>)
```

Each shape dispatches **its own worker set** (the table is authoritative) — e.g. `plan:<point-list>` sends one `team-codebase-explorer` + one `team-best-practice-researcher` per point, never the review six. Each prompt is **self-contained** (workers inherit no calling context): scope (paths/diff slice), goal (one sentence), constraints (what NOT to do), output shape (from `.claude/agents/team-<role>.md`).

### Registry preflight — decide once, record, thread

The `team-*` registry is **session-scoped**: `team-*.md` files created/edited mid-session aren't discoverable until a restart, so a `team-<role>` spawn can fail with `Agent type 'team-<role>' not found`. Handle this **once per run** (like the no-git decision): decide the path, record it, reuse it, **never let a `not found` retreat to single-pass**.

- **The first `team-*` dispatch is the probe.** Record `state.json > team_registry`: `"live"` if it resolves, `"inline-fallback"` on `not found`. Every later fanout reads this without re-probing. (No fanout → stays `null`.)
- **On `inline-fallback`, reissue inline — don't drop the fanout.** Re-issue every spawn with `subagent_type="general-purpose"` and the worker's role contract (`.claude/agents/team-<role>.md`) read inline into the prompt. Parallelism preserved (one message, N calls). Record the actual `subagent_type` per spawn for the `Dispatched-as:` map. **Single-pass is never the response to a registry miss.**
- **Thread it into splittable-worker prompts, capture what they report.** Every `pm`/`lead`/`qa` spawn carries a `team_registry: <live|inline-fallback|unknown>` line. (`engineer`'s implement-fanout helpers are `engineer`-type — **registry-exempt**; pass `team_registry` to `engineer` only when it may recruit read-only `team-*` helpers.) While `team_registry` is `unknown`, the worker tries `team-*`, falls to inline on `not found`, and **reports the path used** (e.g. `team-registry: inline-fallback`). **Orchestrator:** on any return with such a line while `team_registry` is `null`/`unknown`, write that value before the next spawn.
- **Session restart is the other fix** (refreshes the registry — the user's action). Full caveat: `.claude/skills/fanout-team-agents/SKILL.md > Operational caveats > Agent registry is session-scoped`.

### Re-spawn for synthesis

When every worker returns, re-spawn the calling sub-agent (`pm`/`lead`/`qa`/`engineer`) with:

- The workers' outputs concatenated (one labelled block per worker).
- A `Dispatched-as:` map: `team-<role> → <actual subagent_type>` per worker (for the mandatory `**Dispatched-as**:` provenance line on each `### team-<role>` subsection — `.workflow/_templates/review.md > Per-agent findings`).
- **Re-include prompt-only context the first spawn carried** (the re-spawn inherits none), but prefer durable artifacts. `pm` re-passes nothing requirement-bearing (it re-reads its draft `spec.md`); for `lead`/`qa`/`engineer` the disk inputs already carry requirements, so re-pass only genuinely prompt-only context (e.g. review findings being addressed).

The re-spawned sub-agent does the synthesis (spec discovery notes; plan current-state/research notes; per-agent sections + its own plan-adherence/AC/coverage/integration pass).

### Where fanout fires

**Every fanout point that fires does three things:** (a) **honours any gated `state.json > fanout_plan.<phase>`** (gate-steerable phases only — `review`/`security`/`test`/`implement`) — `off` → single-pass, `on` → fan out past the runtime heuristic, subject to the hard feasibility guardrails **and the size-tier machinery** (a forced `fanout review on` on XS/S becomes a `SIZE_UPGRADE` prompt); absent an entry, the step's own heuristic decides; (b) **prefers direct nesting** over the signal for read/research; (c) **appends one `state.json > fanout_log` entry** `{phase, eligible, fired, path, n, reason}` keyed by phase name (`path` ∈ `direct`/`signal`/`single`), re-reading the array and appending (same discipline as `impl_phases_done`). The log is **broader than the gated plan** — it records every fanout point (spec-prep 6 and plan 8 carry no `fanout_plan` key) so `retro` can surface gated-intent-vs-actual divergence.

The steps that can fire a fanout:

- **Step 6 — Spec prep** — **opt-in** (`## Single-pass-first`): main agent runs the interview off its own read by default; dispatches `team-codebase-explorer`/`team-best-practice-researcher` only when 2+ of {existing code named, integration points in disjoint surfaces, APIs, security paths, unfamiliar domain terms, 2+ independent research questions} hold and the research is substantial. Always single-pass for XS/S and pure-greenfield.
- **Step 7 — Spec** — `pm` may return `FANOUT_REQUESTED: research:<question-list>`.
- **Step 8 — Plan** — **(a) Push-based plan-prep (preferred):** before `lead`, dispatch one `team-codebase-explorer` (haiku) per integration point for M/L existing-code work with ≥ 2 points **in disjoint surfaces**, then spawn `lead` once with the findings. **(b) Pull-based fallback:** `lead` may return `FANOUT_REQUESTED: plan:<point-list>` for what prep missed (typically best-practice research); dispatch the residual workers + re-spawn `lead`.
- **Step 10 — Implement** — `engineer` returns `FANOUT_REQUESTED: implement:<parallel-phase-list>` when the plan declares ≥ 2 `Parallelizable: yes` phases (**feat-only**). Gate on `feat`, verify pairwise-disjoint, dispatch write-only phase-engineers (background) then a foreground integration engineer.
- **Step 11 — Review** — `lead` Mode B may return `FANOUT_REQUESTED: review` for a non-trivial diff clearing the cost bar; writes `review.md` directly for small/low-risk. M → core 3 lenses; full 6 for L/high-stakes.
- **Step 12 — Security** — `lead` Mode C may return `FANOUT_REQUESTED: security:<bucket-list>` when ≥ 2 buckets trip and the work is substantial.
- **Step 13 — Test** — `qa` may return `FANOUT_REQUESTED: test:<category-list>` when ≥ 2 categories AND meaningful volume.
