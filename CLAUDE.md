# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

This repository is currently **empty** (no source files, no build configuration, no git history). It is intended to host a "command workflow for Claude Code, for AI engineers" — a project that will codify reusable slash commands, agents, hooks, and skills for an AI-engineering workflow.

Until files are added, there is no codebase to describe. Re-run `/init` once real content lands so this file can be regenerated against the actual source.

## Intended scope (per project owner)

- Audience: AI engineers using Claude Code as their primary development surface.
- Purpose: package opinionated command workflows (slash commands, subagents, hooks, settings) that other repos can adopt.
- Likely surface area once populated: `.claude/` (commands, agents, settings.json, hooks), `skills/` or top-level skill files, and supporting docs.

## Related references in this workspace

When the project is fleshed out, the following sibling directory is the closest prior art and worth consulting for conventions — do **not** copy it wholesale, but use it to understand the house style:

- `../claude-foundation-template/` — earlier template with `.claude/`, `brain/`, `docs/`, `install.sh`, and a populated `CLAUDE.md`. Treat as reference, not source of truth.

## Working agreements (carried from user-level config)

- **LSP first**: when an LSP tool is available, use it for diagnostics, go-to-definition, and references before falling back to grep/read. (From `~/.claude/CLAUDE.md`.)
- **Programming fundamentals by default**: for any code task with real logic (writing a function, designing a module, modeling data, fixing a non-trivial bug, refactoring, reviewing), invoke the `programming-fundamentals` skill before writing or substantially changing code. Rule lives at `.claude/rules/programming-fundamentals.md`; full details at `.claude/skills/programming-fundamentals/SKILL.md`. Run this *before* `database-fundamentals` and `hexagonal-backend` — fundamentals are the layer below storage and architecture.
- **Database fundamentals by default**: for any task that touches a database (designing a schema, writing a non-trivial query, adding an index, writing a migration, debugging slow queries, modeling persistent data), invoke the `database-fundamentals` skill before writing schema, SQL, or migration code. Rule lives at `.claude/rules/database-fundamentals.md`; full details at `.claude/skills/database-fundamentals/SKILL.md`. Run this after `programming-fundamentals` and before `hexagonal-backend` — getting the schema and access patterns right matters even more than the architecture wrapping them.
- **Hexagonal backend by default**: for any backend task with real domain logic (services, APIs, repositories, use cases, persistence, message handling), invoke the `hexagonal-backend` skill before designing or writing code. Rule lives at `.claude/rules/hexagonal-backend.md`; full details at `.claude/skills/hexagonal-backend/SKILL.md`.
- **Queue fundamentals by default**: for any task that introduces, modifies, or debugs a queue, message broker, event stream, background job, async worker, or pub/sub topic, invoke the `queue-fundamentals` skill before designing or writing code. Rule lives at `.claude/rules/queue-fundamentals.md`; full details at `.claude/skills/queue-fundamentals/SKILL.md`. Run this *after* `programming-fundamentals`, `database-fundamentals`, and `hexagonal-backend` — the queue's contract (delivery semantics, idempotency, retries/DLQ, ordering, outbox) sits on top of code, schema, and architecture.
- **Debug fundamentals by default**: for any task that involves diagnosing an unknown-cause failure — a bug, crash, regression, flaky test, performance cliff, or unexpected production behavior — invoke the `debug-fundamentals` skill *before* changing code, adding try/catch, or "trying things to see what happens." Rule lives at `.claude/rules/debug-fundamentals.md`; full details at `.claude/skills/debug-fundamentals/SKILL.md`. When the task is debugging, run this *first* — find the actual cause with this skill, then the construction-time fundamentals (programming/database/hexagonal/queue) own the fix layer.
- **OpenWolf parent CLAUDE.md**: the parent `/Users/hashtagf/Desktop/Work/CLAUDE.md` references `.wolf/OPENWOLF.md`. That file does not exist in this tree — ignore the OpenWolf directive here until a `.wolf/` directory is actually present in this project.

## What to do on the next session

1. Check whether the directory now contains source files. If yes, re-run `/init` so this scaffold gets replaced with a real architecture/commands section.
2. If still empty, ask the owner what the first artifact should be (e.g., a `.claude/commands/` set, a skill, an `install.sh`) rather than inventing structure.
