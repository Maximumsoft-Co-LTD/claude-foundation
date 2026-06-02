# Spec: <title>

**ID**: NNNN-type-slug · **Type**: feat | fix | refactor | chore | docs | spike · **Status**: draft | approved · **Ship as**: one-drop | staged · **Open PR on ship**: yes | no · **Parent**: none | <parent-id>

## Goal
One sentence: what "done" looks like.

## Acceptance criteria
Observable behaviours. Each consequential AC carries one concrete example; edges live as sub-bullets under the AC they edge.

- [ ] AC1: <observable behaviour>
  - e.g.: <real input> → <expected output>  <!-- REQUIRED when the one-line behaviour isn't self-evident; this is where mis-spec'd AC get caught early -->
  - Edge: <only when it changes design>

<!--
Goal + Acceptance criteria are the ONLY always-required sections. Add the sections below ONLY when this task needs them, then DELETE the ones it doesn't (no empty headers, no "N/A"). These triggers are authoritative — pm.md + brainstorming read them. For unresolved bits, embed `[NEEDS CLARIFICATION: <who> — <what>]` inline at the spot it matters; Status can't reach `approved` while any marker remains.

Optional sections — include WHEN:
- Problem — work affects user outcomes / business metrics / unblocks a capability
- Users — multiple actors, or audience non-obvious from Goal
- User journey — `feat` with multi-screen UI (tag each step `[→ AC#]`)
- Scope — Out — adjacent features could be wrongly assumed in-scope
- Non-functional requirements — a measurable target outside the AC (`<attribute>: <target> — measured: <how>`; no aspirational text). DETECTION is REQUIRED for feat/fix shipping a runtime path: the interview MUST ask whether such a target exists. Include this section ONLY if the answer is a real number; otherwise delete it (asking ≠ inventing — a missing-but-needed NFR is the failure mode that passes every consistency scan and only breaks in prod).
- Definition of Done — ship needs steps outside writing code (each item = a concrete artifact plan.md must deliver: telemetry / docs path / rollback flag)
- Reproduction — REQUIRED for Type=fix (numbered steps + **Expected** / **Actual**)
- Timebox — REQUIRED for Type=spike (**Limit** + **Deliverable**: recommendations.md with one named next action)
- Constraints — tech-stack lock / integration boundary / compliance / BC window bounds WHAT we build
- Discovery notes — fanout ran, or pre-spec research changed requirements
- Carried-over follow-ups — this run consumes FOLLOWUPS.md items (list the F-NNN IDs)
-->
