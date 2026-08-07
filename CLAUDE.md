# CLAUDE.md

## Identity

This is `claude-foundation` (`Maximumsoft-Co-LTD/claude-foundation`) - the
upstream source repository of the Claude Foundation harness itself, not a
project that consumes it.

Work here is **product development on the harness**, not use of the harness on
someone else's codebase. We are the maintainers and authors:

- The `.claude/` tree, `openspec/schemas/`, `WORKFLOW.md`, `cli.sh`, and
  `install.sh` are source code we own and change deliberately - not vendor
  files to leave alone.
- A rule, command, skill, or guard that behaves wrongly is our bug to fix here,
  not a constraint to work around.
- Consumers install this via `install.sh` (or Homebrew, `claude-foundation
  init`); every shipped edit lands in their repositories, so treat shipped
  files as a public contract with real users.
- Bug reports and feature requests about Foundation are inbound work for this
  repository, not questions for an upstream project.

The change loop (`/change` → `/build` → `/prove` → `/land`) still governs how we
change this repository - we dogfood the harness while developing it.

## Purpose

This repository packages an installable OpenSpec-native change harness.
The workflow files and deterministic runtime are the product.

## Map

Product surface, installed into consumer projects:

- `.claude/orchestrator.md` - concise change-loop contract.
- `.claude/commands/` - `/investigate`, `/change`, `/build`, `/prove`, `/land`,
  `/changes`, and the `/dev` compatibility composition. Seven commands; there
  is no migration command.
- `.claude/harness/foundation.mjs` - CLI-compatibility entrypoint and
  composition root only. Implementation lives under
  `.claude/harness/runtime/`: `core/` (flags, router, process, state, trust,
  diagnostics), `evidence/` (contract, providers, proof, receipts, review,
  attestation, CI), `workflow/` (change lifecycle, sandbox, agents, budget,
  authority, land, spec-sync), `observability/` (telemetry, metrics, model
  drift, host execution), `reliability/` (bounded retry), `contracts/`
  (portable schemas), and `runtime/version.mjs`, whose `RUNTIME_MODULE_API`
  `foundation.mjs` checks at load so a mixed-revision install fails immediately
  instead of partway through Land. Bump it with `RUNTIME_API_VERSION`.
- `.claude/harness/commands.json` - command registry that drives `cli.sh help`.
- `.claude/harness/protocol.json` - runtime and protocol version pins.
- `.claude/harness/AGENT.md`, `EVIDENCE.md`, `README.md` - shipped agent
  contract, evidence-adapter reference, and runtime reference.
- `.claude/rules/fundamentals.md` - always-on skill router and canonical
  construction order.
- `.claude/skills/` - procedures loaded only when their trigger fires; the
  whole directory ships.
- `.claude/hooks/` + `.claude/settings.json` - `session-context.sh`,
  `phase-mutation-guard.mjs`, `protect-secrets.sh`, and `lint.sh` are wired in
  `settings.json`; `no-direct-main-commit.sh` ships but stays unwired.
- `openspec/schemas/` - `foundation-rapid` and `foundation-standard` assurance
  profiles.
- `openspec/config.yaml`, `openspec/repositories.yaml`, `foundation.json` -
  seeded into a target only when absent, project-owned afterwards.
- `openspec/specs/` and `openspec/changes/` - project-owned; empty here.
- `.foundation/` - ignored machine state, evidence, receipts, and the
  `install-manifest.txt` recording managed-file ownership.
- `WORKFLOW.md` - public change-loop contract.

Repository-only surface, never installed:

- `cli.sh` - top-level `claude-foundation` router; resolves the target project
  and forwards to its own installed runtime. `install.sh` and
  `install-cursor.sh` install.
- `.claude/tests/run-all.sh` - deterministic workflow test entrypoint. Suites
  live in `.claude/tests/{harness,hooks,docs,interview,e2e,scenarios,ledger,
  lib}`; benchmark tooling and rationale in `.claude/tests/bench/`.
  `lib/harness-fixture.sh` installs the runtime into a temp project atomically,
  so a concurrent edit cannot produce a mixed-revision fixture;
  `harness/wiring-check.mjs` verifies the composition root statically.
- `dashboard/` - Node observability server plus `client.sh`; its `npm test`
  runs as the last suite of `run-all.sh`.
- `website/` - GitHub Pages site. `examples/` - sample consumer projects.
- `VERSION`, `RELEASING.md`, `Formula/claude-foundation.rb`, `release-notes/`,
  and `.github/workflows/{release,bottle,pages,workflow-tests}.yml` - release
  and distribution.
- `.workflow/` - read-only legacy migration source.
- `.changeloop/`, `crates/`, `scripts/`, `clients/`, `research/`, `opencode/` -
  local scratch, vestigial, or externally cloned. Not the product; do not
  extend them as if they were.

Risk and evidence—not size—select assurance. Size controls budget and slicing.

## Shipping Boundary

The `MANAGED` array in `install.sh` is authoritative. Everything it names is
copied on every install and recorded in `.foundation/install-manifest.txt`;
a path dropped from `MANAGED` is removed from a target only if that manifest
previously claimed it.

Managed, overwritten on install:

```text
.claude/orchestrator.md
.claude/commands
.claude/harness
.claude/skills
.claude/rules
.claude/hooks
openspec/schemas
.foundation/.gitignore
.foundation/README.md
WORKFLOW.md
```

Project-owned, seeded or merged but never clobbered:

```text
.claude/settings.json          # hooks merged with jq; timestamped backup
openspec/config.yaml           # copied only when missing
openspec/repositories.yaml     # copied only when missing
foundation.json                # copied when missing; packetBytes migrated
CLAUDE.md / AGENTS.md          # only the marked pointer block is rewritten
```

Everything else stays here: `.claude/tests/**`, `docs/**`, `dashboard/**`,
`website/**`, `examples/**`, `Formula/**`, `release-notes/**`, `cli.sh`,
`install*.sh`, `RELEASING.md`, `VERSION`, `package.json`, `README*.md`, and
this file's body.

Runtime files contain rules, not benchmark history, cost figures, incidents, or
maintainer narrative. Never point a shipped file at a non-shipped path.
Evidence belongs in `.claude/tests/bench/rationale.md`.

`docs/` is local by default: `.gitignore` blocks `/docs/*` except an explicit
allowlist plus `docs/reports/` and `docs/adr/`. Notes under `docs/research/`
stay untracked; commit a durable finding to `docs/reports/`.

## Working Rules

- Apply `.claude/rules/fundamentals.md`; do not preload full skill bodies.
- Keep the change packet compact and use `tasks.md` as the sole ledger.
- Use LSP for definitions/references/diagnostics before grep or broad reads.
- Read only the needed section of large files such as `WORKFLOW.md`,
  `CHANGELOG.md` (~280K), `README.th.md`, and harness references.
- Keep changes surgical. A shipped-rule change also updates its deterministic
  tests and, when evidence-driven, the benchmark rationale.
- Run `sh .claude/tests/run-all.sh` after changing shipped files. It needs Node
  >= 20.19.0 and finishes with `npm --prefix dashboard test`.
- Schemas and command files are picked up by the installer automatically, but a
  new agent-facing command also needs an entry in
  `.claude/harness/commands.json`.
- Keep new runtime code inside a `runtime/` domain and leave `foundation.mjs` a
  composition root; follow `.claude/harness/runtime/README.md`.
- Bump the affected pin in `.claude/harness/protocol.json` when a wire-visible
  contract changes, and keep `run-upgrade-compat-tests.sh` honest.

Non-lifecycle skills (`brainstorming`, `plan-writing`, frontend/UX skills,
`skill-creator`) trigger through explicit workflow wiring or their own
descriptions; do not add them to the always-on router merely to make them
discoverable.
