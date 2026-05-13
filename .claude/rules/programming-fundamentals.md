# Rule: Programming fundamentals by default

For every code task with real logic — writing a function, designing a module, modeling data, fixing a non-trivial bug, refactoring, or reviewing code — invoke the `programming-fundamentals` skill **before** writing or substantially changing code.

This rule is the always-on pointer. The 7 principles, pre-flight checklist, and deep-dive guides on naming, error handling, complexity, and testing live in the skill:

- `.claude/skills/programming-fundamentals/SKILL.md`

**Why:** Most defects, hard-to-debug systems, and painful rewrites trace back to the same missed fundamentals — sloppy data shapes, illegal states left representable, functions doing too much, side effects mixed with logic, swallowed errors, accidentally quadratic loops, and bad names. Catching these at *write* time costs seconds; catching them in production costs days.

**How to apply:** At the start of any meaningful code task, load the `programming-fundamentals` skill and run the 7-principle pre-flight (data shape → illegal states → one-thing functions → pure core → error handling → complexity → read first). Apply the relevant reference file when the work is concentrated in one area (e.g., heavy renaming → `references/naming.md`). The skill lists when to skip (one-line shell, throwaway scripts, pure config edits) — defer to it rather than re-deciding here.

**Relation to other skills:** Programming fundamentals are the layer *below* architecture and refactoring. They compose with [[hexagonal-backend]] (architectural layering) and [[simplify]] (post-hoc review) rather than competing with them. If both apply, run this first — get the fundamentals right, then layer architecture on top.

**Status:** Active. Applies to all code work in this project and any project that adopts this foundation.
