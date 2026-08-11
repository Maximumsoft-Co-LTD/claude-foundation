# Tasks

> This is the sole implementation ledger. Check an item only when its verify
> condition passes.

- [x] **T001** The shipped contract's human-interaction guidance names the
      structured question tool and its plain-text fallback, and points at
      `fundamentals.md` for conduct — `.claude/harness/AGENT.md` — verify: every
      rule the section already carried survives alongside the new one
      [claims:the-contract-names-the-question-channel,the-contract-still-fits-its-budget]
      [repo:root] [paths:.claude/harness/AGENT.md]

- [x] **T003** That file's word budget rises to 175 with its reason recorded
      beside the existing per-file raises, and no other limit moves —
      `.claude/tests/harness/run-context-budget-tests.sh` — verify: the budget
      suite passes, the standing slash-command budget is still 120, and the
      contract fails the suite if it grows past 175
      [claims:the-contract-still-fits-its-budget] [repo:root]
      [paths:.claude/tests/harness/run-context-budget-tests.sh]

- [x] **T002** The documentation contract suite fails if that instruction
      reverts to prose — `.claude/tests/docs/run-doc-consistency.sh` — verify:
      the suite passes, and fails when the tool name is removed from the
      contract
      [claims:the-contract-names-the-question-channel] [repo:root]
      [paths:.claude/tests/docs/run-doc-consistency.sh]
