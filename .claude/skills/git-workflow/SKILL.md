---
name: git-workflow
description: Apply git fundamentals — fresh-base branching, atomic commits, why-carrying messages, never rewriting shared history, PRs as the unit of review, reflog-first recovery. Use BEFORE any write to `.git` — branch, commit, commit message, rebase, merge, force-push, opening/updating a PR, or destructive cleanup (`git reset --hard`, `git push --force`). The trigger is any branch/commit/PR-shaped move, even when the user doesn't say "git". Includes references on commit messages, branching/rebasing, pull requests, and recovery. Skip read-only `git status` / `git log` / `git diff`.
---

# Git Workflow

Git is the joint between your work and everyone else's. Almost every lost-changes / force-pushed-over-a-teammate / branch-went-sideways / can't-tell-what-this-PR-does story traces to the same skipped fundamentals — a branch that grew five purposes, a message that said only "fixes", a rebase of a published branch, a `reset --hard` reached for before `reflog`. Catch them before the write and the cost is seconds; catch them in a postmortem and it's a teammate's afternoon, a lost commit, or a PR nobody can review. Workflow-, platform-, and tool-agnostic — solo project pushing to `main` or a 200-engineer monorepo with a merge bot.

## The 7 principles

Apply roughly in order — where you started and what you committed (P1–2) constrain how you rebase and ship (P4–6).

1. **Branch from a fresh base; one branch, one purpose** — `git fetch origin && switch main && pull --ff-only` before `switch -c`; a stale base merges from day one, a five-purpose branch is five PRs sharing one un-reviewable body. Name `<type>/<slug>` (`feat/audit-log`, `fix/login-redirect`), not `flame/wip`. Resist "while I'm in here" — stash it, branch separately.
2. **Commit small, atomic, complete** — one logical change per commit, compiles + tests green + stands alone; if the message needs an "and," it's two commits. Braided commits (fix + rename + reformat) break `bisect` / `revert` / `blame` and hide which line caused the regression. `git add -p` to split, `--fixup` + `--autosquash` to fold mid-branch before pushing.
3. **Commit messages carry the why** — subject imperative, ≤72 chars, no period, `type(scope): subject`; the body says *why* (constraint, trade-off, rejected alternative, `Closes #482`), since the diff already shows *what* and the Slack thread rots in a week. Hold one convention — this project's is Conventional Commits, its type set mirroring the `/dev` run Types (`references/commit-messages.md`).
4. **Rewrite local history, never shared** — before push, rebase/squash/amend/`--fixup` freely (that's how mess becomes reviewable history); after push, additive commits only or `git push --force-with-lease` (never bare `--force`); **never** force-push `main` or a protected branch — add a `revert` commit instead. Don't `--no-verify` / `--no-gpg-sign` past a check unless the user asked — the hook is telling you something.
5. **Integrate often; never let a branch rot** — `git fetch` daily, rebase onto `main` before any review request, run the suite after each integration (a clean merge ≠ a working merge — semantic conflicts compile). Debt is exponential: 2 days behind = 10-min rebase, 2 weeks = half-day of conflicts in files you don't remember. Rebase stacks bottom-up; a branch open >1 week is a smell.
6. **PRs are the unit of review — small, scoped, with context** — target ≤400 lines of meaningful diff, one purpose (can't title it without "and" → split, or stack), description = **Summary / Why / Test plan** (UI → before/after, API → example req/resp); review quality falls off a cliff past ~400 lines. Draft while iterating, flip to ready only on green — never request review on a red PR. Let reviewers close their own threads.
7. **Recover with the reflog before you destroy** — before `reset --hard` / `checkout --` / `push --force` / `clean -fd` / `branch -D`, ask "what gets this back if I'm wrong?" `git reflog` holds 90 days of every HEAD; work is lost by reaching for a *second* destructive command, not the first. Prefer the reversible move (`stash` before `reset --hard`, `revert` before `reset`, backup branch before a scary rebase); inspect (`reflog`, `fsck --lost-found`) before you "clean up and start over."

These seven, run in your head before any non-trivial `.git` write, **are** the pre-flight checklist. If any answer is "I don't know," stop and find out — a 30-second check beats a 3-hour recovery.

## Skip when

Read-only inspection (`git status` / `log` / `diff` / `show`); a `git pull` on a clean, up-to-date branch with no local commits to lose. Anything that writes `.git` or a remote applies — even "just a quick fixup," even "I'll squash before pushing."

## Run order & references

Git-workflow is the *delivery channel*: the construction skills decide *what to write*, this decides *how to commit, branch, and ship it* — independent dimensions, get both right. Atomic commits (P2) are the git-side cousin of [[programming-fundamentals]] "one function, one thing"; `git bisect` ([[debug-fundamentals]] P4) only works because P1–2 keep every commit green and single-purpose; [[database-fundamentals]] / [[queue-fundamentals]] migrations land as an ordered commit sequence with the rollout note in the PR; layer-crossing [[hexagonal-backend]] work wants one PR per layer or a stack. Full run order: `.claude/rules/fundamentals.md`.

Deeper mechanics, load on demand:
- `references/commit-messages.md` — conventional-commits cheat sheet, type/scope/subject anatomy, body + footer conventions, `/dev`-Type mapping, breaking-change syntax, anti-patterns.
- `references/branching-and-rebasing.md` — branch naming, trunk-based vs feature branches, interactive rebase, `--fixup` / `--autosquash`, `--force-with-lease`, stacked branches, rebase-vs-merge, long-lived-branch hygiene.
- `references/pull-requests.md` — full PR template, stacked-PR pattern, draft/ready discipline, review-comment etiquette, size targets and when to split.
- `references/recovery.md` — bad rebase, lost commits, deleted branches, accidental `reset --hard`, force-pushed work, detached-HEAD edits, lost stashes; the `reflog` / `fsck --lost-found` playbook.
