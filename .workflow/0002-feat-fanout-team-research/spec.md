# Spec: Fanout team agents

**ID**: 0002-feat-fanout-team-research
**Type**: feat
**Date**: 2026-05-21
**Status**: approved
**Ship as**: one-drop
**Parent**: none
**Open PR on ship**: no

## Goal
Bring the "fanout team agents" pattern in-house as a local skill, embed the team agents (6 from `pr-review-toolkit` + the `code-reviewer` from `superpowers`) under `.claude/agents/`, and wire the pattern into the `/dev` workflow phases where parallel sub-investigations are independent (review, security, plan, test, implement).

## Users
AI engineers running this `claude-foundation` repo's `/dev` workflow. The change is internal tooling — the orchestrator and its sub-agents (`lead`, `qa`, `engineer`) are the direct consumers; the human running `/dev` benefits indirectly via faster, more thorough review/plan/test passes.

## Scope

**In**:
- New skill at `.claude/skills/fanout-team-agents/SKILL.md` codifying the pattern (independent domains → focused agent prompts with self-contained context → parallel dispatch → integration), including the anti-patterns from the source (too-broad prompts, no constraints, vague output).
- Embed local copies of 7 team agents under `.claude/agents/` (naming convention TBD — see Open questions):
  - `code-reviewer` (from `superpowers` and/or `pr-review-toolkit`)
  - `code-simplifier`
  - `comment-analyzer`
  - `pr-test-analyzer`
  - `silent-failure-hunter`
  - `type-design-analyzer`
- Wire fanout into `.claude/agents/lead.md` **review mode** (Phase 2 step 5): lead dispatches all 6 pr-review-toolkit agents in parallel, then synthesises a single `review.md` with per-agent sections plus lead's own plan-adherence + acceptance-criteria verification.
- Wire fanout into `.claude/agents/lead.md` **security mode** (step 6): fan out per sensitive-paths bucket when the diff trips ≥ 2 distinct trigger categories.
- Wire fanout into `.claude/agents/lead.md` **plan mode** (Phase 1 step 2): opt-in parallel codebase exploration when `spec.md > Constraints` lists ≥ 2 independent integration points.
- Wire fanout into `.claude/agents/qa.md` **test mode** (step 7): opt-in fanout of test categories (unit / integration / e2e) in parallel.
- Wire fanout into `.claude/agents/engineer.md` **implement mode** (step 4): opt-in fanout of independent plan slices.
- Update `.workflow/_templates/review.md` (or document a per-agent-section convention) so the fanout output absorbs cleanly without breaking single-reviewer runs.
- Doc updates: short note in `CLAUDE.md` (or a dedicated `.claude/agents/TEAM.md`) recording that the team agents are locally owned forks of `superpowers` + `pr-review-toolkit`, with the source paths and version/date pulled at fork-time so future drift is visible. Cross-link the new skill from `WORKFLOW.md` where the relevant phases are described.

**Out (non-goals)**:
- No new functionality outside the listed phases — this is plumbing, not new product behaviour.
- No upstream PR back to `superpowers` or `pr-review-toolkit`.
- No live `reference` of the source plugins at runtime — the embedded copies are the source of truth inside this repo.
- No new cross-project install scripts; `install.sh` only gets a light touch if it explicitly enumerates agents today.
- No changes to the 5 `/dev` worker sub-agents' core responsibilities (`pm`, `lead`, `engineer`, `qa`, `retro`) — fanout is a capability added to existing modes, not a sixth driver.
- No automatic always-on fanout for plan/test/implement modes — those stay opt-in to avoid spinning up parallel agents on trivial runs.

## Acceptance criteria
Observable behaviours. `engineer` ticks these as they land; `lead` re-checks during review; `qa` maps each to a specific test in `tests.md`.

- [x] AC1: `.claude/skills/fanout-team-agents/SKILL.md` exists and documents the pattern: independent-domain identification, focused-prompt construction with self-contained context, parallel dispatch mechanics, and findings integration. Anti-patterns section names the same three failure modes the upstream skill calls out. — evidence: `.claude/skills/fanout-team-agents/SKILL.md:67-128` (4 mechanics sections + anti-patterns at 124-128, three failure modes named with capital starts: "Too broad prompts" / "No constraints" / "Vague output shape").
- [x] AC2: All 6 `pr-review-toolkit` team agents exist under `.claude/agents/` (final naming per Open question A — `team-<role>` prefix) as local files. Each opens cleanly without referencing the source plugin paths. — evidence: Open question E resolved to drop the `superpowers` `code-reviewer` variant (recorded in `TEAM.md > Fork sources`); the 6 forks ship at `.claude/agents/team-{code-reviewer,code-simplifier,comment-analyzer,pr-test-analyzer,silent-failure-hunter,type-design-analyzer}.md`. Each has its `name:` YAML renamed to match the filename slug and a `Fork source:` block at top of body.
- [x] AC3: `.claude/agents/lead.md` review mode, when invoked, dispatches the 6 pr-review-toolkit agents in parallel and produces a single `review.md` with one section per agent plus a synthesis section from lead covering plan-adherence and `spec.md > Acceptance criteria` verification. — evidence: `.claude/agents/lead.md:77` (Mode B step 1a — `FANOUT_REQUESTED: review`) wires the dispatch; `.workflow/_templates/review.md:24-46` carries the 6 `### team-<role>` subsections lead synthesises into.
- [x] AC4: `.claude/agents/lead.md` security mode supports per-bucket fanout when the diff trips ≥ 2 distinct sensitive-paths triggers; single-trigger diffs still use the existing single-pass flow. — evidence: `.claude/agents/lead.md:110` (Mode C step 1a — `FANOUT_REQUESTED: security:<bucket-list>`).
- [x] AC5: `.claude/agents/lead.md` plan mode supports opt-in parallel codebase exploration; the opt-in heuristic ("≥ 2 independent integration points in `spec.md > Constraints`") is documented in the agent file. — evidence: `.claude/agents/lead.md:52` (Mode A step 9 — `FANOUT_REQUESTED: plan:<point-list>` with the integration-points-must-share-no-files-or-symbols heuristic).
- [x] AC6: `.claude/agents/qa.md` test mode supports opt-in fanout across unit / integration / e2e categories; default single-pass behaviour is preserved when fanout is not requested. — evidence: `.claude/agents/qa.md:32` (step 1a — `FANOUT_REQUESTED: test:<category-list>` with the "≥ 2 categories AND any category ≥ 3 tests" heuristic; default = single-pass).
- [x] AC7: `.claude/agents/engineer.md` implement mode supports optional fanout of independent plan slices; the opt-in trigger is documented. — evidence: `.claude/agents/engineer.md:27` (Mode A step 3 sub-bullet — `FANOUT_REQUESTED: implement:<phase-list>` with the L-tier + Phases + disjoint Files-touched heuristic).
- [x] AC8: `.workflow/_templates/review.md` accommodates the new per-agent-section shape AND remains valid for single-reviewer (no-fanout) runs. — evidence: `.workflow/_templates/review.md:23-24` ("## Per-agent findings" heading + "(present only when fanout ran; omit for single-reviewer runs)" parenthetical); existing `Plan adherence`, `Acceptance-criteria check`, `Findings > Blocking / Non-blocking` sections retained.
- [x] AC9: `WORKFLOW.md` and `CLAUDE.md` (or `.claude/agents/TEAM.md`) name the new skill, the embedded team agents, and a fork-source/date note for drift awareness. — evidence: `WORKFLOW.md > Type-aware phase matrix > Fanout availability` paragraph (names the skill + 6 team agents + TEAM.md + the session-restart operational note), `WORKFLOW.md > Agent map > team-* row` (agent-map row for the workers), `.claude/agents/TEAM.md > Fork sources` (manifest with `Fork date: 2026-05-21` and per-agent source paths). Spec mentioned CLAUDE.md as alternative; Open question D resolved to TEAM.md instead.
- [x] AC10: A smoke run of `/dev` review mode against a small diff produces a `review.md` with all 6 agent sections populated (not empty, not error stubs). — evidence: `.workflow/0002-feat-fanout-team-research/review.md` is the first real orchestrator-driven fanout artifact for this run. It contains all 6 `### team-<role>` subsections, each carrying a `Dispatched-as:` provenance line and non-empty findings (verify-clauses pass: `grep -c "^### team-"` returns 6; every section has ≥ 1 finding bullet). The workers were dispatched via the inline-fallback route (`subagent_type="general-purpose"` with each worker's role contract read from `.claude/agents/team-*.md`) because the agent registry is session-scoped and the `team-*.md` files created mid-session were not yet discoverable as `subagent_type=team-<role>`; this is the documented operational caveat in `.claude/skills/fanout-team-agents/SKILL.md > Operational caveats > Agent registry is session-scoped`, not a defect of the wiring. A session-restart re-run will use the direct `team-<role>` dispatch path; the `Dispatched-as:` line makes which path ran visible to any future reader.

**Sequencing hints for `plan.md`**:
- AC1 (skill) and AC2 (agents copied in) are prerequisites for AC3–AC7 (wiring).
- AC8 (template) can land in parallel with AC3.
- AC9 (docs) should land last so the references are accurate.
- AC10 (smoke run) is the integration check — runs last.

## Constraints
**Source-plugin paths (for reference at fork-time; runtime stays local-only):**
- `~/.claude/plugins/cache/claude-plugins-official/superpowers/5.0.7/skills/dispatching-parallel-agents/SKILL.md` — pattern source.
- `~/.claude/plugins/cache/claude-plugins-official/superpowers/5.0.7/agents/code-reviewer.md` — superpowers' code-reviewer.
- `~/.claude/plugins/marketplaces/claude-plugins-official/plugins/pr-review-toolkit/agents/` — directory housing the 6 review agents (`code-reviewer.md`, `code-simplifier.md`, `comment-analyzer.md`, `pr-test-analyzer.md`, `silent-failure-hunter.md`, `type-design-analyzer.md`).

**Destination paths inside this repo:**
- Skill → `.claude/skills/fanout-team-agents/SKILL.md` (slug may be renamed by plan if a better one fits; see Open question A).
- Team agents → `.claude/agents/<team-agent-files>` (folder vs. prefix convention TBD — see Open question A).

**Integration points (existing files plan will touch — non-exhaustive; `plan.md` resolves to `path:line`):**
- `.claude/agents/lead.md` (plan / review / security modes)
- `.claude/agents/qa.md` (test mode)
- `.claude/agents/engineer.md` (implement mode)
- `.claude/orchestrator.md` (if fanout decisions need orchestrator-side wiring)
- `WORKFLOW.md` (phase matrix prose, agent map)
- `.workflow/_templates/review.md` (per-agent-section accommodation)
- `.workflow/_templates/plan.md` (optional — if a fanout flag belongs in the plan)
- `CLAUDE.md` or new `.claude/agents/TEAM.md` (fork-source/date note)
- `install.sh` (light touch only if it enumerates agents today)

**Compliance / hygiene:**
- Naming for embedded agents must not collide with the 5 `/dev` workers (`pm`, `lead`, `engineer`, `qa`, `retro`). The `code-reviewer` agent must not be confused with `lead` in review mode — `lead` remains the synthesiser/owner of `review.md`; the embedded `code-reviewer` is one of the fanned-out workers.
- Forks must record source version (`superpowers 5.0.7`) and fork date so drift is auditable.

## Carried-over follow-ups
None. `FOLLOWUPS.md > Open` is empty at the time of this run.

## Open questions
Things to confirm before planning. Empty when status = `approved`.

All gate / plan-time open questions are resolved (A→prefix, B→one-drop, C→commit-only, D→`.claude/agents/TEAM.md`, E→pr-review-toolkit). See `plan.md > Approach > Resolved Open questions` for the full rationale.
