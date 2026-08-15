## ADDED Requirements

### Requirement: One Decision Sheet grounds operated service boundaries

Before Build, Foundation SHALL require one locked Decision Sheet produced only
after complete relevant discovery. It SHALL include conditional production
entry, real wire, activation semantics, service interaction, and observability
rows. Discoverable facts SHALL be resolved from source; irrelevant rows SHALL
be recorded as sourced `N/A`; all unresolved material choices SHALL be asked in
the same user turn.

#### Scenario: A cross-service async change is grounded once

- **WHEN** a change publishes or consumes a cross-service message
- **THEN** the ledger records owner, producer, consumer, contract, delivery,
  timeout/retry, idempotency, ordering, consistency, rollout, rollback,
  correlation, operator question, SLI, alert and runbook decisions before Build

#### Scenario: A local non-runtime change avoids irrelevant questions

- **WHEN** repository evidence shows no operated or cross-service boundary
- **THEN** the same sheet records those sections `N/A` with source reasons and
  does not ask a second question batch

#### Scenario: Build discovers an in-contract defect or a missing operator permission

- **WHEN** implementation evidence exposes a defect already settled by the
  locked behavior, or an external operation needs authority the developer lacks
- **THEN** Foundation auto-repairs the defect or emits the declared handoff and
  does not open another user interview

#### Scenario: New evidence contradicts a locked material decision

- **WHEN** continuing would change behavior, compatibility, security, data, or
  rollout beyond the initial Decision Sheet
- **THEN** Foundation opens one audited batched amendment rather than asking
  piecemeal Build or Prove questions

### Requirement: Locked grounding remains content truthful

Foundation SHALL rehash immutable read-set inputs on every validation, resolve
production and failure paths inside selected repositories, and persist the
first grounding lock only after the complete change validates. A contradicted
lock SHALL use one audited reopen/replacement route.

#### Scenario: A requirement changes after grounding locks

- **WHEN** an immutable requirement or dependency input digest moves
- **THEN** validation reports the drift and cannot reuse the existing grounding
  lock or silently rewrite the decision ledger
