# Aggregate design

## What an aggregate is

A transactional consistency boundary: the smallest cluster of entities and
value objects that must change atomically to keep a business invariant true,
with one root entity that outside code may reference. Three properties:
atomic commit, encapsulated invariants, identity-based references from other
aggregates. It is not every domain object, not a database table, and not
the unit of authorization or display.

## Vernon's four rules

1. **Model true invariants in consistency boundaries.** If "a sprint's
   committed points must not exceed capacity" must hold immediately, sprint
   and its items share an aggregate. If "display name should eventually match
   the CRM" is measured in seconds, they are separate aggregates linked by id.
   Name the invariant before drawing the boundary.
2. **Design small aggregates.** About 70% of well-designed aggregates are a
   root with value-typed properties; about 30% have two or three entities.
   Oversized aggregates cost memory on every load, optimistic-lock contention
   on every write, and collapse throughput under load.
3. **Reference other aggregates by identity.** Hold `customerId`, not
   `customer`. With an object reference, code inside `Order` can call
   `this.customer.deactivate()` and silently break another aggregate's
   invariants; with an id, that is syntactically impossible.
4. **Use eventual consistency outside the aggregate.** A handles a command,
   mutates, emits a domain event, commits; the event is published through the
   outbox (`queue-fundamentals`); a handler loads B in a separate transaction.
   Cross-aggregate consistency is opt-in, never accidental.

```typescript
class Order {
  constructor(
    public readonly id: OrderId,
    public readonly customerId: CustomerId,   // identity, not the Customer aggregate
    public readonly items: OrderItem[],       // inside this aggregate
  ) {}
}
```

## The sizing test

> What business rule is invalidated if these two things are modified in
> separate transactions?

Name a rule and a stakeholder who cares → same aggregate. Otherwise, separate
aggregates and eventual consistency. Failures of the test: "convenient to
load together" (a read model solves that); "they share an id" (that is what
cross-aggregate references do); "they always change together" (retries and
manual corrections say otherwise); "the user expects them in sync" (within a
window, which is eventual). Genuine invariants: an order's items total equals
the order total; an account balance never goes negative.

```
Wrong: `Project` owns `Release` → `Sprint` → `BacklogItem`. Adding an item
       loads the graph and fights for the root's lock; sprint A blocks sprint B.
Right: four aggregates linked by id, each with one invariant (unique project
       code; valid release window; committed points ≤ capacity; legal state
       transitions). `BacklogItem.commitToSprint` emits an event; a handler
       updates the sprint and raises `CommitmentRejected` with a compensating
       move when the invariant fails.
```

## Persistence

Repositories load and save whole aggregates atomically; partial loads or
saves mean the boundary is wrong or encapsulation is bypassed. One aggregate
per transaction; a use case that seems to modify two is modifying one and
emitting an event. When compliance really requires two writes to be atomic
(a transfer between accounts), they are usually one aggregate (`Transfer`
owning both legs, accounts by id).

ORMs are built for entity-graph navigation. Compromises that work: eager-load
the whole aggregate and suppress lazy loading inside the boundary; keep
cascades inside the aggregate; one repository per aggregate; load other
aggregates through their own repositories, never by following references;
treat the ORM as an implementation detail of the repository
(`hexagonal-backend`).

## Events

Aggregate commands validate, mutate, and emit events as first-class output,
either returned from the method or accumulated and flushed at save time; the
use case hands them to the outbox.

```typescript
place(items: LineItem[]): DomainEvent[] {
  if (items.length === 0) throw new EmptyOrderError()
  this.items = items; this.status = OrderStatus.Placed
  return [new OrderPlaced({ orderId: this.id, customerId: this.customerId, total: this.computeTotal() })]
}
```

Internal domain events speak the context's language and evolve with the
model. Events crossing a context boundary are a contract: narrower,
versioned (`OrderConfirmedV1`), produced from the internal event at the
boundary, registered in a schema registry that rejects breaking changes.
Publishing the internal event directly couples every refactor to every
downstream.

```
Wrong: Billing publishes internal `InvoiceCreated` with `pricing_engine_version`
       and `applied_promotion_tree`; three consumers code against them and all
       break when the pricing engine is rewritten.
Right: the outbox relay translates to `InvoiceCreatedV1` (id, customer ref,
       amount, currency, line items, due date).
```

## Anti-patterns

| Symptom | Fix |
|---|---|
| Lock contention, large graph loads, unbounded `0..*` collections | too big: find the invariants, split |
| Cross-aggregate try/catch with compensating writes; rules violated under concurrency | too small: merge; the missing invariant is the boundary |
| `Customer.update(fields)` with no rules or commands | no invariants: drop the ceremony; plain repository and DTO; re-check subdomain classification |
| `order.customer.deactivate()` compiles | object references across aggregates: replace with ids |
| Fields using two contexts' vocabulary | boundary crosses contexts: split and translate |
| One use case orchestrating five aggregates | push rules into aggregates; thin orchestration; domain service for logic that spans them |
| Getters and setters with logic in a `*Service` | anemic: move behavior onto the aggregate, validate in constructors |
