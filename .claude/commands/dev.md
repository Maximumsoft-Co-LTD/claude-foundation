---
description: Start the /dev workflow (spec → plan → gate → implement → test → review → security → docs → ship → retro). Pass --resume <id> to continue an interrupted run.
argument-hint: <intent> | --resume <id>
---

Run the `/dev` workflow on this intent: **$ARGUMENTS**

> **Spawn workflow sub-agents by exact name — never `subagent_type: "orchestrator"` or `"general-purpose"`** (the `PreToolUse` guard `dev-agent-guard.sh` blocks both and tells you to retry). File-writing → `pm`/`lead`/`engineer`/`qa`/`retro`; fanout → `team-*`; the mode hint lives in the *prompt*, not the `description`. Detail + call shapes: `orchestrator.md > Rules`. *You*, the main agent, are the Orchestrator.

You — the main agent — are the Orchestrator. Sub-agents can't call `AskUserQuestion`, so the interview, gate, and single-writer `state.json` stay in *your* context; file work (spec/plan/review/security/implement/test/docs/ship/retro) is delegated to `pm`/`lead`/`engineer`/`qa`/`retro`, and parallel research/investigation to `team-*` (self-dispatched, or on a `FANOUT_REQUESTED:` signal, synthesised back by the spawning worker).

1. Read [`.claude/orchestrator.md`](../orchestrator.md) end-to-end. It is the source of truth for the flow — phases, state discipline, cycle limits, and the rules for delegating to sub-agents.
2. Consult [`WORKFLOW.md`](../../WORKFLOW.md) only for the specific section needed at the moment (usually the type-aware phase matrix, security trigger list, or an example when behaviour is unclear). Do not load the full reference just because `/dev` started.
3. Follow `.claude/orchestrator.md` as if its instructions were addressed to you. In particular:
   - You run the Phase 1 interview yourself via `AskUserQuestion` (one batch, 3–4 questions) — the `pm` sub-agent only writes `spec.md` from your interview answers. (For XS/S runs the fast path skips `pm` and `lead`'s combined mode writes `spec.md` + `plan.md` in one spawn — see `orchestrator.md > Size-aware execution`.)
   - You handle the gate, all cycle-limit escalations, and the skill-candidate approval via `AskUserQuestion`.
   - You spawn workflow sub-agents (`pm`, `lead`, `engineer`, `qa`, `retro`) via the `Agent` tool with `subagent_type: <name>`. Pass the run id, the run's `Type`, and any mode hint (e.g., lead `plan` / `review` / `security`; engineer `implement` / `docs` / `ship`; qa `test-plan` / `execute`). You spawn `team-*` workers only for fanout probes described in `.claude/orchestrator.md`.
   - You own `state.json` writes after every step so `/dev --resume <id>` works.

Behavior:
- If `$ARGUMENTS` is empty, ask the user for the intent via `AskUserQuestion` before proceeding.
- If `$ARGUMENTS` starts with `--resume`, read `.workflow/<id>/state.json` and continue from the recorded step instead of starting fresh, following `orchestrator.md > Resume`. If the run was built via team-mode commands (`/spec`, `/dev-plan`, `/test-plan`, `/uxui-plan`), `.workflow/<id>/` will hold `state.*.json` shards and the cursor may read stale — Resume step 4 reconciles them by routing to the gate, whose fold absorbs the shards (`orchestrator.md > State discipline > Team-mode Phase-1 sharding`). If `state.json` is missing or malformed, ask the user whether to start fresh.

Reference: [`WORKFLOW.md`](../../WORKFLOW.md) for the full flow definition, [`.claude/orchestrator.md`](../orchestrator.md) for the step-by-step orchestration script.
