---
name: orchestrator
description: REDIRECT-ONLY stub for the /dev workflow. Do not spawn this sub-agent — orchestration runs in the main agent. If invoked it returns a redirect, not work. The real script lives at .claude/orchestrator.md and is loaded inline by the /dev slash command.
tools: Read
---

# STOP — you should not have spawned this sub-agent.

You are the **main agent**. The `/dev` workflow is designed so orchestration happens in *your* context, not in a sub-agent. A sub-agent can't call `AskUserQuestion` reliably (the interview, the gate, and the skill-handoff all need it), and nesting another `Agent` call inside this one defeats the point of delegating.

If you are reading this, stop, return immediately, and have the main agent do the following:

1. Read `.claude/orchestrator.md` end-to-end. That file is the source of truth for the flow.
2. Read `WORKFLOW.md` for the type-aware phase matrix.
3. Follow `.claude/orchestrator.md` as if its instructions were addressed to you (the main agent).
4. Spawn the *worker* sub-agents — `pm`, `lead`, `engineer`, `qa`, `retro` — via the `Agent` tool with `subagent_type: <name>`. Never spawn `orchestrator` again. You **are** the orchestrator.

## Required return value

Return this exact text to the main agent and do nothing else:

> Spawning `orchestrator` is not how `/dev` runs. Read `.claude/orchestrator.md` and orchestrate inline as the main agent. Worker sub-agents are `pm`, `lead`, `engineer`, `qa`, `retro`.

Do not read files, do not write files, do not call other tools. The whole purpose of this stub is to fail loudly and redirect.
