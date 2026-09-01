# Contributing to Claude Foundation

Thank you for your interest in improving Claude Foundation. This repository is
the upstream source of the Foundation harness itself — every shipped change
lands in the repositories of everyone who installs it, so we hold contributions
to the same evidence-driven standard the harness enforces.

## Ground rules

- Contributions are accepted under the project's [MIT License](LICENSE).
- Every commit must carry a [Developer Certificate of Origin](https://developercertificate.org/)
  sign-off (see [Sign your work](#sign-your-work-dco) below).
- Be respectful. The [Code of Conduct](CODE_OF_CONDUCT.md) applies to all
  project spaces.
- Report security issues privately — see [SECURITY.md](SECURITY.md), never a
  public issue.

## Getting set up

Requirements:

- Node.js **>= 20.19.0**
- A POSIX shell (`sh`), `git`, and `jq`

```sh
git clone https://github.com/Maximumsoft-Co-LTD/claude-foundation
cd claude-foundation
npm install
```

Run the full deterministic test suite before and after your change:

```sh
sh .claude/tests/run-all.sh
```

The suite installs the harness from `git archive HEAD` into temporary fixture
projects, so commit (or stash) your work-in-progress locally if a suite needs
to see it.

## What lives where

The product is the installable harness; much of the repository is
repository-only tooling. Read [`CLAUDE.md`](CLAUDE.md) — particularly the
**Map** and **Shipping Boundary** sections — before touching anything under
`.claude/`, `openspec/schemas/`, or `install.sh`. In short:

| Area | Nature |
|---|---|
| `.claude/orchestrator.md`, `.claude/commands/`, `.claude/harness/`, `.claude/skills/`, `.claude/rules/`, `.claude/hooks/`, `openspec/schemas/`, `WORKFLOW.md` | **Shipped product** — installed into consumer projects |
| `cli.sh`, `install*.sh` | Distribution surface |
| `.claude/tests/`, `dashboard/`, `website/`, `examples/`, `docs/` | Repository-only |

## Making a change

1. **Open an issue first** for anything beyond a small fix, so we can agree on
   the direction before you invest time.
2. Branch from `main`.
3. Keep the diff surgical — every changed line should trace to the issue or
   request. Do not bundle unrelated cleanup.
4. A change to a shipped rule or runtime behavior also updates its
   deterministic tests. New agent-facing commands need an entry in
   `.claude/harness/commands.json`. Wire-visible contract changes bump the
   affected pin in `.claude/harness/protocol.json`.
5. Run `sh .claude/tests/run-all.sh` and make sure it is green.
6. Open a pull request describing **what** changed and **why**, with the test
   evidence.

This repository dogfoods its own change loop
(`/change` → `/build` → `/prove` → `/land`) for internal development. External
contributors are **not** required to use it — a well-scoped branch and a green
test suite are what matter.

## Sign your work (DCO)

We use the Developer Certificate of Origin instead of a CLA. Add a
`Signed-off-by` line to each commit, certifying you have the right to submit
the work under the project license:

```sh
git commit -s -m "fix(runtime): describe the change"
```

which appends:

```text
Signed-off-by: Your Name <you@example.com>
```

Use your real name and a reachable email address.

## Commit and PR conventions

- Commit messages follow the existing `type(scope): summary` style visible in
  `git log` (`fix(validation): …`, `docs(changelog): …`).
- One logical change per pull request. Small PRs are reviewed quickly; large
  mixed PRs are usually sent back for splitting.
- CI must be green. The workflow suite (`workflow-tests`) runs the same
  `run-all.sh` you run locally.

## Reporting bugs and requesting features

Use the issue templates. For bugs, include your Foundation `VERSION`, host
(Claude Code, Cursor, OpenCode, Codex), and the output of
`claude-foundation doctor` where relevant — they shortcut most round trips.
