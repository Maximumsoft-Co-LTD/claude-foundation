# Rule: API design fundamentals by default

**Trigger:** any task that designs or changes the surface of an API a client codes against — a new HTTP/REST, GraphQL, or RPC endpoint, a resource/URL model, a request or response body, status codes, an error shape, pagination/filtering, idempotency/method semantics, auth/rate-limiting at the boundary, or a version bump. Invoke the `api-design-fundamentals` skill **before** publishing the surface (routes, request/response shapes, error envelope), not after a client has coded against it.

**Why:** an API is a contract you publish to consumers you can't redeploy in lockstep, and every "the retry double-charged / a 200 carried an error / the rename broke every client / unbounded list timed out / `GET /orders/{id}` returned someone else's order" story is a missed surface-design fundamental — minutes to get right while sketching the surface, quarters of consumer-coordination to fix once shipped. This skill owns the **design of one API's surface**; `architecture-fundamentals` owns the runtime relationship between components and `security-fundamentals` owns the trust-boundary implementation.

The 8 principles, pre-flight checklist, references, and skip list live in `.claude/skills/api-design-fundamentals/SKILL.md` — defer to it.
