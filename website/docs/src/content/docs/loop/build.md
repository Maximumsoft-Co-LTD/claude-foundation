---
title: /build
description: Implement the agreement inside an isolated Git worktree, with tasks.md as the only ledger.
---

```text
/build <change>
```

Build implements the agreement. It is where your coding agent does the work it is actually good at — and it happens **away from your working tree**.

## Isolation

```bash
claude-foundation sandbox create <change>
```

This creates an isolated Git worktree under `.foundation/sandboxes/`. Your working tree is untouched until Land. If the change's agreement was revised, `sandbox sync <change>` brings the revision in rather than recreating the sandbox.

A worktree carries tracked files only — no `node_modules`. If your providers need dependencies installed, declare a setup command once: `sandbox.setupCommand` (plus `setupTimeoutMs`) in `foundation.json`, or a per-repository `setupCommand` in `openspec/repositories.yaml`. It runs once inside every newly created workspace, and its outcome is recorded on the workspace record. A failing setup keeps the sandbox and prints the recovery rather than destroying the workspace.

:::caution[Isolation, not a security boundary]
A sandbox is **workspace isolation**, not an OS security boundary. Code executing inside it is still code executing on your machine. Inspect the distinction with `sandbox inspect <change>`.
:::

## Start from the packet, not from history

```bash
claude-foundation packet <change> --phase build
```

The packet is a bounded machine handoff — it carries only what the next step consumes. The agent does not replay the conversation to rebuild context, which is what lets a fresh session pick up work an earlier one started.

Packet budgets are enforced: 8 KiB for a task packet, 8 KiB for review, 12 KiB per repository, 16 KiB global, 4 KiB for a plan summary.

## One ledger

`tasks.md` is the **sole** task ledger. There is no mirrored checklist, no second status file, and no lifecycle state hidden in the agent's head. If something is not in `tasks.md`, it is not tracked.

## Scope

The agent may edit only allowed sandbox paths. Which paths those are comes from the change's `repositories.yaml` write scope — a change that declared it touches one repository cannot quietly write to another.

For multi-repository work, create all selected workspaces together:

```bash
claude-foundation sandbox create <change> --all
```

Write repositories are Build targets. Read and external repositories are pinned
inputs and never receive Land nodes. If a target moves during Build, use
`sandbox sync`; do not copy files between checkouts. See the ordered
[multi-repository workflow](/docs/multi-repository/) before assigning workers.

## Parallel work

For multi-repository work:

```bash
claude-foundation repos <change>
claude-foundation sandbox create <change> --all
claude-foundation agents plan <change>
```

The plan permits parallel workers **only** across genuinely independent repositories and resources. A one-repository change with at most two ordinary tasks stays with a single agent — parallelism that has to serialize on a shared resource costs more than it saves.

Workers receive only `packet --task <task-id>`. The host owns resource leases:

```bash
claude-foundation agents acquire <change> <task> --owner <id>
claude-foundation agents release <change> <task> --owner <id>
```

If a worker crashes holding a lease, `agents release --force` takes it over. A lease that has not yet expired also requires `--decision-ref`, because the worker holding it may still be running.

## Converging

Run focused checks as you go, then ask the runtime what still blocks proof:

```bash
claude-foundation proof readiness <change>
```

Readiness returns **typed blockers** and the canonical next command for each. Resolve code and configuration blockers here, in Build, before spending a fresh Prove run on them.

One blocker hands back its own fix: when a repository changed files no task declares, readiness renders the undeclared paths as a paste-ready `[paths:...]` annotation per repository. Declare new files in the owning task's `[paths:]` the moment you create them and the blocker never appears.

## What Build must never do

Build never replays conversation history, mirrors tasks into a second ledger, archives, commits, or Lands. Those are other steps' authority, and collapsing them is how a change ends up applied without ever having been proven.

## Unattended execution

A host that deliberately runs without a human present uses one bare `--unattended` flag on `doctor` and `sandbox create`. It is presence-only: valued or duplicated forms are rejected before any telemetry, workspace inspection, or sandbox mutation happens.

Detection is diagnostic, never authorization. The runtime accepts no workspace-controlled override and fails unattended execution closed. The guard is cooperative by necessity — the runtime cannot infer that you enabled an "allow all" setting in your host, so the host that enables unattended execution must invoke the guarded form itself.
