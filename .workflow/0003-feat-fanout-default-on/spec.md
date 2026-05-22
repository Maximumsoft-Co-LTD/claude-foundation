# Spec: Fanout default-on at safe parallel points

**ID**: 0003-feat-fanout-default-on
**Type**: feat
**Date**: 2026-05-22
**Status**: draft
**Ship as**: one-drop
**Parent**: none
**Open PR on ship**: no

## Goal
Make `/dev`'s fanout default-on at the two safe parallel points (plan-explore for S+ existing-code plans, and a new `research:<question-list>` shape used during interview prep) so a `/dev` run feels like a small dev team working in parallel instead of an opt-in trigger that almost never fires.

## Users
Single user (the maintainer of this repo) running `/dev` against existing codebases. Personal workflow — no multi-user / no team-coordination concerns. Same context as `0002-feat-fanout-team-research`.

## Scope

**In**:
- **Plan-explore default-on**: rewrite `lead.md > Mode A > step 9` so plan-mode fanout fires by default for plan size `∈ {S, M, L}` AND existing code present. Today's gating phrase ("≥ 2 disjoint integration points") is replaced with "default-on; skip only XS or pure-greenfield".
- **Research shape**: add a fifth fanout payload `research:<question-list>` to the allowlist regex in `.claude/orchestrator.md > Fanout dispatch` and document it in `.claude/skills/fanout-team-agents/SKILL.md > When to use`. Caller set: the main agent at step 6 interview-prep when user intent is ambiguous; `pm` sub-agent may also signal it (pm can't dispatch directly — it returns the signal for the orchestrator to dispatch, then the orchestrator re-spawns pm with the workers' findings appended to the interview Q&A).
- Trigger-phrase harmonisation between `lead.md`, `SKILL.md`, and `orchestrator.md` for the plan-explore row (no longer "≥ 2 disjoint", just "default-on for S+ existing-code").
- "Default = single-pass" prose at `lead.md > Mode A > step 9` is replaced with "Default = fanout for S+ existing-code plans".

**Out (non-goals)**:
- **Mid-implement reviewer fanout** (dropped during interview Q1) — the existing step 5 review fanout (lead Mode B) already covers this. No new dispatch is added between step 4 and step 5.
- **F0004** (`implement:<phase-list>` race with `state.json` Case 3 guard) — explicitly out; that's its own run.
- **F0002** (single source of truth for the `FANOUT_REQUESTED:` allowlist regex) — duplication continues; this run *adds* a payload shape consistently to both places, it does not fix the SoT problem.
- **F0015** (trigger-heuristic phrasing normalised across all 5 fanout callsites) — only the plan-explore row's phrase is updated here; the other rows' phrasing drift is left as-is.
- Backwards-compat shims for the previous opt-in phrasing — the change is a hard cut (the old phrase is removed, not aliased).
- `.workflow/_templates/spec.md` template changes — none; the work is in workflow files only.

## Acceptance criteria

- [x] **AC1** — `lead.md > Mode A > step 9` no longer contains the phrase "Default = single-pass" or the "≥ 2 disjoint integration points" trigger; it instead reads "Default = fanout for plan size ∈ {S, M, L} AND existing code present; skip for XS and pure-greenfield". (Verifiable: `grep -n "Default = single-pass" .claude/agents/lead.md` returns 0 matches; `grep -n "Default = fanout for S" .claude/agents/lead.md` returns ≥ 1 match.) — evidence: `.claude/agents/lead.md:52`; "Default = single-pass" → 0 matches; "Default = fanout for plan size" → 1 match on line 52.
- [x] **AC2** — `.claude/skills/fanout-team-agents/SKILL.md > When to use` table's Plan row reflects default-on with the same trigger phrasing as `lead.md` (XS / pure-greenfield = skip; everything else = default). (Verifiable: grep the SKILL.md row for the new phrasing.) — evidence: `.claude/skills/fanout-team-agents/SKILL.md:31` reads "default-on for plan size ∈ {S, M, L} AND existing code; skip XS / pure-greenfield".
- [x] **AC3** — `.claude/orchestrator.md > Fanout dispatch` allowlist regex is `^FANOUT_REQUESTED: (review|security:[a-z0-9,\-]+|plan:[a-z0-9,\-]+|test:[a-z0-9,\-]+|implement:[a-z0-9,\-]+|research:[a-z0-9,\-]+)$` (research shape added as the 6th alternation). (Verifiable: grep `orchestrator.md` for `research:`.) — evidence: `.claude/orchestrator.md:100` and mirror at `.claude/skills/fanout-team-agents/SKILL.md:153`.
- [x] **AC4** — `.claude/orchestrator.md > Fanout dispatch > documented payload shapes` table has a new row for `research:<question-list>` naming the caller set (main agent at Phase 1 step 1 interview-prep, pre-spec; pm sub-agent via return-signal). The row documents the pm-can't-dispatch-directly mechanism: pm returns `FANOUT_REQUESTED: research:<…>`, orchestrator dispatches, orchestrator re-spawns pm with the findings appended to the interview Q&A. — evidence: `.claude/orchestrator.md:114` (table row) and `.claude/agents/pm.md:75` (pm-side return-signal clause; precedence clause at `pm.md:67`).
- [x] **AC5** — `.claude/skills/fanout-team-agents/SKILL.md > When to use` table has a new row for `research:<question-list>` matching AC4. The row notes that research workers are `general-purpose` (no `team-<role>` constraint). — evidence: `.claude/skills/fanout-team-agents/SKILL.md:34` (When-to-use row) and `.claude/skills/fanout-team-agents/SKILL.md:60` (shapes block).
- [x] **AC6** — `WORKFLOW.md > Fanout availability` paragraph is updated so the plan-mode line no longer says "opt-in per integration point" — it says "default-on for plan size ∈ {S, M, L} AND existing code; opt-in research probes during interview prep". (Verifiable: grep `WORKFLOW.md` line 88.) — evidence: `WORKFLOW.md:88`; "opt-in per integration point" → 0 matches; "default-on for plan size ∈ {S, M, L} AND existing code" → 1 match on line 88 (canonical phrase aligned with `.claude/agents/lead.md:52`, `.claude/skills/fanout-team-agents/SKILL.md:31`, `.claude/orchestrator.md:111`).
- [x] **AC7** — `.workflow/_templates/spec.md` is unchanged in the diff. (Verifiable: `git diff .workflow/_templates/spec.md` is empty.) — evidence: `git diff -- .workflow/_templates/spec.md` returns empty output.
- [x] **AC8** — The `research:<question-list>` shape is documented in at least 2 places (SKILL.md + orchestrator.md). The duplication with the regex SoT problem (F0002) is *acknowledged in retro*, not fixed. — evidence: documented at `.claude/orchestrator.md:100,114` AND `.claude/skills/fanout-team-agents/SKILL.md:34,60,153`. F0002 acknowledgment is a retro-phase deliverable.
- [x] **AC9** — A "smoke-evidence" line in `retro.md` records the trigger phrase grep results from AC1/2/3/4/6 AND AC4 pm-side (the 9-step grep set: plan steps 1, 2, 3, 4, 5, 6, 7, 8, 9 — including pm.md:73's `FANOUT_REQUESTED: research:` clause) so a future regression at any of those sites is bisectable. (No runnable test — the workflow files are prose, not code.) — evidence: grep commands in plan step 11 verify-clause now covers all 9 plan steps; output to be captured in retro phase per plan step 11.

## Constraints

**Integration points (existing code — this run is workflow-file edits, not new code)**:
- `.claude/agents/lead.md > Mode A > step 9` — the plan-explore fanout trigger phrasing.
- `.claude/agents/pm.md` — only if pm needs an explicit "you may return `FANOUT_REQUESTED: research:<…>` when interview answers are insufficient" clause. If the existing return-signal mechanism already covers it, no change.
- `.claude/orchestrator.md > Fanout dispatch` — allowlist regex AND the documented-payload-shapes table.
- `.claude/skills/fanout-team-agents/SKILL.md > When to use` — Plan row update + new Research row.
- `WORKFLOW.md > Fanout availability` (line ~88) — phrasing update.

**Tech stack**: N/A — this run edits markdown workflow/agent/skill files; no code, no schema, no migrations, no tests beyond `grep` smoke-evidence.

**Compliance / dependencies**: none. No external systems. Single-user / personal workflow.

## Carried-over follow-ups

None. User chose `ไม่ fold อะไร — scope แคบไว้` at the interview (Q3).

## Open questions

- **OQ1** — Confirm the precise mechanism for `pm` to dispatch `research:<question-list>`. Intent says "main agent หรือ pm" (both). Main agent can call `Agent` directly; pm cannot (sub-agent constraint). The mechanism therefore must be: pm returns `FANOUT_REQUESTED: research:<…>` as its `BLOCKER`-style signal, orchestrator dispatches the workers, orchestrator re-spawns pm with the worker findings appended to the interview Q&A. **Lead must confirm this is exactly what `pm.md` already supports, or add the clause in plan**. This is captured in AC4 but the wording in `pm.md` (if any edit is needed there) is up to lead.
- **OQ2** — `Open PR on ship: no` was the user's explicit answer (Q4), matching the 0002 pattern. No follow-up needed from the gate.
- **OQ3** — Tighten the XS / pure-greenfield definition. "XS" today is informal in `lead.md`; lead should either (a) accept the same informal threshold or (b) write a one-line definition next to the new trigger phrase. Pick one at plan time.
