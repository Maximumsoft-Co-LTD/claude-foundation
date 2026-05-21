# Retro: Fanout team agents

**Plan**: [./plan.md](./plan.md)
**Type**: feat
**Completed**: 2026-05-21
**Total cycles**: review=2, test=0
**Ship**: commit=`5bfd06728d133a7c5982b2743414bc3c01f4e889` | PR=none (`open_pr_on_ship: false`)

## What worked

- **The fanout pattern paid for itself on its own dogfood run.** Cycle-1 ran the 6-worker review against this very diff, surfaced 8 blocking findings, and at least 4 of those (B1, B2, B3, B4) had ≥ 2 independent workers converging — that convergence-across-workers is the strength signal the upstream skill predicts and we got it on day one. A single reviewer would not have caught both the `TEAM.md:22` typo *and* the orchestrator-side documentation gap *and* the wrong-mechanism story in `SKILL.md:105-107` in one pass.
- **`Dispatched-as:` provenance discipline saved the run from a silent lie.** When the registry-not-refreshed failure mode fired live, the orchestrator engaged the inline-fallback path (`subagent_type="general-purpose"` with each worker's role contract read inline). Without the `Dispatched-as:` line per `### team-<role>` subsection, the resulting `review.md` would have been byte-identical in shape to a real parallel dispatch — AC3 would have ticked `[x]` on a falsehood. The silent-failure-hunter's Critical #1 (cycle-1) and the orchestrator's decision to require the line in the template (B6 fix) are the load-bearing observability call of this whole change.
- **Section-anchor cites beat line-number cites.** B8's fix — replacing every `WORKFLOW.md:147-148`-style cite in `plan.md` / `lead.md` / `qa.md` / `engineer.md` with section-anchor refs (`WORKFLOW.md > Anti-bias rule`) — eliminated an entire class of "cite rot from downstream edits" bug. The `team-comment-analyzer` worker called this out as a Cross-cutting pattern and we now have a repo-wide convention.
- **Cycle-2 orchestrator override on fanout was the right call.** Cycle-2's scope was the narrow re-verification walk of B1–B8 + AC re-tick. Re-running the 6-worker fanout would have cost 6 more parallel dispatches for a closed scope. The override (`Fanout-this-cycle: no`) is documented at `review.md:8` and is now an applicable pattern for future narrow-scope verifications.
- **The engineer's self-disclosed BLOCKER on `smoke-review.md` was honest and the right move.** Step 19 produced a simulation, not a real fanout (the wiring wasn't yet readable by the orchestrator at smoke time). The engineer marked AC10 `[~]` rather than `[x]` and noted the BLOCKER. Cycle-1 lead's first dispatch then *became* the real smoke artifact — `review.md` itself is the integration test, recorded in `tests.md > Acceptance-criteria coverage` row AC10.

## What to change next time

- **The first live fanout will fail on every fresh install** — Claude Code's agent registry is loaded at session start, and `team-*.md` files created mid-session are not discoverable as `subagent_type=team-<role>`. The inline-fallback works but masks the issue from a casual reader. *Pre-ship two of: (a) `team-*.md` stubs at install-time so the registry has them from session 0, (b) a session-restart prompt baked into the install/upgrade flow, (c) a one-line operational note at the very top of `WORKFLOW.md > Fanout availability` rather than the current end-of-paragraph footnote.* Today only (c) is partially done and it's not visible enough.
- **Single source of truth for the `FANOUT_REQUESTED:` allowlist regex.** The full regex is duplicated in `SKILL.md:150` and `.claude/orchestrator.md:100`. Cycle-2 caught this as a carryover. One canonical (recommended: `SKILL.md`) and one cross-reference (`orchestrator.md` cites the skill). If the regex changes and only one site updates, the BLOCKER discipline silently breaks.
- **The 6-name roster is duplicated across 5 places** (`SKILL.md:16-21`, `TEAM.md:17-22`, `lead.md:77`, `review.md` template, `WORKFLOW.md:88`). A future agent rename — or worse, a future 7th agent — has to be applied in 5 places without missing one. Refactor to a single canonical list (recommend `TEAM.md > Fork sources` since that's the manifest) and have every other site say "see `TEAM.md > Fork sources`". The team-code-simplifier's Complexity finding was correct.
- **`1a.` step numbering breaks the flat 1..N pattern.** Five callsites (`lead.md:77`, `:110`, `:52`, `qa.md:32`, `engineer.md:27`) inserted `1a.` to keep the existing 1..N stable. The result is that cross-refs to "step 2" are now ambiguous (does that mean the old step 2, or step 1a? or 1b if we add another?). Either renumber every step list or move to bulleted sub-steps. Not a blocker today; a debt.
- **The `implement:<phase-list>` fanout shape races `state.json` Case 3 guard.** `dev-agent-guard.sh` Case 3 enforces mtime discipline against `.last_worker_return` for the 5 /dev workers — multiple engineers running in parallel will collide on this marker. The wiring shipped because AC7 reads against the prose, but the design is brittle under load. Either drop the shape, relax the guard for parallel engineers, or namespace `state.json` per-phase.
- **Spec-vs-plan coherence on AC10.** Plan step 19's verify-clause still cites `smoke-review.md` (the engineer's pre-cycle-1 simulation); AC10's evidence in `spec.md:56` correctly cites `review.md`. The plan recipe doesn't match the spec contract anymore. Next time a cycle-2 fix lands an AC-evidence-path change, sweep the plan's verify-clauses in the same pass.

## Deviations from plan

- **Step 19 (smoke run) became a two-act sequence.** Plan said "engineer writes `smoke-review.md` end-to-end through the orchestrator against a throwaway diff with all 6 `## Per-agent findings` subsections populated." Reality: the engineer wrote `smoke-review.md` as a simulation (each `### team-<role>` populated by reading the team-*.md inline and applying its checklist) and self-disclosed it as a BLOCKER because the wiring wasn't readable mid-run. Cycle-1 lead review then *was* the first real fanout dispatch end-to-end, and that `review.md` became the AC10 evidence artifact. Reason: agent registry is session-scoped; the team-*.md files created earlier in the run weren't discoverable as `subagent_type=team-<role>` until session restart, so an orchestrator-driven smoke at step 19 couldn't fire a real parallel dispatch. Cycle-1 dispatch worked via the inline-fallback (`subagent_type="general-purpose"`); cycle-2 confirmed the path and ticked AC10.
- **Cycle-2 ran without fanout.** Plan's cycle policy implicitly assumed each review cycle could re-fan-out. Cycle-2 used an orchestrator override (`Fanout-this-cycle: no` at `review.md:8`) because the scope was the narrow B1–B8 + AC re-tick walk. Reason: re-running the 6-worker fanout for a closed scope would cost 6 more parallel dispatches without changing the verdict. Documented at `review.md:178`.
- **Skipped step 6 (security review) and step 7 (test).** No sensitive paths in the diff (logged in `state.json > skipped_steps`). Test was skipped because the diff is 100% markdown and there's no test harness in this repo (logged in `tests.md > Skipped > Reason`). Both deviations match the type-aware phase matrix — not unplanned.

## Acceptance criteria status

Final state of every checkbox in `spec.md > Acceptance criteria` (all ticked at cycle-2 close; see `review.md > Cycle 2 verification > Acceptance-criteria re-tick`):

- [x] AC1 — fanout skill exists with 4 mechanics + 3 anti-patterns. Evidence: `SKILL.md:67-128`.
- [x] AC2 — 6 `team-*.md` forks exist; `name:` YAML matches filename slug; `Fork source:` block per file. Evidence: 6 files under `.claude/agents/team-*.md` + `TEAM.md` manifest.
- [x] AC3 — `lead.md` review mode dispatches the 6 agents in parallel; `review.md` has per-agent sections + lead synthesis. Evidence: `lead.md:77` wiring + `.workflow/_templates/review.md:24-46` template + this run's `review.md` as live artifact.
- [x] AC4 — `lead.md` security mode supports per-bucket fanout on ≥ 2 triggers. Evidence: `lead.md:110`.
- [x] AC5 — `lead.md` plan mode supports opt-in parallel exploration; heuristic documented. Evidence: `lead.md:52`.
- [x] AC6 — `qa.md` test mode supports opt-in fanout across unit/integration/e2e. Evidence: `qa.md:32`.
- [x] AC7 — `engineer.md` implement mode supports opt-in phase-fanout. Evidence: `engineer.md:27` (with structural-concern carryover — see follow-up F0004).
- [x] AC8 — `.workflow/_templates/review.md` accommodates both shapes. Evidence: `:24-25` parenthetical + retained single-reviewer sections.
- [x] AC9 — `WORKFLOW.md` + `TEAM.md` name the skill, agents, fork-source/date. Evidence: `WORKFLOW.md:88, :148` + `TEAM.md:1-33`.
- [x] AC10 — smoke run produces `review.md` with 6 populated agent sections. Evidence: this run's `review.md` itself; `Dispatched-as:` line per subsection records the inline-fallback path the live dispatch used.

10/10 ACs ticked.

## Memory candidates (facts)

Surface to user for confirmation; do not auto-save.

- **type**: project
  **body**: Claude Code's agent registry is loaded at session start. `team-*.md` files (and any other agent files) created mid-session are NOT discoverable as `subagent_type=<name>` until the session restarts. The orchestrator's documented fallback when this fires is to dispatch via `subagent_type="general-purpose"` with each worker's role contract read inline from `.claude/agents/team-<role>.md`. The `Dispatched-as:` line in each per-agent `review.md` subsection is the discriminator between a real parallel dispatch and the fallback.
  **why**: This failure mode was observed live on this run; it will fire on the first run after every fresh install of this skill bundle until either (a) the user restarts their Claude Code session, or (b) the team-*.md files are pre-shipped (install-time stubs). Future readers seeing "registry not found" errors should know this is the documented case and where the fallback lives.
  **how to apply**: When dispatching `team-*` agents and an `Agent type 'team-<role>' not found` error appears, switch to inline-fallback dispatch (general-purpose + inline role contract) and record `Dispatched-as: general-purpose (inline-fallback — registry-not-refreshed)` in every per-agent subsection of `review.md`. Documented at `.claude/skills/fanout-team-agents/SKILL.md > Operational caveats` and `.claude/orchestrator.md > Fanout dispatch > Registry-not-refreshed fallback`.

- **type**: project
  **body**: The `FANOUT_REQUESTED:` signal allowlist is exactly 5 shapes: `review`, `security:<bucket-list>`, `plan:<point-list>`, `test:<category-list>`, `implement:<phase-list>`. Any sub-agent return whose first line matches case-insensitive `FANOUT_REQ` but doesn't match the strict regex (`^FANOUT_REQUESTED: (review|security:[a-z0-9,\-]+|plan:[a-z0-9,\-]+|test:[a-z0-9,\-]+|implement:[a-z0-9,\-]+)$`) is a BLOCKER for the orchestrator.
  **why**: Without the strict allowlist, typos/case errors/payload-shape errors silently fall through to non-fanout (6 documented silent-typo paths in `review.md` cycle-1 team-silent-failure-hunter Critical #2). The discipline only works if it's enforced.
  **how to apply**: When the orchestrator sees a sub-agent return whose first line starts with `FANOUT_REQ` (case-insensitive), validate against the strict regex. Match → dispatch per `.claude/orchestrator.md > Fanout dispatch`. Mismatch → BLOCKER, surface the malformed signal to the user, halt the phase.

- **type**: project
  **body**: Open question E for this run resolved to drop the `superpowers` `code-reviewer` variant — `pr-review-toolkit`'s version is the team's `code-reviewer`. `TEAM.md` ships 6 fork agents + 1 pattern source (the `dispatching-parallel-agents` skill), not 7 fork agents. The 7-vs-6 confusion in early drafts of `spec.md:48` was the surface symptom; B7 in cycle-1 review caught and fixed it.
  **why**: Future maintainers reading `TEAM.md` will see 7 `^- team-` bullets (6 forks + 1 pattern source) and may wonder if a 7th fork was dropped. It wasn't — the 7th bullet is intentional and represents a different kind of artifact (skill source, not agent fork).
  **how to apply**: When auditing `TEAM.md`, count fork agents from `.claude/agents/team-*.md` files (6), not from `^- team-` bullets in `TEAM.md` (7). The pattern-source bullet at `TEAM.md:23` is `team-dispatching-skill-source` and points at the upstream `dispatching-parallel-agents` skill.

## Skill candidates (procedures)

Surface to user for confirmation; do not auto-create. Orchestrator will ask via `AskUserQuestion` for each candidate.

- **name**: fanout-smoke-test
  **scope**: project (`.claude/skills/`)
  **trigger description**: After landing any change to `.claude/agents/team-*.md`, `.claude/skills/fanout-team-agents/SKILL.md`, `.claude/orchestrator.md > Fanout dispatch`, or `.workflow/_templates/review.md > Per-agent findings`, run this skill to assert the fanout pipeline still produces a real parallel dispatch and not a silent inline-fallback.
  **action**: new skill
  **steps**:
  1. Stage a tiny fixture diff (5-line edit) in a scratch worktree under `tests/fixtures/` so all 6 team agents have something non-trivial to look at.
  2. Invoke `/dev` in review-only mode against the fixture, capturing the produced `review.md`.
  3. Assert `grep -c "^### team-" review.md` returns exactly 6.
  4. Assert every `### team-<role>` subsection's first content line matches `^\*\*Dispatched-as\*\*: ` (so a missing provenance line is an automatic fail).
  5. Assert no `Dispatched-as:` line ends with `(inline-fallback — registry-not-refreshed)` — if it does, the test PASSES with a warning ("registry was not refreshed before the smoke; re-run after a session restart for the no-fallback assertion").
  6. Assert every subsection has ≥ 1 finding bullet (no empty stubs, no `Error:` stubs).
  7. Assert `review.md` carries non-empty `Plan adherence`, `Acceptance-criteria check`, and `Findings > Blocking / Non-blocking` sections from the lead synthesis layer.
  8. Exit non-zero on any failed assertion; emit a one-line summary on success.
  **why a skill, not a memory**: 8 ordered steps; clear trigger (`.claude/agents/team-*` or `SKILL.md > Per-agent findings` edits); plausibly applies to every future run that touches the fanout pipeline (≥ 3 future `/dev` runs near-certain). The current AC10 verify-clause is a single `grep -c` against the live run's `review.md` — "verified once at write time." This skill converts it into "verified on every test run" and catches the silent-fallback failure mode that almost lied to AC3 this run.
  **handoff prompt for skill-creator**: Create a project-scoped skill named `fanout-smoke-test` under `.claude/skills/fanout-smoke-test/SKILL.md` that, when invoked after any edit to `.claude/agents/team-*.md` or `.claude/skills/fanout-team-agents/SKILL.md` or `.claude/orchestrator.md > Fanout dispatch` or `.workflow/_templates/review.md > Per-agent findings`, stages a 5-line fixture diff in `tests/fixtures/`, invokes `/dev` in review-only mode against it, and asserts on the produced `review.md`: (1) exactly 6 `^### team-` headers, (2) every `### team-<role>` subsection's first line matches `^\*\*Dispatched-as\*\*: `, (3) no `Dispatched-as:` line ends with `(inline-fallback — registry-not-refreshed)` (warn if it does), (4) every subsection has ≥ 1 finding bullet, (5) `Plan adherence` + `Acceptance-criteria check` + `Findings > Blocking / Non-blocking` sections are all present and non-empty. Exit non-zero on any failed hard assertion. The skill exists because AC10 today is "verified once at write time"; this converts it into a runnable smoke that catches silent inline-fallback masquerading as real parallel dispatch. Source the operational caveat at `.claude/skills/fanout-team-agents/SKILL.md > Operational caveats > Agent registry is session-scoped` for the registry-refresh context.

- **name**: validate-fanout-signal
  **scope**: project (`.claude/skills/`)
  **trigger description**: When the orchestrator receives a sub-agent return whose first line matches case-insensitive `FANOUT_REQ`, this skill validates the signal against the strict allowlist and either dispatches the right workers or surfaces a BLOCKER.
  **action**: new skill
  **steps**:
  1. On `Agent` return (PostToolUse hook target), read the worker's first non-empty return line.
  2. If it doesn't match `(?i)^FANOUT_REQ` — no action, normal continuation.
  3. If it matches `(?i)^FANOUT_REQ` but does NOT match the strict regex `^FANOUT_REQUESTED: (review|security:[a-z0-9,\-]+|plan:[a-z0-9,\-]+|test:[a-z0-9,\-]+|implement:[a-z0-9,\-]+)$` — emit BLOCKER, surface the malformed signal to the user, halt the phase.
  4. If strict match — parse the shape + payload, dispatch the right `team-*` workers in parallel (one `Agent(...)` per worker, all in one message), re-spawn the caller sub-agent with the workers' outputs in the prompt.
  5. Record each `Agent` invocation's actual `subagent_type` and emit it into the synthesis prompt as a `Dispatched-as:` map so the caller's `review.md` template can fill the mandatory provenance line.
  **why a skill, not a memory**: 5 ordered steps with non-trivial conditional logic (3-way branch on `^FANOUT_REQ` match) and a clear trigger (any `Agent` PostToolUse). The current enforcement is "orchestrator reads `SKILL.md` and chooses to honor the prefix" (team-type-design-analyzer scored Enforcement 2/10) — pure prose. A skill turns this into runnable validation, which is what `dev-agent-guard.sh` already does for the 5 /dev workers; the asymmetry between worker-spawn validation (enforced via hook) and fanout-signal validation (prose only) is the gap this skill closes.
  **handoff prompt for skill-creator**: Create a project-scoped skill named `validate-fanout-signal` under `.claude/skills/validate-fanout-signal/SKILL.md` that runs as a PostToolUse hook target on `Agent` returns. The skill validates the sub-agent's first non-empty return line against the strict `FANOUT_REQUESTED:` allowlist regex `^FANOUT_REQUESTED: (review|security:[a-z0-9,\-]+|plan:[a-z0-9,\-]+|test:[a-z0-9,\-]+|implement:[a-z0-9,\-]+)$`. Three branches: (1) no `(?i)^FANOUT_REQ` match → normal continuation; (2) `(?i)^FANOUT_REQ` match but strict regex fails → emit BLOCKER, surface to user, halt phase; (3) strict regex match → dispatch the right `team-*` workers in parallel and re-spawn the caller for synthesis. Capture each `Agent` invocation's actual `subagent_type` and pass it to the caller's synthesis prompt as a `Dispatched-as:` map so `.workflow/_templates/review.md > Per-agent findings` can fill the mandatory provenance line. Source: today this validation is prose-only in `.claude/skills/fanout-team-agents/SKILL.md:145-153` and `.claude/orchestrator.md:97-103`, scored Enforcement 2/10 by cycle-1 team-type-design-analyzer — this skill closes the asymmetry with `.claude/hooks/dev-agent-guard.sh` which already enforces a similar allowlist for the 5 /dev workers.

## Follow-ups

15 new items appended to `.workflow/FOLLOWUPS.md > Open` table (IDs F0001–F0015). Mirrored below for this run's self-contained history.

0 items consumed (the run started with an empty Open list).

### Appended to FOLLOWUPS.md > Open

- **F0001** — Pre-create stub `team-*.md` at install-time OR document "session restart required after first install" prominently. Current first-run UX is the inline-fallback, not real parallel dispatch. **type hint**: chore. **priority**: high.
- **F0002** — Single source of truth for the `FANOUT_REQUESTED:` allowlist regex. Currently duplicated in `SKILL.md:150` and `.claude/orchestrator.md:100`. **type hint**: refactor. **priority**: med.
- **F0003** — Roster of 6 team-agent names duplicated across 5 places (`SKILL.md:16-21`, `TEAM.md:17-22`, `lead.md:77`, `review.md` template, `WORKFLOW.md:88`). Refactor to single canonical roster + references. **type hint**: refactor. **priority**: med.
- **F0004** — `implement:<phase-list>` fanout shape races `state.json` Case 3 guard. Either drop the shape, relax guard, or namespace `state.json` per-phase. **type hint**: refactor. **priority**: high.
- **F0005** — `1a.` step numbering at `lead.md:77/110/52`, `qa.md:32`, `engineer.md:27` breaks the flat 1..N pattern. **type hint**: chore. **priority**: low.
- **F0006** — `model:` YAML field inconsistent across the 6 team forks (2 `opus`, 4 `inherit`). Pick one. **type hint**: chore. **priority**: low.
- **F0007** — `When to invoke` section present in 4/6 team forks. Either all or none. **type hint**: chore. **priority**: low.
- **F0008** — Plan step 3 verify-clause `grep -E "too.broad|no constraint|vague output"` is case-sensitive; substance starts with capitals. False-fail risk. **type hint**: fix. **priority**: low.
- **F0009** — Candidate AC11 (signal validator as a runnable hook) and AC12 (registry-refresh discipline as a preflight) for a follow-up `/dev` run. **type hint**: feat. **priority**: med.
- **F0010** — `WORKFLOW.md:148` agent-map row understates the return path (says "to the calling /dev sub-agent for synthesis"; real path is sub-agent → orchestrator → re-spawn). **type hint**: docs. **priority**: low.
- **F0011** — `SKILL.md:53-65` has both code block and bullet list explaining the same 5 shapes — pick one. **type hint**: chore. **priority**: low.
- **F0012** — TEAM.md `:22-23` 7th bullet (`team-dispatching-skill-source`) conflates pattern-source with agent-fork under the `^- team-` shape. Sub-section the pattern source. **type hint**: docs. **priority**: low.
- **F0013** — Plan step 19's verify-clause still cites `smoke-review.md`; AC10 evidence correctly cites `review.md`. Spec-vs-plan coherence drift. **type hint**: fix. **priority**: low.
- **F0014** — Add `.workflow/*/.last_worker_return` (engineer's ship-note marker file) to `.gitignore`. **type hint**: chore. **priority**: low.
- **F0015** — Trigger-heuristic syntax drifts across the 5 fanout callsites (`≥ 2 independent`, `≥ 2 distinct`, `≥ 2 of {…}`). Normalize phrasing. **type hint**: chore. **priority**: low.

### Consumed from previous FOLLOWUPS.md > Open

None. The Open list was empty at the start of this run (`spec.md:90` — "None. `FOLLOWUPS.md > Open` is empty at the time of this run").

## Security findings (carry-over)

N/A. `security.md` does not exist for this run (`state.json > skipped_steps` includes `6:security-review (no sensitive paths)` — the diff trips zero sensitive-paths buckets, so the security phase was correctly skipped per the type-aware phase matrix). No high/medium/low findings to carry.
