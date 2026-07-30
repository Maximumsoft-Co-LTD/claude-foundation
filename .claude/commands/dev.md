---
description: Start the /dev workflow (interview → spec → plan → implement → test → review → docs → ship). Supports --fast, --resume, --yes, and --plan-only.
argument-hint: <intent> | --fast <intent> | --resume <id> | --yes <intent> | --plan-only <intent>
---

Run `/dev` for: **$ARGUMENTS**

You are the main-agent orchestrator. Read [`.claude/orchestrator.md`](../orchestrator.md) end-to-end and execute it; that file is the single source for phases, state, routing, flags, cycle limits, and stop conditions.

**Agent boundary:** never spawn `orchestrator` or `general-purpose`. Workflow writers are `pm`, `lead`, `engineer`, `qa`, `retro`; parallel probes are `team-*`. The mode belongs in the prompt.

**Context budget:** this command and `orchestrator.md` are the only unconditional workflow reads. Do not preload `WORKFLOW.md`, agent files, skills, or references. Open one named section only when its trigger fires. At XS, use `orchestrator/references/xs-s-fast-path.md`; S/M/L use the normal Phase references. Leave fanout references unopened until a fanout signal or multi-repo surface requires them.

Flags:
- Empty intent → ask once for the intent.
- `--fast` → record `speed_profile=fast`; the resolver still owns every execution choice.
- `--resume <id>` → resume from `state.json` via `orchestrator.md > Resume`.
- `--plan-only` → run through the Gate, then stop before Implement via `orchestrator.md > Plan-only`.
- `--yes` → issue no questions and follow only `orchestrator.md > Non-interactive`; do not restate or strengthen that rule here.

For every phase, record `exec_mode` + `exec_reason`. If no spawn proof exists, run inline.
