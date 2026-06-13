# Agent index

Quick reference for which model each agent in `.claude/agents/` runs on and what it does. Models are pulled from each file's frontmatter `model:` field. For the narrative on how these agents fit the `/dev` pipeline (which phase each runs in, how fanout dispatches them), see [`TEAM.md`](./TEAM.md) — it is the prose companion to this table, not an agent itself.

## `/dev` workers

The five sub-agents the orchestrator (main agent) spawns to do the `/dev` file work. The orchestrator is **not** listed here — there is no `orchestrator` sub-agent; the main agent plays that role (see [`../orchestrator.md`](../orchestrator.md)).

| Agent | Model | One-line role |
|-------|-------|---------------|
| [`pm`](./pm.md) | sonnet | Writes `spec.md` from the orchestrator's interview answers (Phase 1 spec; cannot interview the user itself). |
| [`lead`](./lead.md) | opus | Tech lead — three modes: plan (`plan.md`/`epic.md`), review (`review.md`), and trigger-based security (`security.md`). |
| [`engineer`](./engineer.md) | sonnet | Implements from `plan.md`, ticks acceptance criteria, does the docs touch-up, and ships (commit + optional PR). |
| [`qa`](./qa.md) | sonnet | Writes and runs unit/integration/e2e tests after implement; type-aware; blocks ship until tests pass or are skipped. |
| [`retro`](./retro.md) | sonnet | Closes the run — writes `retro.md`, appends follow-ups, surfaces memory + skill candidates for user confirmation. |

## `team-*` fanout workers

Focused workers the orchestrator dispatches in parallel during fanout phases (spec/plan research, review, security, test). They return findings for a `/dev` sub-agent to synthesise — they never write run artifacts directly.

| Agent | Model | One-line role |
|-------|-------|---------------|
| [`team-best-practice-researcher`](./team-best-practice-researcher.md) | sonnet | Researches best practices for a domain/framework/API/security/testing/UX question before pm or lead synthesises. |
| [`team-codebase-explorer`](./team-codebase-explorer.md) | haiku | Read-only codebase mapping — entry points, current behaviour, invariants, and blast radius — for spec/plan fanout. |
| [`team-code-reviewer`](./team-code-reviewer.md) | sonnet | Reviews code (a diff or named files) for CLAUDE.md adherence, style, and best practices. |
| [`team-code-simplifier`](./team-code-simplifier.md) | sonnet | Simplifies recently modified code for clarity and maintainability while preserving behaviour. |
| [`team-comment-analyzer`](./team-comment-analyzer.md) | haiku | Analyses code comments for accuracy, completeness, comment-rot, and long-term maintainability. |
| [`team-pr-test-analyzer`](./team-pr-test-analyzer.md) | sonnet | Reviews a PR for test-coverage quality and completeness — new functionality and edge cases. |
| [`team-silent-failure-hunter`](./team-silent-failure-hunter.md) | sonnet | Hunts silent failures, inadequate error handling, and inappropriate fallback behaviour in code changes. |
| [`team-type-design-analyzer`](./team-type-design-analyzer.md) | sonnet | Analyses type design — encapsulation, invariant expression, usefulness, enforcement — with qualitative + quantitative ratings. |
