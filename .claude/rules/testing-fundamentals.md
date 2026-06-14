# Rule: Testing fundamentals by default

**Trigger:** any task that writes tests, decides what to test, designs or restructures a test suite, chooses a test level (unit/integration/e2e), or reviews coverage. Invoke the `testing-fundamentals` skill **before** writing the first test.

**Why:** most test pain is missed fundamentals — tests that assert implementation instead of behaviour (so every refactor goes red), an inverted pyramid of slow brittle e2e, mocking the very thing under test, and coverage theatre that proves nothing. This skill owns test **strategy and design**; `debug-fundamentals` owns reproduction and `refactoring-fundamentals` owns characterization baselines. In `/dev` it is design-time knowledge for `engineer`/`qa`; the `qa` agent applies it twice — designing the test strategy into `test-plan.md` at phase 2½ (before code, signed off at the gate) and executing it, recording results in `tests.md`, at phase 7.

The 7 principles, pre-flight checklist, references, and skip list live in `.claude/skills/testing-fundamentals/SKILL.md` — defer to it.
