# external-operation-handoff

## ADDED Requirements

### Requirement: declaration-unblocks-land

The system SHALL Land remains ready, the operation is reported as a declared post-Land obligation, and no user decision or actor/reference bookkeeping is requested.

#### Scenario: A valid post-land operation declares safe-before-activation and its activation proof, but no operator acknowledgement exists

- **WHEN** A valid post-land operation declares safe-before-activation and its activation proof, but no operator acknowledgement exists
- **THEN** Land remains ready, the operation is reported as a declared post-Land obligation, and no user decision or actor/reference bookkeeping is requested.

### Requirement: unsafe-activation-still-blocks

The system SHALL The harness reports WAITING_EXTERNAL and does not weaken the activation safety gate.

#### Scenario: An operation is pre-land or activation-coupled and lacks valid completion evidence

- **WHEN** An operation is pre-land or activation-coupled and lacks valid completion evidence
- **THEN** The harness reports WAITING_EXTERNAL and does not weaken the activation safety gate.

### Requirement: post-archive-obligation-lifecycle

The system SHALL The harness can list it across active and archived changes and record completed, cancelled, or superseded outcomes without reopening tasks.md.

#### Scenario: An operational obligation remains after its source change is archived

- **WHEN** An operational obligation remains after its source change is archived
- **THEN** The harness can list it across active and archived changes and record completed, cancelled, or superseded outcomes without reopening tasks.md.

### Requirement: legacy-records-remain-readable

The system SHALL The runtime continues to read it without migration while acknowledgement remains optional for safe post-Land delivery.

#### Scenario: An existing version-1 handoff record contains accepted or completed status

- **WHEN** An existing version-1 handoff record contains accepted or completed status
- **THEN** The runtime continues to read it without migration while acknowledgement remains optional for safe post-Land delivery.

### Requirement: public-obligation-list-route

The system SHALL The shipped CLI routes the read-only request to the aggregate operational obligation projection.

#### Scenario: An agent invokes the public handoff list command with optional open, owner, environment, or JSON filters

- **WHEN** An agent invokes the public handoff list command with optional open, owner, environment, or JSON filters
- **THEN** The shipped CLI routes the read-only request to the aggregate operational obligation projection.

### Requirement: public-command-contract-remains-frozen

The system SHALL The public command golden and installer surface budget explicitly include the new command while every existing command remains unchanged.

#### Scenario: The shipped command registry adds the read-only handoff list command

- **WHEN** The shipped command registry adds the read-only handoff list command
- **THEN** The public command golden and installer surface budget explicitly include the new command while every existing command remains unchanged.

### Requirement: operational-list-remains-truthful

The system SHALL Only validated terminal dispositions leave the open queue, unreadable changes are reported in-band without hiding healthy obligations, and the public command metadata remains consistent.

#### Scenario: Aggregate listing encounters stale terminal records or an unreadable handoff contract while other obligations remain valid

- **WHEN** Aggregate listing encounters stale terminal records or an unreadable handoff contract while other obligations remain valid
- **THEN** Only validated terminal dispositions leave the open queue, unreadable changes are reported in-band without hiding healthy obligations, and the public command metadata remains consistent.

### Requirement: combined-evidence-preserves-critical-cases

The system SHALL The test receipt durably includes the critical-case observation and the paired discovery receipt remains available.

#### Scenario: A test-discovery provider evaluates a declared critical case while also writing its discovery receipt

- **WHEN** A test-discovery provider evaluates a declared critical case while also writing its discovery receipt
- **THEN** The test receipt durably includes the critical-case observation and the paired discovery receipt remains available.

### Requirement: non-grounding-contract-revision-can-close-review

The system SHALL Review closure accepts the current spec approval as the locked decision revision without weakening grounding-required changes.

#### Scenario: A non-grounding change receives an explicitly approved contract revision after its final AI delta and current deterministic repair evidence passes

- **WHEN** A non-grounding change receives an explicitly approved contract revision after its final AI delta and current deterministic repair evidence passes
- **THEN** Review closure accepts the current spec approval as the locked decision revision without weakening grounding-required changes.
