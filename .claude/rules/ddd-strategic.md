# Rule: DDD strategic by default

**Trigger:** deciding *where* a model lives or *what language* it speaks — bounded contexts, cross-context concepts, subdomain build-vs-buy, aggregate sizing, context mapping, discovery workshops, diagnosing a broken model. Invoke the `ddd-strategic` skill **before** drawing boundaries or integrating with another context.

**Why:** most "split this service / this codebase is unintelligible" stories are model problems, not code problems — a model serving two contexts at once, or core-domain effort spent on subdomains that should have been bought; hours at design time versus quarters of rewrite.

The 6 principles, pre-flight checklist, references, and skip list live in `.claude/skills/ddd-strategic/SKILL.md` — defer to it.
