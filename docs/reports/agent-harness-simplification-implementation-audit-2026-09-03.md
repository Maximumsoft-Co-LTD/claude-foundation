# Agent harness simplification implementation audit

**Date:** 2026-09-03  
**Status:** Implemented and deterministically verified on the working tree  
**Scope:** Entire tracked repository  
**Plan:** [Agent harness simplification plan](agent-harness-simplification-plan-2026-09-03.md)

## Outcome

Change Loop now presents one small model-facing contract:

```text
User: /investigate | /change | /build | /prove | /land | /dev
Agent: semantic draft/amendment → advance --through build|proven|archived
Harness: compile → validate → isolate → execute → prove → recoverable Land
```

The compatible CLI primitives remain available under `help --all`, but normal
agent instructions no longer require a weak model to assemble the lifecycle
from packet, sandbox, dispatch, provider, authority, and Land subcommands.

The implementation preserves these guarantees:

- compiled OpenSpec documents are the source of truth;
- Build writes stay inside the declared isolated workspace;
- proof remains content-bound and fail-closed;
- Land still requires explicit authority and completes only at `archived`;
- no lifecycle command implies commit, push, publish, or pull-request authority;
- a real stop retains state, identifies the responsible actor, and returns an
  exact resume route.

No new active OpenSpec change was created, as requested. The existing
`openspec/changes/copy-sandbox/` work was preserved and not rewritten.

## Implemented contract

### Semantic authoring

`change start` accepts semantic draft schema 3. The agent supplies intent,
requirements, tasks, coverage, and evidence capabilities once. The compiler
owns stable requirement/claim/task identifiers, cross-file links,
classification, defaults, rendering, validation, isolation, and rollback.

`change amend` accepts semantic amendment schema 1. It adds newly discovered
behavior transactionally without discarding completed checkboxes, diagrams,
custom prose, or unrelated sections. Invalid amendments restore the prior
packet.

The compiler supports multiple specs, diagrams, prototype selections, and
versioned integration documentation. Integration-linked behavior requires
both success and failure scenarios. Local documentation must resolve to a
project file; remote documentation must be a URL. Modified requirements merge
the canonical scenario set, and removed requirements require a migration
consequence.

### Conditional artifacts

Rapid work keeps only the core agreement. Standard work adds delta specs.
`design.md`, `grounding.yaml`, `execution.yaml`, `repositories.yaml`, and
`handoffs.yaml` are emitted only when the semantic contract needs them.
Grounding v3 records non-derived material decisions; legacy grounding remains
readable. Project-owned provider wiring is derived when possible.

### Unified lifecycle

`advance <change> --through build|proven|archived` is the normal coordinator.
It performs safe deterministic chains and returns one bounded protocol-v3
action: `EDIT`, `REPAIR`, `RUN_EXTERNAL`, `ASK_USER`, `WAIT`, or `DONE`.
Automatic work continues while progress changes. Authority, resource, budget,
conflict, or repeated no-progress boundaries preserve state and expose one
resume command. `DONE` identifies the requested target; only `archived` is
delivery completion.

## Whole-repository inventory

The audit covered all 1,601 tracked files. Classification is by ownership and
contract surface so generated and historical records are not rewritten as if
they were current operating instructions.

| Path family | Files | Classification | Result |
|---|---:|---|---|
| `.claude/` | 899 | shipped runtime, commands, hooks, rules, skills, tests, fixtures | Runtime and model-facing contracts aligned; regressions added at compiler, coordinator, hook, CLI, docs, and installer boundaries |
| `openspec/` | 413 | canonical specs, schemas/templates, active and archived records | Current specs and templates aligned; active consumer work preserved; archives remain point-in-time records |
| `website/` | 58 | landing page and bilingual documentation site | Primary workflow, source-of-truth, conditional artifact, integration, recovery, and CLI content aligned in English and Thai |
| `examples/` | 58 | fixtures and sample consumers | Verified as compatibility/test material; no normal-path lifecycle contract needed rewriting |
| `docs/` | 38 | current guides, plans, reports, historical investigations | Current plan/index updated; the report index classifies dated observations as historical |
| `dashboard/` | 34 | optional state viewer and tests | Verified as a state consumer; no command-orchestration behavior changed |
| `scripts/` | 39 | maintainer, release, compatibility, and benchmark tooling | Classified as maintainer surfaces; compatible public commands retained |
| `quality/` | 18 | mutation/quality ownership and surface registry | Website and current Markdown coverage added to the owned surface map |
| `.github/` | 10 | CI and issue metadata | Help-contract checks aligned to compact help plus `help --all` compatibility |
| root and packaging files | 34 | canonical docs, installers, configuration, release files | Runtime API/config/install behavior and bilingual docs aligned; unrelated packaging preserved |

### Files intentionally not rewritten

- `openspec/changes/archive/**`, dated reports, generated HTML reports, release
  notes, and changelog history remain historical evidence.
- `.foundation/**` is machine-owned derived state and is not a source of truth.
- `openspec/changes/copy-sandbox/**` is active user work and remains untouched.
- consumer-owned `CLAUDE.md`, `AGENTS.md`, active OpenSpec changes, and consumer
  configuration remain preserved by install/upgrade behavior.
- generated website output, dependency directories, caches, benchmark output,
  temporary consumers, and secrets are not committed.
- ignored local notes under `docs/` are outside the tracked product surface and
  were preserved unchanged.

## Aligned surfaces

- Slash commands: `.claude/commands/**`
- Agent routes and policy: `.claude/orchestrator.md`, `.claude/rules/**`,
  `.claude/skills/**`
- Runtime and wire contracts: `.claude/harness/**`, `cli.sh`,
  `.claude/harness/protocol.json`
- Live guards: `.claude/hooks/**`
- OpenSpec contracts: `openspec/specs/**`, `openspec/schemas/**`
- Defaults: `foundation.json`
- Installer ownership: `install-codex.sh` and the authoritative `install.sh`
  manifest exercised by installer tests
- Quality and CI: `quality/**`, `.claude/tests/**`, `.github/workflows/**`
- Public docs: `README.md`, `README.th.md`, `WORKFLOW.md`, maintainer guides,
  the landing page, and every English/Thai website lifecycle page

## User-visible change

The six slash commands do not change. Users do not need to learn the new JSON
schemas or primitive commands; those are the agent/harness boundary. The
visible improvement is fewer relays and repeated commands, smaller artifacts,
and more precise repair/resume messages. Existing integrations can continue to
use public primitives and earlier semantic draft versions.

## Verification result

All required implementation gates passed on 2026-09-03:

| Gate | Result |
|---|---|
| Authoritative `.claude/tests/run-all.sh` | PASS; 197/197 scheduled shared suites completed |
| Documentation consistency | PASS; 132/132 assertions |
| Strict OpenSpec validation | PASS; 21/21 specs/changes |
| Website production build | PASS; 37 pages built |
| Quality configuration validation | PASS; 9 documents |
| Installer smoke | PASS; 247 assertions |
| Context budgets | PASS; 117/117 assertions |
| Agent contracts | PASS; 38/38 assertions |
| Shipping semantic mutation | PASS; 4/4 mutants killed |
| Deterministic OpenSpec-native sentinel | PASS; 7/7 frozen scenarios, zero model spend |
| `git diff --check` | PASS |

The deterministic weak-host simulator also reaches `archived` by reading one
action, executing it, and resuming the same command. No paid Qwen/live-model
scenario was run; that remains a separately authorized release activity.

Release preflight was not run because this is an intentionally dirty,
uncommitted implementation tree and no commit or publication authority was
granted. That preflight requires an immutable clean candidate by design.
