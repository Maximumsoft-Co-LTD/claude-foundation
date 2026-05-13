---
description: Start the /dev workflow (spec → plan → gate → implement → review → security → test → docs → ship → retro). Pass --resume <id> to continue an interrupted run.
argument-hint: <intent> | --resume <id>
---

Run the `/dev` workflow on this intent: **$ARGUMENTS**

You — the main agent — are the Orchestrator for this run. Do **not** spawn an `orchestrator` sub-agent: Claude Code sub-agents cannot use `Agent` (no nested spawns) or `AskUserQuestion` (sub-agents can't talk to the user), so an orchestrator sub-agent would be unable to delegate or interview. Orchestration and all user interaction happen in *your* (main-agent) context. File work — spec / plan / review / security / implement / test / docs / ship / retro — is delegated to sub-agents via the `Agent` tool.

1. Read [`.claude/orchestrator.md`](../orchestrator.md) end-to-end. It is the source of truth for the flow — phases, state discipline, cycle limits, and the rules for delegating to sub-agents.
2. Read [`WORKFLOW.md`](../../WORKFLOW.md) for the type-aware phase matrix and the example runs.
3. Follow `.claude/orchestrator.md` as if its instructions were addressed to you. In particular:
   - You run the Phase 1 interview yourself via `AskUserQuestion` (one batch, 3–4 questions) — the `pm` sub-agent only writes `spec.md` from your interview answers.
   - You handle the gate, all cycle-limit escalations, and the skill-candidate approval via `AskUserQuestion`.
   - You spawn sub-agents (`pm`, `lead`, `engineer`, `qa`, `retro`) via the `Agent` tool with `subagent_type: <name>`. Pass the run id, the run's `Type`, and any mode hint (e.g., lead `plan` / `review` / `security`; engineer `implement` / `docs` / `ship`).
   - You own `state.json` writes after every step so `/dev --resume <id>` works.

Behavior:
- If `$ARGUMENTS` is empty, ask the user for the intent via `AskUserQuestion` before proceeding.
- If `$ARGUMENTS` starts with `--resume`, read `.workflow/<id>/state.json` and continue from the recorded step instead of starting fresh. If `state.json` is missing or malformed, ask the user whether to start fresh.

Reference: [`WORKFLOW.md`](../../WORKFLOW.md) for the full flow definition, [`.claude/orchestrator.md`](../orchestrator.md) for the step-by-step orchestration script.
