# review-policy

## ADDED Requirements

### Requirement: Committed review waivers are visible before Prove

Foundation SHALL expose the effective reviewer-independence and model-diversity posture during doctor and change validation. A committed self-review or single-model waiver SHALL be named with its assurance consequence and SHALL NOT be presented as an independent or diverse review guarantee.

#### Scenario: Seeded policy permits both waivers

- **WHEN** doctor or change validation runs with independence self and diversity single-model
- **THEN** human and JSON output name both committed waivers, state that review may be non-independent and same-family, and preserve the existing readiness result

#### Scenario: Project requires full separation

- **WHEN** doctor or change validation runs with independence required and diversity required
- **THEN** output reports required independent and cross-family review and carries no waiver advisory

#### Scenario: Only one assurance property is waived

- **WHEN** exactly one of independence or diversity is configured as waived
- **THEN** output names only that waiver and reports the other property as required
