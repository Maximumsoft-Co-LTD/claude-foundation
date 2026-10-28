# Recovery

Git almost never loses your work; a panicked second destructive command often
does.

## Stop

When you suspect lost work, stop running destructive commands. The work is
almost always still there, and what loses it for real is the next `--hard`,
`--force`, `clean -fd`, or `branch -D` fired in a panic. Reach for
`git status`, then `git reflog`, then `git log --all` or `git fsck` — and only
then decide.

## Reflog

`git reflog` is the local journal of every position `HEAD` has held for about
90 days (`gc.reflogExpire`). It survives rebases, resets, branch deletions, and
force updates — everything but `git reflog expire` or `gc --prune=now`.

```bash
git reflog
# d4e5f6 HEAD@{0}: reset: moving to HEAD~5
# a1b2c3 HEAD@{1}: commit: fix(audit): default actor to system

git switch -c rescue/audit a1b2c3     # point a branch at what you want back
```

A specific branch has its own reflog (`git reflog feat/audit-log`), useful when
`HEAD`'s is noisy.

## fsck

`git fsck --lost-found` finds dangling objects no ref points at — including
blobs from `git add` that were never recorded, which the reflog never tracked.

```bash
git fsck --lost-found
git show <sha>                     # identify the commit or blob
git show <blob-sha> > recovered.txt
```

Blobs survive roughly two weeks by default, so this works for a while.

## Recipes

**Lost commits after `git reset --hard`:** find the SHA before the reset in the
reflog, then `git switch -c rescue <sha-before>` — branch first, inspect, then
decide whether to move the original branch.

**Bad rebase:** `git rebase --abort` while it is still running; afterwards find
`HEAD@{N}` just before "rebase finished" and branch a rescue from it.

**Force-updated over your own work:** your reflog still has the overwritten
SHAs. Branch a rescue from the lost SHA, publish that branch, then cherry-pick
or replace as appropriate.

**Force-updated over a teammate's work:** their clone still has the SHA in its
reflog. Ask them to publish it back:

```bash
git reflog                                    # their lost commit's SHA
git push origin <sha>:refs/heads/recovered
```

`--force-with-lease` would have refused the update in the first place.

**Deleted a branch you needed:** the tip SHA is in `HEAD`'s reflog (or the
branch's own, if it still exists) — `git switch -c recovered-branch <sha>`. If
the reflog is gone, `git fsck --lost-found` and identify the dangling commit.

**Lost a stash:** `git stash drop` clears the entry but not the object.

```bash
git fsck --unreachable | grep commit
git show <sha>          # a stash has a recognizable two-parent shape
git stash apply <sha>
```

**Detached-HEAD commits that "disappeared":** they are in the reflog —
`git switch -c rescue <sha-of-last-detached-commit>`.

**Recorded on the wrong branch:**

```bash
git switch -c feat/audit-log      # keep the commit on the right branch
git switch main
git reset --hard origin/main      # remove it from main; it is safe on the new branch
```

If the wrong commit was already published and others have pulled, add a
`git revert` commit instead of rewriting.

**Committed a secret:** treat it as already leaked — anyone who cloned has it —
and rotate it now, before cleaning history. Then remove it: for recent history,
drop or edit the offending commit with an interactive rebase and republish with
`--force-with-lease` after coordinating with the team; for deep history use
`git filter-repo --path .env --invert-paths`. Add the path to `.gitignore` and
check `git ls-files | grep -E '(.env|.pem|.key)'` before the next commit.

**Staged work that was never recorded:** `git fsck --lost-found`, find the
dangling blob whose content matches, `git show <blob-sha> > recovered.txt`.

## Reversible alternatives

| Tempting destructive command | Safer alternative |
|---|---|
| `git reset --hard <ref>` | `git switch -c backup` first, then reset the original branch |
| `git push --force` | `git push --force-with-lease` |
| `git rebase main` on a long branch | `git switch -c backup` first; `--abort` or return to the backup if it goes badly |
| `git checkout -- <file>` | `git stash` — it keeps the changes recoverable |
| `git clean -fd` | `git clean -fdn` first, confirm the list, then run it |
| `git branch -D <name>` | `git switch -c archive/<name> <name>` first |
| `git commit --amend` on published history | Add a follow-up commit; amend rewrites SHAs |
| Interactive rebase on shared history | Coordinate explicitly, or condense at integration time |

The pattern is always **branch first, destroy second** — branches and reflog
entries are free. The mental check before any destructive command: *if I am
wrong about what this does, what gets me back?* If the answer is the reflog,
proceed. If it is a teammate's clone, stop and make a backup. If it is nothing,
stop entirely and find the reversible alternative.
