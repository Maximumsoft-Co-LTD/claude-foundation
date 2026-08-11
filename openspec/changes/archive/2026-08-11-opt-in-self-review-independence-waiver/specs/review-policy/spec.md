## ADDED Requirements

### Requirement: Reviewer independence is waivable only by committed project policy

The system SHALL read reviewer-independence policy from `foundation.json`
`review.independence`, accepting `required` or `self` and defaulting to
`required`. Any other value SHALL fail the policy read. The system SHALL NOT
accept a command flag, environment variable, or receipt field that waives
reviewer independence.

#### Scenario: An unknown independence value is refused

- **WHEN** `foundation.json` declares `review.independence` as anything other
  than `required` or `self`
- **THEN** the harness fails naming `foundation.json review.independence must
  be required|self`

#### Scenario: A project that never opts in is unaffected

- **WHEN** `foundation.json` omits `review.independence`
- **THEN** the review policy reports `independence: "required"`, carries no
  `independenceWaived` field and no independence trigger, and produces the same
  contract fingerprint it produced before the waiver existed

### Requirement: A configured self-review waiver is named in the record

The system SHALL, when `review.independence` is `self`, report the review
policy as `independence: "self"` with `independenceWaived: true` and an
`independence-waived-self-review` trigger, and SHALL carry that policy into the
review packet, the external authority request requirements, and the recorded
review receipt.

#### Scenario: The waiver reaches the review packet

- **WHEN** a review packet is printed for a change in a project that declared
  `review.independence: "self"`
- **THEN** the packet's review policy names the
  `independence-waived-self-review` trigger

### Requirement: A waived review may share the implementer's identity and session

The system SHALL accept a review receipt, including a passing one, whose
reviewer shares an identity or session with an implementation subject when and
only when the project policy waives independence, and SHALL apply the waiver at
every impact level and trigger. The system SHALL record the observed
independence truthfully as `review.policy.independent: false` rather than
asserting independence the review did not have.

#### Scenario: A same-session reviewer passes under the waiver

- **WHEN** a review receipt is recorded whose reviewer identity and session
  match the implementation subject, in a project that declared
  `review.independence: "self"`
- **THEN** the receipt is written with status `pass`, records
  `review.policy.independent` as `false` and `review.policy.independenceWaived`
  as `true`, and remains valid on re-read

#### Scenario: Independence still blocks without the waiver

- **WHEN** the same receipt is attempted in a project that did not declare
  `review.independence: "self"`, including one that declared
  `review.diversity: "single-model"`
- **THEN** the write fails naming reviewer independence, and any receipt
  already written reads back as `review-not-independent`

#### Scenario: Removing the waiver invalidates a recorded self-review

- **WHEN** `review.independence: "self"` is removed from `foundation.json`
  after a self-review receipt was recorded
- **THEN** that receipt stops counting as evidence, reading back as
  `contract-stale` because the review policy is part of the contract
  fingerprint and withdrawal moves it

#### Scenario: The waiver relaxes nothing else

- **WHEN** a self-review is recorded under the waiver
- **THEN** a passing review still requires an explicit unresolved-blocker count
  of zero, reviewer diversity is still governed by `review.diversity`, and the
  two-round AI ceiling and attempt hash chain still apply
