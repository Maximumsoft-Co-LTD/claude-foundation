## ADDED Requirements

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
