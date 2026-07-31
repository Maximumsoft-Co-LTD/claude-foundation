# workflow-performance Specification

## Purpose
TBD - created by archiving change reduce-workflow-latency-and-harden-proof-integrity-across-cli-ph. Update Purpose after archive.
## Requirements
### Requirement: Inspectable external evidence

Foundation SHALL reject an external `pass` receipt unless it contains a
non-empty observation, provenance, and at least one durable artifact or
reference.

#### Scenario: Empty external pass is rejected

- **WHEN** an external provider records `pass` without inspectable evidence
- **THEN** receipt validation fails and the proof remains incomplete

### Requirement: Capability-scoped provider coverage

Foundation SHALL permit a provider to cover only claims that declare the
provider's capability.

#### Scenario: Accessibility output is scoped

- **WHEN** one Playwright execution observes annotations for browser and
  accessibility claims
- **THEN** the accessibility receipt contains only claims declaring
  `accessibility`

### Requirement: Canonical workspace identity

Foundation SHALL use canonical filesystem paths for workspace identity, report
resolution, cleanup, and Land comparisons.

#### Scenario: macOS private var alias

- **WHEN** a sandbox is created below `/var` and resolves below `/private/var`
- **THEN** all proof stages use one canonical workspace and do not report a
  false path escape or stale identity

### Requirement: Atomic proof control

Foundation SHALL provide one public proof command that performs readiness,
preflight, planning, execution, and audit while retaining diagnostic
subcommands.

#### Scenario: Normal proof path

- **WHEN** all configured and external evidence is ready
- **THEN** `proof run` returns `PASS` after one finalized proof execution

#### Scenario: External evidence is missing

- **WHEN** a required external provider has no valid receipt
- **THEN** `proof run` returns `NEEDS_EXTERNAL_EVIDENCE` with provider-specific
  next actions and does not misreport failure as pass

### Requirement: Safe evidence reuse

Foundation SHALL reuse evidence only when the provider's declared inputs are
unchanged and SHALL fall back to global invalidation when input scope is
unknown.

#### Scenario: Dependency evidence survives an application-only edit

- **WHEN** application source changes but dependency manifests and policy inputs
  do not
- **THEN** a valid supply-chain receipt is reusable and the reason is recorded

#### Scenario: Unknown input scope

- **WHEN** a provider has no complete declared input scope
- **THEN** any relevant workspace edit invalidates its receipt

### Requirement: Phase execution accounting

Foundation SHALL record whether each phase runs in a fresh or retained context,
the host session identity, and the recommended and actual model tier.

#### Scenario: Host cannot reset context

- **WHEN** the host continues in the same session
- **THEN** metrics report `contextMode: retained` rather than inferring a fresh
  context from packet size

### Requirement: Standard adapter results

Foundation SHALL parse explicit standard test and mutation results without
installing project dependencies or inventing project commands.

#### Scenario: Node TAP discovery

- **WHEN** a project-owned test command emits valid TAP
- **THEN** the discovery provider records a non-zero discovered count without a
  custom JSON reporter

#### Scenario: Mutation crash

- **WHEN** a mutation command crashes before a behavioral assertion fails
- **THEN** the provider records `error`, not `behavioral-kill`

### Requirement: Honest workflow metrics

Foundation SHALL distinguish active phase time, human wait, provider execution,
context growth, rework, and unknown cost.

#### Scenario: Delay between phase invocations

- **WHEN** a user waits between Build and Prove
- **THEN** the delay is reported as human/phase-transition wait and is not
  silently attributed to Build execution

