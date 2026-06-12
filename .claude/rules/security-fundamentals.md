# Rule: Security fundamentals by default

**Trigger:** any task on a trust boundary — auth/session/token, password/crypto, input handling, SQL/query building, raw HTML/template rendering, file/path handling, exec/shell, deserialisation of untrusted input, secrets, a new external endpoint, or pulling in a dependency. Invoke the `security-fundamentals` skill **before** writing the code, not after.

**Why:** security is the layer that is cheapest to get right at design time and most expensive to get wrong in production — an injection, a missing authorization check, a committed secret, or a known-vulnerable dependency is minutes to prevent and a breach to remediate. This skill is the **design-time** counterpart to the `/dev` security review (`lead` security mode is the after-the-fact checklist on the diff); load it first so the review finds nothing.

The 7 principles, pre-flight checklist, references, and skip list live in `.claude/skills/security-fundamentals/SKILL.md` — defer to it.
