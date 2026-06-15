---
description: Team mode — QA writes test-plan.md only. The qa agent designs the test strategy (coverage per AC, edge cases, fixtures, regression/baseline contract) for an existing run, before any code.
argument-hint: [<run-id>] (defaults to the most recent run)
---

Write the test plan for: **$ARGUMENTS**

This is the **QA test-strategy slice of `/dev`, run on its own** — design-time, before code. You — the main agent — resolve the run and spawn the `qa` sub-agent in **test-plan mode**; `qa` reads `spec.md` + `plan.md` and writes `.workflow/<id>/test-plan.md`. No code is written or run here (that's `/dev`'s test phase, or `qa` execute mode).

> **Spawn the `qa` worker by name** — `Agent({ subagent_type: "qa", ... })`. Do **not** use `subagent_type: "general-purpose"` or `"orchestrator"` (the spawn guard blocks both).

## What to do

1. **Resolve the run.**
   - **`$ARGUMENTS` names a run** (a `NNNN-…` id or a path under `.workflow/`) → use it.
   - **`$ARGUMENTS` is empty** → pick the most-recently-updated run under `.workflow/` (by `state.json > last_updated`, excluding `_templates`). If two or more are plausibly active, ask which via `AskUserQuestion` rather than guessing.
   - **No run exists** → tell the user to run `/spec <intent>` first (the test plan is designed against a spec); offer to start one. Don't fabricate a run folder with no spec.

2. **Pre-flight the inputs.**
   - **No `spec.md`** in the run → stop and point at `/spec` — the coverage plan maps every spec AC, so there's nothing to plan against without one.
   - **No `plan.md`** in the run → the test plan is normally written after the plan (it references `plan.md`'s Files touched / Steps). Tell the user, and offer to either (a) run `/dev --resume <id>` to produce the plan first (recommended), or (b) proceed **spec-only** — `qa` maps ACs to levels from the spec and marks plan-derived rows (edge cases off Files-touched, fixtures) as `[pending plan]`. Proceed spec-only only on the user's go-ahead.
   - **Type check** — read `state.json > type` (or `spec.md` frontmatter). Only `feat` / `fix` / `refactor` get a test plan. For `chore` / `docs` / `spike`, say so and stop (their test phase is skipped/absent) — don't write a stub.

3. **Spawn `qa` in test-plan mode** (`qa.md > Mode: Test plan`). Pass the run id, the `Type`, and `repo_root` / `branch` from `state.json`. Point it at `spec.md` + `plan.md` as authoritative; don't re-list the ACs inline. `qa` writes `test-plan.md` (Coverage plan per AC, Edge cases to probe, Visual verification for UI diffs, Fixtures + execution mechanism, and the type-specialised Regression contract / Baseline) and returns its summary.
   - If `qa` returns a `BLOCKER:` first line (a reachable security / data-integrity path the spec leaves undefined), surface it to the user via `AskUserQuestion` and route the answer back to the spec (`/spec <id>` → spec-patch) before the plan is final — don't ship a test plan over an undefined hole.

4. **Test-plan check.** Confirm `test-plan.md` exists and has a Coverage-plan row for every `spec.md` AC (including each AC's `on error / at boundary:` clause and any `measured:` target). Re-spawn `qa` once if an AC is unmapped.

5. **Write `state.json` and stop.** Per orchestrator `State discipline`, write the complete `state.json`: `step=test-plan`, `next_step=gate`, `last_agent=qa`, fresh `last_updated`. Tell the user the path and that `/dev --resume <id>` will carry the run through the gate → implement → the test phase that **executes** this plan.

Reference: [`.claude/agents/qa.md`](../agents/qa.md) (`Mode: Test plan`), [`.claude/orchestrator.md`](../orchestrator.md) (step 8a + State discipline), [`.workflow/_templates/test-plan.md`](../../.workflow/_templates/test-plan.md).
