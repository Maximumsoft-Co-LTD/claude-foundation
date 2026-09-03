# land Specification

## Purpose
TBD - created by archiving change archive-telemetry-sync. Update Purpose after archive.
## Requirements
### Requirement: Archive imports session telemetry

`land archive` SHALL run one quiet Claude-telemetry sync for the change before
the destructive archive step, and SHALL warn — without blocking — when the
change is archived with no model usage ever imported.

#### Scenario: ambient transcript is imported at archive

- **WHEN** a bound host transcript with unimported usage rows exists and
  `land archive` runs
- **THEN** the change's telemetry store gains those rows without any manual
  `telemetry sync` invocation

#### Scenario: absent transcript stays silent and non-blocking

- **WHEN** no host transcript is bound and `land archive` runs
- **THEN** the archive completes exactly as before, with one warning that
  model usage was never imported, naming `telemetry sync`

#### Scenario: telemetry never gates the archive

- **WHEN** the telemetry source is unreadable or empty
- **THEN** the archive still completes and the outcome is reported as a
  warning, never a blocker

### Requirement: Landing onto a default branch is visible

The system SHALL surface — without blocking — when landed work targets a
repository whose checked-out branch is `main` or `master`.

#### Scenario: land record warns on a default branch

- **WHEN** `land record` binds a commit and the target repository is checked
  out on `main` or `master`
- **THEN** the command succeeds and prints a warning naming the repository
  and the branch

#### Scenario: a feature branch stays silent

- **WHEN** the target repository is checked out on any other branch or a
  detached HEAD
- **THEN** no branch warning is printed

#### Scenario: land check reports the root target branch

- **WHEN** `land check` reaches `LAND READY` and the root target is checked
  out on `main` or `master`
- **THEN** the output includes a `branch:` line naming it

### Requirement: Doctor escalates the unwired branch guard

`doctor` SHALL report `no-direct-main: disabled (opt-in policy)` at `warn`
level while the hook is not wired, and keep `enabled` at `info`.

#### Scenario: disabled guard is a warning

- **WHEN** `.claude/settings.json` does not wire `no-direct-main-commit.sh`
  and `doctor` runs
- **THEN** the `no-direct-main` check reports at `warn` level and the doctor
  exit code is unchanged

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

### Requirement: Out-of-band delivery is visible but non-authoritative

The system SHALL report when change bytes or an explicit delivery reference are observed in a target before archived, SHALL provide an exact audited recovery route, and SHALL NOT convert that observation into Proof, authority, Land permission, or archive completion.

#### Scenario: Target contains the change before archive

- **WHEN** the target repository advances to include the change while lifecycle state is still change, building, waiting, or proven
- **THEN** diagnostics report out-of-band delivery with current lifecycle state and supported reconciliation choices

#### Scenario: External delivery exists without proof

- **WHEN** an out-of-band commit, pull request, or deployment reference is recorded but required evidence is missing or stale
- **THEN** Proof and Land remain blocked and the change cannot be marked archived

### Requirement: High-level recovery remains local and non-authoritative

The coordinator MAY perform or prescribe reversible local sandbox reconciliation, evidence refresh, and idempotent telemetry ingestion when their preconditions are fully observed, but SHALL stop before conflict overwrite, waiver, commit, push, publication, pull request creation, or inferred delivery acceptance.

#### Scenario: Target moved without a conflict

- **WHEN** local sandbox reconciliation is policy-allowed and the replay is conflict-free
- **THEN** the coordinator returns or performs the bounded sync and requires fresh invalidated proof

#### Scenario: Target movement conflicts with repair work

- **WHEN** sandbox reconciliation detects a conflicting path
- **THEN** the coordinator preserves both states and returns a conflict authority boundary

#### Scenario: Delivery authority is absent

- **WHEN** proof passes but commit, push, publication, or another declared delivery step lacks authority
- **THEN** the coordinator reports Land readiness and stops without performing that step

