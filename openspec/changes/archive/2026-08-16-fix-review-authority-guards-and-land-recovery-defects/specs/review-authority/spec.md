## ADDED Requirements

### Requirement: Receipt reconciliation compares latest attempt to latest receipt

The review-authority guard SHALL treat a completed AI response as unrecorded
only when the latest delivered AI attempt (excluding errored completions) is
newer in the attempt chain than the newest recorded receipt of any reviewer
type, and SHALL NOT block dispatch, record, or run merely because an earlier
receipt was overwritten by a later one or superseded by a human receipt.

#### Scenario: Delta receipt overwrote the full receipt

- **WHEN** two AI reviews were delivered and the recorded receipt's attempt
  digest names the later delta attempt
- **THEN** authority dispatch, record, and run proceed without the
  "no matching recorded receipt" refusal

#### Scenario: Human receipt superseded the AI receipt

- **WHEN** a delivered AI review was followed by a recorded human review whose
  receipt replaced the AI attempt digest
- **THEN** authority commands proceed without the "no matching recorded
  receipt" refusal

#### Scenario: Errored completion is not a delivered response

- **WHEN** an AI attempt completed with result status "error" and no receipt
- **THEN** the guard does not count it as a delivered response awaiting a
  receipt

#### Scenario: Genuinely unrecorded response still blocks

- **WHEN** the latest delivered AI attempt has no recorded receipt and no
  later attempt of any type has been recorded
- **THEN** authority dispatch, record, and run refuse with the
  "no matching recorded receipt" error

### Requirement: Reviewer request schema is portable to structured-output providers

The configured reviewer request schema SHALL NOT contain the `uniqueItems`
keyword, and the response validator SHALL reject duplicate finding IDs,
duplicate `claimIds`, duplicate `verificationCaseIds`, and duplicate
`verifiedFindingIds` after parsing.

#### Scenario: Schema accepted by structured output

- **WHEN** the reviewer request schema is serialized for a structured-output
  provider
- **THEN** it contains no `uniqueItems` keyword

#### Scenario: Duplicates still refused

- **WHEN** a reviewer response carries duplicate IDs in any of its ID lists
- **THEN** the response is rejected as invalid

### Requirement: Bounded reset of the reviewer infrastructure retry

The system SHALL provide `authority reset-infra <change> --decision-ref <ref>`
which, when the prove-stage provider diagnosis passes and the decision
reference has not been used before, acknowledges the consumed reviewer
infrastructure attempts so they no longer count against the infrastructure
retry bound, without mutating the recorded attempt chain.

#### Scenario: Reset after provider repair

- **WHEN** the infrastructure retry is exhausted, the provider diagnosis
  passes, and a fresh decision reference is supplied
- **THEN** a subsequent AI review dispatch is permitted and the acknowledged
  attempt digests are recorded in the review history

#### Scenario: Failing diagnosis refuses

- **WHEN** the provider diagnosis fails
- **THEN** the reset is refused and the retry bound stays consumed

#### Scenario: Reused decision reference refuses

- **WHEN** the supplied decision reference was already used for a reset on the
  change
- **THEN** the reset is refused
