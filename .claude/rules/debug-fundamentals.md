# Rule: Debug fundamentals by default

**Trigger:** any unknown-cause failure — bug, crash, regression, flaky test, perf cliff, prod surprise. Invoke the `debug-fundamentals` skill **before** changing code, adding try/catch, or "trying things to see what happens" — and run it *first* to find the cause, then the construction skill that owns the fix layer.

**Why:** most lost debugging time is skipped fundamentals — patching symptoms without a repro, guessing past the evidence, changing five things at once, fixing the layer where the bug surfaced instead of where the data turned wrong, shipping without a regression test.

The 7 principles, pre-flight checklist, references, and skip list live in `.claude/skills/debug-fundamentals/SKILL.md` — defer to it.
