## ADDED Requirements

### Requirement: Critical test evidence names each required case

A material test claim SHALL declare stable critical case IDs. Its report SHALL
record passed, failed, and skipped status for each ID. A missing or skipped
critical case SHALL block the claim even when the command exits zero and the
aggregate test count meets its minimum.

#### Scenario: A critical case is skipped inside a green suite

- **WHEN** the suite exits zero but one declared critical case is skipped
- **THEN** proof records the case as skipped and refuses the claim

### Requirement: Mutation evidence binds mutants to behavioral kills

Mutation protocol v2 SHALL record mutant ID, whether it applied and compiled,
its killed or survived result, and the critical case that killed it. A crash,
non-applying mutant, compile failure, or aggregate score SHALL NOT substitute
for a required behavioral kill.

#### Scenario: A required semantic mutant survives

- **WHEN** a field-swap, duplicate-wire-key, classifier, or equivalent required
  mutant remains behaviorally observable without a failing critical case
- **THEN** mutation evidence fails naming the mutant and missing killer
