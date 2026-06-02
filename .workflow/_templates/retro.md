# Retro: <title>

**Plan**: [./plan.md](./plan.md)
**Type**: feat | fix | refactor | chore | docs | spike
**Completed**: YYYY-MM-DD
**Total cycles**: review=N, test=N
**Ship**: commit=<sha> | PR=<url> | skipped (reason)

## What worked
Specific + repeatable. "LSP-first nav saved a grep round on the auth middleware" beats "good process".
- ...

## What to change next time
Each item paired with WHY. Vague entries get cut.
- ...

## Acceptance criteria status
Final state of every checkbox in `spec.md > Acceptance criteria`.

- [x] Criterion 1 — shipped
- [ ] Criterion 2 — deferred → see Follow-ups

## Memory candidates (facts)
A single rule / preference / reference / user trait. Surface to the user for confirmation; never auto-save. Write "none this run" if empty. (Routing rules + save-worthy filters live in the retro agent.)

- **type**: feedback | project | reference | user · **body**: <fact> · **why**: <reason> · **how to apply**: <when it kicks in>  (why + how required for feedback/project)

## Skill candidates (procedures)
A multi-step procedure — ≥3 steps OR conditional logic, AND a clear trigger, AND plausibly ≥3 future runs. Surface to the user for confirmation; never auto-create. Write "none this run" if empty.

- **name**: <kebab> · **scope**: personal | project · **trigger description**: <phrase / task type> · **action**: new | update `<name>` | promote memory `<slug>` · **steps**: 1… 2… 3… · **why a skill not a memory**: … · **handoff prompt for skill-creator**: <copy-paste-ready brief>  (leave status blank — orchestrator fills it after the approval round)

<!--
The sections above are always required. Add the sections below ONLY when this run produced them, then DELETE the rest:
- Deviations from plan — when actual ≠ plan (Step X became Y — reason)
- Follow-ups — append each verbatim to FOLLOWUPS.md > Open, then mirror here:
    - **item**: <one line> · **type hint**: feat|fix|refactor|chore|docs|spike · **priority**: low|med|high
    - **consumed**: <followup-id> — landed in this run via step <n>
- Security findings (carry-over) — when security.md exists (its non-blocking medium/low findings, so they don't get lost)
-->
