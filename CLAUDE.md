# CLAUDE.md

## Purpose

This repository packages an installable Claude Code workflow for AI engineers.
The workflow files are the product; this is not an application.

## Map

- `.claude/orchestrator.md` - `/dev` main-agent procedure. There is no
  orchestrator sub-agent; main owns questions, spawns, and `state.json`.
- `.claude/agents/` - scoped workers and `team-*` fanout helpers.
- `.claude/commands/` - `/dev` plus explicit phase commands.
- `.claude/rules/fundamentals.md` - always-on skill router and canonical
  construction order.
- `.claude/skills/` - procedures loaded only when their trigger fires.
- `.claude/hooks/` and `.claude/settings.json` - runtime guards.
- `.workflow/` - run templates, index, follow-ups, and resumable artifacts.
- `WORKFLOW.md` - type-aware phase matrix and public workflow contract.
- `.claude/tests/run-all.sh` - deterministic workflow test entrypoint.

The `/dev` axes are `Type`, `size`, and `field` (`greenfield|brownfield`).
Brownfield uses understand → lock → change. Every run reads
`.workflow/CONTEXT.md` before walking code and treats it as evidence, not
authority.

## Shipping Boundary

`install.sh > PLAN` is authoritative.

Ships:

```text
.claude/orchestrator.md
.claude/orchestrator/references/**
.claude/agents/**
.claude/commands/**
.claude/skills/**
.claude/rules/**
.claude/hooks/**
.claude/settings.json
.workflow/_templates/**
.workflow/INDEX.md
.workflow/FOLLOWUPS.md
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
- On the `/dev` critical path, use summaries first and at most one targeted
  reference section when a concrete friction requires it.
- Use LSP for definitions/references/diagnostics before grep or broad reads.
- Read only the needed section of large files such as `WORKFLOW.md`,
  `CHANGELOG.md`, and agent references.
- Keep changes surgical. A shipped-rule change also updates its deterministic
  tests and, when evidence-driven, the benchmark rationale.
- Run `sh .claude/tests/run-all.sh` after changing shipped workflow files.
- New command files are included automatically because installers copy the
  command directory.
- `no-direct-main-commit.sh` ships but remains opt-in.

Non-lifecycle skills (`brainstorming`, `plan-writing`,
`fanout-team-agents`, frontend/UX skills, `skill-creator`) trigger through
explicit workflow wiring or their own descriptions; do not add them to the
always-on router merely to make them discoverable.
