# Tasks

> This is the sole implementation ledger. Check an item only when its verify
> condition passes. Group by coherent behavior, not workflow phase. Add
> `[claims:<claim-id>]` after each stable task ID once evidence claims exist.

- [x] **T001** Render undeclared changed paths as a paste-ready `[paths:...]` fix-it in the readiness recovery channel — `.claude/harness/runtime/evidence/proof-readiness.mjs` — verify: unit suite sees the annotation for a synthetic multi-repo state and silence when surfaces are declared [repo:root] [paths:.claude/harness/runtime/evidence/proof-readiness.mjs] [claims:fixit-annotation,fixit-silent-when-declared]
- [x] **T002** Unit regression suite for the fix-it formatting, TAP via node:test — `.claude/tests/harness/run-proof-fixit-tests.mjs` plus a `run` line and README row — verify: `node --test` passes; suite listed in run-all.sh and README [repo:root] [paths:.claude/tests/harness/run-proof-fixit-tests.mjs,.claude/tests/run-all.sh,.claude/tests/README.md] [claims:fixit-annotation,fixit-silent-when-declared] [depends:T001]
- [x] **T003** `/build` declares new test files in the ledger at creation time — `.claude/commands/build.md` — verify: sentence present; docs/context-budget suites pass [repo:root] [paths:.claude/commands/build.md] [claims:build-declares-tests]
