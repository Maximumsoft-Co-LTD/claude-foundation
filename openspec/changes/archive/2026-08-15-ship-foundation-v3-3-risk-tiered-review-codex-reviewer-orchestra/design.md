# Design

## Current state

Foundation 3.2.19 uses runtime API 19 and external review authority. The
control-pane overlay already demonstrated one Decision Sheet, a two-dispatch
full/delta circuit, Codex host links, and a resumable proof controller, but
these behaviors are not all present in upstream and their contracts do not
express risk-tiered human routing, critical-case proof, service interactions,
or emitted observability evidence. Review attempts and proof state are durable,
but every proof mutation and freshness transition is not yet one serialized
operation.

## Decisions

- **Decision:** Classify review as low, medium, or high from declared risk and
  observed capabilities, with the stricter tier winning.
  - **Why:** Review cost should follow failure impact rather than file count.
  - **Rejected:** two AI rounds or a human gate for every change.
- **Decision:** Low receives one full AI review; a production correction
  promotes it to medium. Medium and high receive one full AI review and, only
  after a correction, one fresh-session delta closure. High-risk material
  decisions are settled by the developer in the initial Decision Sheet; Prove
  has no mandatory human approval gate.
  - **Why:** Closure must verify the patch without opening a new audit loop,
    while developers must not wait for a reviewer identity after Build.
  - **Rejected:** a third AI, a full packet for round two, mandatory human final
    approval, or silently accepting an unasked high-risk choice.
- **Decision:** If the final AI delta still finds an in-contract blocker, every
  blocker must bind affected claims to predeclared critical cases. After the
  fix, current passing non-review receipts close those exact IDs in a
  deterministic hash-chained attempt. A later approved locked contract
  revision renews that same source lineage with current evidence instead of
  requiring another AI wave.
  - **Why:** Two bounded review waves need a quality-preserving exit that is
    neither a third open audit nor a permanent failing receipt.
  - **Rejected:** treating the second failure as pass, accepting unbound tests,
    or asking for a mandatory human reviewer.
- **Decision:** Configure reviewers independently of build model tiers. Ship
  `codex-sol` as `codex exec` using `gpt-5.6-sol`, reasoning high, read-only
  sandbox, fresh ephemeral sessions, JSON Schema output, and exact workspace.
  - **Why:** Reviewer provenance and model-family diversity become enforceable
    rather than narrative.
  - **Rejected:** shell-template reviewer commands or a self-review receipt.
- **Decision:** Support a `claude-cli` reviewer alongside `codex-cli`. A team
  using one provider/model family may commit `review.diversity: single-model`;
  the reviewer still runs in a distinct fresh session, in read-only mode, and
  the receipt records observed non-diversity plus the waiver. The configured
  adapter never treats a same-session result as independent.
  - **Why:** Codex-only and Claude-Code-only teams need a bounded review path
    without fabricating cross-family diversity or falling into a human gate.
    When launched from Claude Code, the adapter removes the inherited
    `CLAUDECODE` nesting marker before starting the isolated reviewer process.
  - **Rejected:** silently accepting same-family review, sharing the coding
    session, mutable shell templates, or treating a policy waiver as observed
    diversity.
- **Decision:** Ground operator questions and service boundaries before Build.
  The Decision Sheet carries conditional service-interaction and observability
  rows; irrelevant rows are sourced `N/A`, not user questions.
  - **Why:** Activation, retry, wire, consistency, trace, and rollback hazards
    are cheapest to settle before code.
  - **Rejected:** a second observability interview during Prove.
- **Decision:** A test claim names critical cases and a mutation claim names
  mutants. Reports carry per-case status and per-mutant kill evidence.
  - **Why:** exit zero and a total count cannot prove a required behavior ran.
  - **Rejected:** treating skipped tests or aggregate minimums as sufficient.
- **Decision:** One recoverable per-change proof lock protects every proof and
  authority state mutation; validators remain side-effect-free until the whole
  transition is valid.
  - **Why:** concurrent agents and killed processes must not duplicate runs or
    corrupt receipts.
  - **Rejected:** separate locks with stale read-modify-write windows.
- **Decision:** Permission-bound infrastructure work is an external operation,
  not an implementation task. `handoffs.yaml` declares a stable operation and
  `.foundation/handoffs` records its named owner, tracking reference, evidence,
  and status without storing credentials.
  - **Why:** Developers can finish and prove repository work without pretending
    to hold AWS, cluster, Terraform apply, secret-write, or production access.
  - **Rejected:** leaving unauthorized operations as unchecked developer tasks
    or marking them done without an operator.
- **Decision:** Repository integration and runtime activation are separate
  boundaries. An accepted, tracked `post-land` operation may remain incomplete
  at Land only when the merged artifact is demonstrably
  `safe-before-activation`; `pre-land` and `activation-coupled` operations
  remain Land blockers with the typed status `WAITING_EXTERNAL`.
  - **Why:** Dark configuration can be merged safely, while auto-deployed or
    activation-coupled changes still require the external prerequisite first.
  - **Rejected:** bypassing all external work at Land or blocking every safe
    post-Land rollout behind developer permissions.
- **Decision:** Discovery challenges production entry, real wire, activation,
  external authority, and proof oracles before the first Decision Sheet. Build
  auto-repairs only inside the locked contract; Prove executes and waits but
  does not open another interview.
  - **Why:** Questions and design risk belong at intake, while tool/provider
    failures and missing permissions have deterministic recovery routes.
  - **Rejected:** asking piecemeal questions after each Build or Prove failure.

## Compatibility and migration

Runtime API moves to 20. Evidence schema v2 remains readable; named critical
cases and mutation v2 are additive provider contracts and are required only
when a claim or risk tier declares them. Existing changes are classified from
their current impact/capabilities; missing grounding v2 data is reported as a
single migration Decision Sheet rather than invented. Legacy review receipts
remain readable but cannot satisfy a v3.3 policy fingerprint after policy or
workspace movement.

`handoffs.yaml` is optional and additive. A change without external operations
retains existing Build, Prove, and Land behavior. A post-Land operation must be
accepted into an external tracking system before archive so the obligation is
not lost when the active change directory moves.

Installers update every managed host surface atomically. `doctor --stage prove`
names missing Codex or Claude Code installation, authentication, model, and
diversity routes for the selected configured reviewer.
Rollback is reinstalling the last 3.2.x release and retaining existing change,
receipt, and attempt data; v3.3-only receipts then read stale rather than being
misinterpreted.

## Risks

| Risk | Mitigation | Evidence owner |
|---|---|---|
| Tier misclassification skips a material risk question | deterministic risk matrix, one initial Decision Sheet, table tests | test/review |
| Reviewer 2 reopens unchanged code | immutable delta scope and closure-only output schema | test/review |
| A configured reviewer edits the workspace or loses provenance | adapter-specific read-only ephemeral execution, exact cwd/model/schema, captured session | test/security |
| A single-provider team is rejected or mislabeled diverse | explicit committed waiver, separate-session enforcement, receipt records observed diversity | test/review |
| Test count hides a skipped critical scenario | named case report and missing/skipped rejection | test/mutation |
| Cross-service failure is untraceable | grounded owner/contract/retry/correlation/SLI evidence | test/review |
| Concurrent or killed proof corrupts state | recoverable per-change lease and process race tests | test |
| Upgrade drops host links or active work | clean installer and upgrade-compatibility tests | compatibility |
| Developer lacks cloud or production authority | typed DevOps handoff, named tracking reference, no unchecked developer task | test/review |
| Merge activates incomplete infrastructure | only accepted post-Land + safe-before-activation work may remain incomplete; all other work reports `WAITING_EXTERNAL` | test |
| Handoff leaks credentials or goes stale | reject secret-like fields/material and bind records to the operation digest | test/security |
