# Review: <title>

**Plan**: [./plan.md](./plan.md)
**Spec**: [./spec.md](./spec.md)
**Reviewed**: YYYY-MM-DD
**Verdict**: pass | fix-required
**Cycle**: 1 of max 2

## Plan adherence
One row per plan step — no skipping rows. A deviation needs a one-line reason.

- [x] Step 1 — implemented as planned
- [ ] Step 2 — deviation: <what + why>

## Acceptance-criteria check
One row per `spec.md > Acceptance criteria` bullet, INCLUDING each AC's `on error / at boundary:` clause and any `measured:` perf/security/a11y target (these are checkable assertions, not optional). `engineer` ticks these; `lead` re-verifies against the diff and the running code. Any criterion that can't be ticked here is a **blocking** finding.

- [ ] Criterion 1 — evidence: `path:line` / behaviour observed
- [ ] Criterion 1 (on error / at boundary) — evidence: `path:line` / behaviour observed

## Non-AC slot check
DoD items and Constraints do NOT thread through AC tags, so they get their own walk here or they ship unchecked. Delete this section only when the spec has neither a `Definition of Done` nor a `Constraints` section.

- [ ] DoD: <item> — concrete artifact present? evidence: `path:line` / file exists (missing artifact = **blocking**)
- [ ] Constraint: <constraint> — diff honours it? evidence: `path:line` (violation, e.g. banned dependency or crossed integration boundary = **blocking**)

## Findings

### Blocking
- `path:line` — issue → suggested fix

### Non-blocking
- `path:line` — note (carried to retro)

## Sign-off
pass | fix-required → see Phase 2 step 5

<!--
The sections above are always required. Add the section below ONLY when the review-mode fanout ran (see fanout-team-agents/SKILL.md):

## Per-agent findings
One `### team-<role>` subsection per worker dispatched. `lead`'s synthesis stays in Findings above; this is the evidence trail. MANDATORY first line of every subsection: `**Dispatched-as**: <subagent_type>` (or `general-purpose` + a one-phrase reason if the fallback fired) — the orchestrator passes the Dispatched-as map into synthesis (orchestrator.md > Fanout dispatch). Without it a reader can't tell a real team-<role> dispatch from the inline fallback (both produce byte-identical artifact shapes).
  ### team-<role>
  **Dispatched-as**: `team-<role>`
  - `path:line` — finding
-->
