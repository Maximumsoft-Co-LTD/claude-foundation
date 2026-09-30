---
description: Create or complete an OpenSpec change and evidence contract.
argument-hint: <intent|existing-change> [--prototype-selection <path>]
---

Create or update **$ARGUMENTS**.

For a low-impact isolated change follow
`.claude/commands/references/rapid-path.md`. Read
`.claude/skills/change/references/workflow.md` completely only for `impact`
medium/high, `riskSignals`, integrations, external operations, several
repositories, a revision or amendment, or a `standard` lane; it owns the full
agreement-detail and document-language rules. Inspect the compiled documents;
obtain explicit spec approval before Build. Start from
`change start --template`; save draft v4 under `.foundation/drafts/`. Use
semantic requirement/task keys; never invent claim IDs or create
OpenSpec artifacts by hand. Declare `workType`; design warnings advise.

Run `change start <draft.json>`; it inspects and starts in one call when clean;
else follow its typed action and resume route. The compiler owns
classification, stable links, validation, and rollback; Build `advance` owns
setup. Edit an existing change, never abandon it: before Build use `change
revise`; after, one semantic amendment. Repair named draft fields in one batch;
retry. Ask the user only for behavior, compatibility, security, migration,
rollout, prototype, or authority decisions. Record approval with `advance <id>
--approve-spec --decision-ref <ref>`. Do not implement product code during
Change.

Keep protocol fields internal. Return the outcome, material decisions, compiled
agreement, and `advance` action in the user's language.
