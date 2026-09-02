---
title: /land
description: The explicit completion transaction — apply the proven sandbox, verify, sync specs, archive, and clean up.
---

```text
/land <change>
```

Land is the only step that touches your real working tree, and it is deliberately explicit. Reaching it is not automatic, and running the earlier commands is not consent to run this one.

## Check first

```bash
claude-foundation land check <change>
```

This validates that the proven projection is still landable: proof freshness, receipt validity, no dropped scenarios, no pending tasks, and a projection that actually ran.

When a target advanced, this check marks the ordinary replay as automatic
recovery. The agent syncs every moved writable sandbox, re-proves the rebased
work, checks again, and continues. It tells you that the work was preserved; it
does not ask you to start a new change or copy commands. Replay conflicts and
authority choices still stop for judgment.

## Then archive

```bash
claude-foundation land archive <change>
```

The archive runs through a journal, and that journal is what makes it recoverable. It:

1. applies the proven projection while **preserving unrelated edits** in your working tree
2. verifies workspace identity
3. syncs specs into `openspec/specs/`
4. audits the evidence
5. archives the change
6. cleans up isolation

`ALREADY ARCHIVED` is a success result, not an error — it means a previous run got there.

Before archive, Land drains every bound transcript cursor automatically. When a
policy requires usage, at least one trustworthy measured dimension must exist.
Measured input/output tokens satisfy that policy even if the host omits price;
the record remains `partial-measurement` and cost stays `null`. Missing or
correlation-only telemetry stops with a recovery route instead of being treated
as zero. No manual telemetry step is needed when a real dimension was measured.

`land check` also adds a `branch:` line to `LAND READY` when the target repository is checked out on `main`/`master`, and `land record` warns on a default-branch target. Both are warnings only — every land guard stays commit-based, and branch reads are failure-silent.

:::caution[Land does not commit]
Land never commits, pushes, or opens a pull request. Those require separate authorization from you. Running `/land` is not authorization to push.
:::

## Multi-repository work

A change spanning repositories lands as a saga. `land check` returns a structured next action; follow it rather than improvising.

```bash
claude-foundation land record <change> --repo <id> --commit <sha> --decision-ref <ref> \
  [--ci-attestation <signed.json>] [--ci-required]
claude-foundation land resume <change>
```

`land record` binds a child repository commit **after an explicit host-recorded user decision**. `--ci pass` is the operator's word for it; `--ci-attestation` accepts the Ed25519-signed CI envelope the harness can actually verify, and `--ci-required` refuses the unsigned assertion. A non-submodule child's binding is reported as runtime-state-only, because nothing versioned in the root records it.

`land resume` continues an interrupted or multi-repository saga. It stages eligible root pointers and reports when a fresh Prove is required.

Re-staging root pointers that already hold the landed commit is a no-op. It used to invalidate proof unconditionally, so anything that reset the control repository's index sent Land back to Prove and straight into Land again.

## When something goes wrong

Land is built to fail safely and tell you what it left behind.

**Apply refuses to clobber another change's work.** A target file carrying uncommitted edits — say, from a previously landed change — is never silently overwritten by a whole-file copy. Apply refuses, names the clobbered paths, and says how to reconcile; symlinks are compared by link target, like Git blobs.

**An unresolved apply transaction stops the next apply.** A journal left in `rolling-back` or `manual-recovery` is not skipped. It would otherwise open a fresh transaction over a working tree Change Loop had already failed to restore, and report success. `doctor --change <id>` reports this before Land reaches it.

**Terminal stops carry their exits.** Exhausted review rounds, a corrupt review chain, a spent budget continuation, a control repository that moved mid-Land, an apply that could not finish rolling back — each emits the same decision envelope: a stop code, at least two honest options, a recommendation, and a preserved `pause`.

**Recovery re-checks the guards.** If `openspec archive` moves the change directory and then fails, recovery verifies what remains checkable before writing anything, and refuses a projection that never ran.

If a change genuinely cannot proceed, `change abandon` is the designed exit.

## Before authority actions

Your agent explains the visible effects in ordinary language and offers inspect, proceed, and pause. A command being available is not approval to run it.
