# Tasks

- [x] **T001** Add a pure cycle-path finder and use it in the task planner's stuck-graph failure so the error names an actual cycle path [claims:task-cycle-path-reported] — verify: `node --test .claude/tests/harness/run-dag-cycle-tests.mjs`
- [x] **T002** In the provider scheduler's stuck-graph throw, distinguish a dependency cycle (report its path) from a node blocked by a failed dependency (report the failed provider), keeping the throw-not-exit contract [claims:provider-cycle-path-reported,provider-failed-dependency-distinguished] [depends:T001] — verify: `node --test .claude/tests/harness/run-dag-cycle-tests.mjs`
- [x] **T003** Add the deterministic suite `.claude/tests/harness/run-dag-cycle-tests.mjs` covering both schedulers' cycle, failed-dependency, and unchanged acyclic behavior, with a `run` line in `run-all.sh` and a README row [claims:acyclic-scheduling-unchanged] [depends:T002] — verify: `sh .claude/tests/run-all.sh`
