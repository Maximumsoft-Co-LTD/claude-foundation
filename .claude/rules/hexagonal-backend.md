# Rule: Hexagonal backend by default

**Trigger:** any backend task with real domain logic — services, APIs, repositories, use cases, persistence, message handling. Invoke the `hexagonal-backend` skill **before** designing or writing code; define ports before controllers or DB code.

**Why:** standing preference — ports-and-adapters keeps requirement changes cheap, because swapping a DB, framework, or transport touches only adapters, never core logic.

The layering rules, port/adapter patterns, folder structures, and skip list live in `.claude/skills/hexagonal-backend/SKILL.md` — defer to it.
