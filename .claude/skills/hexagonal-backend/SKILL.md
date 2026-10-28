---
name: hexagonal-backend
description: "Use when one backend service needs domain logic isolated from framework and storage through ports and adapters. Skip trivial CRUD and cross-service design (architecture-fundamentals)."
---

# Hexagonal backend

Dependencies point inward; a port is as small as the use case that needs it.

```text
driving adapter → use case → domain
                      ↓
                driven port → driven adapter
```

## Steps

1. Keep the domain free of framework, transport, ORM, and vendor imports; it
   holds business state, rules, and domain errors.
2. Let the application layer own one use case: its transaction boundary,
   authorization decision, and driven ports.
3. Define each port at the consumer boundary; never leak ORM, HTTP, broker, or
   vendor types through it. Map persistence and transport models explicitly
   when their lifecycle differs from the domain.
4. Put cross-cutting concerns at the right edge: authentication in the adapter,
   authorization/policy in application or domain, observability around use-case
   and adapter calls.
5. Test domain rules directly, application behavior with fake driven ports, and
   adapters with focused integration tests that exercise real serialization.
6. Use a simpler vertical slice for truly trivial CRUD; add ports only where
   policy, replacement risk, or test isolation justifies them. Avoid
   pass-through abstractions.

## Harness

Record only consequential dependency or transaction-boundary decisions in the
active OpenSpec design; seam tests run through the harness are the evidence.
No parallel architecture document; Build never stages or commits.

## References

- `references/typescript.md` — folder layout, ports, adapters, unit of work in TypeScript
- `references/go.md` — the same structure in Go
- `references/patterns-and-pitfalls.md` — transactions, error translation, query ports, common mistakes
