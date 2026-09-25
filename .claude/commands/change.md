---
description: Create or complete an OpenSpec change and evidence contract.
argument-hint: <intent|existing-change> [--prototype-selection <path>]
---

Create or update **$ARGUMENTS**.

Read `.claude/skills/change/references/workflow.md` completely.
Apply its agreement-detail and document-language rules to the authored packet,
then inspect the compiled documents; obtain explicit spec approval before Build.
Follow its semantic-intake reference. Write a semantic
draft v4 under `.foundation/drafts/`. Use
semantic requirement/task keys; never invent claim IDs or create
OpenSpec artifacts by hand. Declare `workType`; resolve design warnings. Add
`decisions`, `diagrams`, `prototypeSelection`, `integrations`, repositories, or
external operations when needed.

Run `change start <draft.json> --inspect`; follow its typed action and resume
route. On `DONE`, rerun with `--consume-draft`. The compiler owns classification,
stable links, validation, and rollback; Build `advance` owns setup.
Draft v3 remains readable. Edit an existing change, never
abandon it: before Build use `change revise <change> <draft.json>`; after, use
one `change amend` with its v4 discovery delta. Re-approve only the
reported delta. On compiler errors, repair the named draft
fields as one batch and retry. Ask the user only for behavior,
compatibility, security, migration, rollout, prototype, or authority decision.
Do not implement product code during Change.

Keep protocol fields internal. Return the outcome, material decisions, compiled
agreement, and `advance` action in the user's language.
