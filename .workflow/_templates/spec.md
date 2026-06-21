# Spec: <title>

**ID**: `NNNN-type-slug`
**Type**: feat | fix | refactor | chore | docs | spike
**Status**: draft | approved
**Ship as**: one-drop | staged
**Open PR on ship**: yes | no
**E2E + visual**: off | on
**Parent**: none | `<parent-id>`

## User Stories *(required)*

Priority-ordered, each independently testable — build P1 alone and you still have a viable MVP. Acceptance scenarios carry stable ids (`AC1`, `AC2`, …) that plan / tasks / test / review all reference.

### US1 — <title> (Priority: P1) 🎯 MVP

<one plain-language sentence: who does what, to what end>

**Why this priority**: <why this is the most critical slice>
**Independent test**: <how to verify US1 alone delivers value>

**Acceptance scenarios**

- [ ] **AC1** — **Given** <initial state>, **When** <action>, **Then** <expected outcome>.
- [ ] **AC2** — **Given** <state>, **When** <boundary / bad input>, **Then** <on-error outcome> — or `none — <default>`.

---

### US2 — <title> (Priority: P2)

<one plain-language sentence>

**Why this priority**: <value, and why lower than P1>
**Independent test**: <how to verify US2 alone>

**Acceptance scenarios**

- [ ] **AC3** — **Given** <state>, **When** <action>, **Then** <outcome>.

### Edge Cases

- What happens when <boundary condition>? → <handling> (FR-###).
- How does the system handle <error scenario>? → <handling> (FR-###).

## Requirements *(required)*

### Functional Requirements

- **FR-001**: System MUST <specific capability, e.g. "add a task with a non-empty trimmed title">.
- **FR-002**: Users MUST be able to <key interaction>.

### Key Entities *(include when the feature involves data)*

- **<Entity>** — <what it represents; key attributes, no implementation>.

## Success Criteria *(required)*

Measurable, technology-agnostic outcomes.

- **SC-001**: <measurable metric, e.g. "a first-time user adds their first item in under 5 s">.
- **SC-002**: <measurable performance / volume metric>.

## Assumptions

- <reasonable default chosen where the request was silent>.

---
*Optional — add when triggered, delete the rest: Problem · Users · User journey · Scope—Out · Glossary · NFR · Definition of Done · Reproduction (fix) · Timebox (spike) · Constraints · References · Discovery notes · Carried-over follow-ups. Structure + hard rules (priority, Given/When/Then with AC ids, FR/SC, no invented values, [NEEDS CLARIFICATION]) → **pm.md > Spec sections**.*
