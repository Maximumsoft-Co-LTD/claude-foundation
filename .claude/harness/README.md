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
| `EVIDENCE.md` | Evidence v2 provider and adapter reference |
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
claude-foundation doctor
```

Check both the project and one change's executable evidence:

```bash
claude-foundation doctor --change <change>
```

## Operator commands

| Command | What it does | When to use it |
|---|---|---|
| `providers` | Lists supported evidence contracts | Choosing evidence for a change |
| `doctor` | Checks runtime and project readiness | After install or when diagnosing setup |
| `changes` | Lists active changes and readiness | Finding work to resume or land |
| `packet <change>` | Prints a compact phase handoff | Resuming Build or Prove without replaying history |
| `metrics <change>` | Reports measured phase and provider cost | Finding latency or orchestration overhead |
| `validate <change>` | Validates change artifacts | After creating or revising an agreement |
| `proof plan <change>` | Shows missing, stale, or reusable evidence | Before executing providers |
| `proof execute <change>` | Runs required configured providers and finalizes proof | When implementation is ready to prove |
| `proof finalize <change>` | Finalizes from existing valid receipts only | When evidence was recorded separately |
| `evidence run ...` | Runs one provider command and records its receipt | Manual or diagnostic provider execution |
| `evidence record ...` | Records evidence produced by an external system | CI, human review, or remote systems |
| `evidence upgrade <change>` | Upgrades evidence v1 to v2 without guessing commands | Migrating an older active change |
| `sandbox create <change>` | Creates an isolated Git worktree | Before Build |
| `sandbox sync <change>` | Synchronizes a revised agreement | When requirements change during Build |
| `sandbox apply <change>` | Applies a proven sandbox diff to the main worktree | Usually delegated to Land |
| `land check <change>` | Checks proof freshness and landing readiness | Before accepting the change |
| `land archive <change>` | Applies, verifies, archives, and safely cleans up | Completing an accepted change |
| `migrate` | Inspects or migrates legacy workflow evidence | Moving from the legacy workflow |

Run `claude-foundation help` for command syntax and installer options.
Low-level `runtime` commands are reserved for installed slash commands and
diagnostics.

## Normal flow

### 1. Define the agreement

Use `/change` to create or revise `openspec/changes/<change>/`. A complete
change declares its intent, tasks, claims, and required evidence capabilities.
Use `/investigate` first only when the problem or direction is materially
unclear.

Validate the result:

```bash
claude-foundation validate <change>
claude-foundation doctor --change <change>
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

Inspect the execution plan, then run configured evidence:

```bash
claude-foundation proof plan <change>
claude-foundation proof execute <change>
```

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
change, and cleans up a safely owned sandbox. It is designed to be idempotent
when resumed after an interruption.

Foundation does not commit, push, or open a pull request implicitly.

## Evidence model

Evidence v2 stores provider execution contracts beside the claims in
`evidence.yaml`. Four adapters are available:

| Adapter | Use |
|---|---|
| `command` | One deterministic command for one provider |
| `test-discovery` | One test process that emits test and discovery receipts |
| `playwright` | Structured browser evidence mapped to claim annotations |
| `external` | A receipt produced outside Foundation |

Provider names describe what is proven, not which tool runs. The built-in
contracts include behavioral tests, discovery, browser behavior, mutation,
state identity, integration, compatibility, performance, security, review,
static analysis, migration, accessibility, resilience, observability,
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
| `.foundation/logs/` | Provider logs and telemetry events |
| `.foundation/sandboxes/` | Isolated Git worktrees |

Receipts are reusable only while their bound inputs remain unchanged. Relevant
bindings include the workspace hash, change revision, claim scope, adapter
configuration, environment descriptor, platform, and required artifacts.

Use metrics to inspect the actual cost of a run:

```bash
claude-foundation metrics <change>
```

Unknown requests, token usage, cache usage, or monetary cost remain `null`;
Foundation does not manufacture estimates when telemetry is unavailable.

## Playwright ownership

Install Playwright in the application repository, for example:

```bash
npm install --save-dev @playwright/test
npx playwright install chromium
```

The Playwright adapter requires a local, project-owned executable. It will not
use `npx` to download an unpinned package during proof. Keep server startup in
the project's Playwright `webServer` configuration, emit a structured JSON
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

Re-run `doctor` after updating. Runtime and CLI API versions must be compatible,
so update them together rather than copying `foundation.mjs` alone.

## Troubleshooting

- **`permission denied: ./install.sh`** — run `bash ./install.sh <target>` or
  add executable permission intentionally.
- **Playwright is unavailable** — install and lock `@playwright/test` plus the
  required browser in the application repository.
- **Evidence is `inconclusive`** — inspect the receipt and provider log; common
  causes are missing discovered-test counts, missing Playwright claim
  annotations, or absent required artifacts.
- **A receipt became stale** — run `proof plan`; a bound input, agreement
  revision, environment, or artifact changed.
- **Build is in a worktree** — inspect
  `.foundation/sandboxes/<change>` or use `/build <change>`; Land applies the
  proven diff to the main worktree.
- **Requirements changed during Build** — revise the same OpenSpec change and
  run `sandbox sync`; do not preserve a proof for the old agreement.
