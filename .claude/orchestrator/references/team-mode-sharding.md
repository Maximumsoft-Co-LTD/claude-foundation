# Orchestrator reference — Team-mode Phase-1 sharding

> Loaded on demand by the main agent (`.claude/orchestrator.md`). The single-writer rule + hook enforcement stay inline in `## State discipline`; this holds the **parallel team-mode Phase-1 slices** case. Read it **only** when a run is built via the team-mode commands (`/dev-plan` / `/test-plan` / `/uxui-plan`) — a one-shot `/dev` run never produces shards. This is the **canonical shard shape**: those commands point here for the JSON and keep only their own next-moves/delta inline.

The single-writer rule governs the **canonical `state.json` cursor** (the sequential Phase-2 resume position). All three team-mode Phase-1 commands (`/dev-plan`, `/test-plan`, `/uxui-plan`) can run **fully in parallel on one run** — none waits on another — so they must NOT contend that cursor (two slices re-emitting the full object = lost update). Each writes its **own shard** and leaves `state.json`/`INDEX.md` untouched:

- `/dev-plan` → `state.plan.json` — `{"status":"done","step":"plan","next_step":<"test-plan"|"gate">,"size":…,"field":…,"phase_plan":{…},"last_agent":"lead","last_updated":…}` (set `"epic": true` instead of the cursor fields if scope split).
- `/test-plan` → `state.test-plan.json` — `{"status":"done","last_agent":"qa","last_updated":…}` (+ `"pending_plan_backfill":true` when it ran spec-only — see below).
- `/uxui-plan` → `state.uxui.json` — `{"status":"done","last_agent":"uxui","last_updated":…,"notes":…}`.

**`/dev-plan` and `/uxui-plan` need only `spec.md`** — pure parallel. **`/test-plan` also reads `plan.md`** (Files-touched → edge cases, fixtures, regression/baseline path), so when `plan.md` isn't there yet it runs **spec-only**: Coverage-plan rows (spec-derived) complete, plan-derived rows marked `[pending plan]`, shard sets `pending_plan_backfill`. The **gate folds, then backfills** — if `pending_plan_backfill` set (or `[pending plan]` remain) and `plan.md` now exists, re-spawn `qa` `backfill` once before the consistency scan (`orchestrator.md` step 9).

`state.json` is written single-writer at exactly two **sequential** points: **run creation** (identity + `step=spec`) and the **gate** (step 9 / `/implement`), where you **fold the shards in** (and backfill any spec-only test plan). Readiness is derived from the **artifacts** (`plan.md`/`test-plan.md` present, no `[NEEDS CLARIFICATION]`, no `[pending plan]`), not the cursor; shards carry only metadata the artifact can't express (`size`/`field`/`phase_plan`/`next_step`/`pending_plan_backfill`). `INDEX.md` advances only at the gate.

The `/dev-plan` (→`lead`) and `/test-plan` (→`qa`) slice spawns carry `team-slice: <plan|test-plan>` as the prompt's first line so `dev-state-mark.sh` skips the marker (a sliced producer owns its shard). `/uxui-plan`'s `uxui` isn't in the marker set, so it needs no token.
