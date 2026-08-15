## ADDED Requirements

### Requirement: Proof transitions are serialized, fresh, and ordered

Every proof and authority mutation for one change SHALL use one recoverable
lease/CAS boundary. Proof validity SHALL compare the recorded relevant
workspace hash with the current hash. Capability order SHALL require review
before acceptance explicitly rather than relying on provider sort order.

#### Scenario: Two agents advance the same proof

- **WHEN** two processes attempt the same change transition concurrently
- **THEN** one owns the transition and the other observes or resumes it without
  duplicating a provider run, review dispatch, or receipt

#### Scenario: A valid proof becomes stale

- **WHEN** a relevant workspace input moves after a passing receipt
- **THEN** proof no longer reports valid and reruns only the affected evidence

### Requirement: External waiting is a one-shot handoff

A waiting external review or acceptance SHALL emit one stable request and stop.
Repeated `proof advance` calls SHALL return the same request without polling,
redispatching, or consuming another attempt.

#### Scenario: Advance is called while review is waiting

- **WHEN** the external request is unchanged and no response exists
- **THEN** Foundation returns the existing handoff and performs no external or
  model call
