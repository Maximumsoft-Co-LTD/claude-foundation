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
OpenSpec artifacts by hand. Include typed `decisions`, `diagrams`,
`prototypeSelection`, `integrations`, repositories, or external operations only
when the change needs them.

Run `change start <draft.json> --inspect`; follow its typed action and resume
route. On `DONE`, rerun with `--consume-draft`. The compiler owns classification,
stable links, validation, and rollback; Build `advance` owns setup.
Draft v3 remains readable for compatibility. If an active semantic change gains
a requirement,
use one `change amend <change> <amendment.json> --consume-amendment`, including
its discovery delta for v4; do not
rewrite its ledgers independently. On compiler errors, repair the named draft
fields as one batch and retry. Ask the user only for behavior,
compatibility, security, migration, rollout, prototype, or authority decision.
Do not implement product code during Change.

Keep protocol fields internal. Return the outcome, material decisions, compiled
agreement, and `advance` action in the user's language.
