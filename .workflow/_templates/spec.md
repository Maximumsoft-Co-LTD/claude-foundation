# Spec: <title>

**ID**: NNNN-type-slug · **Type**: feat | fix | refactor | chore | docs | spike · **Status**: draft | approved · **Ship as**: one-drop | staged · **Open PR on ship**: yes | no · **Parent**: none | <parent-id>

## Goal
One sentence: what "done" looks like.

## Acceptance criteria
Observable behaviours — the ONLY requirement that threads spec → plan → qa → review, so every correctness-bearing requirement lives here. That includes measurable perf/security/a11y targets: write the target as an AC whose `verify`/measurement is its `measured:` clause, NOT as a separate untestable section (an NFR that lives only in its own section is orphaned — no plan step, no test, no review row).

- [ ] AC1: <observable behaviour>   <!-- a BEHAVIOURAL AC: carries the two sub-bullets below -->
  - e.g.: <real input> → <expected output>  <!-- REQUIRED for any consequential behavioural AC (behaviour not obvious from the one line); this is where mis-spec'd AC get caught early -->
  - on error / at boundary: <behaviour for bad input, limit hit, or unauthorized caller> — or `none — <explicit default, e.g. returns generic 400>`  <!-- REQUIRED for any consequential behavioural AC. The EARS IF/THEN clause: it RECORDS the unhappy-path decision instead of leaving the implementer to guess it silently (the #1 "runs but does the wrong thing" failure). `none — <default>` is a valid answer; an empty/missing line is not. -->
  - Edge: <only when a further edge changes design beyond the boundary line above>
- [ ] AC2: <measurable perf/security/a11y target> — measured: <command/observable>   <!-- an NFR-class AC: the `measured:` clause IS its verify, so it carries NO e.g./on-error sub-bullets. e.g. "p95 latency < 200ms — measured: k6 load test at 1k rps". This is how a measurable NFR threads through plan/qa/review instead of being orphaned in its own section. -->

<!--
Goal + Acceptance criteria are the ONLY always-required sections. Add the sections below ONLY when this task needs them, then DELETE the ones it doesn't (no empty headers, no "N/A"). These triggers are authoritative — pm.md + brainstorming read them. For unresolved bits, embed `[NEEDS CLARIFICATION: <who> — <what>]` inline at the spot it matters; Status can't reach `approved` while any marker remains.

Optional sections — include WHEN:
- Problem — work affects user outcomes / business metrics / unblocks a capability
- Users — multiple actors, or audience non-obvious from Goal
- User journey — `feat` with multi-screen UI (tag each step `[→ AC#]`)
- Scope — Out — adjacent features could be wrongly assumed in-scope
- Non-functional requirements — an at-a-glance roll-up ONLY; never the home of a target. A measurable perf/security/a11y target is written as an Acceptance criterion above (its `measured:` clause becomes that AC's verify) so it threads through plan/qa/review; this section, if it earns its place, only lists which AC numbers are the NFR-class ones. DETECTION is REQUIRED for feat/fix shipping a runtime path: the interview MUST ask whether such a target exists. On `yes` → add the AC. On `no` → no AC and no section (asking ≠ inventing — a missing-but-needed target is the failure mode that passes every consistency scan and only breaks in prod). Delete this section unless the roll-up genuinely aids readability.
- Definition of Done — ship needs steps outside writing code (each item = a concrete artifact plan.md must deliver: telemetry / docs path / rollback flag). DoD items do NOT thread through AC tags — review walks them separately (see lead.md Mode B), so each item must name a concrete, checkable artifact.
- Reproduction — REQUIRED for Type=fix (numbered steps + **Expected** / **Actual**)
- Timebox — REQUIRED for Type=spike (**Limit** + **Deliverable**: recommendations.md with one named next action)
- Constraints — tech-stack lock / integration boundary / compliance / BC window bounds WHAT we build
- Discovery notes — fanout ran, or pre-spec research changed requirements
- Carried-over follow-ups — this run consumes FOLLOWUPS.md items (list the F-NNN IDs)
-->
