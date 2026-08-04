# Foundation workflow

**Version 3.1.6**

Foundation is an OpenSpec-native harness for safe, economical software changes
in brownfield repositories.

```text
Investigate? → Change → Build → Prove → Land
```

## Why this shape

The previous workflow encoded quality as a long sequence of agent roles and
phases. That preserved quality but made the control plane dominate cost and
latency. The new workflow separates three concerns:

- OpenSpec stores the agreement.
- The native coding agent implements the agreement.
- Deterministic providers prove the agreement.

Rigor scales with risk and evidence needs, not with a task-size phase matrix.

## Commands

### `/investigate <problem>`

Use only when the problem or direction is unclear. Exploration is bounded,
read-only with respect to product code, and may produce an investigation note.
Its output is facts, hypotheses, options, tradeoffs, and a next decision.

### `/change <intent>`

Creates or completes `openspec/changes/<id>/`. The resolver records:

- ambiguity: clear or unclear;
- impact: low, medium, or high;
- coupling: isolated or coupled;
- evidence capabilities;
- size for budget and slicing only;
- semantic security and review triggers.

Standard changes contain proposal, delta specs, design, tasks, evidence, and
execution wiring. Rapid changes contain proposal, tasks, evidence, and execution
wiring and upgrade in place if risk emerges.

`/investigate <decision> --compare` is the optional disposable mode for
genuinely unresolved experience, API, or architecture alternatives. It writes only under
`.foundation/prototypes/`, never edits product code, and adds no lifecycle state;
the selected conclusion is always written to `selection.md`. Continue with
`/change <intent|existing-change> --prototype-selection <selection-path>`; Change
summarizes the decision into proposal/design without treating the ignored
selection or its artifacts as evidence. The runtime rejects local prototype
artifacts and references before they can enter a receipt or proof bundle.

### `/build <change>`

The native harness reads the compact change packet and implements it. `tasks.md`
is the only ledger. Focused checks run during convergence. Native task primitives
or subagents are used only for independently verifiable parallel/resumable work
packages, not lifecycle personas.

For a Git project, create an isolated worktree with:

```bash
claude-foundation sandbox create <change>
```

This is workspace isolation, not an OS security boundary. Inspect the distinction
with `sandbox inspect <change>`. A host that deliberately runs unattended must
use `doctor --stage build --change <change> --unattended` and
`sandbox create <change> --unattended`. Detection is diagnostic, not authorization:
the current runtime accepts no workspace-controlled override and fails unattended
execution closed pending a trusted host-owned attestation mechanism.
`--unattended` is a presence-only security flag: valued or duplicate forms are
rejected before telemetry, workspace inspection, or sandbox mutation. The guard
is cooperative because the runtime cannot infer an external Allow All setting;
the host that enables unattended execution must invoke the guarded form.

For a selected multi-repository topology:

```bash
claude-foundation repos <change>
claude-foundation sandbox create <change> --all
claude-foundation agents plan <change> [--group <n>] [--pretty]
claude-foundation packet <change> --task <task-id> [--pretty]
```

The plan permits parallel workers only across independent repositories and
resources. The full plan is persisted while stdout stays below 4 KiB; workers
receive only an 8 KiB task packet. A one-repository change with at most two
ordinary tasks stays with one agent. It routes mechanical inventory to the configured Haiku/fast tier,
normal implementation to Sonnet/standard, and architecture, security,
migration, or independent review to Opus/deep. Exact model versions remain host
configuration.

Resume planning considers completed tasks as satisfied dependencies and returns
`proof-ready` when no implementation remains. Dispatch is denied when a task
claims behavior outside its repository authority or has no evidence provider.
Load one primary construction skill per task; add only the security and
observability cross-cutting skills whose triggers apply.

If requirements or design change during Build, pause, revise the same OpenSpec
change, then synchronize it without losing unchanged completed tasks:

```bash
claude-foundation sandbox sync <change>
```

Sync increments the revision and invalidates previous proof.

### `/prove <change>`

Proof validates artifacts, hashes relevant inputs, resolves claims to providers,
reuses valid receipts, executes missing/stale evidence, and writes a proof bound
to the workspace hash.

```bash
claude-foundation proof readiness <change>
claude-foundation proof run <change>
```

Required evidence that is failed, missing, stale, erroneous, or inconclusive
blocks landing.

Execution adapters run project-owned commands. `test-discovery` produces
two receipts from one process; `playwright` consumes a structured JSON report
and requires claim annotations. The scheduler reuses valid receipts,
deduplicates identical commands, and runs providers concurrently only when
their declared resources do not conflict. Evidence v1 remains manual-compatible
and upgrades explicitly with `claude-foundation evidence upgrade <change>`.

When executable wiring is absent, `evidence detect` inspects repository-owned
manifests without executing scripts, `evidence init` previews high-confidence
additions and writes them only with `--write`, and `evidence doctor` reports
remaining ambiguity or external authority. Detection never installs tools,
creates receipts, overwrites configured providers, or weakens claim coverage.

`change audit` checks scenario → claim → task → provider traceability, including
negative security paths and migration rollback/integrity. Tasks link explicitly
with `[claims:<claim-id>]`.

Remote CI can return a signed envelope through `evidence verify-ci`; issuer,
workspace, optional commit, run URL, and artifact digests are verified before a
receipt is created. Human review and acceptance use `authority request`,
`authority status`, and `authority record`, so external work is resumable,
expires when abandoned, becomes stale with the workspace, and cannot bypass the
existing receipt validator.

### `/land <change>`

Landing checks proof freshness, applies a proven sandbox diff when applicable,
verifies state identity, then delegates semantic spec sync and archive to the
pinned OpenSpec CLI.

```bash
claude-foundation land check <change>
claude-foundation land archive <change>
```

Commit, push, and pull-request effects require explicit authorization.

### `/changes`

Lists active changes and distinguishes in-progress, proven, stale-proof, and
ready-to-land states.

### `/dev`

Compatibility composition:

```text
/change → /build → /prove
```

It never lands by implication. `--plan-only` stops after `/change`;
`--resume <id>` resumes an active OpenSpec change.

## Schemas

### `foundation-rapid`

Allowed only when all are true:

- low impact;
- isolated;
- no public contract change;
- no persistent migration;
- no semantic security trigger;
- no irreversible effect;
- unit/static evidence is sufficient.

### `foundation-standard`

Used for all other changes. Design remains concise and records only decisions
that constrain implementation, compatibility, rollout, rollback, or proof.

## Evidence

`evidence.yaml` is the stable JSON-compatible behavioral contract.

```json
{
  "version": 2,
  "claims": [
    {
      "id": "owner-updates-profile",
      "scenario": "An authenticated owner updates their profile",
      "impact": "medium",
      "capabilities": ["test"]
    }
  ]
}
```

`execution.yaml` separately holds commands, structured reports, named services,
readiness identity, resources, and environment variable names. Legacy embedded
providers remain readable and migrate with `evidence upgrade`.

Supported capabilities:

| Provider ID | Select it when the claim requires |
|---|---|
| `test` | Executable behavioral checks |
| `discovery` | Proof that the expected tests were actually found |
| `browser` | Rendered behavior or real input in a browser |
| `mutation` | Proof that tests detect a deliberate behavioral fault |
| `state-identity` | Actor, revision, or before/after state identity |
| `integration` | Multiple components or external boundaries working together |
| `compatibility` | Public or persisted contract compatibility |
| `performance` | A measured latency, throughput, resource, or size budget |
| `security-static` | Static security analysis of a changed trust boundary or sink |
| `cross-repo-contract` | Agreement between producer and consumer repositories |
| `review` | Independent risk review |
| `acceptance` | Named human acceptance of an explicitly subjective decision |
| `static-analysis` | Compile, type, lint, or static quality gates |
| `data-migration` | Forward migration, mixed-version safety, and rollback |
| `accessibility` | Semantics, keyboard, focus, contrast, or assistive access |
| `resilience` | Timeout, retry, partial failure, recovery, or degraded dependency |
| `observability` | Required logs, metrics, traces, or alerts |
| `deployment` | Package, configuration, rollout health, or rollback behavior |
| `dependency-supply-chain` | Vulnerability, license, lockfile, or provenance policy |

Run `claude-foundation providers` to inspect the canonical
catalog installed in a project. Providers are evidence contracts, not bundled
vendor tools: `/prove` may execute the repository's existing command with
`run-provider`, or record a receipt from an external system. Select only
providers justified by observable claims.

Test evidence automatically requires suite-level discovery evidence.
Risk-triggered changes automatically require review evidence. After Build, a
changed-surface policy adds supply-chain, migration, accessibility,
compatibility, security/review, or deployment obligations when relevant files
changed.

Each receipt records provider/version, change, claims, workspace hash, result,
observations, capability metadata, command/log, and timestamps. Status is one of
`pass`, `fail`, `inconclusive`, or `error`.

The provider protocol is deny-by-default: a provider may cover only claims that
declare it, executable providers require an explicit `--claims` scope, and a
provider protocol/version/fingerprint change invalidates old receipts. Browser
receipts record `foreground-required` and `foreground-available` independently.
Playwright uses the distinct `browser-automation` input mode. Foundation does
not install Playwright or browser binaries; `doctor --stage prove --change
<id>` checks the project-owned command, dependency, configuration, readiness
identity, execution DAG, and report topology.

If a configured provider is unavailable, readiness returns
`INFRASTRUCTURE_ERROR` with structured recovery choices: diagnose, retry,
record verifiable external evidence, or reconfigure an available project-owned
command for the same declared claims. Recovery never weakens claim coverage or
manufactures a passing receipt.

Every non-ready state provides an explicit recovery path. Pending tasks return
`NEEDS_CODE_CHANGE` with `/build` and task-plan pointers; topology or agreement
issues return `CONFIGURATION_ERROR` with doctor, `/change`, affected files, and
validation pointers. `changes` also exposes non-archived runtime files whose
active OpenSpec directories disappeared as `orphan-runtime`, and doctor reports
how to restore or quarantine them.

When executable project evidence and external review are both required, run
`claude-foundation proof collect <change>` first. It records workspace-bound
receipts without finalizing proof, allowing the review packet to carry executed
test evidence. After the external receipt is recorded, `proof run` reuses those
receipts and finalizes atomically.

## Review

Review is required for high impact, authentication/authorization, public
compatibility, migration, irreversible mutation, concurrency, monetary logic,
multi-repository contracts, anomalous evidence, or explicit policy.

Required review starts from the ≤8 KiB `packet --phase review`, never Build
history. Its changed surface unions committed base-to-HEAD paths with staged,
unstaged, untracked, renamed, and deleted paths for each repository; a missing
recorded base blocks review instead of appearing clean. Every review receipt
identifies the reviewer and one or more structured implementation subjects.
Critical security, migration, compatibility, monetary, or irreversible changes
require a different model/provider family or a human; other reviews require a
fresh context and prefer diversity. AI re-review is limited to two rounds, after
which unresolved work escalates to a human. A change-level hash chain binds each
attempt to its receipt payload, so deleting a receipt or renaming its provider
cannot reset the limit. Missing or modified history fails closed. Workspace edits
stale prior review.

Human acceptance is separate from review and is required only when `/change`
explicitly declares a subjective product or experience decision. Its receipt is
bound to explicit claim IDs, the final workspace, named nonblank criteria, human
identity, observation, provenance, and a durable artifact or reference. Review and
acceptance remain external-only; the deterministic runtime never invokes a model
or impersonates a human.

Findings are `verified`, `hypothesis`, `disproved`, or `accepted-risk`.
Hypotheses require deterministic reproduction before becoming confirmed major
findings.

## Security resolver

Triggers are semantic: identity/access, secrets, permissions, cross-user data,
network trust, irreversible mutation, sensitive storage, unsafe sinks, public
security contracts, and security-relevant migrations. Syntax alone is not risk.

## Invalidation

Foundation creates one relevant workspace snapshot per proof and shares its
identity across receipts.
It excludes runtime receipts, sandboxes, dependencies, legacy workflow records,
other active changes, and archived changes. Any relevant edit makes prior
receipts and proof stale.

## Preflight and telemetry

Run `doctor --stage change|build|prove`. Change and Build allow commands that
are explicitly planned but not created yet. Prove requires executable providers
and rejects dependency cycles, report collisions, secret-like literal
environment values, and status-only readiness probes. Add `--require-archive`
when the intended flow includes landing.

Native CLI operations append duration and exit state on a best-effort basis to
`.foundation/logs/<change>/operations.jsonl`. Request, token, cache, and cost
come from uniquely identified host request records; unknown usage is never
reported as zero. Claude Code binds its session transcript at `SessionStart`
and incrementally reads only `assistant.message.usage` at phase checkpoints.
There is no per-tool telemetry hook, and prompt/tool payloads are never copied.
Other hosts use `telemetry import --format generic|codex|cursor|otel|claude`;
OpenTelemetry GenAI/LLM attributes normalize into the same append-only event
contract.

Use `claude-foundation metrics <change>` to aggregate phase timing, unique
provider execution time, request/token/cache/cost totals, orchestrator token
share, and emitted context bytes without double-counting receipts emitted by
one combined execution.

`claude-foundation packet <change> --phase build|prove|review` emits the bounded
handoff for a fresh execution context. Global, repository, task, and review
packets are capped at 16, 12, 8, and 8 KiB respectively and reference larger artifacts by
path and digest. Compact JSON is the default and is the exact measured budget;
`--pretty` is available for people. Collection previews include counts and
digests, with task packets providing authoritative expansion. Atomic context
events are best-effort, concurrency-safe, tolerant of legacy rows, and rolled
up when their retained set grows. The phase marker first closes usage
from the prior phase using the incremental transcript cursor. Large changed-file
sets collapse into prefix counts plus a digest. Build and Prove consume this
packet instead of replaying the full orchestrator transcript.

## Sandbox safety

Foundation sandboxes protect workspace/apply integrity. They do not by themselves
contain processes, network access, host secrets, or system commands. Never infer
that a Git worktree or copied directory is safe for Allow All/unattended execution.

- Git projects use detached temporary worktrees.
- The target HEAD must remain at the recorded base before apply.
- `git apply --check` runs before target mutation.
- Apply identity covers only paths changed by the proven sandbox. Unrelated
  target edits are preserved and excluded from the projection comparison.
- Touched paths and change artifacts are backed up and journaled before writes;
  failures roll back and interrupted transactions recover on retry.
- The sandbox remains the proof subject until archive and proof audit finish.
- Conflicts stop without overwriting unrelated user edits.
- Mutation testing happens only in isolation.

Non-Git projects use an isolated temporary copy with a before/after content
manifest. Apply rejects any touched target path changed since the baseline,
then verifies the expected touched-path projection. Multi-repository changes use one
OpenSpec change plus a repository manifest and require cross-repository contract
evidence before each repository is landed in its declared order.
Their workspace identity is composite, while providers configured with
`repository` bind receipts to one repository snapshot. Unrelated repository
edits therefore preserve scoped evidence; contract and producer/consumer edits
still invalidate integration evidence. Multiple remotes Land through an
ordered, resumable saga with explicit commit/CI records and root pointer
verification, never by claiming atomic remote mutation.

## Watchdog

The external event ledger requires unique request identity and records operation,
agent/model, parent request, tokens, cache, cost, tool, hash, and change. The
watchdog evaluates the larger of request usage and configured token usage, so a
small number of unusually large requests cannot bypass the thresholds.

Budget actions:

- 70%: batch remaining work and reuse evidence;
- 85%: stop speculative exploration;
- 100%: stop and split or re-scope.

The stop applies to further model exploration. Deterministic packet, readiness,
evidence, proof-resume, metrics, and archive commands remain available, and
fresh receipts are reused. Required evidence is never removed to meet budget.

## Legacy migration

`.workflow/` is no longer runtime state. Existing records remain read-only.

```bash
claude-foundation migrate
claude-foundation migrate <legacy-id> --apply
```

Apply creates migration candidates, not authoritative specs. Only statements
corroborated by code, tests, or accepted contracts may be promoted.

## Native CLI

`claude-foundation` is the stable public control surface. It searches upward
from the working directory, or from `--project <path>`, and forwards to the
runtime installed in that project so schemas and runtime behavior stay aligned.
Use canonical `change`, `packet`, `evidence detect|init|doctor`,
`proof readiness|collect|run`, `sandbox create|sync`, and
`land check|record|resume|archive` commands rather than calling runtime
internals directly.

When the packaged CLI is not on `PATH`, use the source checkout's public router:

```bash
bash /path/to/claude-foundation/cli.sh --project "$PWD" proof readiness <change>
```

Do not bypass it with `foundation.mjs`; that file intentionally exposes the
hyphenated low-level runtime API rather than the public nested command grammar.

## Runtime layout

```text
foundation.json
openspec/
  config.yaml
  repositories.yaml
  schemas/
  specs/
  changes/

.foundation/
  runtime/
  receipts/
  logs/
  sandboxes/
  repository-sandboxes/
  plans/
  leases/
```

The contents under `.foundation/` are machine-owned and ignored by Git.

## Requirements

- Node.js 20.19 or later
- OpenSpec pinned to `@fission-ai/openspec@1.7.0`
- Git for worktree isolation
- `jq` for automatic settings merge during installation

## Quality invariants

- Zero discovered tests cannot silently pass.
- Missing expected evidence cannot silently pass.
- Browser capability mismatch is inconclusive.
- Mutation crash is not a behavioral kill.
- Stale proof cannot land or archive.
- A sandbox diff cannot overwrite a conflicting target.
- OpenSpec performs semantic spec sync before archive.
- Required assurance is never dropped because of size or budget.
