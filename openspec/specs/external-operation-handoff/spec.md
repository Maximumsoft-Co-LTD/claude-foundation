# external-operation-handoff Specification

## Purpose
Define typed, secret-free handoffs for authority-bound operations while keeping
delivery safe before activation and auditable through Land.
## Requirements
### Requirement: Unauthorized infrastructure work becomes a typed handoff

Foundation SHALL separate repository implementation tasks from operations that
require authority unavailable to the developer, including cloud IAM, secret
writes, Terraform apply, cluster changes, deployment, restart, and production
verification. Each external operation SHALL declare a stable ID, owner,
environment, timing, activation safety, required evidence, runbook, rollback,
and related claims without containing secret values.

#### Scenario: Developer cannot write an AWS secret

- **WHEN** implementation requires a Secrets Manager value and the developer
  has no authorized AWS role
- **THEN** Build can close the code/config task and produces a DevOps handoff
  naming the secret reference and evidence required, without asking the
  developer to obtain credentials or marking the external write complete

#### Scenario: A handoff contains credential material

- **WHEN** a declaration or record contains a password, access key, private
  key, bearer token, or credential-valued field
- **THEN** validation rejects it before the material enters a packet or receipt

### Requirement: Land distinguishes integration from activation

An unresolved external operation SHALL NOT be reported as developer code
rework. Land MAY proceed with an incomplete operation only when it is
`post-land`, `safe-before-activation`, and accepted by a named operator with a
durable tracking reference. Every `pre-land` or `activation-coupled` operation
SHALL require completed evidence and otherwise report `WAITING_EXTERNAL` with
the responsible owner and recovery command.

#### Scenario: Dark configuration is activated after merge

- **WHEN** a post-Land operation is proven dormant until DevOps activation and
  a named DevOps operator accepts it into a tracking system
- **THEN** Prove and Land may complete while the external operation remains
  accepted, and the archived change retains its tracking reference

#### Scenario: Auto-deploy would consume a missing prerequisite

- **WHEN** merge activates a service that requires an incomplete secret,
  Terraform apply, deployment, or restart
- **THEN** Land stops as `WAITING_EXTERNAL` until a named operator records the
  required completion evidence

#### Scenario: The handoff contract changes after acceptance

- **WHEN** owner, operation, timing, activation safety, evidence, or rollback
  changes after a record was accepted
- **THEN** the old record becomes stale and cannot satisfy Land
