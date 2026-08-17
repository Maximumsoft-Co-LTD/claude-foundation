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

- [x] **T001** Stage and replay every moved writable repository before replacing any live multi-repository sandbox; keep all live sandboxes unchanged on conflict and report repository-qualified conflicts — `.claude/harness/runtime/workflow/sandbox-runtime.mjs` — verify: `sh .claude/tests/harness/run-target-drift-tests.sh` [claims:multi-repository-replay] [kind:implementation] [repo:root] [paths:.claude/harness/runtime/workflow/sandbox-runtime.mjs,.claude/tests/harness/run-target-drift-tests.sh]
- [x] **T002** Remove repository `baseHead` from composite content identity while retaining explicit target-head Land guards; bump evidence protocol pins — `.claude/harness/runtime/workflow/repository-snapshot.mjs`, `.claude/harness/foundation.mjs`, `.claude/harness/protocol.json` — verify: focused multi-repository evidence-binding regression [claims:content-stable-evidence] [kind:implementation] [repo:root] [paths:.claude/harness/runtime/workflow/repository-snapshot.mjs,.claude/harness/foundation.mjs,.claude/harness/protocol.json,.claude/tests/harness/contracts/multi-repository.sh]
- [x] **T003** Update shipped operator documentation and changelog for the recovery and evidence-identity contracts — `.claude/harness/README.md`, `WORKFLOW.md`, `CHANGELOG.md` — verify: documentation consistency suite [claims:multi-repository-replay,content-stable-evidence] [kind:docs] [repo:root] [depends:T001,T002] [paths:.claude/harness/README.md,WORKFLOW.md,CHANGELOG.md]
- [x] **T004** Run the complete deterministic suite and confirm protocol upgrade compatibility — `.claude/tests/run-all.sh` — verify: `sh .claude/tests/run-all.sh` [claims:multi-repository-replay,content-stable-evidence] [kind:test] [repo:root] [depends:T001,T002,T003] [paths:.claude/tests/**]
