# Body contracts, errors, and the trust edge

Schema-first workflow, wire-vs-domain mapping, the error envelope, and the
authn/authz/rate-limit checks every endpoint must answer before it ships.

## Schema as the single source of truth

Write the contract in a machine-readable schema and generate the rest from it;
hand-maintained docs and types drift.

| Protocol | Schema | Generates |
|---|---|---|
| REST | OpenAPI | docs, client SDKs, server stubs, request validators |
| GraphQL | SDL | resolver types, typed client queries, introspection docs |
| gRPC | `.proto` | message and service code, strict on the wire |

A change to the surface is a change to the schema first, then the code; that is
also what makes the CI compatibility check in [evolution](evolution.md) possible.

## Validate at the boundary

Validation is one job done once, at the edge, before domain logic runs. Its
output is a trusted typed value the rest of the code never re-checks.

- Required fields, types, enum range, string length, numeric bounds.
- Reject with `400` (malformed) or `422` (well-formed but breaks a rule) and a
  field-level error body.
- Validate against the schema (`zod`, `pydantic`, JSON Schema), not by hand.
- Safe canonicalization and allow-lists live in
  [security-fundamentals](../../security-fundamentals/references/input-and-output.md);
  this rule says do it here.

## Wire model ≠ domain model

Never serialize an ORM row to the client. Map through a DTO so an internal
rename cannot leak and no field ships by accident.

```ts
type OrderResponse = { id: string; status: 'pending' | 'paid' | 'refunded'; total_cents: number }
const toOrderResponse = (o: Order): OrderResponse =>
  ({ id: o.id, status: mapStatus(o.internal_status), total_cents: o.totalCents })
```

Tolerant reader, strict writer: ignore unknown input fields; never emit an
output field you are not committed to keeping.

## The three states of "no value"

| State | JSON | Meaning |
|---|---|---|
| absent | key omitted | "leave alone" (PATCH) / "no opinion" |
| null | `"x": null` | explicitly cleared |
| empty | `""` or `[]` | present but contains nothing |

Decide per field and state it in the schema; for `PATCH` the absent-vs-null
distinction is the whole semantics.

## One error envelope everywhere

Use one shape for every endpoint, including framework-default 404/500s. RFC
9457 Problem Details: `type` (stable machine key), `title`, `status`,
`detail` (free text), `instance` (correlation id), plus extensions such as
`errors: [{field, code}]` and `trace_id`.

- `code`/`type` is the contract clients branch on: adding one is safe;
  repurposing or removing one is breaking ([evolution](evolution.md)).
- `message`/`detail` is free text; clients must never compare it.
- Never leak internals: no stack traces, SQL, hostnames, or enumeration
  oracles. Log the detail server-side with a correlation id and return that id.
- List each endpoint's error set in the schema; undocumented errors are
  discovered in production.

## Authenticate, authorize, rate-limit at the edge

The endpoint is the trust boundary; token mechanics and the threat model are in
[security-fundamentals](../../security-fundamentals/references/authn-authz.md).

- Standard scheme (`Authorization: Bearer`, API keys for services); `401`
  when the credential is missing or expired.
- Authorize the object, not "is logged in": ownership, role/scope, tenant on
  every call. A missing object-level check is BOLA/IDOR.
- Rate-limit every endpoint, tighter on auth, expensive, and write paths;
  `429` with `Retry-After` and `X-RateLimit-*` headers.
- Hide existence: a resource the caller may not see returns `404`, not `403`.

See [resource-modeling](resource-modeling.md) for the resources these rules
guard.
