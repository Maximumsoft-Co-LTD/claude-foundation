## ADDED Requirements

### Requirement: The shipped agent contract reports update advisories without taking authority

The shipped agent contract SHALL require an agent to notify the user when a
phase-bound update advisory reports an available update, avoid duplicate notices
between Investigate and Change, remind immediately before Build when the update
remains unresolved, continue the requested work, and never perform the package
or project update without user authority.

#### Scenario: Agent discovers an update

- **WHEN** an Investigate or Change instruction carries an available update advisory
- **THEN** the agent tells the user once in the user's language
- **AND** continues the requested phase

#### Scenario: Update remains unresolved before Build

- **WHEN** Build preflight carries the same available update
- **THEN** the agent gives one concise reminder
- **AND** does not run an upgrade automatically

#### Scenario: Update status is unavailable

- **WHEN** the advisory status is unknown because no valid cache or remote result is available
- **THEN** the agent does not claim that Foundation is current
- **AND** does not block work
