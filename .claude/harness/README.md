# Foundation harness runtime

This directory contains the deterministic runtime installed by Claude
Foundation. It turns an OpenSpec change into a bounded implementation and
evidence workflow:

```text
Investigate? → Change → Build → Prove → Land
```

The harness is the control plane, not the coding agent and not a replacement
for project tooling. OpenSpec owns the agreement, the native coding agent owns
the implementation, and project-owned providers such as test runners,
Playwright, linters, or security scanners produce evidence.

## Files in this directory

| File | Role |
|---|---|
| `foundation.mjs` | Runtime used by the public `claude-foundation` CLI |
| `AGENT.md` | Small portable contract loaded by Claude, Codex, and other agents |
| `EVIDENCE.md` | Evidence contract, execution adapter, and proof reference |
| `README.md` | Runtime overview and operator guide |

Use the public CLI instead of invoking `foundation.mjs` directly. The CLI finds
the project from the current directory, or from `--project <path>`, and then
uses the runtime installed in that project.

## Requirements

- Node.js 20.19 or newer
- Git for isolated sandbox/worktree operations
- OpenSpec CLI for schema validation and archival
- Project-owned test and browser dependencies required by configured evidence

Foundation deliberately does not install Playwright, browser binaries, test
frameworks, or application dependencies. Each application must lock and
maintain its own versions.

Check a project before starting:

```bash
claude-foundation doctor --stage change
```

Check both the project and one change's executable evidence:

```bash
claude-foundation doctor --stage prove --change <change>
```

## Operator commands

| Command | What it does | When to use it |
|---|---|---|
| `providers` | Lists supported evidence contracts | Choosing evidence for a change |
| `repos [change]` | Shows discovered topology, drift, and change selection | Setting up or diagnosing multi-repo work |
| `models` | Shows portable model-tier mappings | Reviewing cost/quality routing |
| `agents plan <change> [--group <n>] [--pretty]` | Persists the full plan and prints a ≤4 KiB summary or one dispatch group | Before spawning independent workers |
| `agents task <change> <task> [--pretty]` | Prints a ≤8 KiB task packet with its model and authority | Starting one worker |
| `agents acquire/release ...` | Holds atomic task resource leases with bounded expiry | Around each spawned worker |
| `doctor` | Checks runtime and project readiness | After install or when diagnosing setup |
| `changes` | Lists active changes and readiness | Finding work to resume or land |
| `packet <change> --phase <phase>` | Prints a compact handoff; review packets are ≤8 KiB and exclude Build history | Starting Build, Prove, or independent Review |
| `packet <change> --repo <id> [--task <id>] [--pretty]` | Prints a bounded repository or task packet | Starting a native subagent |
| `metrics <change>` | Reports measured phase/provider cost and emitted context bytes | Finding latency or orchestration overhead |
| `telemetry sync <change> [transcript]` | Incrementally imports native Claude request usage | Manual sync or host-integration fallback |
| `telemetry import <change> <file>` | Imports deduplicated generic, Codex, or Claude host usage | Attributing request/token/cost to orchestration |
| `validate <change>` | Validates change artifacts | After creating or revising an agreement |
| `proof plan <change>` | Shows missing, stale, or reusable evidence | Before executing providers |
| `proof readiness <change>` | Returns READY or a typed blocker with exact next commands | At the end of Build and start of Prove |
| `proof run <change>` | Executes, finalizes, and audits proof as one operation | Normal Prove path |
| `proof preflight <change>` | Validates provider DAG, reports, services, and readiness without running tests | Immediately before proof |
| `proof execute <change>` | Runs required configured providers and finalizes proof | When implementation is ready to prove |
| `proof audit <change>` | Verifies receipt and artifact digests in the durable proof bundle | Before Land or during an audit |
| `proof finalize <change>` | Finalizes from existing valid receipts only | When evidence was recorded separately |
| `evidence run ...` | Runs one provider command and records its receipt | Manual or diagnostic provider execution |
| `evidence record ...` | Records evidence produced by an external system | CI, human review, or remote systems |
| `evidence upgrade <change>` | Upgrades evidence v1 to v2 without guessing commands | Migrating an older active change |
| `sandbox create <change>` | Creates an isolated Git worktree | Before Build |
| `sandbox inspect <change> [--json] [--unattended]` | Separates workspace isolation from detected execution security | Before deliberately unattended work |
| `sandbox create <change> --unattended` | Fails closed; detected virtualization is not trusted host attestation | Unattended Build only |
| `sandbox create <change> --all` | Creates one sandbox per selected writable repository | Before a multi-repo Build |
| `sandbox sync <change>` | Synchronizes a revised agreement | When requirements change during Build |
| `sandbox apply <change>` | Applies a proven sandbox diff to the main worktree | Usually delegated to Land |
| `land check <change>` | Checks proof freshness and landing readiness | Before accepting the change |
| `land plan <change>` | Shows ordered child commit, CI, and pointer states | Coordinating multiple repositories |
| `land record <change> ...` | Binds an explicitly created child commit | After authorized commit/CI work |
| `land pointers <change>` | Transactionally stages verified child gitlinks | After child commits land, before final Prove |
| `land resume <change>` | Rechecks the resumable Land saga | After a child PR or branch lands |
| `land archive <change>` | Applies, verifies, archives, and safely cleans up | Completing an accepted change |
| `migrate` | Inspects or migrates legacy workflow evidence | Moving from the legacy workflow |

`--unattended` is a presence-only security flag. Valued and duplicate forms
are rejected before telemetry or workspace mutation. This is a cooperative host
preflight, not automatic detection of an external Allow All setting. The current
runtime always fails closed until a trusted host-owned attestation exists.

Review and acceptance adapters are external-only. Review packets combine
committed and dirty paths from recorded repository bases. Protocol-v2 receipts
store reviewer/subject tuples and bind the complete receipt to a change-level
hash-chained attempt history; deleting a receipt or renaming a provider cannot
reset the two-AI limit. Acceptance is revalidated against explicit claims, human
identity, criteria, observation, provenance, durable evidence, contract reason,
and workspace hash.

Run `claude-foundation help` for command syntax and installer options.
Low-level `runtime` commands are reserved for installed slash commands and
diagnostics.

## Repository and model execution

The committed `openspec/repositories.yaml` describes root, submodule, Git, and
external nodes. A monorepo remains one Git repository and uses task path scopes
rather than pretending packages are independently landable remotes.
Per-change `repositories.yaml` selects access
and dependency scope. The runtime creates child worktrees under
`.foundation/repository-sandboxes/`, hashes them into one composite snapshot,
and scopes provider commands and receipts with `repository`.

`tasks.md` stays the only ledger. `[repo:<id>]`, `[depends:<task-ids>]`,
`[kind:<kind>]`, `[paths:<paths>]`, and `[resources:<locks>]` are compact
execution annotations. `agents plan` uses them to prevent same-workspace or
shared-resource concurrency and applies the model tiers in `foundation.json`.
The complete plan is persisted under `.foundation/plans/`; stdout is a compact
summary, or one group selected with `--group`. `agents task` emits only the
chosen task's claims, files, providers, and model. A small one-repository change
recommends one agent. The plan is advice and bounded authority for the native
host; the harness does not invoke a model itself.

JSON output is compact by default and `--pretty` is inspection-only. Plan
schema 2 resumes dependencies satisfied by completed tasks, reports
`proof-ready` after all tasks complete, and declares the deepest model required
by a mixed session. Packet schema 4 rejects unknown, cross-repository, or
providerless task claims. Large collections are previews plus counts and
digests; use the task packet as the authoritative expansion.

Multiple remotes use ordered saga states rather than an atomicity claim.
Foundation verifies explicit child commits, optional CI state, dependency
order, root gitlinks, and fresh composite proof. It never commits or pushes
without separate authority.

## Normal flow

### 1. Define the agreement

Use `/change` to create or revise `openspec/changes/<change>/`. A complete
change declares its intent, tasks, claims, and required evidence capabilities.
Use `/investigate` first only when the problem or direction is materially
unclear.

Validate the result:

```bash
claude-foundation validate <change>
claude-foundation doctor --stage build --change <change>
```

### 2. Build in isolation

Use `/build <change>`. For a Git project, the harness creates an isolated
workspace under `.foundation/sandboxes/<change>`.

If Build reveals a new requirement, revise the same change and synchronize it:

```bash
claude-foundation sandbox sync <change>
```

Synchronization increments the change revision and invalidates receipts or
proofs that no longer describe the current agreement.

### 3. Prove the claims

Use the atomic proof path:

```bash
claude-foundation proof readiness <change>
claude-foundation proof run <change>
```

`proof plan`, `preflight`, `execute`, `finalize`, and `audit` remain available
for diagnosis and recovery.

The scheduler:

- reuses receipts bound to unchanged inputs;
- deduplicates identical commands within an execution;
- runs independent read-only providers concurrently;
- serializes providers that share exclusive resources;
- marks incomplete or ambiguous evidence `inconclusive` instead of guessing.

A successful command is not automatically sufficient evidence. Every declared
claim must be covered by a valid receipt from each required capability. See
[EVIDENCE.md](EVIDENCE.md) for adapter configuration, Playwright claim
annotations, resource locks, and receipt reuse rules.

### 4. Land transactionally

Check readiness:

```bash
claude-foundation land check <change>
```

Then complete the change:

```bash
claude-foundation land archive <change>
```

`land archive` verifies the content-bound proof, applies the isolated diff when
needed, checks state identity, synchronizes the specs, archives the OpenSpec
change, and cleans up a safely owned sandbox. Before mutation it builds an
immutable touched-path projection, backs up those paths, and writes an apply
journal. Each write is verified; failure rolls the projection back while
leaving unrelated target edits alone. The sandbox remains the proof subject
until archive completes, so an interrupted OpenSpec archive can resume without
invalidating proof. Transaction backups are removed only after archive audit.

Foundation does not commit, push, or open a pull request implicitly.

## Evidence model

`evidence.yaml` stores stable behavioral claims. `execution.yaml` stores
commands, reports, services, readiness identity, and resource wiring. Legacy
changes that keep `providers` in `evidence.yaml` remain readable; `evidence
upgrade` separates them. Four adapters are available:

| Adapter | Use |
|---|---|
| `command` | One deterministic command for one provider |
| `test-discovery` | One test process that emits test and discovery receipts |
| `playwright` | Structured browser evidence mapped to claim annotations |
| `external` | A receipt produced outside Foundation |

Provider names describe what is proven, not which tool runs. The built-in
contracts include behavioral tests, discovery, browser behavior, mutation,
state identity, integration, compatibility, performance, security, review,
static analysis, migration, accessibility, resilience, observability, acceptance,
deployment, and supply-chain checks.

The project selects only the capabilities required by the risk and claims of
the change. Task size affects budgeting and slicing; it does not weaken proof.

## Runtime state

Generated state lives under `.foundation/` and must not be treated as product
source:

| Path | Contents |
|---|---|
| `.foundation/runtime/` | Runtime operation and handoff state |
| `.foundation/receipts/` | Content-bound provider receipts |
| `.foundation/evidence/` | Immutable proof bundles, receipt copies, reports, logs, and attachments |
| `.foundation/snapshots/` | One content snapshot descriptor per proof |
| `.foundation/logs/` | Provider logs and telemetry events |
| `.foundation/sandboxes/` | Isolated Git worktrees |

Receipts are reusable only while their bound inputs remain unchanged. Every
required artifact is copied into the evidence vault and bound by SHA-256 and
byte size. Proofs bind receipt digests, contract and execution fingerprints,
the workspace snapshot, environment descriptor, and protocol versions.

Use metrics to inspect the actual cost of a run:

```bash
claude-foundation metrics <change>
```

Context is budgeted at the control surface: plan summaries are at most 4 KiB,
task and review packets 8 KiB, repository packets 12 KiB, and global packets 16 KiB.
Oversized artifacts are referenced by path and digest. The budget covers the
exact compact bytes written to stdout. Every emitted plan and packet records
its byte count as an atomic event below
`.foundation/logs/<change>/context-events/`; old events roll into a bounded
summary. Telemetry is best-effort and cannot block packet delivery. `metrics`
tolerates legacy/malformed rows and reports totals, estimated tokens, retained
and archived event counts, median, p95, and maximum by kind.

Crossing a request or token budget emits `STOP_AND_SPLIT` and blocks additional
model exploration, not deterministic lifecycle recovery. Packet, readiness,
evidence, proof-resume, metrics, and archive commands continue and reuse fresh
receipts instead of replaying completed providers.

Claude request telemetry is request-owned, not tool-owned. The `SessionStart`
hook exposes only `session_id` and `transcript_path` to later Foundation
commands. It does not parse the transcript and there is no per-tool telemetry
hook. `packet --phase`, Prove, Land, and `metrics` then read only complete JSONL
records added since the previous cursor. Main-agent and nested subagent
transcripts are deduplicated by request/message identity.

Only usage metadata is persisted: model, request/session identity, timestamp,
phase, agent, input/output tokens, separate cache-creation/cache-read tokens,
and cost when the host supplies it. Prompt text, tool input, and tool output are
never copied to `.foundation/logs/`. `PostToolUse` remains reserved for
behavioral hooks such as linting edited files.

Use an explicit sync when the lifecycle hook was not active:

```bash
claude-foundation telemetry sync <change> ~/.claude/projects/.../session.jsonl
```

Use `telemetry import` for other hosts or historical files. Unknown requests,
token usage, cache usage, or monetary cost remain `null`; Foundation does not
manufacture estimates when telemetry is unavailable. Claude transcript parsing
is schema-validated and isolated behind the host adapter so a future host
format change cannot silently become fabricated usage.

## Playwright ownership

Install Playwright in the application repository, for example:

```bash
npm install --save-dev @playwright/test
npx playwright install chromium
```

The Playwright adapter requires a local, project-owned executable. It will not
use `npx` to download an unpinned package during proof. Server startup may live
in project Playwright configuration or a named `execution.yaml` service. Named
services require an identity-bearing readiness body/header so an unrelated
process on the same port cannot produce a false green. Emit a structured JSON
report, annotate tests with the claims they prove, and configure traces,
screenshots, videos, console-error handling, and page-error handling in the
project.

## Updating an installed copy

The source installer manages this entire directory, including this README:

```bash
bash ./install.sh /path/to/project
```

For a packaged installation:

```bash
claude-foundation init /path/to/project --yes
```

The installer records `.foundation/install-manifest.txt`, removes only stale
Foundation-owned files, preserves project files and managed blocks in
`CLAUDE.md`/`AGENTS.md`, then refreshes the runtime as one bundle. Re-run
`doctor` after updating. Runtime and CLI API versions must be compatible.

## Troubleshooting

- **`permission denied: ./install.sh`** — run `bash ./install.sh <target>` or
  add executable permission intentionally.
- **Playwright is unavailable** — install and lock `@playwright/test` plus the
  required browser in the application repository.
- **Evidence is `inconclusive`** — inspect the receipt and provider log; common
  causes are missing discovered-test counts, missing Playwright claim
  annotations, or absent required artifacts.
- **A configured provider is unavailable** — run `proof readiness <change>`.
  `INFRASTRUCTURE_ERROR` returns structured `next` choices to diagnose the
  environment, retry, record verifiable external evidence, or reconfigure an
  available project-owned command that proves the same claims. It never
  converts an unavailable provider into passing evidence.
- **Readiness says code or configuration is incomplete** —
  `NEEDS_CODE_CHANGE` returns the `/build` resume command and pending task IDs;
  `CONFIGURATION_ERROR` returns doctor, `/change`, affected config files, and a
  validation command. Operators should not need to infer the next lifecycle
  action from a status label.
- **`changes` reports `orphan-runtime`** — the runtime state exists but its
  active OpenSpec directory does not. Restore that directory, or move the JSON
  state into `.foundation/recovery/orphaned-runtime/` for recoverable
  quarantine. `doctor --change <id>` fails explicitly until reconciled.
- **A receipt became stale** — run `proof plan`; a bound input, agreement
  revision, environment, or artifact changed.
- **Readiness is rejected** — add `expectBody` or `expectHeader` that identifies
  the intended application, not merely an HTTP status.
- **An archived proof fails audit** — restore the immutable evidence bundle or
  rerun proof; Land never treats a missing/tampered report as passing.
- **Build is in a worktree** — inspect
  `.foundation/sandboxes/<change>` or use `/build <change>`; Land applies the
  proven diff to the main worktree.
- **Requirements changed during Build** — revise the same OpenSpec change and
  run `sandbox sync`; do not preserve a proof for the old agreement.
