# Spec: <title>

**ID**: `NNNN-type-slug`

**Type**: feat | fix | refactor | chore | docs | spike

**Status**: draft | approved

**Ship as**: one-drop | staged

**Open PR on ship**: yes | no

**E2E + visual**: off | on

**Parent**: none | `<parent-id>`

## Outcome *(required)*

Why this run exists — the user-facing change the Acceptance criteria below verify.

- **Before**: <the gap or pain today, e.g. "users can't reset a password without emailing support">
- **After**: <the one-sentence outcome the acceptance criteria verify>
- **Benefit**: <who gets what>

## Acceptance criteria *(required)*

Each AC is one observable, testable behaviour. Write the happy path and its boundary on separate lines, using real values (never invented ones).

- [ ] **AC1**: <observable behaviour, e.g. "submitting a valid form creates the record">
  - **Example**: <real input> → <expected output>
  - **On error / at boundary**: <bad input / limit / unauthorized> — or `none — <default>`

- [ ] **AC2**: <measurable target, e.g. "list endpoint returns in < 300ms at p95">
  - **measured**: <command / observable>

*Mark an open requirement inline:* `<behaviour>` [NEEDS CLARIFICATION: what is unspecified?]

---

**Optional sections** — add one only when its trigger fires, in this order; delete the rest (no empty headers, no "N/A"):

Problem · Users · User journey · Scope—Out · Glossary · Non-functional requirements · Definition of Done · Reproduction (fix) · Timebox (spike) · Constraints · References / examples · Discovery notes · Carried-over follow-ups

Triggers + hard rules (NFR→AC, no invented values, [NEEDS CLARIFICATION]) → **pm.md > Spec sections**.
