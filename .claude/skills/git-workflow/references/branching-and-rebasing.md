# Branching and rebasing

Where a branch starts, how local history gets cleaned up, and how a branch
stays in sync with the integration branch.

## Branch naming and lifetime

Pick one convention and use it everywhere:

```
<type>/<short-slug>            feat/audit-log, fix/login-redirect
<type>/<ticket>-<slug>         feat/AUTH-482-audit-actor
<author>/<type>/<slug>         flame/feat/audit-log
```

Aim for ≤3 days on a focused branch and ≤1 week on any branch with active work.
Past that the branch pays rebase tax daily — ship a slice or rebuild. Delete
branches once integrated; `git fetch --prune` clears stale remote-tracking refs.

Two viable styles: **trunk-based** (everything lands on the default branch or a
branch that integrates within a day) needs strong CI and feature-flag
discipline but keeps integration debt near zero; **feature branches** add a
review gate and isolated CI at the cost of rot and large diffs. Short-lived
feature branches are the conservative default, and Change Loop produces one
short-lived branch per run.

## Interactive rebase

`git rebase -i <base>` lists one line per commit since `<base>`. Change `pick`
to `reword` (message), `edit` (pause to amend), `squash` (combine, keep both
messages), `fixup` (combine, drop this message), or `drop`; reorder lines to
reorder commits. Use it to clean a messy branch before review, fold "fix typo"
commits into their target, reword a misleading subject, or split a large commit
(`edit`, then `git reset HEAD^` and re-record in pieces).

Do this while the history is still private. Rewriting already-published history
is a separate, more careful operation.

## Fixup and autosquash

The cleanest way to correct an earlier commit on the same branch:

```bash
git add <files>
git commit --fixup=<sha-of-earlier-commit>   # titled "fixup! <orig subject>"
git rebase -i --autosquash <base>            # positions fixups under their targets
```

Set `git config --global rebase.autoSquash true` so the flag is automatic. This
beats `--amend` for anything but the most recent commit: amend only rewrites
`HEAD`, while fixup + autosquash corrects any commit on the branch.

## Rebase vs merge

```bash
git fetch origin
git rebase origin/main   # replay your commits on top; linear history
git merge origin/main    # record an integration commit; branching history
```

Rebase gives a linear log and clean bisection but rewrites SHAs (so publishing
needs `--force-with-lease`) and resolves conflicts commit by commit. Merge
preserves literal history and resolves once, at the cost of a noisy log and a
graph bisection must navigate. Pick one per branch and never mix the two —
mixing produces a graph nobody can read. Change Loop rebases onto the
integration branch during a branch's life and leaves the final integration
strategy to the platform policy.

## `--force-with-lease`

`git push --force` overwrites the remote unconditionally: if a teammate
published something while you were rebasing, their commit is gone and they find
out tomorrow. `git push --force-with-lease` proceeds only when the remote is
still at the SHA you last saw — one extra fetch in the rare collision, instead
of losing someone's work.

```bash
git config --global alias.fpush 'push --force-with-lease'
```

Never force-update the default or a protected branch. When a bad commit has
already landed there, add a `git revert` commit instead: the history is the
truth, and "the truth got worse for ten minutes" beats "the truth got rewritten
under everyone's feet."

## Stacked branches

B branches off A, A off the integration branch; each is its own review unit and
B integrates only after A. Rebase from the bottom up:

```bash
git switch A
git fetch origin && git rebase origin/main
git switch B
git rebase --onto A <old-base-of-B> B
```

Rebasing B first leaves it on a SHA of A that A no longer has, producing
phantom conflicts. `git rebase --update-refs` handles a whole stack at once.

## Resolving conflicts

1. `git status` to see the conflicted files; open them.
2. Resolve the `<<<<<<<` / `=======` / `>>>>>>>` markers. During a rebase
   "ours" is the branch you are replaying onto and "theirs" is your commit —
   reversed from a merge. Remove the markers.
3. `git add <file>`.
4. `git rebase --continue`, or `git rebase --abort` to return to the start.

**Semantic conflicts** resolve cleanly but mean the wrong thing — the
integration branch renamed a function and your commit added a call to the old
name. Git cannot catch this: rerun the relevant evidence after any non-trivial
rebase, because a clean integration is not a working one.

If a rebase is genuinely impossible (both sides rewrote the same lines),
`git rebase --abort`, keep a copy of the work on a rescue branch
(`git switch -c rescue/<name>`), and integrate the other way. Rebase is the
default, not a religion.
