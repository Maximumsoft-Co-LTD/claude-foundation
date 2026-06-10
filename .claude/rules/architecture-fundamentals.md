# Rule: Architecture fundamentals by default

**Trigger:** any system-level decision — new system, splitting/merging services, a new cross-component call, API/event schema design, failure modes, scaling, how components or teams relate at runtime. Invoke the `architecture-fundamentals` skill **before** drawing the first box or writing the first cross-boundary call.

**Why:** most "we need to rewrite this system" stories are missed architecture fundamentals — boundaries drawn around technologies, unowned data, calls with no timeout or breaker, silently broken consistency assumptions; minutes at design time versus engineering quarters in production.

The 7 principles, pre-flight checklist, references, and skip list live in `.claude/skills/architecture-fundamentals/SKILL.md` — defer to it.
