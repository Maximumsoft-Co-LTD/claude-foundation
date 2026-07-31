## ADDED Requirements

### Requirement: Bounded agent handoff

The system SHALL emit parseable task-authorized handoffs within configured
byte budgets and SHALL compact large collections by reference rather than
blocking valid brownfield work.

#### Scenario: Large resumable change

- **WHEN** a partially completed change contains hundreds of tasks and claims
- **THEN** plan and packet output remains parseable, bounded, and references
  the complete durable artifacts

### Requirement: Safe compatible context policy

The system SHALL account for emitted context without blocking execution and
SHALL preserve project-owned policy during upgrades.

#### Scenario: Existing installation upgrade

- **WHEN** an installation contains the former default numeric packet budget
- **THEN** it receives scoped defaults while a custom numeric value is preserved

## MODIFIED Requirements


## REMOVED Requirements
