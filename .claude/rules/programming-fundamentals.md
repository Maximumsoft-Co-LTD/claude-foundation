# Rule: Programming fundamentals by default

**Trigger:** any code task with real logic — function, module, data model, non-trivial bug, refactor, review. Invoke the `programming-fundamentals` skill **before** writing or substantially changing code.

**Why:** most defects and painful rewrites trace back to missed fundamentals — sloppy data shapes, illegal states left representable, oversized functions, impure cores, swallowed errors, quadratic loops, bad names — that cost seconds to catch at write time and days in production.

The 7 principles, pre-flight checklist, references, and skip list live in `.claude/skills/programming-fundamentals/SKILL.md` — defer to it.
