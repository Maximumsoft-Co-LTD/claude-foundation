# Commit messages

The diff says *what changed*; the message says *why*.

## Conventional commits

```
<type>(<scope>): <subject>

<body>

<footers>
```

Conventional Commits v1.0.0 mandates only **`feat`** and **`fix`**. Every other
type — the Angular set (`build|chore|ci|docs|perf|refactor|style|test`) and
project-local ones — is a project choice: pick a list, write it down, and hold
the line. Tooling keys on `feat`, `fix`, and the `!` / `BREAKING CHANGE:`
marker for major versions.

| Type | When |
|---|---|
| `feat` | New user-visible capability (mandatory in CC v1.0.0) |
| `fix` | Bug fix — pairs with a regression test (mandatory in CC v1.0.0) |
| `refactor` | Internal restructure, no behavior change |
| `perf` | Performance change, no behavior change |
| `chore` | Tooling, deps, infra; nothing user-facing |
| `docs` | Documentation only |
| `test` | Tests only |
| `build` / `ci` | Build system or CI configuration |
| `revert` | Reverts a prior commit |

Scope is optional and useful — usually the module, package, or feature area
(`auth`, `orders`, `cli`, `installer`). The same scope every time is worth more
than a slightly better scope each time.

## Subject line

The subject stands alone in `git log --oneline`, in titles, in blame summaries.
Keep it ≤72 characters including type and scope, imperative ("Add audit log",
read as "if applied, this commit will…"), no trailing period, and specific.

```
feat(audit): record user_id on every audit row
fix(auth): persist session before redirect to fix login loop
refactor(orders): pull formatter through (no behavior change)
chore(deps): bump axios 1.6.0 → 1.7.2
```

Avoid `update`, `fix`, `WIP`, past tense ("Fixed the thing"), and subjects that
describe two changes — that is two commits.

## Body

Write a body whenever a future reader would ask "why?" or "why this way?" —
nearly every non-trivial change. Separate it from the subject with a blank
line, wrap near 72 characters, and explain the reason and the shape rather than
restating the diff. Name alternatives you rejected and why, and reference the
failing test, runbook, or design doc by ID.

```
fix(auth): persist session before redirect to fix login loop

When the OAuth callback set the session cookie and immediately
redirected, Chrome (but not Firefox) dropped the cookie on the
cross-origin redirect. Flush the session write before redirecting
so the Set-Cookie header has committed by the time the 302 fires.

Considered moving the redirect into a meta-refresh landing page;
rejected because it adds a visible flash on every login.

Regression test: auth.spec.ts:redirect-loop.
Closes #482.
```

## Footers and breaking changes

Machine-readable trailers: `Closes #482` / `Fixes #482` to autoclose,
`Refs #482` to link, `Co-authored-by:`, `Reviewed-by:`, `BREAKING CHANGE:`.

A breaking change takes `!` after the type, the `BREAKING CHANGE:` footer, or
both — changelog tools read either, and the redundancy is fine:

```
feat(api)!: replace /v1/orders payload with the v2 shape

BREAKING CHANGE: clients on /v1 must migrate. See MIGRATION.md.
```

Never ship a silent breaking change: a consumer's owner should be able to grep
the log for `BREAKING` and find it.

## Anti-patterns

| Anti-pattern | Why it hurts | Fix |
|---|---|---|
| "WIP" / "fix" / "stuff" | Useless to anyone who did not write it | Fold into the real commit before publishing |
| "Address review feedback" | The thread is transient; the message is permanent | Say what changed: "use --force-with-lease, not --force" |
| Past tense ("Added", "Fixed") | Convention and tooling expect imperative | "Add" / "Fix" |
| Mixed types in one commit | Bisect and revert become impossible | Split with `git add -p` |
| No body on a substantive change | Loses the why permanently | Write the body |
| A pasted error as the whole body | Hides the why | "X failed because Y, fixed by Z" |
| 500-character subject | Truncated in every view | It is two commits — split |

## Change Loop provenance

/dev delivers through Change, Build, Prove, and authorized Land. It produces
an uncommitted target diff, not a commit. For separately authorized Git or
/deliver work, choose the commit type from actual behavior and the repository
convention; do not invent a spec Type field or a legacy workflow directory.

Reference the archived OpenSpec change and actual evidence when useful.
Never create plan/review/retro artifacts just to fill a commit message.
See installed WORKFLOW.md for Deliver authority and retained provenance.

Prose style: [writing](../../init-project-docs/references/writing.md).
