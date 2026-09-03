---
title: Quickstart
description: Take one change from intent to landed, using the five commands in order.
---

This walks one small change end to end. You talk to your coding agent in ordinary language; the agent runs the commands. Nothing here requires you to memorise CLI syntax.

The agent matches your language, leads with the outcome, performs safe recovery
within the authority you already gave, and reports what it changed and checked.
It asks only for a consequential decision. Protocol JSON, hashes, receipts, and
provider codes stay out of the conversation unless you request diagnostics.

:::note[Single or multiple repositories?]
Follow this page as written for one repository. If implementation or evidence
needs several Git repositories, read the
[multi-repository workflow](/docs/multi-repository/) before step 1. The five
commands stay the same; repository scope and sandbox creation gain one setup
layer.
:::

## 0. Check the project is ready

```bash
claude-foundation doctor --stage change
```

Consumer quality is optional. To add changed-code CRAP and mutation gates,
onboard the repository once with `quality discover`, `quality init`, and
`quality doctor` before starting enforcement. Keep the initial policy
report-only until its mappings and baselines have been reviewed. See
[Consumer quality gates](/docs/consumer-quality/).

## 1. Agree on the change

```text
/change add profile authentication
```

The agent creates `openspec/changes/add-profile-auth/` and resolves how much rigor the change needs — impact, coupling, security triggers, and whether a human has to accept the result. It will **ask you** about anything consequential rather than guessing.

The agent writes one semantic draft: intent, requirements and scenarios, task
outcomes, and evidence needs. The harness derives stable IDs and links and
compiles the OpenSpec packet transactionally. Both lanes need only proposal,
tasks, and evidence at their core; standard adds delta specs. Design, grounding,
custom execution, repository scope, and handoffs appear only when their concern
exists. A rapid change upgrades itself in place if risk emerges.

What you should read and push back on is `proposal.md` and the delta specs. That is the agreement.

## 2. Build it in isolation

```text
/build add-profile-auth
```

The agent calls `advance add-profile-auth --through build`. The coordinator
creates an isolated workspace, returns one bounded action, and resumes through
the same route. **Your working tree is not touched.** `tasks.md` is the only
ledger; the user never assembles sandbox, packet, plan, or dispatch commands.

## 3. Prove it

```text
/prove add-profile-auth
```

This is the step that makes the difference. Change Loop reuses any receipt that is still valid, schedules only what is missing or stale, runs your project's tools, and validates the results.

The agent drives it with `advance add-profile-auth --through proven`; low-level
`proof` commands remain available for operator diagnosis and integrations.

Evidence can come back `pass`, `fail`, `inconclusive`, or `error`. Anything other than a pass keeps the change blocked, and the agent goes back to Build to fix it. An `inconclusive` result is *not* a soft pass — a browser suite that exits 0 without the required claim annotations is inconclusive, because nothing demonstrated the claim.

The harness checks the gate once, groups all known repairable findings into one
plan, and lets the agent fix the batch. It then rechecks only evidence made
missing or stale by those edits. The loop has no arbitrary retry limit: it
continues while progress is possible and asks you only when a decision,
permission, unavailable external system, or unresolved conflict is required.

## 4. Land it

```text
/land add-profile-auth
```

Land is an explicit boundary, and it is the only step that touches your real working tree. It re-checks proof freshness, applies only the proven sandbox while preserving unrelated edits, syncs specs, audits the evidence, archives the change, and cleans up isolation.

The agent drives the resumable transaction with `advance add-profile-auth
--through archived`. Only `archived` means the lifecycle is complete.

If the target branch advanced after Prove, the agent replays the same sandbox
onto the new base, re-proves it, and resumes Land. You do not restart Change or
run recovery commands by hand. A replay conflict remains visible and requires
judgment rather than being merged silently.

:::caution
Land never commits, pushes, or opens a PR on its own. Those need separate authorization from you.
:::

## Moving backward

The loop is not a waterfall. If requirements change halfway through, you revise the same change rather than starting a new one:

```text
Change ⇄ Build ⇄ Prove
```

The agent submits one semantic amendment to the same change. The harness
preserves completed tasks and manual sections, validates the staged packet,
rolls back on failure, and invalidates affected claims before resuming. That
invalidation prevents evidence from an older agreement being credited to a
newer one.

## Checking on things

```text
/changes
```

Lists active changes, their status, blockers, and the next useful action for each. It mutates nothing, so it is always safe to run.

## When a change cannot be proven

Sometimes a change turns out to be unprovable — an evidence contract that cannot be satisfied, a provider that will never exist. Retire it explicitly instead of deleting files by hand:

```bash
claude-foundation change abandon <change> --reason <reason> --decision-ref <ref>
```

This quarantines the change's records under `.foundation/recovery/abandoned/<id>/` rather than deleting them, never touches Git, and refuses to run on an already-archived change. Your agent will offer this when it applies, but it will never retire a change without asking.

A smaller escape exists for a single gate that ran and failed when the gate itself is wrong: `change waive --capability <c>` withdraws that one capability's enforcement on a recorded decision, and `--revoke` restores it. There is deliberately no route that lands a failing proof.
