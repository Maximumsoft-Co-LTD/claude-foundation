# Orchestrator reference — Resolve the run

> Loaded by the team-mode commands that act on an EXISTING run (`/dev-plan`, `/test-plan`, `/uxui-plan`, `/implement`) to turn `$ARGUMENTS` into a run id. `/spec` creates or refines runs and resolves differently — it does not use this. Each command keeps its own "missing prerequisite" routing inline (its delta).

- **`$ARGUMENTS` names a run** — a `NNNN-…` id or a path under `.workflow/` → use it.
- **`$ARGUMENTS` empty** → the most-recently-updated run under `.workflow/` (by `state.json > last_updated`, excluding `_templates`). **More than one plausibly active → `AskUserQuestion`** — don't guess.
- **No run exists** → nothing to act on; route per the command's delta (usually `/spec <intent>` first). Never fabricate a run folder.
