# Tasks

> This is the sole implementation ledger.

- [x] **T001** Align brainstorming, grill-task-gu, and change instructions around one private prerequisite-aware decision frontier, one finalized sheet, and a no-reask handoff [claims:prerequisite-aware-frontier,source-owned-facts,single-finalized-sheet,agreement-reuse] [repo:root] [kind:contract] [paths:.claude/skills/brainstorming/SKILL.md,.claude/skills/grill-task-gu/SKILL.md,.claude/skills/change/references/workflow.md] — verify: `sh .claude/tests/harness/run-context-budget-tests.sh`
- [x] **T002** Prove frontier ordering, source-owned facts, finalized-sheet boundaries, and agreement reuse through deterministic contract and interview replay fixtures [claims:prerequisite-aware-frontier,source-owned-facts,single-finalized-sheet,agreement-reuse] [depends:T001] [repo:root] [kind:tests] [paths:.claude/tests/interview/run-interview-tests.sh,.claude/tests/interview/fixtures/decision-frontier-bank.json,.claude/tests/harness/run-context-budget-tests.sh,.claude/tests/harness/run-changeloop-seam-tap.sh] — verify: `sh .claude/tests/harness/run-changeloop-seam-tap.sh --json`
