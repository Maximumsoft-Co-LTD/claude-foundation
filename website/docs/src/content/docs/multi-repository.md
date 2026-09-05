---
title: Multi-repository workflow
description: Configure, build, prove, and land a change that needs more than one Git repository, in the order Change Loop evaluates it.
---

Use this guide when one change writes code in several repositories, or when a
test runs in one repository but needs code or contracts from others.

If the change needs only one repository, stop here: the normal
[Quickstart](/docs/quickstart/) already covers the simpler path.

## First, understand the three scopes

These files answer different questions. Configure them in this order:

| Order | Contract | Question it answers |
|---|---|---|
| 1 | `openspec/repositories.yaml` | Which repositories may this project use? |
| 2 | `openspec/changes/<change>/repositories.yaml` | Which of them may this change read or write? |
| 3 | derived provider or conditional `execution.yaml` fields | Which repositories does this evidence command need? |

Do not skip directly to provider wiring. A provider cannot prove a repository
that the project topology does not know or the change did not select.

## 1. Declare the project topology

Add every repository Change Loop may isolate to `openspec/repositories.yaml`:

```json
{
  "version": 1,
  "repositories": [
    { "id": "api", "path": "services/api", "setupCommand": "npm ci" },
    { "id": "app", "path": "apps/web", "setupCommand": "npm ci" },
    { "id": "contracts", "path": "contracts", "mode": "read" },
    {
      "id": "partner-sdk",
      "type": "external",
      "path": "../partner-sdk",
      "mode": "read",
      "allowOutsideRoot": true
    }
  ]
}
```

What matters:

- `id` is the stable name used by tasks, providers, receipts, and Land.
- `path` is relative to the control repository unless the row is external.
- `setupCommand` prepares that repository's newly created worktree.
- an outside path must declare `type: "external"` and
  `allowOutsideRoot: true`;
- every selected repository must already be an initialized Git repository.

Change Loop refuses a non-Git dependency because it cannot pin or isolate a
moving directory honestly.

Check the result before creating a change:

```bash
claude-foundation repos
```

## 2. Select the change scope

Inside the change, select only the repositories it needs:

```json
{
  "version": 1,
  "repositories": [
    { "id": "api", "mode": "write", "dependsOn": [] },
    { "id": "app", "mode": "write", "dependsOn": ["api"] },
    { "id": "contracts", "mode": "read", "dependsOn": [] },
    { "id": "partner-sdk", "mode": "read", "dependsOn": [] }
  ]
}
```

Use `write` only where the change will produce code. Use `read` for test data,
contracts, SDKs, and integration dependencies. A read repository is part of
proof identity, but it is not a Build or Land target.

Selecting any non-root repository makes the lifecycle composite. This includes
a selection with exactly one child and no `root` product work; it must not be
downgraded to the single-root Apply or archive path.

Then inspect the resolved selection:

```bash
claude-foundation repos <change>
```

## 3. Bind tasks to repositories

Every implementation task names its owning repository and paths. Dependencies
make cross-repository order explicit:

```markdown
- [ ] **T001** Update API [repo:api] [kind:implementation] [paths:src/profile]
- [ ] **T002** Update app [repo:app] [kind:implementation] [depends:T001] [paths:src/profile]
- [ ] **T003** Verify contract [repo:app] [kind:contract] [depends:T001,T002]
```

Change Loop compiles repository selection, tasks, providers, and Land order into
the execution graph. Do not create a second graph file.

## 4. Let Build create all sandboxes

The normal agent command creates the selected workspaces together:

```bash
claude-foundation advance <change> --through build
```

`sandbox create --all` and `sandbox inspect` remain operator diagnostics under
`help --all`; users do not need to sequence them.

After isolation, every selected child must have a runtime record matching its
catalog target, access mode, base head, and live worktree. `sandbox inspect`
lists `missing-record`, `unexpected-record`, `missing`, or `invalid` instead of
silently substituting the target checkout. Inspection reads filesystem and Git
metadata directly, so a repository-controlled `git` on `PATH` is never run.

Write repositories receive isolated Build worktrees. Git-backed read and
external repositories receive pinned detached worktrees. The command does not
make an external service or arbitrary folder safe; this is Git workspace
isolation, not an OS security boundary.

## 5. Wire repository-scoped evidence

For custom wiring in conditional `execution.yaml`, `repository` is the provider's working directory.
`repositories` is the complete set the command reads:

```json
{
  "providers": {
    "integration": {
      "capability": "integration",
      "adapter": "command",
      "repository": "api",
      "repositories": ["api", "app", "contracts", "partner-sdk"],
      "command": ["npm", "run", "test:integration"]
    }
  }
}
```

Change Loop passes two relevant environment variables:

- `FOUNDATION_REPOSITORY_ID` — the working-directory repository ID;
- `FOUNDATION_REPOSITORIES_FILE` — a versioned JSON manifest mapping every
  scoped ID to its isolated `path`, `access`, and `baseHead`.

Changed-surface checks, review packets, provider manifests, snapshots, and Land
use this same recorded base. Before isolation the selected source head may seed
the record; after isolation a missing child binding is infrastructure failure.

Provider code must read the manifest. It must not assume all five company
repositories happen to be checked out as siblings on the current machine.

The repository set is part of command deduplication and receipt identity. Two
identical commands with different repository sets execute separately, and each
receipt records its complete `repositoryIds`.

## 6. Build and synchronize

Plan parallel workers only after scope and dependencies are stable:

```bash
claude-foundation agents plan <change>
```

If another change advances a selected repository, synchronize before Prove:

```bash
claude-foundation sandbox sync <change>
```

Sync refreshes child read worktrees even when the control sandbox uses copy
mode. A repository `setupCommand` runs again after refresh. If setup or a
provider leaves a tracked change in a read workspace, readiness fails closed.

## 7. Prove the complete graph

```bash
claude-foundation proof readiness <change>
claude-foundation proof run <change>
```

Prove may run independent branches concurrently and preserve completed branches
after a failure. Aggregate proof still requires every selected repository and
provider scope to match the current graph. A moved read dependency requires
sync and fresh proof; Change Loop never certifies the old commit under the new
repository manifest.

Consumer quality follows the same graph but never averages repositories. Add a
row for every selected repository to `quality/foundation-quality.json`; a
selected repository missing from that file fails closed. Each lane keeps its
own commit, workspace digest, tool/config identity, baseline, and assurance.
Use `quality run --change <change>` before Prove or let evidence bootstrap wire
the committed quality config as static-analysis evidence. See
[Consumer quality gates](/docs/consumer-quality/).

## 8. Land every writable target uncommitted

Read repositories have no Land node. One explicit user command grants the
complete local delivery transaction:

```text
/land <change>
```

The harness prepares every writable target before the first write, then applies
the proven projections in dependency order with durable checkpoints. Each node
finishes `applied-uncommitted`; Git HEAD and the index remain unchanged in every
repository, and existing non-overlapping edits are preserved. A later `/land`
resumes the same transaction and skips verified nodes. `land check`, legacy
`land record`, and `land resume` remain diagnostic/compatibility primitives—not
steps the user must sequence. Commits, pushes, and pull requests stay outside
Land under separate user authority.

The saga is also required when exactly one non-root child is selected. A missing
child runtime record cannot make Land take the single-repository shortcut.

## Recovery map

| What happened | Correct next action |
|---|---|
| A selected target moved | `sandbox sync <change>`, then Prove again |
| Sync reports a replay conflict | Resolve the named paths; do not recreate the change |
| A read repository is dirty | Remove the mutation or fix setup/provider behavior |
| Repository setup failed | Harness retries only that repository and preserves ready siblings; change policy only if the declared command itself is wrong |
| A selected child binding is missing | Harness repairs the binding while preserving valid worktrees; use `sandbox inspect` only for requested diagnosis |
| A canonical child path belongs to another repository | Keep it untouched, inspect the reported path, then correct the target/path conflict or explicitly abandon the change |
| Provider cannot see a repository | Add it to provider `repositories`; do not hard-code a local path |
| Land is interrupted | Invoke `/land <change>` again; it resumes the journal |

## What the user and agent each need to do

**User:** confirm consequential repository scope/dependency semantics, invoke
Land once, review the final diffs, and commit through the project's normal Git
process. You do not construct manifests, grants, receipts, hashes, or journals.

**Agent:** configure the three scopes in order, use the manifest paths, run
readiness before spending a Prove attempt, follow the reported recovery, and
state which repositories were read, written, proven, and still waiting to Land.
Do not ask the user to copy protocol JSON or silently reduce a five-repository
test to the three repositories present in the sandbox.
