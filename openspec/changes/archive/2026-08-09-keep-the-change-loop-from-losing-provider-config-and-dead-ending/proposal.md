# Change: keep the change loop from losing provider config and dead-ending a fresh install

## Why

A consumer review of v3.2.7 drove the shipped loop end to end in two scratch
projects (`docs/reports/changeloop-review-2026-08-08.md`). The runtime is
correct and fast on a small project — a full rapid change costs ~4s of CLI time
and every suite in `run-all.sh` passes. It does not survive a real repository.

Building *this* change in *this* repository exhausted the disk. Two code paths
walk the workspace by a fixed list of directory names instead of asking git what
is regenerable, and this repository carries a 79GB gitignored Rust `target/`:

- `sandbox create` copied `target/` until the filesystem was full, died on an
  uncaught `ENOSPC`, and left a 41GB tree that `state.workspace` had never
  recorded — invisible to the runtime, and enough to make every retry fail with
  `sandbox path already occupied`.
- `workspaceManifest` hashed the same tree into the copy-mode baseline:
  906,814 of 909,041 entries were `target/`, ~250s of hashing, and a 156MB
  runtime state file that every later command had to parse. `changes` went from
  0.09s to 1.96s and `packet` from 0.22s to 9.31s.

The remaining defects are at the seams of the loop:

- `evidence init --write` resolves its target through `activeChangePath`, which
  points into the sandbox during Build. The next `sandbox sync` does
  `rm` + `cp` and merges only `tasks.md` back, so the detected provider config
  is destroyed in both trees with no warning. `evidence doctor` recommends the
  very command that loses its own output.
- A second active change makes every later `sandbox create` fall back to a
  full-tree isolated copy, because another change's uncommitted draft counts as
  a dirty target — and the loop deliberately keeps drafts uncommitted until Land.
- `install.sh` ends with `Next: /change <intent>` while leaving the managed
  files untracked. Those files become the first change's surface, so the
  harness's own shipped paths trip its own policy triggers and Prove demands
  `accessibility`, `compatibility`, and `data-migration` evidence for a one-line
  change. Committing the managed files first removes both this and the copy
  fallback.
- The rapid proposal template uses `## Why and what`; OpenSpec 1.7.0 expects
  `## Why` and `## What Changes`, so every rapid Land prints raw validator text
  at the user.
- `doctor` tells an operator to `mv` a runtime state file by hand when
  `change abandon` already quarantines orphans correctly.

## What changes

- The copy sandbox and the workspace baseline both skip git-ignored paths,
  asking git rather than matching a fixed list of directory names.
- A copy that fails partway removes what it wrote instead of leaving an
  unrecorded tree that blocks every retry.
- `evidence init --write` writes `execution.yaml` to the change's durable source
  directory and mirrors it into an active sandbox, so a later `sandbox sync`
  cannot destroy it.
- `sandbox create` treats every `openspec/changes/` draft as harness-owned, so
  concurrent changes keep git-worktree isolation instead of full-tree copies.
- `install.sh` stages the managed files and reports that they must be committed
  before the first `/change`.
- The rapid proposal template uses OpenSpec's expected `## Why` and
  `## What Changes` headers.
- The orphan-runtime diagnostic names `change abandon` instead of a manual `mv`.

## Impact

- **Impact:** medium
- **Coupling:** coupled
- **Affected surfaces:** shipped runtime (`evidence init`, `sandbox create`,
  `doctor`), installer, rapid schema template
- **Security triggers:** none — no identity, secret, permission, or trust
  boundary is touched; `sandbox create` keeps its existing isolation guarantees
  and only reclassifies a path already excluded from both the workspace hash
  and the apply projection.

## Non-goals

- Reworking how `canonicalChangedSurface` treats pre-existing untracked files.
  Committing the managed files removes the user-visible dead-end; making the
  surface itself baseline-relative is a separate, deeper change.
- Reducing PreToolUse hook startup cost (~53ms per mutating call).
- Rotating `.foundation/logs/guardrail-audit.jsonl`.
