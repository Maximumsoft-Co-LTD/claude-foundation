---
title: /change
description: Create or complete the OpenSpec agreement — intent, delta specs, tasks, claims, risk, and the evidence contract.
---

```text
/change <intent | existing-change> [--prototype-selection <path>]
```

`/change` produces the **agreement**: the durable, human-reviewable statement of what is going to change and how anyone will know it worked. Everything downstream reads from it.

It creates or completes `openspec/changes/<id>/`.

## What gets resolved

Before writing artifacts, the agent classifies the change and records:

| Property | Values | Used for |
|---|---|---|
| ambiguity | clear, unclear | whether to investigate first |
| impact | low, medium, high | assurance profile |
| coupling | isolated, coupled | assurance profile |
| security triggers | matched semantically | forcing independent review |
| evidence capabilities | see [claims](/docs/evidence/claims/) | what must be proven |
| size | — | **budget and slicing only** |

Size never downgrades rigor. That is deliberate: the cheapest-looking changes are routinely the ones that cross a trust boundary.

Security triggers match **whole words**, not substrings. An earlier version matched `access` inside "accessibility" and `migration` inside "migration guide" — forcing external review on routine work — while missing "sign in with a passkey" entirely, which is the case that actually crosses a trust boundary.

## Two shapes

**Rapid** — proposal, tasks, evidence, and execution wiring. Only for low-impact, isolated, unit/static work.

**Standard** — adds delta specs and `design.md`.

A rapid change **upgrades in place** if risk emerges. When resolving impact, coupling, security, or acceptance moves a change from rapid to standard, the command prints the schema it settled on and creates the newly required artifacts, rather than leaving `validate` to refuse the change for files nobody knew it now needed.

## Delta specs

Requirements are written as deltas against the current spec — `## ADDED Requirements`, `## MODIFIED Requirements`, `## REMOVED Requirements` — each with observable scenarios.

:::caution[Renaming a scenario]
OpenSpec reads a `## MODIFIED Requirements` block as the **complete** scenario list, so quietly renaming a scenario archives as a deletion. Change Loop refuses this before Land rather than after. To rename, put the old name under `## REMOVED Requirements` and the new name under `## ADDED Requirements` with its full scenario list.

There is deliberately no bypass flag: OpenSpec enforces the same rule at archive time, so skipping the check would only move the failure past the point of no return.
:::

## Acceptance is decided, not inferred

Some outcomes are subjective — "does this feel right" — and no test can settle them. A standard change must **explicitly decide** whether human acceptance is required. Silence stays `undecided` and blocks validation; it never becomes approval.

## Validation

```bash
claude-foundation change validate <change>
claude-foundation change audit <change>
```

`validate` checks the change and its evidence contract. `audit` reports scenario, claim, task, and provider traceability — every observable scenario should be reachable from a claim, and every claim from a provider that can actually demonstrate it.

Validation returns all independent problem groups together and a bounded repair
plan, so the agent fixes the complete batch before validating again. Atomic
draft version 2 lets the author state intent, outcomes, paths, and verification;
Change Loop derives stable IDs and only those cross-links that are unambiguous.
Version 1 drafts remain compatible. The user never has to maintain duplicate
bookkeeping ledgers.

## Revising an existing change

Pass the change ID instead of an intent. Revision is the normal path when requirements move — you do **not** open a second change. Change Loop syncs any existing sandbox and invalidates proof the revision made stale.

## Retiring one

A change that cannot be proven is retired explicitly:

```bash
claude-foundation change abandon <change> --reason <reason> --decision-ref <ref>
```

It releases leases, cleans up the sandbox, and quarantines the change directory, runtime state, receipts, evidence, transactions, and logs under `.foundation/recovery/abandoned/<id>/`, with an audit line in `.foundation/logs/abandoned.jsonl`. It never touches Git and refuses an archived change. If the proven files are already in your working tree it stops and asks whether to keep or revert them.

Your agent offers this when it applies. It will never retire a change unasked.
