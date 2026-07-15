# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

This repo packages an opinionated **command workflow for Claude Code, aimed at AI engineers** — reusable slash commands, sub-agents, hooks, skills, and the `/dev` pipeline — so other repos can adopt them. The audience is engineers using Claude Code as their primary development surface; the artifacts here are the product, not an application.

Key surface area:
- `.claude/orchestrator.md` — the main-agent playbook for `/dev`. There is **no** `orchestrator` sub-agent; the main agent IS the orchestrator (it owns the interview, the gate, and the single-writer `state.json`). Never call `Agent(subagent_type="orchestrator")`.
- `.claude/agents/` — `/dev` workers (`pm`, `lead`, `engineer`, `qa`, `retro`), the team-mode `uxui` designer (spawned only by `/uxui-plan`), and the parallel `team-*` fanout workers — each with an explicit `model:` for cost/speed tuning.
- `.claude/commands/` — slash commands: `dev.md` (full pipeline) plus the **team-mode** slice commands that drive one phase into a shared `.workflow/<id>/` run (`spec`, `dev-plan`, `test-plan`, `uxui-plan`, `implement`). All three Phase-1 plan slices can run fully in parallel — each writes its own `state.<slice>.json` shard (with an `ac_covered` index so the gate fold is a deterministic **set-compare**, not a full re-read); the gate folds them into `state.json` single-writer (canonical: `orchestrator.md > State discipline > Team-mode Phase-1 sharding`). `dev-plan`/`uxui-plan` need only `spec.md`; `test-plan` also reads `plan.md`, so run first it goes **spec-only** and the gate **backfills** the plan-derived rows once `plan.md` exists (inline for XS/S, a `qa` re-spawn only for M/L). Installers ship the whole dir, so new commands need no manifest edit.
- `.claude/rules/` — `fundamentals.md`, the single **always-on router** that maps every "by default" trigger to its skill. Load-bearing: the fundamentals are applied via this thin always-on layer (project skills don't auto-trigger), then the full skill body loads on demand. It is the canonical source for triggers and cross-skill run order.
- `.claude/skills/` — the fundamentals skill bodies (full detail, loaded on demand — construction chain, process/verification, delivery channel; the router lists them) plus product skills (`brainstorming`, `plan-writing`, `qa-handoff-note`, `fanout-team-agents`, frontend/UX, `skill-creator`).
- `.claude/hooks/` — `dev-agent-guard.sh` (PreToolUse spawn guard), `dev-state-mark.sh` (PostToolUse state marker), `lint.sh` (PostToolUse linter), `protect-secrets.sh` (PreToolUse `.env`/credential read guard). `no-direct-main-commit.sh` is shipped but **opt-in** (wire it under `PreToolUse`/`Bash` in `settings.json` to block commits on `main`/`master`).
- `WORKFLOW.md` + `.workflow/` — the type-aware phase matrix, run templates, and per-run `state.json`/artifacts that drive `/dev --resume`. Gated by three axes: `Type` (which phases), `size` (how much machinery), `field` (**greenfield | brownfield**). Brownfield gates the **understand → lock → change** discipline (current-state map, characterization baseline); greenfield skips both. Canonical `field` def: `plan-writing > references/size-tiering.md > Greenfield vs brownfield`.

## Skills outside the router

Ten skills deliberately sit outside `.claude/rules/fundamentals.md` (which scopes itself to the code/construction/delivery lifecycle). They trigger two other ways — this split is intentional:

| Trigger path | Skills |
|---|---|
| `/dev`-pipeline wiring (orchestrator/agents invoke them) | `brainstorming` (interview), `plan-writing` (lead), `fanout-team-agents` (fanout dispatch), `skill-creator` (post-retro, user-approved only) |
| Frontmatter-description match on explicit ask | `claude-md`, `qa-handoff-note`, `init-project-docs`, `frontend-design`, `tailwind-design-system`, `ui-ux-pro-max` |

## Related references in this workspace

- `../claude-foundation-template/` — earlier template with `.claude/`, `brain/`, `docs/`, `install.sh`. Reference for house style only — do **not** copy it wholesale.

## Working agreements (carried from user-level config)

The fundamentals are applied via the always-on router `.claude/rules/fundamentals.md` (project skills don't auto-trigger). **The router maps every "by default" trigger to its skill and is the single source of truth for triggers and the cross-skill run order.** On the `/dev` plan / implement / review critical path, the always-on router + agent summaries are the default pre-flight: load no full skill body unless a specific friction requires it, and prefer at most one targeted `references/<file>` section. Off the critical path, or when a task explicitly asks for a skill's full procedure, load the relevant `SKILL.md`.

- **LSP first** — when an LSP tool is available, use it for diagnostics, go-to-definition, and references before grep/read. (From `~/.claude/CLAUDE.md`.)
- **`coding-discipline` wraps every code task** and runs first as the conduct check (assumptions stated → minimum non-speculative code → surgical diff → verifiable definition of done); it routes to the construction/debug/refactor skills per their rules and must not re-teach them.