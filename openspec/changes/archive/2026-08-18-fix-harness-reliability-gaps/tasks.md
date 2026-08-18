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

- [x] **T001** Bind command-referenced workspace scripts through validation and bootstrap — `.claude/harness/runtime/evidence/**`, validation and focused tests — verify: changing the script invalidates reuse and missing coverage is named [claims:provider-input-coverage] [repo:root] [paths:.claude/harness/runtime/evidence/**,.claude/harness/runtime/workflow/change-validation.mjs,.claude/tests/harness/**]
- [x] **T002** Accept already-reconciled copy projections without weakening overwrite protection — apply runtime and regression — verify: equal target/sandbox passes while divergent target still blocks [claims:copy-land-reconciliation] [repo:root] [paths:.claude/harness/runtime/workflow/apply-runtime.mjs,.claude/tests/harness/**]
- [x] **T003** Recover canonical sandboxes after repository relocation — sandbox/state/CLI runtime and regression — verify: a moved fixture rebinds only its matching canonical sandbox and rejects mismatches [claims:sandbox-relocation] [repo:root] [paths:.claude/harness/runtime/core/**,.claude/harness/runtime/workflow/sandbox-runtime.mjs,.claude/harness/commands.json,.claude/harness/README.md,.claude/tests/harness/**]
- [x] **T004** Synchronize shipped runtime API guidance and retain reviewer provenance regression — instructions and deterministic tests — verify: all pins/instructions report API 23 and configured-reviewer tests pass [claims:runtime-api-consistency,review-session-regression] [repo:root] [paths:.claude/harness/AGENT.md,.claude/harness/DEVELOPER-SETUP.md,.claude/harness/tests/configured-reviewer.test.mjs,.claude/tests/**]
- [x] **T005** Prove compatibility across the installed harness — full shipped suite — verify: `sh .claude/tests/run-all.sh` passes [claims:harness-compatibility] [repo:root] [paths:.claude/**]
- [x] **T006** Keep documented single-repository Build authority valid for packets with more than two tasks — shared execution-authority rule and regression — verify: graph tests accept five local tasks while retaining cross-repository and shared-resource lease boundaries [claims:harness-compatibility] [repo:root] [paths:.claude/harness/runtime/core/graph-execution.mjs,.claude/harness/runtime/workflow/agent-planning.mjs,.claude/harness/runtime/evidence/proof-runtime.mjs,.claude/harness/tests/execution-graph.test.mjs]
- [x] **T007** Classify the shipped host agent-contract CLI module as an intentional standalone runtime entrypoint — composition-root wiring guard — verify: the unreferenced-module check passes without a synthetic JavaScript import [claims:harness-compatibility] [repo:root] [paths:.claude/tests/harness/wiring-check.mjs]
