# Design

## Current state

- `workspaceManifest` (`core/state-runtime.mjs:374`) walks the filesystem and
  filters only by `excludedWorkspaceDirs`, `.gitignore`, and the archive/change
  directories. Every untracked file in the tree is therefore change surface.
- `singleRelevantSnapshot` (`core/state-runtime.mjs:223`) hashes the git index
  plus `git status --untracked-files=all`, so untracked paths also bind the
  proof hash.
- `buildApplyEntries` (`workflow/apply-runtime.mjs:91`) computes
  `codePaths = union(baseline, sandbox).filter(baseline[p] !== sandbox[p])`. A
  path present in the baseline and absent from the sandbox becomes an entry with
  `after: null` — a deletion. The adjacent guard only fails when
  `target[p] !== baseline[p]`, which is false for a path the target never
  changed, so an entire untouched subtree passes as deletions.
- `landCheck` (`workflow/land-runtime.mjs:98`) calls `recoverPendingApply`
  before any reporting. On a journal in `applying` it rolls the transaction back;
  on `rolling-back`/`manual-recovery` it blocks with a decision. Either way the
  documented read-only check writes to the working tree.

## Decisions

- **Decision:** Define one surface predicate — git-tracked or declared — and
  apply it in `workspaceManifest` and `singleRelevantSnapshot`.
  - **Why:** The manifest feeds the apply projection and the snapshot feeds the
    proof hash; a single predicate keeps them from disagreeing, which is what
    turned a manifest asymmetry into deletions.
  - **Rejected:** Excluding only directories that carry their own `.git`. It
    fixes the observed incident and leaves every other untracked tree able to
    expire evidence and enter a projection.
  - **Rejected:** Tracked-only. A change legitimately creates files it has not
    committed; dropping them would silently omit new tests from Land.

- **Decision:** A projection entry may carry `after: null` only when the path is
  inside the declared surface and the sandbox reports it deleted relative to the
  sandbox base. Any other null is a projection defect that fails the apply,
  naming the paths and the total count.
  - **Why:** Deletion is the one irreversible operation in the transaction, so
    it must rest on an observation inside the sandbox rather than on an absence
    in a manifest.
  - **Rejected:** Capping the number of deletions. A threshold turns a
    correctness question into a magnitude question and still lands the small case.

- **Decision:** Remove `recoverPendingApply` from `landCheck`; report the pending
  transaction instead, and move the operation to `land recover <change>
  --decision-ref <ref>`.
  - **Why:** Recovery replays or reverses filesystem mutations. It is an
    authority action, and the phase that names itself a check must not perform it.
  - **Rejected:** Auto-recovering only non-destructive transactions. It keeps two
    behaviors behind one command and leaves the operator unable to predict which.

- **Decision:** Print `projection: N update, N create, N delete` before the
  entries run.
  - **Why:** The incident was invisible until after the fact; the counts are the
    cheapest place to see a projection that does not match the change.

## Compatibility and migration

`land check` loses a side effect, so a project holding an interrupted apply now
sees a report and a named command instead of silent recovery. That is a
wire-visible change to the land command surface: `commands.json` gains
`land recover`, `.claude/commands/land.md` and `WORKFLOW.md` document it, and the
protocol pin for the land surface is bumped.

Narrowing the surface changes `relevantHash` for any project carrying undeclared
untracked files, so proofs collected before the upgrade expire once. Evidence
already binds to a hash, so this surfaces as one re-prove, not as a false pass.
Existing journals keep their shape; only new projections are constrained.

## Risks

| Risk | Mitigation | Evidence owner |
|---|---|---|
| A file the change created but did not declare is dropped from Land | Declared paths are part of the predicate, and the existing changed-surface issue already fails a change that edits outside its paths; cover the create-and-declare path | test |
| A legitimate deletion stops landing | Require sandbox-observed deletion rather than declaration alone, and cover a real removal inside declared paths | test |
| Removing recovery from `land check` strands an interrupted transaction | `land check` names the transaction, its status and counts, and the recovery command; cover the report and the recovery | test |
| The surface predicate diverges between manifest and snapshot again | Both call one exported predicate, and a test asserts they agree on the same tree | test |
| Existing land and seam behavior regresses | Run the changeloop seam suite and the full shipped baseline | compatibility |
