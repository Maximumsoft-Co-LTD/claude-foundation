# Rule: Concurrency fundamentals by default

**Trigger:** any in-process code where things run at once — threads, async/await, shared mutable state, locks, parallel tasks, event loops, racing callbacks. Invoke the `concurrency-fundamentals` skill **before** writing the code.

**Why:** concurrency bugs — lost updates, deadlocks, data races, swallowed errors from un-awaited promises — are the hardest to reproduce and the easiest to design out. A few seconds of stance (don't share mutable state; make the critical section atomic; bound the fan-out) prevents the heisenbug that only shows under load. This skill owns **in-process** concurrency; `queue-fundamentals` owns cross-process/broker async and `database-fundamentals` owns transaction isolation — it sits between `programming-fundamentals` and `queue-fundamentals` in the chain.

The 7 principles, pre-flight checklist, references, and skip list live in `.claude/skills/concurrency-fundamentals/SKILL.md` — defer to it.
