---
title: Quickstart
description: Take one change from intent to landed, using the five commands in order.
---

This walks one small change end to end. You talk to your coding agent in ordinary language; the agent runs the commands. Nothing here requires you to memorise CLI syntax.

## 0. Check the project is ready

```bash
claude-foundation doctor --stage change
```

## 1. Agree on the change

```text
/change add profile authentication
```

The agent creates `openspec/changes/add-profile-auth/` and resolves how much rigor the change needs — impact, coupling, security triggers, and whether a human has to accept the result. It will **ask you** about anything consequential rather than guessing.

Two shapes exist. A *rapid* change carries proposal, tasks, evidence, and execution wiring, and is only for low-impact isolated work. A *standard* change adds delta specs and a design document. A rapid change upgrades itself in place if risk emerges — and when it does, it tells you which schema it settled on and creates the artifacts the new schema requires.

What you should read and push back on is `proposal.md` and the delta specs. That is the agreement.

## 2. Build it in isolation

```text
/build add-profile-auth
```

The agent creates an isolated Git worktree under `.foundation/sandboxes/`, reads a compact packet, and implements. **Your working tree is not touched.** `tasks.md` is the only ledger — there is no second checklist to keep in sync.

## 3. Prove it

```text
/prove add-profile-auth
```

This is the step that makes the difference. Foundation reuses any receipt that is still valid, schedules only what is missing or stale, runs your project's tools, and validates the results.

Evidence can come back `pass`, `fail`, `inconclusive`, or `error`. Anything other than a pass keeps the change blocked, and the agent goes back to Build to fix it. An `inconclusive` result is *not* a soft pass — a browser suite that exits 0 without the required claim annotations is inconclusive, because nothing demonstrated the claim.

## 4. Land it

```text
/land add-profile-auth
```

Land is an explicit boundary, and it is the only step that touches your real working tree. It re-checks proof freshness, applies only the proven sandbox while preserving unrelated edits, syncs specs, audits the evidence, archives the change, and cleans up isolation.

:::caution
Land never commits, pushes, or opens a PR on its own. Those need separate authorization from you.
:::

## Moving backward

The loop is not a waterfall. If requirements change halfway through, you revise the same change rather than starting a new one:

```text
Change ⇄ Build ⇄ Prove
```

Revising the agreement syncs the sandbox and invalidates any proof that the revision made stale. That invalidation is the point — it prevents evidence from an older agreement being credited to a newer one.

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
