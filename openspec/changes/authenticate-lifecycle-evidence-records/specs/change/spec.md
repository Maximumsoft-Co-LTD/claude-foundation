## ADDED Requirements

### Requirement: Authoritative lifecycle records require a keyed sidecar

The system SHALL treat operational, proof, and review JSON under `.changeloop/`
as lifecycle authority only when a matching HMAC-SHA256 sidecar verifies against
the operator's record-authentication key.

#### Scenario: unsigned operational state clears authority only

- **WHEN** an existing `operational.json` has no valid sidecar
- **THEN** sessions and change intent load, but proof, review, convergence, and
  Land readiness are cleared

#### Scenario: unsigned proof is invisible to restart discovery

- **WHEN** a proof JSON exists under `.changeloop/proofs/` without a valid sidecar
- **THEN** app-server restart discovery does not list it as a recoverable change

#### Scenario: unsigned review does not satisfy review readiness

- **WHEN** a review `result.json` exists without a valid sidecar bound to its
  agreement and evidence bytes
- **THEN** discovery does not treat that change as reviewed

### Requirement: The authentication key lives outside the repository

The system SHALL keep the record-authentication key in the operator configuration
directory, create it only on authoritative write, and refuse a key path inside
the project root.

#### Scenario: verification never creates a missing key

- **WHEN** verification runs and the key file is absent
- **THEN** verification fails and no key file is created

#### Scenario: a repository-owned key directory is rejected

- **WHEN** the configured key directory resolves inside the project root
- **THEN** signing fails before a key is written

### Requirement: Sidecars bind project root, payload, and authority config

The system SHALL bind each sidecar to the canonical project root, record kind,
record id, payload digest, and digests of proof-provider, reviewer, prove-oracle,
and executor-approval configuration.

#### Scenario: tampered payload voids authority

- **WHEN** the authenticated payload bytes change after the sidecar was written
- **THEN** the next load or discovery rejects the record as unauthoritative

#### Scenario: foreign project root voids authority

- **WHEN** a valid sidecar is presented under a different canonical project root
- **THEN** verification fails

#### Scenario: changing lifecycle config or losing the key stales readiness

- **WHEN** proof-provider, reviewer, prove-oracle, or executor-approval bytes
  change, or the operator key is deleted
- **THEN** previously authenticated operational readiness no longer verifies and
  Land requires fresh Prove and Review

### Requirement: App-server proof and review writes are authenticated

The system SHALL write authenticated sidecars for app-server proof and review
result records, and SHALL require those sidecars before treating the records as
durable proof or review evidence.

#### Scenario: authenticated proof and review survive restart discovery

- **WHEN** prove and review complete through the app-server and the process
  restarts
- **THEN** discovery reports the authenticated proof and review as recoverable
  without restoring automatic Land authority
