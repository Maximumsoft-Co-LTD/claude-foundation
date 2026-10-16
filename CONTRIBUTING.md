# Contributing to Change Loop

**Audience:** contributors to Change Loop itself. These development checks are
not required in projects that merely install it; those projects use their own
tests and the [user workflow](README.md#your-first-change).

Thank you for your interest in improving Change Loop. This repository is the
upstream source of the Change Loop harness itself — every shipped change
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
- Website docs: Node.js **22.13.x or later 22.x, or >= 24.0.0** (the docs CI
  exercises 22.13.0; Astro and its optional WASM dependency require newer Node
  than the consumer harness).
- A POSIX shell (`sh`), `git`, and `jq`

```sh
git clone https://github.com/Maximumsoft-Co-LTD/claude-foundation
cd claude-foundation
npm install
```

Install dependencies before running tests. The harness resolves the pinned
OpenSpec CLI from `PATH`; upgrade-compatibility tests also need historical
release tags. Fetch missing tags when preparing that suite (CI does the same).

## Choose checks for your change

During editing, run the nearest regression first. When a related batch of edits
is complete, inspect and run the affected suites:

```sh
rtk test bash .claude/tests/run-all.sh --affected --list
rtk test bash .claude/tests/run-all.sh --affected
```

The full suite remains the authoritative final gate before commit. You do not
need to run it before and after every edit:

```sh
rtk proxy env PATH="$PWD/node_modules/.bin:$PATH" bash .claude/tests/run-all.sh
rtk git diff --check
```

Current-source tests and historical upgrade fixtures exercise different inputs;
do not commit or stash unfinished work just to run a test. See the
[test guide](.claude/tests/README.md) for suite ownership, branch-base selection,
parallelism, and timeouts. Website documentation changes also require
`rtk npm run build` from `website/docs`.

## What lives where

The product is the installable harness; much of the repository is
repository-only tooling. Read [`CLAUDE.md`](CLAUDE.md) — particularly the
**Repository map** and **Shipping boundary** sections — before touching anything under
`.claude/`, `openspec/schemas/`, or `install.sh`. In short:

| Area | Nature |
|---|---|
| `.claude/orchestrator.md`, `.claude/commands/`, `.claude/harness/`, `.claude/skills/`, `.claude/rules/`, `.claude/hooks/`, `openspec/schemas/`, `WORKFLOW.md` | **Shipped product** — installed into consumer projects |
| `cli.sh`, `install*.sh` | Distribution surface |
| `.claude/tests/`, `dashboard/`, `website/`, `examples/`, `docs/` | Repository-only |

## Making a change

For documentation, use the [file responsibilities and editing rules](CLAUDE.md#documentation-ownership).
Update the canonical source and affected English/Thai summaries together.

1. **Open an issue first** for anything beyond a small fix, so we can agree on
   the direction before you invest time.
2. Branch from `main`.
3. Keep the diff surgical — every changed line should trace to the issue or
   request. Do not bundle unrelated cleanup.
4. A change to a shipped rule or runtime behavior also updates its
   deterministic tests — and, when the change is evidence-driven, the
   benchmark rationale in `.claude/tests/bench/rationale.md`. New agent-facing
   commands need an entry in `.claude/harness/commands.json`. Wire-visible
   contract changes bump the affected pin in `.claude/harness/protocol.json`.
5. Run the full test suite exactly as shown in
   [Choose checks for your change](#choose-checks-for-your-change) and
   make sure it is green.
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
