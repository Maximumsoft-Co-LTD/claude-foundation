---
title: What Foundation writes
description: Every artifact the harness produces — the change packet, machine state, the evidence vault, and the archive — and which of them you are meant to read.
---

Foundation writes in two places, and the split is the whole point.

**`openspec/` is yours.** Durable intent, reviewed by humans, committed to Git.
**`.foundation/` is the machine's.** Lifecycle state, receipts, logs, and proof
bundles, ignored by Git and safe to delete between changes.

Nothing durable is ever stored only in chat, and nothing machine-generated is
ever committed as if a human wrote it.

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
| `schemas/` | Foundation | **Overwritten every install.** Edit a profile here and the next upgrade discards it |
| `config.yaml` | your project | Copied only when missing, yours afterwards |
| `repositories.yaml` | your project | Copied only when missing, yours afterwards |
| `specs/`, `changes/`, `investigations/` | your project | Never touched by the installer |

`foundation.json` sits at the repository root rather than in `openspec/`,
because it holds project *policy* rather than intent: execution budgets, packet
size caps, model tiers, escalation triggers, the review diversity and
independence settings, and the sandbox setup command (`sandbox.setupCommand`)
that runs once inside every new Build workspace.
It is seeded when missing and yours afterwards.

The shipped policy permits at most three parallel agents and uses 45-minute
leases. Task and review packets are capped at 8 KiB, repository packets at
12 KiB, and the global packet at 16 KiB. Rapid runs receive ceilings of 800,000
tokens and 100 requests; standard runs receive 1,600,000 tokens and 200
requests. These values bound a run—they are not work quotas.

Model tiers are purpose-based: `fast`/Haiku handles inventory, logs, and
mechanical docs; `standard`/Sonnet handles implementation, tests, and focused
investigation; `deep`/Opus handles architecture, security, migration, and
review. The default reviewer is Claude Code Opus in a read-only ephemeral run,
with Codex GPT-5.6 Sol configured as an alternate. The shipped
`independence: "self"` and `diversity: "single-model"` policy works without a
second identity or provider and records both waivers in its receipts. Projects
that need separation of duties can strengthen independence, diversity, or both
to `required`. The risk-tiered review circuit allows one full review and at
most one required delta.

See [Configure foundation.json](/docs/foundation-config/) for every field,
valid ranges, and ready-to-use policy recipes.

:::caution[Two files named `repositories.yaml`]
`openspec/repositories.yaml` describes the project's repository topology.
`openspec/changes/<id>/repositories.yaml` describes the repositories **one
change** touches and in which mode. They are different files with the same
name; a provider that reads the wrong one silently scopes to the wrong set.
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
| `proposal.md` | Why the change exists, what observably changes, impact, and non-goals | both |
| `tasks.md` | The sole implementation ledger — the only place work is tracked | both |
| `evidence.yaml` | The stable behavioral contract: claim IDs, scenarios, capabilities | both |
| `grounding.yaml` | Locked decisions, read-set hashes, production/failure paths, and the sourced eight-category NFR assessment | both when grounding is required |
| `execution.yaml` | Replaceable wiring: provider commands, services, readiness | both |
| `repositories.yaml` | Repository topology and write modes | both |
| `.openspec.yaml` | Which assurance profile governs the packet | both |
| `design.md` | Stable `DEC-*` decisions, rationale, rejected alternatives, consequences, supersession, compatibility, risks | standard |
| `specs/**/spec.md` | Requirement deltas — `ADDED`, `MODIFIED`, `REMOVED` | standard |

A `foundation-rapid` packet omits `design.md` and the spec deltas. The moment
impact rises above low, coupling stops being isolated, or review or acceptance
becomes required, the change **upgrades itself to standard** and those two
artifacts are created for you.

:::tip
`tasks.md` is the sole ledger by design. A second checklist kept in chat or in
a scratch file is not tracked, not validated, and not evidence.
:::

## Machine state

Everything under `.foundation/` is generated. Its `.gitignore` is an allow-list
— it ignores `*` and re-admits only `.gitignore` and `README.md` — so machine
state cannot drift into a commit by accident.

| Path | Contents |
|---|---|
| `runtime/` | Lifecycle state, one file per change |
| `receipts/` | Live provider receipts and `proof.json` |
| `evidence/` | Immutable proof bundles and the review-attempt ledger |
| `snapshots/` | One workspace snapshot descriptor per proof |
| `logs/` | Provider logs, telemetry, receipt-reuse and budget audits |
| `sandboxes/` | The control sandbox — a Git worktree or a copy |
| `repository-sandboxes/` | Per-repository sandboxes for multi-repository work |
| `plans/` | Agent execution plans |
| `leases/` | Task and resource leases |
| `transactions/` | Land apply journals and staged backups |
| `authority/` | Review and acceptance requests and their completion records |
| `attestations/` | Unattended-execution challenges and consumed nonces |
| `instruction-manifests/` | Instruction provenance per command |
| `recovery/` | Quarantined abandoned changes and orphaned state |
| `prototypes/` | Disposable comparison prototypes |
| `policy.json` | Optional project rules mapping paths to required capabilities |
| `install-manifest.txt` | Installer record of which files it owns |

Several of these appear only once something creates them —
`repository-sandboxes/` needs multi-repository work, `recovery/` needs an
abandoned change, and `policy.json` is yours to write or leave absent.

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

The review-attempt ledger is a hash chain. A broken link fails closed rather
than being treated as an empty history.

## The archive

Landing moves the packet to `openspec/changes/archive/<YYYY-MM-DD>-<change-id>/`
with the same files intact, and merges the requirement deltas into the durable
specs at `openspec/specs/<capability>/spec.md`.

The merge is verified rather than trusted: Foundation re-derives the before,
after, and delta states and blocks the land if the archived specs do not match
what the deltas said they would produce.

## Artifacts that are deliberately not evidence

Two kinds of output exist to help you think, and neither can be cited as proof.

**Prototypes** written to `.foundation/prototypes/<id>/` during a comparison
investigation are explicitly rejected as evidence artifacts or references. A
prototype demonstrates that an approach is possible; it does not demonstrate
that the shipped code works.

**Investigation notes** at `openspec/investigations/<name>.md` are the durable
output of `/investigate` when findings need to outlive the session. They are
committed and reviewable, and they rank *below* specs and code when the three
disagree — a note records what was believed at the time, not what is true now.

:::caution
Never point an evidence provider at a prototype directory or an investigation
note. Evidence has to come from the code that will actually ship.
:::

## Telemetry

Each command appends a row to `.foundation/logs/<change-id>/operations.jsonl`,
alongside context events and phase-context records. `telemetry` reports totals,
estimated tokens, and duration percentiles by kind.

The accounting deliberately distinguishes *unknown* from *zero*. A run whose
cost could not be measured is reported as unmeasured rather than free.
