# Changeloop review — bugs, cost, and improvement plan (2026-08-08)

Scope: the shipped change loop (`/investigate → /change → /build → /prove → /land`)
as a *consumer* experiences it. Reviewed against v3.2.7 (`e3f82f4`).

> **Update — defect 3 was understated, and it is now fixed.**
>
> This review called the sandbox copy's `.gitignore` blindness a Medium-severity
> cost, "brutal on ext4/CI." Building the fix in *this* repository proved that
> too mild. `sandbox create` copied this repo's 79GB gitignored Rust `target/`
> until a 926GB disk hit 683Mi free, died on an uncaught `ENOSPC`, and left a
> 41GB tree `state.workspace` had never recorded — invisible to the runtime,
> and enough to make every retry fail with `sandbox path already occupied`.
>
> The same blind spot sat in `workspaceManifest`: 906,814 of 909,041 baseline
> entries were `target/`, ~250s of hashing, and a **156MB** runtime state file
> that every later command re-parsed — `changes` 0.09s → 1.96s, `packet` 0.22s
> → 9.31s.
>
> Both walks now ask git what is ignored. Measured after: `sandbox create`
> 0.92s, sandbox 31MB, state file 104KB, `packet` 0.23s. A failed copy now
> removes its partial tree. See
> `openspec/changes/.../keep-the-change-loop-from-losing-provider-config-and-dead-ending`
> and `.claude/tests/harness/run-changeloop-seam-tests.sh`, which fails 11 of
> 19 assertions against the code as reviewed here.

## Verdict

The loop is correct and fast on its happy path — a full rapid change costs
**~4s of deterministic CLI time** end to end, and `sh .claude/tests/run-all.sh`
passes every suite. The problems are not in the engine; they are at the
**entry** and in **state handoff between phases**. Three defects put a
first-time user on a path that dead-ends, and one silently destroys the
harness's own configuration.

Ranked by what actually stops a user:

| # | Defect | Severity | Blocks a real user? |
|---|---|---|---|
| 1 | `sandbox sync` wipes `execution.yaml` written by `evidence init --write` | **High** | Yes — silent, Prove regresses |
| 2 | Fresh install leaves the harness untracked → Prove demands 3 unsatisfiable providers | **High** | Yes — first change dead-ends |
| 3 | Any second active change downgrades every sandbox to a full-tree copy | Medium | No, but costs time/disk |
| 4 | Rapid proposal template fails OpenSpec validation → warning on every Land | Low | No, noise only |
| 5 | Orphan runtime state has no discoverable cleanup path | Low | Yes, if hit |

Method: installed v3.2.7 into two scratch Node projects and drove the loop with
the shipped CLI only — no model in the path, so every number below is
deterministic runtime cost.

---

## 1. `sandbox sync` silently destroys detected provider config — **High**

`evidence doctor` ends by recommending:

```
next: claude-foundation evidence init <id> --write
```

During Build, `evidence init --write` resolves its target through
`activeChangePath(id)`, which points **into the sandbox**
(`change-validation.mjs:403`). It writes there and reports success:

```
"path": ".foundation/sandboxes/<id>/openspec/changes/<id>/execution.yaml",
"written": ["test"]
```

`sandbox sync` then does `rmSync(destination)` + `cpSync(source, destination)`
(`sandbox-runtime.mjs:329-331`) and merges **only `tasks.md`** back via
`mergeTaskProgress`. Everything else the sandbox learned is discarded.

Reproduced verbatim:

```
sandbox providers BEFORE sync: [ 'test' ]
--- sandbox sync ---
SYNCED <id>  revision: 2
sandbox providers AFTER sync: []
root providers AFTER sync:    []
```

The config is gone from **both** trees — unrecoverable, no warning. Prove then
falls back to demanding external evidence for `test`, and the user has no signal
that the harness deleted its own answer. Both `/change` ("Sync any sandbox") and
`/build` ("run `sandbox sync`") instruct the sync that triggers it.

**Fix.** `execution.yaml` is project-owned contract, not sandbox scratch. Either:

- (preferred) make `evidence init --write` always write to the **root** change
  directory, since that is the copy Land archives; or
- have `sync` merge `execution.yaml` back the way it already merges `tasks.md`,
  and bump `executionRevision` accordingly.

Add a deterministic test asserting `init --write` → `sync` → provider survives.

## 2. A fresh install dead-ends the first change — **High**

`install.sh` finishes with `Next: /change <intent>` and leaves ~245 harness
files **untracked**. Two things then go wrong at once, both traceable to
`canonicalChangedSurface` treating those files as the change surface:

**a. Spurious required providers.** `policyAnalysis` (`packet-runtime.mjs:98-125`)
pattern-matches the changed surface. The harness's own shipped paths match its
own triggers — `.claude/harness/runtime/contracts/` matches the `contracts?`
pattern → `compatibility`; shipped `.css`/`.html` under `.claude/skills/` match
→ `accessibility`; and `data-migration` fires likewise. On a one-line rapid
change whose only declared capability is `test`:

```
providers: accessibility compatibility data-migration discovery test
status: NEEDS_USER_DECISION
next[0]: accessibility / user-decision (external-evidence)
```

The user is asked to supply external accessibility evidence for adding a
`subtract()` function. There is no honest way forward.

**b. Isolated-copy fallback.** `createSingle` (`sandbox-runtime.mjs:205-212`)
treats any unrelated dirty path as grounds for a full-tree copy:

```
mode: isolated-copy
reason: dirty-target:?? .claude/commands/build.md
```

Committing the harness first fixes **both**, which confirms the causal chain:

```
providers: discovery test          # correct
SANDBOX add-subtract-to-calc       # git worktree, not a copy
```

**Fix.** Two independent guards, both worth having:

1. `install.sh` should end by staging/committing the managed files (or, at
   minimum, print that the loop expects them committed before the first
   `/change`). "Next: /change" is currently an instruction to walk into the
   broken state.
2. `policyAnalysis` should exclude harness-managed paths (the `MANAGED` set) the
   same way it already excludes `openspec/changes/`. A capability the *harness's
   own files* triggered is never the user's change surface.

## 3. A second active change forces a full-tree copy on every sandbox — Medium

`createSingle`'s `harnessOwned` allowlist covers `.foundation/` and
`openspec/changes/archive/`, plus *this* change's own draft — but not other
active changes' drafts. With two changes open:

```
mode: isolated-copy
reason: dirty-target:?? openspec/changes/standard-header-probe/.openspec.yaml
```

Since the loop deliberately keeps drafts uncommitted until Land, **two or more
concurrent changes guarantee copy mode for all of them.**

This is safe to fix and the runtime already proves it: `state-runtime.mjs:230`
drops other changes' directories from the relevant snapshot, and
`apply-runtime.mjs:49` excludes them from the apply diff. They are already
outside both the hash and the projection, so admitting them to `harnessOwned`
costs no fidelity.

**Cost of not fixing it.** The copy filter uses a hardcoded directory-name list
(`foundation.mjs:107-113`), *not* `.gitignore`. Measured on a 134MB project with
gitignored `dist/`, `target/`, `.venv/`:

```
target project size: 134M
sandbox size:        134M     # all gitignored build output copied
```

On APFS this took 0.4s thanks to `COPYFILE_FICLONE` reflinks. On ext4/CI —
no reflink — this is a genuine multi-GB, multi-minute copy per change for any
Rust/JVM/Python project. (`node_modules` *is* excluded; `target/`, `dist/`,
`build/`, `out/`, `vendor/`, `.venv/` are not.)

**Fix.** Add `openspec/changes/` to `harnessOwned`, and make the copy filter
consult `git check-ignore` rather than a fixed name list. Worth noting: the
workspace **hash** is already correctly `.gitignore`-aware — I verified that
rewriting a gitignored file does not change `workspaceHash` while touching a
tracked file does. So this is purely copy cost, not evidence staleness.

## 4. Rapid proposal template fails OpenSpec validation — Low

`openspec/schemas/foundation-rapid/templates/proposal.md` uses `## Why and what`.
OpenSpec 1.7.0 expects `## Why` and `## What Changes`. Every rapid Land prints:

```
Proposal warnings in proposal.md (non-blocking):
  ⚠ Change must have a Why section. Missing required sections.
    Expected headers: "## Why" and "## What Changes".
```

The **standard** template validates clean — I confirmed this is rapid-only. So
the recommended lane for small work is the one that warns, and the raw upstream
validator text reaches the user, which `orchestrator.md`'s human-interaction
boundary forbids.

**Fix.** Split the rapid template into `## Why` + `## What Changes`. One-line
change; keeps the lane silent.

## 5. Orphan runtime state has no discoverable exit — Low

This repository's own `SessionStart` reported three orphans (runtime state whose
`openspec/changes/<id>` directory is gone). `doctor` advises:

> restore `openspec/changes/<id>` or move `.foundation/runtime/<id>.json` to
> `.foundation/recovery/orphaned-runtime/`

That is a raw `mv` handed to a user, and it is unnecessary — `change abandon`
handles orphans correctly and quarantines them:

```
ABANDONED gate-lifecycle-executables-behind-trusted-approval
  quarantined: .foundation/recovery/abandoned/<id>
```

I cleared all three that way; `changes` is now clean.

**Fix.** Point the diagnostic at `change abandon`. Also, `changes` prints orphans
as tab-separated machine rows directly under "No active changes." — protocol
output in a user-facing surface.

---

## Performance and time cost

Deterministic CLI, warm, on the scratch project:

| Step | Time |
|---|---|
| `changes` / `help` / `--version` | 0.09s |
| `doctor` | 0.26s |
| `packet --phase build` | 0.22s |
| `sandbox create` (worktree) | 0.2s |
| `proof readiness` | 0.19s |
| `proof run` (2 providers) | 0.56s |
| `land check` + `archive` | 2.2s |
| **Full loop** | **~4s** |

The runtime is not the bottleneck. The measurable overhead is in hooks:

| Hook | Per call | Fires on |
|---|---|---|
| `phase-mutation-guard.mjs` | **53ms** | every Edit/Write/MultiEdit/Bash |
| `protect-secrets.sh` | 8ms | every Read/Grep/Bash |

~61ms added to every mutating tool call — roughly **30s per 500-call session**,
and Node process startup is essentially all of the 53ms. Converting the guard's
fast path to shell, or merging the two PreToolUse hooks into one process, would
recover ~45ms per call.

One related item, already fixed and worth confirming: `guardrail-audit.jsonl`
holds 2495 rows (422KB) in this repo, and **100% are noise** —
`phase: unknown`, reason `active phase is unavailable`. The early exit at
`phase-mutation-guard.mjs:42` fixed it; the log stopped growing on 2026-08-06
and has not grown during this session. What remains is that nothing ever prunes
the file — there is no rotation anywhere in the runtime.

---

## Improvement plan

Sequenced so each step is independently landable and testable.

**Step 1 — stop losing state (defect 1).** Make `evidence init --write` target
the root change directory, or teach `sync` to merge `execution.yaml`. Add the
init → sync → survives regression test. This is the only defect that destroys
user work.

**Step 2 — make the first run work (defect 2).** Commit-or-warn in
`install.sh`, and exclude `MANAGED` paths from `policyAnalysis`. Test: fresh
install → `new --rapid` → `packet --phase prove` requires exactly
`discovery test`. This is the difference between "the harness works" and "the
harness demands accessibility evidence for a one-line change."

**Step 3 — keep sandboxes cheap (defect 3).** Add `openspec/changes/` to
`harnessOwned`; switch the copy filter to `git check-ignore`. Test: two active
changes both get worktrees; a gitignored `dist/` is absent from the copy.

**Step 4 — quiet the surface (defects 4, 5).** Fix the rapid template headers.
Repoint the orphan diagnostic at `change abandon`. Render `changes` orphan rows
as prose.

**Step 5 — trim per-call overhead.** Rewrite the guard fast path in shell or
merge the PreToolUse hooks; add size-based rotation for
`guardrail-audit.jsonl`.

Steps 1 and 2 are what stand between the current release and a loop a new user
can finish unaided. Steps 3–5 are cost and polish.

### What I did not find

No correctness defect in evidence binding, receipts, proof staleness, spec sync,
or Land. The workspace hash correctly ignores gitignored output; Land's
projection preserved unrelated edits; `ALREADY ARCHIVED` is idempotent; and the
full test suite passes. The loop's guarantees hold — the failures are at the
seams around it.
