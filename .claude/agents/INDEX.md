# Agent index

Which model each agent in `.claude/agents/` runs on and what it does (model from each file's frontmatter `model:`). For how these agents fit the `/dev` pipeline (which phase each runs in, how fanout dispatches them), see [`TEAM.md`](./TEAM.md) — the prose companion to this table, not an agent itself.

## `/dev` workers

The five sub-agents the orchestrator (main agent) spawns for the `/dev` file work. The orchestrator is **not** listed — there is no `orchestrator` sub-agent; the main agent plays that role (see [`../orchestrator.md`](../orchestrator.md)).

| Agent | Model | One-line role |
|-------|-------|---------------|
| [`pm`](./pm.md) | sonnet | Writes `spec.md` from the orchestrator's interview answers (Phase 1 spec; cannot interview the user itself). |
| [`lead`](./lead.md) | opus frontmatter; plan/review default sonnet override | Tech lead — three modes: plan (`plan.md`/`epic.md`), review (`review.md`), and trigger-based security (`security.md`). Opus is kept for security and high-stakes review/plan cases. |
| [`engineer`](./engineer.md) | sonnet | Implements from `plan.md`, ticks acceptance criteria, does the docs touch-up, and ships (commit + optional PR). |
| [`qa`](./qa.md) | sonnet | Test-plan mode (Phase 1) writes `test-plan.md` before code; execute mode (Phase 2) runs unit/integration/e2e against it; type-aware; blocks ship until tests pass or are skipped. |
| [`retro`](./retro.md) | sonnet | Closes the run — writes `retro.md`, appends follow-ups, surfaces memory + skill candidates for user confirmation. |

## Team-mode command workers

Workers a **team-mode slash command** spawns to drive one slice outside the full `/dev` run. The command's main agent plays the orchestrator (setup + interview + gate); the workers do the file work. The `/dev` workers above are reused — `pm` (via `/spec`), `lead` (via `/dev-plan`), `qa` (via `/test-plan`), and `engineer` + `lead` + `qa` + `retro` (via `/implement`, which runs the whole autonomous Phase 2). `uxui` is exclusive to team mode (`/uxui-plan`).

| Agent | Model | Command | One-line role |
|-------|-------|---------|---------------|
| [`uxui`](./uxui.md) | sonnet | `/uxui-plan` | UX/UI designer — writes `uxui-plan.md` (Scenes, ASCII wireframes, Scenarios, UX direction & components, AC↔scene mapping) from the spec, before the frontend is built. Drives `ui-ux-pro-max` / `frontend-design`; design only, writes no UI code. |

## `team-*` fanout workers

Focused workers the orchestrator dispatches in parallel during fanout phases (spec/plan research, review, security, test). They return findings for a `/dev` sub-agent to synthesise — never writing run artifacts directly.

| Agent | Model | One-line role |
|-------|-------|---------------|
| [`team-best-practice-researcher`](./team-best-practice-researcher.md) | sonnet | Researches best practices for a domain/framework/API/security/testing/UX question before pm or lead synthesises. |
| [`team-codebase-explorer`](./team-codebase-explorer.md) | haiku | Read-only codebase mapping — entry points, current behaviour, invariants, and blast radius — for spec/plan fanout. |
| [`team-code-reviewer`](./team-code-reviewer.md) | sonnet | Reviews code (a diff or named files) for CLAUDE.md adherence, style, and best practices. |
| [`team-code-simplifier`](./team-code-simplifier.md) | haiku | Recommends simplifications for recently modified code — clarity and maintainability while preserving behaviour (advisory; report-only). |
| [`team-comment-analyzer`](./team-comment-analyzer.md) | haiku | Analyses code comments for accuracy, completeness, comment-rot, and long-term maintainability. |
| [`team-pr-test-analyzer`](./team-pr-test-analyzer.md) | haiku | Reviews a PR for test-coverage quality and completeness — new functionality and edge cases. |
| [`team-silent-failure-hunter`](./team-silent-failure-hunter.md) | sonnet | Hunts silent failures, inadequate error handling, and inappropriate fallback behaviour in code changes. |
| [`team-type-design-analyzer`](./team-type-design-analyzer.md) | haiku | Analyses type design — encapsulation, invariant expression, usefulness, enforcement — with qualitative + quantitative ratings. |
