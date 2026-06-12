# Rule: Refactoring fundamentals by default

**Trigger:** any task that restructures existing code without changing what it does — refactor, "clean this up", restructure, extract, rename, untangle, de-duplicate, "simplify", pay down debt. Invoke the `refactoring-fundamentals` skill **before** the first move — and run it *first* for a refactor (decide the safe path + capture the behaviour baseline), then the construction skill that owns the target layer.

**Why:** refactoring is the most common way working code gets broken — a restructure with no test net, a diff that mixes cleanup with a behaviour change, or a "small tidy" that becomes a half-done rewrite on a red branch. A few seconds of stance (behaviour contract, one hat, green-or-characterize-first, small reversible steps) is what keeps the transformation safe, reviewable, and always shippable.

The 7 principles, pre-flight checklist, references (code smells, the refactoring catalog, characterization tests, large-scale), and skip list live in `.claude/skills/refactoring-fundamentals/SKILL.md` — defer to it. This skill owns the safe *process*; `programming-fundamentals` owns the *target shape* the code is moving toward. In the `/dev` refactor path, its characterization-test technique is the baseline-capture contract (`engineer` captures it as step 1 when coverage is thin; `qa` verifies it).
