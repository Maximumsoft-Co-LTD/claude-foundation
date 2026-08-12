# Plan: one answer for target movement during Build

Status: proposed, not entered into the change loop.
Lane: Runtime (`.claude/harness/runtime/**`) — gates are the wiring test,
protocol pins, and a regression at the seam.

## Problem

The target repository moves while a change is building — a teammate's commits
arrive by `pull`, another change lands, someone edits the working tree. The
harness handles this well in one sandbox mode and badly in the other.

**Isolated copy (`mode: "copy"`)** reconciles properly. `sandbox sync`
fast-forwards every path the target moved and the sandbox left alone, names any
double-edited path as `CONFLICT <path>` at sync time, and accepts
`--resolve <path,path>` once the merge is done in the sandbox copy
(`sandbox-runtime.mjs:478-536`).

**Git worktree (`mode: "worktree"`)** has no reconciliation at all. `sandbox
sync` skips the whole block — the guard is `workspace.mode === "copy"`. If the
target HEAD moved, `sandbox apply` refuses with a bare
`fail("target HEAD moved since sandbox creation")`
(`apply-runtime.mjs:104` and `:144`) and nothing anywhere names a way out.

Three consequences, in descending severity:

1. **No recovery route.** The single-repository refusal is a bare string. Its
   multi-repository sibling for the same condition already emits a structured
   `blockWithDecision(id, "control-head-moved", …)` naming inspect /
   recreate-sandbox / abandon / pause (`land-runtime.mjs:371-396`). The
   asymmetry is ours, not the user's.

2. **`land check` lies.** `commands.json` describes it as "Validate that the
   proven projection remains landable." `landCheck` (`land-runtime.mjs:97`)
   never compares target HEAD against `workspace.baseHead`; the comparison
   lives downstream in `buildApplyEntries`/`reapplyCodePaths`. So `land check`
   reports a landable change that `land archive` will refuse. The user pays for
   a full `/prove` cycle before finding out.

3. **`sandbox inspect` cannot see it.** `workspaceInspection`
   (`sandbox-runtime.mjs:206-223`) returns `{kind, status, path, repositories}`
   only. `baseHead` sits in runtime state already but is never surfaced, so
   diagnosing the drift means reading `.foundation/` by hand.

Nothing here is a safety hole — every path is blocked, and no change can land
on an unproven base. It is purely a recovery and lead-time defect.

## Design

**Reconcile worktree target movement inside `sandbox sync`, not in a new
command.**

The alternative — a separate `sandbox rebase` — is worse for one reason: the
user would have to know which sandbox mode they are in to know which command to
run, and mode is chosen automatically by target cleanliness at
`sandbox create`. Making the answer to "the target moved" the same sentence in
both modes is the whole point. `sandbox sync` is already the "the world moved,
resettle Build" command: it already bumps `revision`, already deletes the proof,
already owns `--resolve`.

The rebase runs only when `gitHead(root) !== workspace.baseHead`, exactly as the
copy-mode fast-forward loop is a no-op when nothing moved.

**Accepted consequence:** replaying by diff flattens any commits made inside the
sandbox into working-tree changes. Nothing in the harness reads that history —
`sandboxBase()` diffs from `baseHead` and Land creates its own commit — and the
sandbox is machine state under `.foundation/`. State it in the sync output.

### Sequence (worktree, heads differ)

Check before destroying anything:

1. `git -C <sandbox> add -N .`, then
   `diff = git diff --binary <baseHead> -- <applyPathspec>`. Same call
   `gitApplyInputs` already makes, so committed and uncommitted work are both
   captured.
2. `git worktree add --detach <sandbox>.rebase <newHead>`.
3. `git apply --check` the diff in the temp worktree. On failure: parse the
   rejected paths, remove the temp worktree, leave the sandbox **untouched**,
   and print one `CONFLICT <path>` line per path in the same wording copy mode
   already uses. Land stays blocked; the user merges in the sandbox and reruns.
4. Apply the diff for real in the temp worktree; copy `openspec/changes/<id>/`
   across.
5. Swap: `git worktree remove --force <sandbox>` then
   `git worktree move <sandbox>.rebase <sandbox>`. Verified available —
   `git worktree move` ships in git ≥ 2.17; local is 2.50.1.
6. Update state: `workspace.baseHead = newHead`, refresh `changeSourceHash` and
   `packetSnapshot`, bump `revision`, delete the proof, `clearSnapshotCache`.
   Steps 5-6 reuse the tail of `sync` unchanged.

Persist the step-1 diff under `.foundation/` before step 5 so a crash between
remove and move is recoverable.

Report it like the copy-mode twin:

```
SYNCED <id>
  revision: 4
  workspace: <hash>
  rebased: <baseHead short> -> <newHead short>
```

### Scope note

`--resolve` stays copy-only. In worktree mode a conflict means `git apply`
rejected a hunk; there is no baseline to advance, so the user merges and the
next sync's `git apply --check` either passes or does not. Do not invent a
worktree `--resolve`.

## Work items

Ordered. Items 1-3 are one coherent change; item 4 is separable.

| # | Item | Files | Size |
|---|---|---|---|
| 1 | Worktree rebase inside `sandbox sync` | `workflow/sandbox-runtime.mjs` | ~120 lines |
| 2 | Replace both bare `fail()`s with `blockWithDecision` | `workflow/apply-runtime.mjs` | ~25 lines |
| 3 | Move the HEAD check into `landCheck` | `workflow/land-runtime.mjs` | ~10 lines |
| 4 | Surface drift in `sandbox inspect` | `workflow/sandbox-runtime.mjs` | ~15 lines |

**Item 1** is above. Update the `sandbox sync` description in
`.claude/harness/commands.json` — it currently reads "fast-forwarding target
moves the sandbox left alone", which is copy-specific — and the matching
paragraph in `WORKFLOW.md:120-126`. No new command, so no new registry entry.

**Item 2** — the new decision must satisfy the invariants in
`core/blocked-decision.mjs:13-28`: at least two options, one of them `pause`,
and `recommended` must name an offered option. Proposed:

- `sync` — "Rebase the sandbox onto the current target commit and re-prove."
  (recommended, once item 1 exists)
- `inspect` — "Compare the recorded base with the current target history first."
- `abandon` — "Retire this change and reopen it against the current commit."
- `pause` — "Change nothing and leave both workspaces as they are."

Reuse the `control-head-moved` code so single- and multi-repository emit the
same code for the same condition. Do item 1 first, or `sync` recommends a
capability that does not exist yet.

**Item 3** — add the worktree-mode HEAD comparison to `landCheck` so `land
check` stops claiming a change is landable when it is not. Copy mode must be
exempt: a moved HEAD there is reconcilable and not a blocker. Keep the
downstream guards in `apply-runtime.mjs` — they are the last line before the
transaction and cost nothing.

**Item 4** — extend `workspaceInspection` with `baseHead`, `targetHead`, and a
`drift` field (`"none" | "target-moved"`). `sandbox inspect` is
`audience: internal` and no entry in `protocol.json` covers its output shape, so
additive fields should need no pin — **confirm this before assuming it.**

## Cut line

Items 1-3 deliver the outcome. Item 4 is diagnostics and can be dropped or
deferred without weakening the fix.

## Evidence

Put the regressions at the sync seam, beside the copy-mode cases they mirror:

- `.claude/tests/harness/run-changeloop-seam-tests.sh` — the existing sections
  at lines 766 ("a target that moves under an isolated copy fast-forwards at
  sync") and 785 ("a double-edited file is named at sync") get worktree twins.
  Placing them adjacent makes the symmetry visible in the test file itself.
  Cases: heads differ and the diff replays cleanly; heads differ and a hunk is
  rejected (assert the sandbox survives untouched); heads match (assert no
  `rebased:` line); `land check` refuses after the target HEAD moves.
- `.claude/tests/harness/run-blocked-decision-tests.mjs` — one case for the new
  single-repository `control-head-moved` envelope.
- `.claude/tests/harness/run-feedback-isolation-tests.sh` — item 4's fields;
  it already asserts on `.workspaceIsolation.kind` at line 344.

No new suite, so no `run-all.sh` line and no README row. Full run:
`sh .claude/tests/run-all.sh`.

## Protocol pins

- `runtimeApi` — internal composition only, no CLI-visible contract change
  expected. Confirm against `wiring-check.mjs`.
- No pin covers `sandbox inspect` output or `land check` behavior. Verify
  before concluding no bump is needed.
