# Agent index

Which model each agent in `.claude/agents/` runs on and what it does (model from each file's frontmatter `model:`). Tier *policy* — who gets which tier and why, floors, escalation — lives in [`../orchestrator/references/model-tiers.md`](../orchestrator/references/model-tiers.md); this table mirrors it. For how these agents fit the `/dev` pipeline (which phase each runs in, how fanout dispatches them), see [`TEAM.md`](./TEAM.md) — the prose companion to this table, not an agent itself.

**When an agent gets a `references/<agent>.md`:** the base file carries the always-loaded core (role, modes, rules); mode *variants* and rarely-hit procedures overflow to a references file once the base would exceed roughly a page (~1,200 words) — never split below that, and never let the same rule live in both (`pm`, `lead`, `qa`, `engineer` have one; `retro`/`uxui` don't need one yet).

## `/dev` capability workers

The five optional capabilities the orchestrator (main agent) may execute inline, fork from warm context, or cold-spawn for `/dev`. A size label never selects a worker by itself: every cold spawn needs an `exec_reason` accepted by the execution resolver in [`../orchestrator.md`](../orchestrator.md). The orchestrator is **not** listed — there is no `orchestrator` sub-agent; the main agent plays that role.

| Agent | Model | One-line role |
|-------|-------|---------------|
| [`pm`](./pm.md) | sonnet | Writes `spec.md`. Eligible for explicit `/spec`, independent requirements work, or a material context gap; otherwise the warm executor writes it. |
| [`lead`](./lead.md) | sonnet default; opus for Security/high-stakes review | Plans or performs independent review/security. Planning stays inline/forked when context is warm; runtime M/L review normally supplies the independence proof. |
| [`engineer`](./engineer.md) | sonnet default; explicit high-stakes opus escalation | Implements a bounded task delta. Execution volume can justify one worker even with warm main context; size alone cannot. |
| [`qa`](./qa.md) | sonnet | Designs or executes tests when an independent contract, browser/new-harness tooling, or multi-repo isolation proves a separate context. Known commands stay inline. |
| [`retro`](./retro.md) | sonnet | Performs substantial multi-repo or explicitly deep synthesis. Routine closeout and ledger updates stay inline. |

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
| [`team-pr-test-analyzer`](./team-pr-test-analyzer.md) | haiku | Reviews a PR for test-coverage quality and completeness — new functionality and edge cases. |
| [`team-silent-failure-hunter`](./team-silent-failure-hunter.md) | sonnet | Hunts silent failures, inadequate error handling, and inappropriate fallback behaviour in code changes. |
| [`team-type-design-analyzer`](./team-type-design-analyzer.md) | haiku | Analyses type design — encapsulation, invariant expression, usefulness, enforcement — with qualitative + quantitative ratings. |
