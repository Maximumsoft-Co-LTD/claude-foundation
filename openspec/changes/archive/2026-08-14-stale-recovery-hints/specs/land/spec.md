## ADDED Requirements

### Requirement: Stale refusals state the recovery order

A staleness refusal SHALL state, in the refusal itself, the order of
operations that avoids repeating it.

#### Scenario: stale proof names the order

- **WHEN** the workspace changed after Prove and `land check` refuses
- **THEN** the message says to finish contract and code edits, sync, and run
  one fresh prove, naming the prove command

#### Scenario: stale authority request names the order

- **WHEN** the workspace changed after an authority request and
  `authority record` refuses
- **THEN** the message says review and acceptance are requested after the
  workspace stops changing, naming the re-request command

#### Scenario: fresh state stays unchanged

- **WHEN** nothing is stale
- **THEN** `land check` and `authority record` outputs carry no recovery hint
