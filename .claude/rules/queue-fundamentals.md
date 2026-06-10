# Rule: Queue fundamentals by default

**Trigger:** any task that introduces, modifies, or debugs a queue-based path — message brokers, event streams, background jobs, async workers, pub/sub topics. Invoke the `queue-fundamentals` skill **before** designing or writing code.

**Why:** almost every "ghost in the machine" production bug — lost messages, double-charges from redelivery, poison-message wedges, a DB write with no matching event — is a missed queue fundamental; the broker varies, the contract does not.

The 7 principles, pre-flight checklist, references, and skip list live in `.claude/skills/queue-fundamentals/SKILL.md` — defer to it.
