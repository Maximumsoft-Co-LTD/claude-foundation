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

## The change packet

One directory per active change, at `openspec/changes/<change-id>/`. This is
what a reviewer reads.

| File | What it holds | Profile |
|---|---|---|
| `proposal.md` | Why the change exists, what observably changes, impact, and non-goals | both |
| `tasks.md` | The sole implementation ledger — the only place work is tracked | both |
| `evidence.yaml` | The stable behavioral contract: claim IDs, scenarios, capabilities | both |
| `execution.yaml` | Replaceable wiring: provider commands, services, readiness | both |
| `repositories.yaml` | Repository topology and write modes | both |
| `.openspec.yaml` | Which assurance profile governs the packet | both |
| `design.md` | Load-bearing decisions, rejected alternatives, compatibility, risks | standard |
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
