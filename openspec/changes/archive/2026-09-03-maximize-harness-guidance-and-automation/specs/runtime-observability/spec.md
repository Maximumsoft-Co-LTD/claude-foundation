# runtime-observability

## ADDED Requirements

### Requirement: Host usage attribution is normalized before availability classification

The system SHALL normalize supported host-execution source aliases before classifying usage, SHALL report measurement availability independently for tokens, cost, and model identity, and SHALL not recommend re-importing an already ingested supported event.

#### Scenario: Retained Codex host envelope uses a compatibility alias

- **WHEN** a measured event carries `source: host-execution` and identifies the Codex host
- **THEN** metrics include `codex` in correlated hosts
- **AND** preserve measured token values and unavailable cost or model values
- **AND** do not classify the event source as unsupported

#### Scenario: Event source is genuinely unknown

- **WHEN** an ingested event names no supported source alias or host identity
- **THEN** metrics report source unsupported and name only a safe normalization/import route

### Requirement: Unstructured blocker fallback is ambiguity-safe

The system SHALL prefer a structured package-owned blocker cause, SHALL use textual classification only for compatibility input, and SHALL fall back to a generic policy guard rather than select a recovery route when multiple blocker classes match.

#### Scenario: Legacy error text matches multiple blocker classes

- **WHEN** an unstructured blocked error matches two or more package classifier patterns
- **THEN** the retained operation uses the bounded `policy-guard` cause and packet recovery route

#### Scenario: Historical operation predates typed blockers

- **WHEN** feedback reads an operation schema that has no blocker field
- **THEN** cause provenance is explicitly unavailable for that row and is not inferred from later symptoms

### Requirement: Feedback timing preserves causal provenance

The system SHALL distinguish command execution, configured reviewer execution, observed repair intervals, verified external or human wait, and unattributed elapsed time without converting one category into another.

#### Scenario: Review fails before the workspace is repaired

- **WHEN** a completed failed review is followed by a current repair plan and Proof resumes with a changed workspace
- **THEN** feedback reports the bounded elapsed interval as repair
- **AND** does not label it reviewer wait, human wait, idle, or stalled

#### Scenario: No event explains an elapsed interval

- **WHEN** no retained transition proves the interval's cause
- **THEN** feedback retains it as unattributed

### Requirement: Feedback is a deterministic read-only projection

The system SHALL expose one versioned feedback snapshot containing source cohort, lifecycle timing, blocker groups, review/repair history, evidence invalidation or reuse reasons, budget calibration, and the exact next action without mutating lifecycle state.

#### Scenario: A report is generated for retained work

- **WHEN** the feedback snapshot is rendered as JSON or HTML
- **THEN** every quantitative value identifies its retained source or explicit unavailable basis
- **AND** inspection guards are separated from lifecycle guards and unexpected failures
