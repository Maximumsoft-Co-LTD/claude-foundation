# Tasks

> This is the sole implementation ledger. Check an item only when its verify
> condition passes.

- [x] **T001** The contract carries the same rules in fewer words —
      `.claude/harness/AGENT.md` — verify: 150 words, and every rule listed in
      the proposal is still present
      [claims:the-contract-fits-its-original-budget-with-every-rule] [repo:root]
      [paths:.claude/harness/AGENT.md]

- [x] **T002** The budget returns to 150 with its raise rationale removed, and
      the fallback assertion tracks the reworded sentence —
      `.claude/tests/harness/run-context-budget-tests.sh`,
      `.claude/tests/docs/run-doc-consistency.sh` — verify: both suites pass,
      and the contract fails the budget suite if it grows past 150
      [claims:the-contract-fits-its-original-budget-with-every-rule] [repo:root]
      [paths:.claude/tests/harness/run-context-budget-tests.sh,.claude/tests/docs/run-doc-consistency.sh]
