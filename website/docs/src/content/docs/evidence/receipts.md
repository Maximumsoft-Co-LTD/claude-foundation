---
title: Receipts, statuses, and staleness
description: What a receipt binds itself to, the four statuses a provider can return, why a hand-written pass is refused, and what makes proof go stale.
---

A receipt is Foundation's record that a specific provider observed a specific
result against specific content. Everything about it is designed so that a
receipt cannot outlive the thing it described.

## The four statuses

A provider returns one of four statuses, and three of them block.

| Status | Meaning | Lands? |
|---|---|---|
| `pass` | The provider ran and the claim held | Yes |
| `fail` | The provider ran and the claim did not hold | No |
| `error` | The provider could not run — crash, timeout, spawn failure | No |
| `inconclusive` | The provider ran but produced no verdict for the claim | No |

`inconclusive` is the one that surprises people, and it is the most useful of
the four. A Playwright suite that runs green but carries no claim annotations
is inconclusive, not passing: it demonstrated that some tests ran, not that
*your claim* holds. Declared readiness that was never observed is an `error`
regardless of the command's exit code, because a suite that ran before its
dependency was up proved nothing.

:::tip
Treat `inconclusive` as "the wiring is wrong," not "the code is broken." It
almost always means a provider is not reporting against the claim you declared.
:::

## What a receipt binds

Each receipt records what ran, what it saw, and what it saw it against:

```json
{
  "provider": "test",
  "execution": "harness",
  "status": "pass",
  "workspaceHash": "eb7f67b3…",
  "contractFingerprint": "9a456f30…",
  "providerFingerprint": "084664fa…",
  "inputIdentity": { "mode": "global" },
  "claims": ["profile-update"],
  "artifacts": [{ "name": "command-log", "sha256": "…", "size": 4210 }]
}
```

The fingerprints are what make reuse safe. `contractFingerprint` covers the
intent, impact, review policy, acceptance, and claims. `providerFingerprint`
covers the adapter, command, capability, environment, **lockfile digests**,
timeouts, and readiness identity. Change any of them and the receipt no longer
describes the current world.

`workspaceHash` binds the receipt to the content it was produced against. It is
derived from Git index entries plus the identity of dirty files, skipping
regenerable output directories and the change's own `execution.yaml` — so
rewiring a provider does not by itself expire evidence, but editing source does.

## Executed versus asserted

Foundation distinguishes evidence it produced from evidence a person handed it,
and it will not let the two be confused.

A receipt marked `execution: "harness"` can only be written by a call site that
actually ran a command, and a passing one must carry a command log as an
artifact.

A receipt marked `execution: "manual"` must carry an observation, a provenance
source, and at least one artifact or a reference that resolves — a URI or a
real path. Free text is refused, because "I ran it and it worked" is not
evidence.

:::caution
A hand-recorded receipt may not name an executing adapter, and a provider wired
to `command`, `test-discovery`, `playwright`, or `contract-digest` cannot be
given a hand-written `pass` at all. If the harness can run it, the harness has
to run it.
:::

## Declared inputs and safe reuse

By default a receipt is bound to the whole workspace, so any edit expires it.
That is correct but blunt: a documentation typo should not invalidate a
security scan.

A provider can narrow that by declaring the inputs it actually depends on:

```json
{
  "security-static": {
    "adapter": "command",
    "command": ["npm", "audit", "--audit-level=high"],
    "inputs": ["package.json", "package-lock.json"]
  }
}
```

With declared inputs, Foundation records the sorted digest of exactly those
files. When the workspace changes but those files do not, the receipt is
rebound to the new workspace hash rather than re-run, and the rebinding is
written to an audit log. Narrow the inputs honestly — a provider that reads
more than it declares will reuse a receipt it should have re-earned.

`review` and `acceptance` may not declare inputs. A human verdict is about the
whole change.

## Why proof goes stale

`prove` refuses unless every required provider is currently valid. The common
verdicts, in the order they are checked:

| Verdict | What happened |
|---|---|
| `missing` | The provider never produced a receipt |
| `contract-stale` | The claims or the contract changed after the receipt |
| `provider-fingerprint-stale` | The command, environment, or lockfiles changed |
| `stale` | The workspace changed and inputs were not declared |
| `provider-inputs-stale` | The declared inputs themselves changed |
| `review-not-independent` | The reviewer was also an implementer |
| `review-not-diverse` | The AI reviewer shared a model family with the implementer |
| `acceptance-invalid` | The scope, hash, or stated reason drifted after acceptance |
| `external-observation-missing` | A manual receipt lacks its observation or provenance |

A receipt that goes stale *after* execution during the same proof run usually
means a provider wrote inside the hashed surface — a report emitted into the
working tree rather than an ignored directory. Point the report somewhere
regenerable, or declare it as an artifact.

Land re-checks all of this a second time. The proof's workspace hash must still
match, and every live receipt's digest must equal the digest recorded in the
proof manifest, so a receipt cannot be swapped between proving and landing.
