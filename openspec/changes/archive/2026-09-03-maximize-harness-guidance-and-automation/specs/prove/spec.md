# prove

## ADDED Requirements

### Requirement: Rejected review becomes bounded repair work

The proof controller SHALL derive machine-owned repair nodes from current in-contract blocker and major findings, bind them to the source attempt, workspace, claims, paths, and verification cases, and SHALL reject deterministic closure until an authorized changed workspace and current evidence close every required finding.

#### Scenario: Current review rejects the workspace

- **WHEN** a delivered current review contains blocker or major findings inside the locked contract
- **THEN** Proof returns one dependency-ordered repair graph and bounded host action
- **AND** does not ask the user to make a product decision

#### Scenario: Repair would change the agreement

- **WHEN** a finding requires a behavior, security, data, or rollout choice outside the locked contract
- **THEN** Proof returns `CONTRACT_DECISION_REQUIRED` and preserves the repair state

#### Scenario: Repair result does not change the workspace

- **WHEN** a host reports a repair result but the bound workspace identity is unchanged
- **THEN** the finding cannot receive deterministic closure

### Requirement: Repair invalidates only soundly affected evidence

The proof controller SHALL explain each provider invalidation or reuse from its recorded input manifest and SHALL invalidate ambiguous scope rather than reuse possibly stale evidence.

#### Scenario: Repair changes one provider's complete input set

- **WHEN** a repair changes paths consumed by one provider but not another
- **THEN** Proof reruns the affected provider and reuses the unaffected valid receipt with a recorded reason
