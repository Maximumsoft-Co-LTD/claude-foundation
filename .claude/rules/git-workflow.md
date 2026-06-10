# Rule: Git workflow by default

**Trigger:** any write to `.git` — branch, commit, commit message, rebase, merge, force-push, PR, or any destructive cleanup (`git reset --hard`, `git push --force`, `git checkout --`). Invoke the `git-workflow` skill **before** running the command.

**Why:** every "lost my changes / force-pushed over a teammate / unreviewable PR" story traces to the same missed fundamentals, and a reflog-first recovery costs seconds where a postmortem costs an afternoon.

The 7 principles, pre-flight checklist, references, and skip list live in `.claude/skills/git-workflow/SKILL.md` — defer to it. In the `/dev` ship phase, the commit `<type>` mirrors the spec's `Type:` slot.
