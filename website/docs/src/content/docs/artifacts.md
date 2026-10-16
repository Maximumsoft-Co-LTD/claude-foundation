---
title: Files, readers, and ownership
description: What users review, what the project owns, and what the agent or harness maintains.
---

<!-- docs-audience: users -->
**Audience:** project users. This guide explains what to review and decide; the agent handles routine system operations.

File ownership and intended reader are different things. A project-owned
agreement can be compiled by the harness, and an agent can write project-owned
code. You review the intent and result; you do not have to maintain internal state.

## What belongs to whom?

| Category | Examples | Your role | Writer and upgrade behavior |
|---|---|---|---|
| Project agreement | `openspec/specs/`, `openspec/changes/`, `openspec/investigations/` | Review behavior, scope, decisions, and outcomes | Agent authors inputs; harness compiles and updates the packet. Installer preserves it |
| Project configuration | `foundation.json`, `openspec/config.yaml`, `openspec/repositories.yaml`, `quality/` | Choose project policy; ask the agent to configure it | Project maintainer or authorized agent; installer seeds/merges supported configuration |
| Project instructions | `CLAUDE.md`, `AGENTS.md`, `.claude/settings.json` | Keep your project's instructions and preferences | Installer updates marked pointer blocks and merges supported host settings, not whole project instructions |
| Installed Change Loop files | `WORKFLOW.md`, `.claude/harness/`, managed commands/skills/hooks, `openspec/schemas/` | Read as reference; customize project configuration instead | Change Loop maintains these; upgrades refresh managed files |
| Runtime records | `.foundation/runtime/`, `receipts/`, `evidence/`, `transactions/` | Read diagnostics if needed; do not edit records to change a verdict | Harness and configured tools write these through supported operations |
| Temporary inputs and working code | `.foundation/drafts/`, declared sandbox code/test paths | Review the compiled agreement and final diff | Agent writes inputs and implementation; sandbox work may not yet be delivered |

**Do not delete `.foundation/` to reset work.** It may hold unlanded code,
evidence history, recovery journals, backups, and optional local policy.
Ignored by Git does not mean safe to delete. Ask the agent to use the supported
recovery or cleanup flow.

In the Change Loop source repository, root `CLAUDE.md` and `AGENTS.md` guide
maintainers. In your installed project, files with those names remain your
project instructions. Repository tests, reports, and the documentation website
are upstream maintenance material, not prerequisites for using Change Loop.

The [system ownership reference](https://github.com/Maximumsoft-Co-LTD/claude-foundation/blob/main/.claude/harness/README.md#file-ownership-and-writers)
defines the full categories and writer rules; your installed copy is at
`.claude/harness/README.md`. The installer's `MANAGED` list and your
`.foundation/install-manifest.txt` determine installed-file ownership.

## The `openspec/` tree

```text
openspec/
├── config.yaml          project OpenSpec configuration and authoring rules
├── repositories.yaml    repository topology and per-repository CI issuers
├── specs/               the requirements the landed system is held to
├── changes/
│   ├── <change-id>/     one active change packet
│   └── archive/         landed packets, dated
├── investigations/      durable findings from /investigate
└── schemas/             the two assurance profiles and their templates
```

Ownership is not uniform across that tree, and it decides what an upgrade may
overwrite:

| Path | Owner | On install |
|---|---|---|
| `schemas/` | Change Loop | **Overwritten every install.** Edit a profile here and the next upgrade discards it |
| `config.yaml` | your project | Copied only when missing, yours afterwards |
| `repositories.yaml` | your project | Copied only when missing, yours afterwards |
| `specs/`, `changes/`, `investigations/` | your project | Never touched by the installer |

`foundation.json` sits at the repository root rather than in `openspec/`,
because it holds project *policy* rather than intent: execution budgets, packet
size caps, model tiers, escalation triggers, the review diversity and
independence settings, and the sandbox setup command (`sandbox.setupCommand`)
that runs once inside every new Build workspace.
It is seeded when missing and remains project-owned. Upgrades can add missing
fields and migrate recognized legacy defaults while preserving custom policy.

See [Configure foundation.json](/docs/foundation-config/) for policy fields,
current defaults, and review settings. This page describes ownership rather
than duplicating those defaults.

Consumer quality adds another committed, project-owned tree:

```text
quality/
├── foundation-quality.json       repository profiles, providers, thresholds, exceptions
└── baselines/
    ├── manifest.json             decision references and baseline provenance
    └── <repository>/             versioned CRAP and mutation reports
```

`quality init` previews this configuration before writing it. Baselines are
never created implicitly: `quality baseline --write` requires both a decision
reference and a reason. See [Consumer quality gates](/docs/consumer-quality/).

:::caution[Two files named `repositories.yaml`]
`openspec/repositories.yaml` describes the project's repository topology.
`openspec/changes/<id>/repositories.yaml` describes the repositories **one
change** touches and in which mode when explicit multi-repository scope exists.
Without the packet file, the semantic default is the single `root` repository.
They are different files with the same name; a provider that reads the wrong
one silently scopes to the wrong set.
:::

`config.yaml` is worth reading once. It carries the default schema plus the
authoring rules every change inherits — what a proposal must state, that specs
use stable names and WHEN/THEN, that design records only decisions constraining
implementation or rollback, and that `tasks.md` stays a single ledger. Changing
it changes what the harness asks of every future change.

## The change packet

One directory per active change, at `openspec/changes/<change-id>/`. This is
what a reviewer reads.

| File | What it holds | Profile |
|---|---|---|
| `proposal.md` | Summary, why, user stories, success criteria, a capability index, what observably changes, impact, and non-goals; discovery coverage as an appendix | both |
| `tasks.md` | The sole implementation ledger — the only place work is tracked | both |
| `evidence.yaml` | The stable behavioral contract: claim IDs, scenarios, capabilities | both |
| `grounding.yaml` | Semantic v3 non-derived material decisions; legacy read-set grounding remains readable | conditional when a decision must be locked |
| `execution.yaml` | Replaceable custom wiring: provider commands, services, readiness | conditional when derived wiring is insufficient |
| `repositories.yaml` | Explicit repository selection and write modes | conditional for multi-repository scope |
| `handoffs.yaml` | Permission-bound external operations and activation safety | conditional when such work exists |
| `.openspec.yaml` | Which assurance profile governs the packet | both |
| `design.md` | Overview, assumptions and open questions, typed blueprints, a task overview, durable decisions (including settled intake answers), diagrams, integrations, compatibility, and risks; empty sections are omitted | standard, conditional on design context |
| `specs/**/spec.md` | Requirement deltas — `ADDED`, `MODIFIED`, `REMOVED` | both (rapid: concise; absent only in legacy `skip_specs` packets) |

A `foundation-rapid` packet has a concise spec delta, merged into `openspec/specs`
at Land, and normally omits `design.md`; agent defaults appear under Decisions
in its proposal. The moment
impact rises above low, coupling stops being isolated, or review or acceptance
becomes required, the change **upgrades itself to standard** and its delta
artifacts are created for you. Optional extensions still appear only when their
concern exists.

The agent does not author cross-ledger IDs by hand. The current semantic draft compiles
requirements, scenarios, tasks, claims, and provider bindings into this packet.
That compiled OpenSpec packet remains the source of truth. A selected prototype
or diagram may be referenced from design, but prototype output is still
non-authoritative and is rejected as evidence.

Project-owned does not mean hand-edited during an active change. Ask the agent
to revise or amend the agreement through the supported workflow. The harness
maintains generated links, task IDs, and completion checkboxes. Review these
files; do not tick tasks or rewrite generated packet fields to bypass checks.

:::tip
`tasks.md` is the sole ledger by design. A second checklist kept in chat or in
a scratch file is not tracked, not validated, and not evidence.
:::

## Machine state

Generated records are ignored by Git. The installed `.gitignore` and README
are product files. Agent-written drafts and sandbox code are working inputs;
optional `.foundation/policy.json` is project-authored capability policy.
These exceptions do not permit manual edits to receipts or lifecycle state.

For the complete state inventory, use the installed
[Runtime state reference](https://github.com/Maximumsoft-Co-LTD/claude-foundation/blob/main/.claude/harness/README.md#runtime-state).
It lists generated records, caches, working inputs, and their purposes.

The sections below explain the evidence and archive records you may need to
review; they are not instructions to edit runtime files.

## The evidence vault

`receipts/` holds the *live* receipt for each provider, which is overwritten
every time that provider runs. `evidence/` holds the *immutable* copy taken at
the moment proof was finalized:

```text
.foundation/evidence/<change-id>/
  <proof-run-id>/
    manifest.json                     the proof, copied verbatim
    receipts/<provider>.json          each receipt, with sha256 and byte size
    artifacts/<provider>/<digest>-<name>   logs, reports, traces, screenshots
  review-attempts/
    0001-<digest>.json                hash-chained review ledger
```

Every copied receipt and artifact is bound by **SHA-256 and byte size**.
`proof audit` re-reads them and fails if either has moved. An artifact that
lives outside the vault is not admissible, which is why a durable report is
copied in rather than referenced where it was produced.

The review-attempt ledger is a hash chain. A broken link is never treated as
an empty history: the harness moves the ledger aside as
`review-attempts.corrupt-<stamp>` and rebuilds it without asking you. The
rebuilt count never drops below the attempts on record, and an attempt that
no longer verifies counts as a spent review wave rather than a reusable verdict.

## The archive

Landing moves the packet to `openspec/changes/archive/<YYYY-MM-DD>-<change-id>/`
with the same files intact, and merges the requirement deltas into the durable
specs at `openspec/specs/<capability>/spec.md`.

The merge is verified rather than trusted: Change Loop re-derives the before,
after, and delta states and blocks the land if the archived specs do not match
what the deltas said they would produce.

## Artifacts that are deliberately not evidence

Two kinds of output exist to help you think, and neither can be cited as proof.

**Prototypes** written to `.foundation/prototypes/<id>/` during a comparison
investigation are explicitly rejected as evidence artifacts or references. A
prototype demonstrates that an approach is possible; it does not demonstrate
that the shipped code works.

**Investigation records** at `openspec/investigations/<id>.json` hold typed,
source-linked facts, hypotheses, decisions, and the conclusion. Optional notes
at `openspec/investigations/<name>.md` add human narrative. Machine state and
handoff digests live under `.foundation/investigations/`; they are derived and
ignored. The project-owned record and note are
committed and reviewable, and they rank *below* specs and code when the three
disagree — a note records what was believed at the time, not what is true now.

:::caution
Never point an evidence provider at a prototype directory or an investigation
note. Evidence has to come from the code that will actually ship.
:::

## Telemetry

Each command appends a row to `.foundation/logs/<change-id>/operations.jsonl`,
alongside context events and phase-context records. `telemetry` reports totals,
estimated tokens, and duration percentiles by kind. Scheduler rows expose
queueing, reuse, executed nodes, and peak concurrency for harness-owned waves.

The accounting deliberately distinguishes *unknown* from *zero*. A run whose
cost could not be measured is reported as unmeasured rather than free.
