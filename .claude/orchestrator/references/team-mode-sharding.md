# Orchestrator reference — Team-mode Phase-1 sharding

> Loaded on demand by the main agent (`.claude/orchestrator.md`). The single-writer rule + hook enforcement stay inline in `## State discipline`; this holds the **parallel team-mode Phase-1 slices** case. Read it **only** when a run is built via the team-mode commands (`/dev-plan` / `/test-plan` / `/uxui-plan`) — a one-shot `/dev` run never produces shards.

The single-writer rule governs the **canonical `state.json` cursor** (the sequential Phase-2 resume position). Team-mode Phase-1 commands (`/dev-plan`, `/test-plan`, `/uxui-plan`) can run **in parallel on one run** (each needs only `spec.md`), so they must NOT contend that cursor (two slices re-emitting the full object = lost update). Each writes its **own shard** and leaves `state.json`/`INDEX.md` untouched:

- `/dev-plan` → `state.plan.json` — `{"status":"done","step":"plan","next_step":<"test-plan"|"gate">,"size":…,"field":…,"phase_plan":{…},"last_agent":"lead","last_updated":…}` (set `"epic": true` instead of the cursor fields if scope split).
- `/test-plan` → `state.test-plan.json` — `{"status":"done","last_agent":"qa","last_updated":…}`.
- `/uxui-plan` → `state.uxui.json` — `{"status":"done","last_agent":"uxui","last_updated":…,"notes":…}`.

`state.json` is written single-writer at exactly two **sequential** points: **run creation** (identity + `step=spec`) and the **gate** (step 9 / `/implement`), where you **fold the shards in**. Readiness is derived from the **artifacts** (`plan.md`/`test-plan.md` present, no `[NEEDS CLARIFICATION]`), not the cursor; shards carry only metadata the artifact can't express (`size`/`field`/`phase_plan`/`next_step`). `INDEX.md` advances only at the gate.

The `/dev-plan` (→`lead`) and `/test-plan` (→`qa`) slice spawns carry `team-slice: <plan|test-plan>` as the prompt's first line so `dev-state-mark.sh` skips the marker (a sliced producer owns its shard). `/uxui-plan`'s `uxui` isn't in the marker set, so it needs no token.
