# Rule: Database fundamentals by default

**Trigger:** any task that touches a database — schema design, non-trivial query, index, migration, slow-query debugging, persistent data modeling. Invoke the `database-fundamentals` skill **before** writing schema, SQL, or migration code.

**Why:** most production database pain — slow pages, deploy outages, corrupt data — traces back to missing constraints, wrong indexes, long transactions, and unsafe migrations; minutes to catch at design time, hours of downtime in production.

The 7 principles, pre-flight checklist, references, and skip list live in `.claude/skills/database-fundamentals/SKILL.md` — defer to it.
