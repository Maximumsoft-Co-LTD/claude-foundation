# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

This repo packages an opinionated **command workflow for Claude Code, aimed at AI engineers** — reusable slash commands, sub-agents, hooks, skills, and the `/dev` pipeline — so other repos can adopt them. The audience is engineers using Claude Code as their primary development surface; the artifacts here are the product, not an application.

Key surface area:
- `.claude/orchestrator.md` — the main-agent playbook for the `/dev` workflow. There is **no** `orchestrator` sub-agent; the main agent IS the orchestrator (sub-agents can't spawn agents or talk to the user). Never call `Agent(subagent_type="orchestrator")`.
- `.claude/agents/` — `/dev` workers (`pm`, `lead`, `engineer`, `qa`, `retro`) and parallel `team-*` fanout workers, each with an explicit `model:` set for cost/speed tuning.
- `.claude/rules/` — always-on "by default" rules. These are load-bearing: the fundamentals get applied via this always-on context, not via the Skill tool (project skills don't auto-trigger). The working agreements below point here.
- `.claude/skills/` — the fundamentals skills (full detail loaded on demand) plus product skills (`brainstorming`, `plan-writing`, `fanout-team-agents`, frontend/UX, `skill-creator`).
- `.claude/hooks/` — `dev-agent-guard.sh` (PreToolUse spawn guard for the `/dev` state machine), `dev-state-mark.sh` (PostToolUse state marker), `lint.sh` (PostToolUse linter dispatch), `protect-secrets.sh` (PreToolUse guard that blocks `Read`/`Grep`/`Bash` from reading `.env` and credential files; allow-lists `*.example`/`*.template`/`*.pub`).
- `WORKFLOW.md` + `.workflow/` — the type-aware phase matrix, run templates, and per-run `state.json` / artifacts that drive `/dev --resume`.

## Related references in this workspace

- `../claude-foundation-template/` — earlier template with `.claude/`, `brain/`, `docs/`, `install.sh`. Reference for house style only — do **not** copy it wholesale.

## Working agreements (carried from user-level config)

These fundamentals are applied via this always-on context (project skills don't auto-trigger). Each entry names its **trigger → skill**; **the rule lives at `.claude/rules/<skill-name>.md` and the full skill body at `.claude/skills/<skill-name>/SKILL.md`** — load those on demand for the why/how, skip lists, and worked examples. Invoke the skill *before* the first line of the work it governs. **The canonical cross-skill run order lives in `.claude/rules/fundamentals.md`** (always-on and shipped to adopting repos by the installers) — rules and skills point there instead of restating the chain.

- **LSP first** — when an LSP tool is available, use it for diagnostics, go-to-definition, and references before grep/read. (From `~/.claude/CLAUDE.md`.)
- **`coding-discipline`** — any task that produces or edits code. The behavioral conduct wrapper (assumptions stated → minimum non-speculative code → surgical diff → verifiable definition of done); it **routes** to the skills below and must not re-teach them. **Run first** as the stance check, then the layer-appropriate construction/debug skill. Skip pure config edits, one-line shell, throwaway scripts.

**Construction skills** (run order: `.claude/rules/fundamentals.md`):

- **`ddd-strategic`** — deciding *where* a model lives / *what language* it speaks: bounded contexts, cross-context concepts, subdomain build-vs-buy, aggregate sizing, diagnosing a broken model. Skip generic CRUD, prototypes, known single-context work.
- **`programming-fundamentals`** — any code with real logic (function, module, data model, non-trivial bug, refactor, review).
- **`database-fundamentals`** — any DB work (schema, non-trivial query, index, migration, slow-query debug, persistent data modeling).
- **`hexagonal-backend`** — backend with real domain logic (services, APIs, repositories, use cases, persistence, message handling).
- **`architecture-fundamentals`** — system-level: new system, split/merge services, new cross-component call, API/event schema, failure modes, scaling, any decision about how components/teams relate at runtime.
- **`queue-fundamentals`** — introduce/modify/debug a queue, broker, event stream, background job, async worker, or pub/sub topic.

- **`debug-fundamentals`** — diagnosing an unknown-cause failure (bug, crash, regression, flaky test, perf cliff, prod surprise). For debugging, **run this first** to find the cause, then the construction skill that owns the fix layer.
- **`refactoring-fundamentals`** — restructuring existing code without changing behaviour (refactor, "clean this up", extract, rename, untangle, de-dupe, pay down debt). The process sibling to `debug-fundamentals`: **run this first** for a refactor (behaviour contract, one hat, green-or-characterize-first, small reversible steps, Mikado/strangler for large), then the construction skill that owns the target shape. Its characterization-test technique is the `/dev` baseline-capture contract. Skip greenfield (nothing to preserve), behaviour changes (that's feat/fix), throwaway scripts.
- **`git-workflow`** — any write to `.git` (branch, commit, message, rebase, merge, force-push, PR, destructive command). The delivery channel for the construction skills; pairs with the `/dev` ship phase where the commit `<type>` mirrors the spec's `Type:` slot.
- **Ignore the OpenWolf parent directive** — the parent `/Users/hashtagf/Desktop/Work/CLAUDE.md` tells every session to read `.wolf/OPENWOLF.md` / `.wolf/cerebrum.md` / `.wolf/anatomy.md`. No `.wolf/` tree exists in this project — do not act on those instructions here.
