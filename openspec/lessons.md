# Lessons

**Audience:** agents and maintainers starting an investigation or change in
`claude-foundation`. Read this before `/investigate`. Repository-only; nothing
here ships to consumers.

Each lesson is a durable rule learned from an incident in
[incidents/](incidents/). Keep one line per lesson, newest first, and link its
incident. When a lesson becomes a shipped rule or a test, say where and keep
the line as history.

| Date | Lesson | Incident | Enforced by |
|---|---|---|---|
| 2026-11-09 | Never switch the target checkout's branch while a change is in Prove; use a separate worktree for other work. A completed review result is recorded, never aborted: recovery must bind the model that actually ran. | [2026-11-09-review-deadlock-after-target-branch-switch](incidents/2026-11-09-review-deadlock-after-target-branch-switch.md) | Recovery uses `dispatch.reviewer` and `authority abort` refuses a stranded result (`workflow-policy.test.mjs`, `authority-request-operation.test.mjs`); the branch-switch practice is not automated |
| 2026-11-09 | Run the full suite in the Build sandbox before Land; task verify commands alone miss other suites that construct the changed runtime. A new runtime factory dependency needs a safe default. | [2026-11-09-review-rules-callback-default](incidents/2026-11-09-review-rules-callback-default.md) | Maintainer practice (`CLAUDE.md` § Development workflow step 7); not automated |
