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

- [x] **T001** Preserve unavailable host usage as unknown in metrics and budget decisions while retaining measured numeric zero after a real event — `.claude/harness/runtime/{observability/metrics-runtime.mjs,workflow/budget.mjs}` — verify: `node --test .claude/tests/harness/run-telemetry-truth-tests.mjs` [claims:unobserved-host-usage-remains-unknown,observed-zero-remains-measured] [repo:root] [paths:.claude/harness/runtime/observability/metrics-runtime.mjs,.claude/harness/runtime/workflow/budget.mjs,.claude/tests/harness/run-telemetry-truth-tests.mjs,.claude/tests/harness/contracts/change-policy.sh]
- [x] **T002** Correlate Codex phases and explicitly imported records by thread ID without synthesizing usage — `.claude/harness/runtime/observability/{telemetry-runtime,telemetry}.mjs` — verify: `node --test .claude/tests/harness/run-telemetry-truth-tests.mjs` [claims:codex-identity-correlates-without-inventing-usage] [repo:root] [paths:.claude/harness/runtime/observability/telemetry-runtime.mjs,.claude/harness/runtime/observability/telemetry.mjs,.claude/tests/harness/run-telemetry-truth-tests.mjs]
- [x] **T003** Preserve existing telemetry formats and aggregate behavior, register the focused suite, and run the complete shipped baseline — `.claude/tests/{harness/run-telemetry-truth-tests.mjs,run-all.sh,README.md}` — verify: `sh .claude/tests/harness/run-changeloop-seam-tests.sh && sh .claude/tests/run-all.sh` [claims:existing-telemetry-contracts-remain-compatible] [repo:root] [paths:.claude/tests/harness/run-telemetry-truth-tests.mjs,.claude/tests/run-all.sh,.claude/tests/README.md] [depends:T001,T002]
