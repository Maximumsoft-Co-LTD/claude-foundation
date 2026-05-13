# Retro: <title>

**Plan**: [./plan.md](./plan.md)
**Type**: feat | fix | refactor | chore | docs | spike
**Completed**: YYYY-MM-DD
**Total cycles**: review=N, test=N
**Ship**: commit=<sha> | PR=<url> | skipped (reason)

## What worked
- ...

## What to change next time
- ...

## Deviations from plan
- Step X became Y — reason: ...

## Acceptance criteria status
Final state of every checkbox in `spec.md > Acceptance criteria`.

- [x] Criterion 1 — shipped
- [ ] Criterion 2 — deferred → see Follow-ups

## Memory candidates (facts)
Surface to the user for confirmation; do not auto-save.

Use this bucket for *facts* — single rules, preferences, references, user traits. If the item has multi-step instructions or a clear task-type trigger, put it under **Skill candidates** instead.

- **type**: feedback | project | reference | user
  **body**: <rule or fact>
  **why**: <reason>
  **how to apply**: <when this kicks in>

## Skill candidates (procedures)
Surface to the user for confirmation; do not auto-create.

Use this bucket when the learning is a *procedure* — a multi-step checklist or workflow that should fire whenever a specific task type appears. A skill earns its keep when:

- It has ≥3 steps **or** non-trivial conditional logic, **and**
- It has a clear trigger (task phrase, file pattern, or task type), **and**
- It will plausibly apply to ≥3 future `/dev` runs.

If a candidate fails those checks, it is a [[memory]] entry, not a skill. Also propose **promoting an existing memory to a skill** here when this run is the 3rd+ time the same memory got cited.

Format each candidate so the orchestrator can hand it straight to `skill-creator`:

- **name**: <kebab-case-skill-name>
  **scope**: personal (`~/.claude/skills/`) | project (`.claude/skills/`)
  **trigger description**: <one-liner — what user phrasing or task type should load this>
  **action**: new skill | update existing skill `<name>` | promote memory `<slug>`
  **steps**:
  1. ...
  2. ...
  3. ...
  **why a skill, not a memory**: <what makes this a procedure rather than a fact>
  **handoff prompt for skill-creator**: <copy-paste-ready prompt: "Create a skill named X that does Y when Z. Steps: ...">

## Follow-ups
Each entry here is appended verbatim to `.workflow/FOLLOWUPS.md` so a future `/dev` run can pick it up. Mark items consumed from the previous FOLLOWUPS list with `consumed: <id>` so retro can close them out.

- **item**: <one-line description>
  **type hint**: feat | fix | refactor | chore | docs | spike
  **priority**: low | med | high
- **consumed**: <followup-id or one-line excerpt> — landed in this run via step <n>

## Security findings (carry-over)
If `security.md` exists, list non-blocking medium/low findings here so they don't get lost.

- ...
