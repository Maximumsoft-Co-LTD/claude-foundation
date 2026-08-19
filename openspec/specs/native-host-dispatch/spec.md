# native-host-dispatch Specification

## Purpose
TBD - created by archiving change automate-native-host-agent-dispatch. Update Purpose after archive.
## Requirements
### Requirement: Deterministic next dispatch action

The system SHALL derive one bounded next Build action from the current
execution graph, pending tasks, active leases, and configured concurrency
ceiling without invoking a model.

#### Scenario: Independent work is offered to the host

- **WHEN** at least two ready tasks are independent and no task lease is active
- **THEN** dispatch returns `spawn-group` with no more than the configured maximum workers and graph-bound acquire and packet instructions for each task

#### Scenario: Small work remains in the parent session

- **WHEN** the plan is eligible for single-agent execution
- **THEN** dispatch returns `run-in-session` and does not recommend a worker spawn

#### Scenario: Completed Build does not dispatch

- **WHEN** no implementation task remains
- **THEN** dispatch returns `build-complete` with the proof-readiness command

### Requirement: Live work is idempotently resumed

The system SHALL expose live task leases as a wait decision so repeated host
calls do not recommend duplicate workers.

#### Scenario: Host restarts while workers are live

- **WHEN** dispatch is called while one or more unexpired task leases exist
- **THEN** it returns `wait` with the existing owner, task, attempt, and expiry and returns no new spawn group

#### Scenario: Planning is blocked

- **WHEN** the current plan has an ambiguity or active-scope conflict
- **THEN** dispatch returns `blocked` with the existing reasons and does not recommend a worker spawn

### Requirement: Workers receive bounded authority context

The system SHALL make native workers consume the leased task packet rather
than the parent conversation transcript.

#### Scenario: Host spawns a returned group

- **WHEN** the native host follows a `spawn-group` decision
- **THEN** it acquires each task lease, regenerates the leased task packet, and supplies that packet as the worker's construction context

#### Scenario: Worker completes its bounded task

- **WHEN** a worker finishes focused verification
- **THEN** the host releases the matching lease so the harness validates observed writes and records the accepted lease result before advancing the graph
