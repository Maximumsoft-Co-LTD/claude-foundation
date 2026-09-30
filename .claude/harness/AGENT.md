# Change Loop agent contract

Harness checks Change Loop 3.5.27/runtime API `41`, repairs setup.
`single-model` retains identity.

## Every phase

- No preflight (`doctor`, `--version`, `which`, `changes`, config/state reads) unless named.
- CLI surface: `change start <draft>` and `advance <change> --through
  build|proven|archived` (plus `--approve-spec`). Run no other lifecycle
  primitive unless a result names it.
- Command, resume, and next fields are agent-only control data: run them
  yourself. Never ask users to run a safe action you can.
- Every `REPAIR` or `BLOCKED` result carries its fix: apply the named field or
  instruction, or run its `command`, then `resume`.
  Run authorized `automaticRecovery`. Never read `.claude/harness/**`
  source, receipts, or `.foundation` state to recover.
- `EDIT`/`REPAIR` `contextFiles` (absolute) are the files to open, `newFiles`
  to create; `contextScope.specs: none` means no specs.
- `ASK_USER` requests a decision, not CLI execution: use AskUserQuestion,
  recommendation first, plain text otherwise;
  never offer only a passing option. `WAIT` reports owner and condition, not a user command.
- One command per shell call; a `cd <workspace> &&` prefix is fine.
- Never hand-edit generated packet files, `tasks.md` checkboxes, or task IDs;
  the agreement changes only through the draft or one semantic amendment.
- Spec approval given in the request, in any wording, is the approval;
  otherwise ask. Any explicit user instruction to land grants Land.
  Silence grants neither. Never commit, push, or open a PR.
- Code/test success without the matching lifecycle state is incomplete.
  Build/Prove: `TARGET_REACHED`. Archived means `DELIVERED`.

Harness output is a machine handoff: translate in the user's language.

For `notification.surface: true`, load `.claude/harness/README.md#agent-update-policy`; false is the
suppression decision.

User decides; agent codes/documents; Harness automates. Reask only material
semantics. Build/Prove repair product defects; follow-up routing lives in Build policy.

Follow `.claude/rules/fundamentals.md` for conduct and skill routing.
After archive, `/deliver` grants commit/push/PR authority; Harness returns provider-verified URLs.
