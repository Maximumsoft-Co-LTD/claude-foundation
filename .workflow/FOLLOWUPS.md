# Follow-ups

Items surfaced by past `retro` runs, out of their original scope. `retro` appends + marks consumed; `pm` reads every interview and asks if any open item is now in scope.

## Open

<!-- ID `F-<run-id>-NN`: run folder + per-run counter from 01. -->

| ID | From run | Item | Type hint | Priority | Status |
|----|----------|------|-----------|----------|--------|
| F-0004-feat-solar-system-auth-01 | 0004-feat-solar-system-auth | Change the default placeholder passcode (`"solaris42"`, `solar-system/index.html:245`) before any real use of the gate. | feat | med | open |
| F-0004-feat-solar-system-auth-02 | 0004-feat-solar-system-auth | Full-suite command (`npx playwright test`, documented in `tests.md > Commands`) is flaky under default parallel workers ("page setup timeout", `channel:chrome` contention vs. the single `python3 -m http.server` webServer); passes 15/15 serially (`--workers=1`). Pin `workers: 1` in the git-ignored `solar-system/playwright.config.js`, or document `--workers=1` alongside the command. | chore | low | open |
| F-0004-feat-solar-system-auth-03 | 0004-feat-solar-system-auth | Non-blocking review notes worth revisiting if the app grows: (a) logout re-locks via full `location.reload()` rather than WebGL teardown — deliberate for a showcase today, revisit only if the app needs to preserve in-memory state across logout; (b) SC-002's "<100ms paint" timing half is structurally guaranteed but not independently measured — add a timed assertion only if the gate grows heavier DOM/CSS. | chore | low | open |


## Closed

Audit trail — keep. `retro` moves rows here on `consumed-by:` or `wont-do`.

| ID | From run | Item | Consumed by | Date consumed |
|----|----------|------|-------------|---------------|

## Conventions

- **ID** — `F-<run-id>-NN` (`<run-id>` = surfacing run's folder, `NN` per-run from `01`); collision-proof under parallel runs. `retro` mints; never "next after highest" (races). Legacy `F0001`-style IDs keep their form; history not renumbered.
- **From run** — `NNNN-type-slug` of the surfacing run.
- **Type hint** — which `/dev` run kind would consume it. Non-binding; `pm` can override.
- **Priority** — `low | med | high`. `high` = known-broken or security carry-over from `security.md`.
- **Status** — `open | in-progress | consumed-by:<run-id> | wont-do (reason)`. Move `Open`→`Closed` on `consumed-by:…` or `wont-do`.
