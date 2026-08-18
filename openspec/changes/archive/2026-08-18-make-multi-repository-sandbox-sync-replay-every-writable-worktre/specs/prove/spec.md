# prove Delta

## ADDED Requirements

### Requirement: Composite evidence identity is content-derived

The composite workspace and code hashes SHALL derive from repository content
and agreement revision and SHALL NOT change solely because a repository's
recorded base commit identity changes. Explicit target-head guards SHALL remain
responsible for refusing an unreconciled target before Land.

#### Scenario: History-only base movement

- **WHEN** repository content and agreement revision are unchanged but a
  recorded base commit identity changes
- **THEN** the composite workspace and code hashes remain unchanged

#### Scenario: Repository content changes

- **WHEN** any tracked repository content changes
- **THEN** the applicable composite hash changes and stale evidence cannot be
  reused

#### Scenario: Target movement was not synchronized

- **WHEN** the target head differs from the recorded sandbox base at Land
- **THEN** the existing `control-head-moved` decision blocks Land even though
  commit identity is not part of the evidence hash
