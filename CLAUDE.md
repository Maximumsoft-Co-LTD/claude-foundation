# CLAUDE.md

## Identity

This is `claude-foundation` (`Maximumsoft-Co-LTD/claude-foundation`) - the
upstream source repository of the Claude Foundation harness itself, not a
project that consumes it.

Work here is **product development on the harness**, not use of the harness on
someone else's codebase. We are the maintainers and authors:

- The `.claude/` tree, `openspec/schemas/`, `WORKFLOW.md`, and `install.sh` are
  source code we own and change deliberately - not vendor files to leave alone.
- A rule, command, skill, or guard that behaves wrongly is our bug to fix here,
  not a constraint to work around.
- Consumers install this via `install.sh`; every shipped edit lands in their
  repositories, so treat shipped files as a public contract with real users.
- Bug reports and feature requests about Foundation are inbound work for this
  repository, not questions for an upstream project.

The change loop (`/change` → `/build` → `/prove` → `/land`) still governs how we
change this repository - we dogfood the harness while developing it.

## Purpose

This repository packages an installable OpenSpec-native change harness.
The workflow files and deterministic runtime are the product.

## Map

- `.claude/orchestrator.md` - concise change-loop contract.
- `.claude/harness/foundation.mjs` - deterministic resolver, proof, receipts,
  sandbox, watchdog, migration, and land guards.
- `.claude/commands/` - `/investigate`, `/change`, `/build`, `/prove`, `/land`,
  `/changes`, migration, and the `/dev` compatibility composition.
- `.claude/rules/fundamentals.md` - always-on skill router and canonical
  construction order.
- `.claude/skills/` - procedures loaded only when their trigger fires.
- `.claude/hooks/` and `.claude/settings.json` - generic safety and lint guards.
- `openspec/` - custom schemas, current specs, and durable changes.
- `.foundation/` - ignored machine state and evidence.
- `.workflow/` - read-only legacy migration source.
- `WORKFLOW.md` - public change-loop contract.
- `.claude/tests/run-all.sh` - deterministic workflow test entrypoint.

Risk and evidence—not size—select assurance. Size controls budget and slicing.

## Shipping Boundary

`install.sh > PLAN` is authoritative.

Ships:

```text
.claude/orchestrator.md
.claude/commands/**
.claude/harness/**
.claude/skills/**
.claude/rules/**
.claude/hooks/**
.claude/settings.json
openspec/config.yaml
openspec/schemas/**
.foundation/.gitignore
.foundation/README.md
WORKFLOW.md
```

Does not ship:

```text
.claude/tests/**
docs/**
CLAUDE.md
README.md
dashboard/**
examples/**
install*.sh
```

Runtime files contain rules, not benchmark history, cost figures, incidents, or
maintainer narrative. Never point a shipped file at a non-shipped path.
Evidence belongs in `.claude/tests/bench/rationale.md`; research notes belong
in `docs/research/`.

## Working Rules

- Apply `.claude/rules/fundamentals.md`; do not preload full skill bodies.
- Keep the change packet compact and use `tasks.md` as the sole ledger.
- Use LSP for definitions/references/diagnostics before grep or broad reads.
- Read only the needed section of large files such as `WORKFLOW.md`,
  `CHANGELOG.md`, and agent references.
- Keep changes surgical. A shipped-rule change also updates its deterministic
  tests and, when evidence-driven, the benchmark rationale.
- Run `sh .claude/tests/run-all.sh` after changing shipped files.
- New commands and schemas are included automatically by the installer.
- `no-direct-main-commit.sh` ships but remains opt-in.

Non-lifecycle skills (`brainstorming`, `plan-writing`, frontend/UX skills,
`skill-creator`) trigger through explicit workflow wiring or their own
descriptions; do not add them to the always-on router merely to make them
discoverable.
