# Tasks

> This is the sole implementation ledger. Check an item only when its verify
> condition passes. Group by coherent behavior, not workflow phase. Add
> `[claims:<claim-id>]` after each stable task ID once evidence claims exist.
>
> Annotations the planner reads, all optional for a single-repository change:
> `[repo:<id>]` (default `root`), `[kind:<kind>]` (default `implementation`),
> `[paths:<glob,glob>]` — declare these to let two tasks in one repository run
> in parallel — `[depends:<T00n,T00n>]`, and `[resources:<token>]` for a
> genuinely shared resource such as a database. A multi-repository change must
> annotate `[repo:]` and `[paths:]` on every task.

- [x] **T001** Reject non-ADDED requirement sections for a capability with no canonical spec — `.claude/harness/runtime/workflow/change-validation.mjs` — verify: `sh .claude/tests/harness/run-harness-tests.sh` [claims:a-new-capability-declares-a-non-additive-operation,a-new-capability-declares-only-additions] [repo:root] [paths:.claude/harness/runtime/workflow/change-validation.mjs]
- [x] **T002** Prove invalid MODIFIED/REMOVED deltas fail early and an ADDED delta remains valid — `.claude/tests/harness/run-harness-tests.sh` — verify: `sh .claude/tests/harness/run-harness-tests.sh` [claims:a-new-capability-declares-a-non-additive-operation,a-new-capability-declares-only-additions] [repo:root] [paths:.claude/tests/harness/run-harness-tests.sh]
