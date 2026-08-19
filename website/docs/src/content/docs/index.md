---
title: What is Claude Foundation?
description: An OpenSpec-native change harness that makes an AI coding agent agree on a change, build it in isolation, prove it with real evidence, and only then land it.
---

Claude Foundation is a **software-change harness for AI coding agents**. It gives the agent a repeatable way to agree on a change, implement it away from your working tree, prove it with real evidence, and only then bring it into the project.

```text
Investigate? → Change → Build → Prove → Land
```

It is not an AI, and it does not write code. It is a deterministic control plane *around* your coding agent. It does not replace your agent, test framework, CI system, or Git workflow either — it drives the tools your repository already owns.

## The problem it solves

An AI coding agent will tell you it finished. That claim is usually the weakest link in the whole workflow: the agent read its own output, decided it looked right, and reported success. Nothing independently checked that the code runs, that the tests it claims to have written exist, or that the thing you asked for is the thing that shipped.

Foundation refuses to take the agent's word for it. Every observable behaviour the change promises becomes a **claim** with a stable ID, and a claim is only satisfied by a **receipt** produced by actually executing a project-owned tool. A passing command is not automatically proof, and an agent's summary is never proof.

## Who does what

Foundation deliberately splits responsibility so that no single party can both do the work and certify it.

| Part | Responsibility |
|---|---|
| **You** | Define intent, make consequential decisions, review the result, and explicitly authorize Land |
| **AI coding agent** | Investigates, writes the agreement, implements code and tests, fixes what evidence reports |
| **Foundation harness** | Controls lifecycle state, scope, sandboxes, evidence, proof freshness, budgets, and Land guards |
| **OpenSpec** | Stores the durable, human-reviewable requirements and change agreement |
| **Project tools** | Test runners, linters, Playwright, scanners — these produce the executable evidence |
| **Git and CI** | Version control and automation, through your existing process |

## What makes it different

**One native owner.** The coding agent reads a compact change packet and owns implementation. There is no relay race between PM, lead, engineer, QA, and retro personas — that shape preserved quality but let orchestration dominate cost and latency.

**Executable evidence.** Claims select capabilities. Capabilities are satisfied by provider contracts that run *your* tools and produce receipts the runtime validates. Foundation never installs a test framework or downloads a browser to make evidence appear.

**Reuse before rerun.** Receipts bind to code, agreement, claims, configuration, environment, protocol, and artifacts. Change a bound input and the receipt goes stale; leave it alone and the work is reused instead of repeated.

**Transactional finish.** Land checks proof freshness, applies only the proven sandbox, verifies identity, syncs specs, archives, and cleans up. An interrupted or multi-repository Land resumes from its journal rather than leaving you half-applied.

**Risk, not size, selects rigor.** Size only controls budget and slicing. A one-line change that touches an auth boundary is not treated as trivial.

## Where to go next

- [Install](/docs/install/) — requirements and the two supported install paths
- [Quickstart](/docs/quickstart/) — take one change end to end
- [The change loop](/docs/loop/) — what each of the five commands does and why

:::note[Version]
These docs track Foundation **v3.3.2** — runtime API 24, provider protocol 10. Receipts recorded by earlier versions read as `provider-version-stale` and must be re-proven.
:::
