# Review: <title>

**Plan**: [./plan.md](./plan.md) · **Spec**: [./spec.md](./spec.md)
**Reviewed**: YYYY-MM-DD · **Verdict**: pass | fix-required · **Cycle**: 1 of max 2

## Plan adherence *(required)*

One row per plan step — no skipping rows. A deviation needs a one-line reason.

- [x] Step 1 — implemented as planned
- [ ] Step 2 — deviation: <what + why>

## Acceptance-criteria check *(required)*

One row per `spec.md` AC, INCLUDING each `on error / at boundary:` clause and any `measured:` target. Re-verify against the diff + running code (don't trust the checkbox). Any criterion that can't be ticked = **blocking**.

- [ ] Criterion 1 — evidence: `path:line` / behaviour observed
- [ ] Criterion 1 (on error / at boundary) — evidence: `path:line` / behaviour observed

## Non-AC slot check *(required when spec has a Definition of Done or Constraints)*

- [ ] DoD: <item> — concrete artifact present? evidence: `path:line` (missing = **blocking**)
- [ ] Constraint: <constraint> — diff honours it? evidence: `path:line` (violation = **blocking**)

## Findings *(required)*

### Blocking
- `path:line` — issue → suggested fix

### Non-blocking
- `path:line` — note (carried to retro)

## Sign-off *(required)*

pass | fix-required → see Phase 2 step 5

<!--
Fanout-only sections — add when the matching fanout ran:
Per-agent findings (lens-axis: ≥2 review workers on one repo's diff — each `### team-<role>` with `**Dispatched-as**:` first line) ·
Per-repo review (surface-axis: one `### Repo: <path>` per changed repo; AC check / Verdict / Cycle stay global).
Shape + when — Per-agent: lead.md > Mode B (Review); Per-repo: orchestrator/references/surface-fanout.md > Lead — Mode B (Review).
-->
