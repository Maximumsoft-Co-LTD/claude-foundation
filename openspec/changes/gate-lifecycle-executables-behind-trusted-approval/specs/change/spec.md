## ADDED Requirements

### Requirement: Repository-configured lifecycle executables require trusted approval

The system SHALL refuse to spawn any lifecycle executable whose program or
arguments originate from repository content unless a matching approval exists in
the operator's trusted configuration directory.

#### Scenario: unapproved proof provider refuses to run

- **WHEN** a repository configures a proof provider command and no approval for
  it exists in the trusted store
- **THEN** `prove` exits with the approval-required code, spawns no process, and
  names the command that must be granted

#### Scenario: unapproved reviewer refuses to run

- **WHEN** a repository configures a reviewer command and no approval for it
  exists in the trusted store
- **THEN** `review` exits with the approval-required code and spawns no process

#### Scenario: approved executable runs

- **WHEN** an approval recorded by the operator matches the executable, its
  bytes, the ordered arguments, the environment, the caps, and the config digest
- **THEN** the executable runs and produces its receipt as before

#### Scenario: compiled-in default provider needs no approval

- **WHEN** a project has no proof-provider configuration file
- **THEN** the compiled-in hardened provider runs without any approval record

### Requirement: An approval is bound to executable and configuration content

The system SHALL void an approval when the executable bytes, the ordered
arguments, the environment, the caps, the source configuration digest, or the
canonical project root differ from those the approval was recorded for.

#### Scenario: swapped executable voids the approval

- **WHEN** the approved program's bytes change after the approval was recorded
- **THEN** the next run refuses with the approval-required code

#### Scenario: edited configuration voids the approval

- **WHEN** the configuration file that supplied the command is edited after the
  approval was recorded
- **THEN** the next run refuses with the approval-required code

#### Scenario: an approval does not transfer to another project

- **WHEN** the same command is configured in a different canonical project root
- **THEN** the approval recorded for the first root does not authorize it

### Requirement: Only the operator may create an approval

The system SHALL create approvals only from a re-derivation of current on-disk
configuration under user or trusted-policy provenance, and SHALL NOT accept a
digest supplied by a caller.

#### Scenario: grant re-derives rather than accepting a digest

- **WHEN** the operator grants an approval
- **THEN** the request is re-derived from the current configuration and the
  resolved program, arguments, caps, and digests are displayed before recording

#### Scenario: repository content cannot record an approval

- **WHEN** repository content attempts to place an approval record where the
  trusted store is read
- **THEN** the store location is outside the repository and the attempt has no
  effect on authorization

### Requirement: Reviewer-declared authority comes from the approval

The system SHALL take the reviewer model family from the approval record rather
than from the reviewer process output.

#### Scenario: reviewer reporting a different family is rejected

- **WHEN** an approved reviewer returns a model family that differs from the one
  recorded on its approval
- **THEN** the review is rejected as a reviewer contract violation and no review
  attempt is recorded

#### Scenario: independence gate reads the approved family

- **WHEN** the approved reviewer family equals the implementation model family
  and independent families are required
- **THEN** the review is rejected for non-independence

### Requirement: The lifecycle runner cannot be reached without an approval

The system SHALL expose no public path that spawns a lifecycle executor without
an approval value that only the authorization check can construct.

#### Scenario: the raw runner is unreachable

- **WHEN** a crate outside the runner attempts to spawn a lifecycle process
- **THEN** the only public entry requires an approval token it cannot construct
