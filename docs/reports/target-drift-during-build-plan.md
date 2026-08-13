# Plan: one answer for target movement during Build

Status: **implemented** on top of `08cd28a`, at the repository root rather than
through the change loop. Revised against `08cd28a` (land surface confinement)
and `bec90ec` (unprovable gates); supersedes the first draft written against
`ec78b19`. What shipped, and the two places implementation contradicted this
plan, is recorded under *Outcome* at the end.
Lane: Runtime (`.claude/harness/runtime/**`) — gates are the wiring test,
protocol pins, and a regression at the seam.

## Problem

The target repository moves while a change is building — a teammate's commits
arrive by `pull`, another change lands, someone edits the working tree. The
harness reconciles this in one sandbox mode and is silent about it in the other,
and the operator does not choose which mode they get: `sandbox create` picks
worktree for a clean target and falls back to an isolated copy for a dirty one.

**Isolated copy (`mode: "copy"`)** reconciles properly. `sandbox sync`
fast-forwards every path the target moved and the sandbox left alone, names any
double-edited path as `CONFLICT <path>` at sync time, and accepts
`--resolve <path,path>` once the merge is done in the sandbox copy
(`sandbox-runtime.mjs:478-536`).

**Git worktree (`mode: "worktree"`)** does nothing. The reconciliation block is
guarded by `workspace.mode === "copy"`, so a worktree sandbox never sees the
target move at all.

### Measured, not inferred

`tmp/repro-worktree-head.sh` — clean target, worktree sandbox, one commit landed
on the target afterwards:

```
sandbox mode: worktree
baseHead recorded : 7eb7132…
target HEAD now   : 00df292…
--- sandbox sync ---
  SYNCED worktree-head-drift
    revision: 1
    workspace: 7074895c…
baseHead after sync: 7eb7132…
  => sync did NOT reconcile; baseHead still stale
--- does the sandbox see the teammate's file? ---
  sandbox is STALE on src/helper.js
```

**`sandbox sync` prints an ordinary success while the target has moved and the
sandbox is stale.** That is the finding that reorders this plan. The refusal at
Land was the visible symptom; the real defect is upstream of it — Build and
Prove continue against a base that no longer exists, and the harness says
nothing. Under this harness's own framing that is the worse failure: proof
*passes*, bound to a workspace hash the target can no longer accept.

Then, at the end, `sandbox apply` refuses with a bare
`fail("target HEAD moved since sandbox creation")` (`apply-runtime.mjs:107`
and `:147`) — a dead-end string, after the prove cycle is already spent.

Three defects, in the order they bite:

1. **Silent stale sandbox.** No signal at sync, none at prove, none at
   `land check`. Measured above.

2. **`land check` does not check this.** `commands.json:138` describes it as
   "Validate that the proven projection remains landable." `landCheck`
   (`land-runtime.mjs:97-177`) guards archived state, pending transactions,
   dropped scenarios, the OpenSpec CLI, proof presence, the proof audit, hash
   staleness, receipt validity and the applied projection — and never compares
   target HEAD against `workspace.baseHead`. The comparison lives downstream in
   `buildApplyEntries`/`reapplyCodePaths`.

3. **No recovery route.** The single-repository refusal is a bare string. Its
   multi-repository sibling for the identical condition already emits
   `blockWithDecision(id, "control-head-moved", …)` naming inspect /
   recreate-sandbox / abandon / pause (`land-runtime.mjs:426-447`). The
   asymmetry is ours.

Nothing here is a safety hole — every path is blocked and no change can land on
an unproven base. It is a lead-time and recovery defect.

## What the two new commits change

`08cd28a` and `bec90ec` landed after the first draft. Both help.

- **`landCheck` now emits a `blockWithDecision` of its own** —
  `apply-pending-recovery` (`land-runtime.mjs:112-134`) — and the commit states
  the principle this plan's item 3 argues: *a check reports; it does not
  settle.* Item 3 stops being a foreign concept bolted into `landCheck` and
  becomes a second stop beside the one already there, in the same shape.
- **`control-head-moved` is already in the `REGISTERED` set**
  (`run-blocked-decision-tests.mjs:68`), which is asserted by `deepEqual`
  against every code found in the harness sources. Reusing it in
  `apply-runtime.mjs` costs zero registry edits; inventing a new code costs one.
- **`land recover <change> --decision-ref <ref>`** is a new sibling. It is not
  the model for a sandbox rebase: recovery replays filesystem mutations against
  the target and is `kind: "authority"`. Rebasing a sandbox mutates only
  `.foundation/`. Keep it out of the authority surface.
- **A raised evidence bar.** `run-land-surface-mutation.sh` injects each new
  guard as a fault and confirms the suite detects it. That standard was set for
  guards in this exact area; the guards below should meet it.
- `sandbox-runtime.mjs` was untouched by both commits, so items 1 and 4 land on
  the code the first draft read. `applyPathspec` (`apply-runtime.mjs:47`) and
  `sandboxBase` (`:64`) are unchanged, so the rebase mechanics below still hold.

### A hypothesis raised and disproved

`08cd28a` confines the change surface to "tracked ∪ declared", and both
`workspaceManifest` and the proof snapshot now run that predicate. The obvious
worry is that copy-mode sync stopped fast-forwarding target moves outside a
change's declared `[paths:]`.

It did not. `tmp/repro-confined-sync.sh` ran the same scenario with and without
a `[paths:]` declaration; both fast-forwarded. The reason is
`state-runtime.mjs:440`: the confinement drops a path only when it is
**untracked and undeclared**. Everything git tracks stays in the manifest, and a
teammate's pull is by definition tracked. Recorded here so the question is not
reopened.

## Design

**Reconcile worktree target movement inside `sandbox sync`, not in a new
command.**

A separate `sandbox rebase` is worse for one reason: the user would have to know
which sandbox mode they are in to know which command to run, and they did not
choose the mode — target cleanliness at `sandbox create` did. Making the answer
to "the target moved" one sentence in both modes is the point. `sandbox sync` is
already the "the world moved, resettle Build" command: it bumps `revision`,
deletes the proof, and owns `--resolve`.

The reconciliation runs only when `gitHead(root) !== workspace.baseHead`,
exactly as the copy-mode fast-forward loop is a no-op when nothing moved.

**Ship it in two steps.** Step 1a is small, safe, and removes the silent-success
defect on its own; 1b is the part that touches a git worktree.

### 1a — say it

In `sync`, when the mode is `worktree` and heads differ, report it:

```
SYNCED <id>
  revision: 4
  workspace: <hash>
  target moved: <baseHead short> -> <newHead short> (sandbox not rebased)
```

Nothing else changes. Even alone this converts a silent stale sandbox into a
visible one.

### 1b — reconcile it

Check before destroying anything:

1. `git -C <sandbox> add -N .`, then
   `diff = git diff --binary <baseHead> -- <applyPathspec>`. The call
   `gitApplyInputs` already makes, so committed and uncommitted sandbox work are
   both captured.
2. `git worktree add --detach <sandbox>.rebase <newHead>`.
3. `git apply --check` the diff there. On failure: collect the rejected paths,
   remove the temp worktree, leave the sandbox **untouched**, and print one
   `CONFLICT <path>` line per path in the wording copy mode already uses. Land
   stays blocked; the user merges in the sandbox and reruns.
4. Apply the diff for real in the temp worktree; copy `openspec/changes/<id>/`
   across.
5. Swap: `git worktree remove --force <sandbox>`, then
   `git worktree move <sandbox>.rebase <sandbox>`. Verified present — local git
   is 2.50.1 and `worktree move` ships in ≥ 2.17.
6. `workspace.baseHead = newHead`; refresh `changeSourceHash` and
   `packetSnapshot`; bump `revision`; delete the proof; `clearSnapshotCache`.
   Steps 5-6 reuse the existing tail of `sync`.

Persist the step-1 diff under `.foundation/` before step 5 so a crash between
`remove` and `move` is recoverable.

Report `rebased: <old> -> <new>` in place of 1a's `target moved:` line.

**Accepted consequence:** replaying by diff flattens commits made inside the
sandbox into working-tree changes. Nothing in the harness reads that history —
`sandboxBase()` diffs from `baseHead` and Land creates its own commit — and the
sandbox is machine state under `.foundation/`. Say so in the sync output.

**Not in scope:** a worktree `--resolve`. In worktree mode a conflict means
`git apply` rejected a hunk; there is no baseline to advance, so the user merges
and the next sync's `git apply --check` either passes or does not.

## Work items

| # | Item | Files | Size |
|---|---|---|---|
| 1a | Report a moved target at sync (worktree) | `workflow/sandbox-runtime.mjs` | ~15 lines |
| 2 | Both bare `fail()`s become `blockWithDecision` | `workflow/apply-runtime.mjs` | ~25 lines |
| 3 | HEAD drift becomes a `landCheck` stop | `workflow/land-runtime.mjs` | ~20 lines |
| 1b | Rebase the worktree sandbox at sync | `workflow/sandbox-runtime.mjs` | ~120 lines |
| 4 | Surface drift in `sandbox inspect` | `workflow/sandbox-runtime.mjs` | ~15 lines |

Ordered by value per line, not by dependency. 1a, 2 and 3 together turn a silent
stale sandbox and a dead-end string into a named condition with stated exits,
for roughly 60 lines. 1b is the actual fix and the bulk of the work.

**Item 1a** — also update the `sandbox sync` description in `commands.json:106`;
it currently reads "fast-forwarding target moves the sandbox left alone", which
is copy-specific and now actively misleading for worktree. Matching paragraph in
`WORKFLOW.md:113-126`. No new command, so no registry entry.

**Item 2** — reuse code `control-head-moved`; it is already registered. Satisfy
the invariants in `core/blocked-decision.mjs:13-28` (≥2 options, one `pause`,
`recommended` must be offered). Proposed, mirroring the multi-repository
sibling and following the `apply-pending-recovery` precedent of carrying data
fields beside the options:

- `sync` — "Rebase the sandbox onto the current target commit and re-prove."
  (recommended once 1b exists; until then recommend `inspect`)
- `inspect` — "Compare the recorded base with the current target history first."
- `abandon` — "Retire this change and reopen it against the current commit."
- `pause` — "Change nothing and leave both workspaces as they are."

Carry `recordedBase` and `currentHead` as data, as `control-head-moved` already
does at `land-runtime.mjs:445-446`.

**Item 3** — add the worktree-mode HEAD comparison to `landCheck`, beside the
`apply-pending-recovery` stop, so `land check` stops reporting a change as
landable that `land archive` will refuse. **Copy mode must be exempt**: a moved
HEAD there is reconcilable and not a blocker. Keep the downstream guards in
`apply-runtime.mjs` — they are the last line before the transaction and cost
nothing.

**Item 4** — extend `workspaceInspection` (`sandbox-runtime.mjs:206-223`) with
`baseHead`, `targetHead` and `drift` (`"none" | "target-moved"`). Diagnostics
only; droppable.

## Cut line

1a + 2 + 3 is a shippable increment: the condition becomes visible and every
stop names its exits. 1b completes it. 4 is optional.

## Evidence

Put the regressions at the sync seam, beside the copy-mode cases they mirror.

- `.claude/tests/harness/run-changeloop-seam-tests.sh` — the existing sections
  at **line 774** ("a target that moves under an isolated copy fast-forwards at
  sync") and **line 793** ("a double-edited file is named at sync") get worktree
  twins. Adjacency makes the symmetry visible in the test file itself. Cases:
  heads differ and the diff replays cleanly; heads differ and a hunk is rejected
  (assert the sandbox survives untouched); heads match (assert no `rebased:`
  line); `land check` refuses after the target HEAD moves.
  `tmp/repro-worktree-head.sh` is the seed for the first assertion — it already
  reproduces the defect end to end.
- `.claude/tests/harness/run-blocked-decision-tests.mjs` — no registry edit
  needed; the `deepEqual` will keep passing. Add a case only if item 2's
  envelope grows fields worth pinning.
- Mutation coverage — follow `run-land-surface-mutation.sh`: inject the item 3
  guard as a fault and confirm the seam suite detects it. Same bar the
  neighbouring land guards were held to yesterday.
- `.claude/tests/harness/run-feedback-isolation-tests.sh` — item 4's fields; it
  already asserts on `.workspaceIsolation.kind` at line 344.

No new suite unless the mutation check gets its own script; if it does, that is
three edits together — the script, a `run` line in `run-all.sh`, and a README
row. Full run: `sh .claude/tests/run-all.sh`.

## Protocol pins

- `runtimeApi` — internal composition only; no CLI-visible contract change
  expected. Confirm against `wiring-check.mjs`.
- No entry in `protocol.json` covers `sandbox inspect` output or `land check`
  behavior. Verify that before concluding no bump is needed.

## Reproductions

Kept outside the repo, under the job's scratch directory:

- `repro-worktree-head.sh` — the primary defect, worktree mode.
- `repro-confined-sync.sh` — the disproved confinement hypothesis.

## Outcome

All five items shipped, and `sh .claude/tests/run-all.sh` passes.

| Item | Where it landed |
|---|---|
| 1a report / 1b replay | `workflow/sandbox-runtime.mjs` — `rebaseWorktree`, called from `sync` |
| 2 apply stop | `workflow/apply-runtime.mjs` — `assertTargetHeadUnmoved`, both guards |
| 3 `land check` stop | `workflow/land-runtime.mjs` — after `assertOpenSpecCli` |
| 4 inspect drift | `workflow/sandbox-runtime.mjs` — `workspaceInspection` |
| shared | `core/workspace-surface.mjs` `sandboxCodePathspec`; `workflow/apply-recovery.mjs` `targetHeadMovedDecision` |

Docs: `commands.json`, `WORKFLOW.md`, `.claude/harness/README.md`.
Evidence: `run-target-drift-tests.sh` (24 assertions), 5 new unit tests in
`run-land-surface-tests.mjs` (17 total), and `run-target-drift-mutation.sh`
(2/2 faults detected), each with its `run-all.sh` line and README row.

### The suite it slowed down, and the runner that fixed it

The first cut of the mutation script ran the 30-scenario change-loop seam suite
three times for two scenarios: 109s, a third of the whole run. Two corrections,
both measured:

- The two worktree scenarios moved out of the seam suite into
  `run-target-drift-tests.sh` (4.3s), and the mutation script runs that instead:
  **109s → 11s**. A pointer comment sits beside the copy-mode twins they used to
  neighbour.
- `run-all.sh` now runs suites concurrently through an `xargs -P` pool, buffering
  each suite's output and replaying it in table order so a parallel run reads and
  diffs exactly like a serial one. `FOUNDATION_TEST_JOBS=1` restores serial.
  Measured on this machine: **5m54s → 1m56s**, serial fallback 3m50s.

A mutation suite cannot share the repository: it corrupts a file under
`.claude/harness/` and restores it, so anything running beside it reads a source
that is briefly wrong. Those are marked `!` in the table and run alone, after
everything else.

The pattern generalizes — point a mutation script at the narrowest suite that
covers its guard. The exclusive lane is serial by construction, so a mutation
suite that runs an expensive suite three times sets the floor for the whole run
on its own.

### Where the plan was wrong

**A straight `git apply` cannot resolve a moved base.** The plan specified
`git apply --check` then `git apply`. Both match the base's context lines, so
the moment a user merges the target's version into the sandbox to clear a
conflict, the very diff carrying that merge stops applying — the documented fix
would have made the next sync fail for the same reason. Caught by the seam
assertion "a merged file stops being named". The replay uses `git apply --3way`,
and the sandbox is staged with `git add -A` rather than `add -N` so the blobs
the three-way merge needs exist. Conflict detection reads `git apply --3way`'s
own vocabulary — `U <path>`, not `git merge`'s `CONFLICT (content):` — from both
streams.

**`sandbox inspect` may not execute a PATH-resolved program.** The plan assumed
item 4 could read the target head with `gitHead(root)`. It cannot: isolation
inspection and the unattended preflight are the decisions a hostile PATH would
most like to influence, and `run-feedback-isolation-tests.sh` pins that neither
shells out. Drift is read from `.git/HEAD` and the ref files instead
(`headOfRepository`), which answers the same question without executing
anything — and keeps working precisely when the environment is suspect.

### Two consequences worth knowing

- `landCheck` now fires first for a non-applied worktree sandbox, so
  `apply-runtime`'s guard is reachable only for the **applied** case
  (`reapplyCodePaths`). It is not dead code, but it is no longer the common
  path.
- No protocol pin was bumped. `runtimeApi` guards the boundary between
  `foundation.mjs` and `runtime/**`; `foundation.mjs` is untouched, no factory
  signature changed, and `wiring-check.mjs` passes. Nothing in `protocol.json`
  covers `sandbox inspect` output or `land check` behavior.
