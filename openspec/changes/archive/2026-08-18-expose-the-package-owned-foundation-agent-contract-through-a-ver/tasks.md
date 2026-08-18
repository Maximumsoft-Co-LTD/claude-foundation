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

- [x] **T001** Implement and publish the protocol-1 package-owned agent-contract endpoint, schema, protocol pin, CLI metadata, and workflow documentation. — `.claude/harness/runtime/core/host-agent-contract.mjs`, `.claude/harness/runtime/contracts/host-agent-contract.schema.json`, `cli.sh`, `.claude/harness/commands.json`, `.claude/harness/protocol.json`, `WORKFLOW.md` — verify: endpoint returns the exact shipped contract outside a project [repo:root] [paths:.claude/harness/runtime/core/host-agent-contract.mjs,.claude/harness/runtime/contracts/host-agent-contract.schema.json,cli.sh,.claude/harness/commands.json,.claude/harness/protocol.json,WORKFLOW.md] [claims:host-agent-contract-response]
- [x] **T002** Add deterministic endpoint, failure, packaged-layout, help, and existing-instruction compatibility coverage. — `.claude/tests/harness/run-host-instruction-tests.mjs`, `.claude/tests/harness/run-installer-tests.sh`, `.claude/tests/README.md` — verify: host contract and installer suites pass [repo:root] [paths:.claude/tests/harness/run-host-instruction-tests.mjs,.claude/tests/harness/run-installer-tests.sh,.claude/tests/README.md] [claims:host-agent-contract-response,host-agent-contract-compatibility] [depends:T001]
