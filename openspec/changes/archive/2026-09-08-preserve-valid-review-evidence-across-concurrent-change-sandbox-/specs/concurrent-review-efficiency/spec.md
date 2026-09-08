# concurrent-review-efficiency

## ADDED Requirements

### Requirement: copy-review-reuse

The system SHALL The review receipt can rebind through the existing proof route without another reviewer dispatch; identity covers every writable selected repository and fails closed when unavailable.

#### Scenario: A copy sandbox receives an unrelated target change while its baseline-to-sandbox contribution and review packet remain unchanged

- **WHEN** A copy sandbox receives an unrelated target change while its baseline-to-sandbox contribution and review packet remain unchanged
- **THEN** The review receipt can rebind through the existing proof route without another reviewer dispatch; identity covers every writable selected repository and fails closed when unavailable.

### Requirement: preserve-noop-proof

The system SHALL Valid proof and lifecycle progress are preserved; changed inputs or unresolved conflicts still invalidate proof without discarding reusable receipts.

#### Scenario: Sandbox sync does not change evidence-bound inputs

- **WHEN** Sandbox sync does not change evidence-bound inputs
- **THEN** Valid proof and lifecycle progress are preserved; changed inputs or unresolved conflicts still invalidate proof without discarding reusable receipts.

### Requirement: explain-review-invalidation

The system SHALL The existing invalidation projection distinguishes missing identity, changed contribution, and changed review packet while retaining stale validity and conservative behavior.

#### Scenario: A moved workspace cannot reuse a review receipt

- **WHEN** A moved workspace cannot reuse a review receipt
- **THEN** The existing invalidation projection distinguishes missing identity, changed contribution, and changed review packet while retaining stale validity and conservative behavior.

### Requirement: reuse-wire-compatibility

The system SHALL Runtime API pins and public documentation stay aligned while command arguments and existing receipt identity representations remain compatible.

#### Scenario: Runtime exposes more specific review invalidation reasons

- **WHEN** Runtime exposes more specific review invalidation reasons
- **THEN** Runtime API pins and public documentation stay aligned while command arguments and existing receipt identity representations remain compatible.

### Requirement: public-api-docs-alignment

The system SHALL The English and Thai website CLI references and landing page display the same runtime API as the shipped CLI.

#### Scenario: The runtime API pin changes for sync diagnostics

- **WHEN** The runtime API pin changes for sync diagnostics
- **THEN** The English and Thai website CLI references and landing page display the same runtime API as the shipped CLI.

### Requirement: upgrade-detector-preservation

The system SHALL Shipping mutation fixtures continue injecting detectable API mismatches using the canonical protocol value, and all shipped API guidance stays synchronized.

#### Scenario: The runtime API changes while existing shipping mutation checks run

- **WHEN** The runtime API changes while existing shipping mutation checks run
- **THEN** Shipping mutation fixtures continue injecting detectable API mismatches using the canonical protocol value, and all shipped API guidance stays synchronized.
