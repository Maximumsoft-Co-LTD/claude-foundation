# review-policy Specification

## Purpose
TBD - created by archiving change opt-in-self-review-independence-waiver. Update Purpose after archive.
## Requirements
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

### Requirement: Review effort follows deterministic risk tiers

Foundation SHALL classify every change as low, medium, or high using the
strictest declared risk, observed surface capability, and correction behavior.
Low SHALL require one AI full review. Medium and high SHALL permit one AI full
review and, only after correction, one fresh-session delta closure. High-risk
material decisions SHALL be asked in the initial Decision Sheet and SHALL NOT
create a mandatory human approval gate during Prove. No tier SHALL dispatch a
third AI.

Reviewer executable, authentication, entitlement, timeout, or transport errors
SHALL NOT create a delivered baseline or consume a correction wave. Foundation
MAY run one bounded full infrastructure retry. Exhausting delivered waves SHALL
refuse another open review without asking a generic redesign/split/pause
question; remaining work SHALL be classified as in-contract repair, a material
contract decision, or an external-authority wait.
A blocker or major finding delivered by the final AI delta SHALL name its
affected claims and predeclared verification cases. After an in-contract fix,
Foundation SHALL close exactly those finding IDs only when every bound
non-review receipt is current and passing; that deterministic closure SHALL be
hash-chained and SHALL NOT count as a third AI wave.

#### Scenario: A clean low-risk change finishes after one AI

- **WHEN** the full AI review passes and no production correction is made
- **THEN** review completes without a second AI or human request

#### Scenario: A corrected medium change receives closure only

- **WHEN** a medium change fixes the complete first-round finding batch
- **THEN** the second packet contains only changed artifacts and finding IDs,
  and the reviewer cannot reopen unchanged surface

#### Scenario: A high-risk change asks once and stays AI-bounded

- **WHEN** a change affects money, authorization, secrets, destructive data,
  concurrency, replay/idempotency, queue semantics, external wire contracts,
  legacy activation, or production cutover
- **THEN** the developer answers the material risk in the initial Decision Sheet,
  one full AI review runs, and one delta is available only after correction

#### Scenario: The configured reviewer fails before delivering a verdict

- **WHEN** the reviewer executable, model, authentication, timeout, or transport
  fails and no pass, fail, or inconclusive verdict is delivered
- **THEN** the prior receipt remains unchanged, one full infrastructure retry
  is available, and no product question or delta baseline is fabricated

#### Scenario: Delivered review waves are complete

- **WHEN** the risk route has received every allowed full/closure verdict
- **THEN** another open-ended AI dispatch is refused and the workflow routes
  remaining work without presenting generic redesign, split, or pause choices

#### Scenario: The final delta finds an in-contract defect

- **WHEN** the second AI reports a blocker with claim and critical-case bindings,
  the implementation repairs it, and all bound providers pass on the new workspace
- **THEN** Foundation records a deterministic repair closure for those exact
  finding IDs and continues Prove without AI round three or human approval

#### Scenario: Deterministic closure evidence changes

- **WHEN** a receipt bound into final repair closure is modified, stale, missing,
  failing, or no longer covers the declared claim and case
- **THEN** the review receipt becomes invalid and Land remains blocked

#### Scenario: An approved contract revision follows deterministic closure

- **WHEN** a valid deterministic closure exists, a later Decision Sheet
  revision is locked and bound to the current contract, and every finding-bound
  non-review provider passes on the current workspace
- **THEN** Foundation appends a new deterministic closure preserving the
  original failed-delta lineage and continues without another AI or human gate

### Requirement: Codex and Claude Code are configured reviewer adapters

Foundation SHALL support Codex CLI and Claude Code CLI reviewers whose
executable, provider/model family, model ID, reasoning effort, read-only mode,
output schema, and session policy are configured separately from build model
tiers. Dispatch SHALL use the exact workspace without shell interpolation and
record truthful provider/model/session provenance.

By default a reviewer from the same provider and model family as an AI
implementer SHALL be rejected. A committed `review.diversity: single-model`
policy SHALL permit that reviewer while recording observed diversity as false
and the waiver as true. The reviewer SHALL still use an identity and fresh
session distinct from every implementation subject unless the separate
independence waiver is committed. A diversity waiver SHALL NOT waive
independence.

#### Scenario: Codex Sol reviews a non-OpenAI implementation

- **WHEN** `codex-sol` is selected for an eligible review
- **THEN** Foundation invokes a fresh ephemeral `codex exec` with
  `gpt-5.6-sol`, high reasoning, read-only sandbox, exact cwd and the review
  response JSON schema

#### Scenario: A Codex-only team uses a fresh same-family reviewer

- **WHEN** an OpenAI implementation selects `codex-sol`, the committed policy
  declares `diversity: single-model`, and Codex returns a fresh thread ID
- **THEN** Foundation accepts the review, records `diverse: false` and
  `diversityWaived: true`, and still rejects the coding session as the review
  session

#### Scenario: A Claude-Code-only team uses a configured reviewer

- **WHEN** `claude-opus` is selected for an Anthropic implementation
- **THEN** Foundation invokes a fresh non-persistent `claude --print` session
  with the configured model, high effort, plan/read-only tools, JSON Schema,
  exact cwd, and records the actual returned Claude session ID

#### Scenario: A same-family waiver is absent

- **WHEN** reviewer and implementation provider/model family match and policy
  still requires diversity
- **THEN** dispatch refuses before invoking the configured reviewer and names
  the committed `single-model` policy route

#### Scenario: Doctor finds the selected reviewer unavailable

- **WHEN** Codex or Claude Code is missing, unauthenticated, has an incompatible CLI/config,
  or the supplied implementation provenance cannot satisfy reviewer diversity
- **THEN** `doctor --stage prove` names local installation/login/upgrade checks,
  `authority run` rejects non-diverse provenance, and a remote model-entitlement
  failure is recorded as infrastructure failure without fabricating a review

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

