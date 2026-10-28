# Schema design: data shape and constraints

## Model the data first

The schema outlives the code. Choose types that match the domain, start
normalized, and denormalize only when a query forces it.

- Money is integer cents or `NUMERIC`, never `FLOAT`; moments in time are
  `TIMESTAMPTZ`, never strings; one canonical identifier type everywhere.
- Third normal form by default: one fact lives in one place.
- Model relationships honestly: 1:N is a foreign key on the many side; N:N is
  a join table, never a comma-separated column.
- Reserve `JSONB` for genuinely schemaless or rarely-queried payloads; fields
  you filter or index on want real columns.

```sql
CREATE TABLE orders (
  id           UUID PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES users(id),
  total_cents  BIGINT NOT NULL,
  currency     CHAR(3) NOT NULL,
  placed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE order_items (
  order_id     UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  sku          TEXT NOT NULL,
  quantity     INTEGER NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (order_id, sku)
);
```

## Constraints are invariants

Every invariant the application "always" guarantees is also a constraint:
the application will have a bug and a future script will write the same
tables. A unique index is the only way to enforce uniqueness across
concurrent writers; `SELECT` then `INSERT` has a race window.

- Default every column to `NOT NULL`; a nullable column is a claim that
  "missing" means something in business terms.
- Foreign keys on every reference.
- `UNIQUE` for anything a human treats as identifying (`email`, `slug`,
  `(tenant_id, name)`).
- `CHECK` for closed-form rules: `quantity > 0`, `status IN (...)`,
  `ended_at IS NULL OR ended_at >= started_at`.
- Choose `ON DELETE` deliberately: `CASCADE` for owned children, `RESTRICT`
  for references that should block deletion, `SET NULL` only when null means
  "parent gone, child remains".

```sql
CREATE TABLE subscriptions (
  id          UUID PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  plan        TEXT NOT NULL CHECK (plan IN ('basic','pro','enterprise')),
  started_at  TIMESTAMPTZ NOT NULL,
  ended_at    TIMESTAMPTZ CHECK (ended_at IS NULL OR ended_at > started_at),
  UNIQUE (user_id, plan, started_at)
);
```

Document stores without foreign keys or `CHECK` do not remove the invariant;
the application owns the enforcement and accepts orphan documents and drift.
If the data is truly relational, prefer a relational store.
