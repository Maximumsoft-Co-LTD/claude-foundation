# Boundaries

Decide what is one thing before deciding whether it is one module, one
service, or one team. Boundaries follow the domain, not the org chart or the
technology at hand; left undecided, Conway's Law decides them for you and
those choices last a decade.

## Bounded contexts first

A bounded context is where a word has one meaning. "Order" in Checkout (a
cart awaiting payment), Fulfillment (a packed box), and Finance (a revenue
line) are three concepts; one `Order` class for all three becomes thirty
nullable fields nobody wants to touch. The boundary goes where the language
changes; across it you translate (`OrderId` ↔ `ShipmentReference` ↔
`RevenueLineKey`). Context discovery, glossaries, and the seven relationship
patterns are `ddd-strategic` work; this skill decides deployment shape once
the contexts are known.

```
Wrong: split "user profile" and "user authentication" into two services
       because they feel different; every signup and login redeploys both.
Right: one Identity service owns the user concept; pull notifications out
       months later when it has its own backlog and on-call rotation.
```

## Module versus service

A service is a permanent operational cost: separate deploy, monitoring,
on-call, scaling decision, inter-service auth, and a network call where a
function call used to be. A module inside the same deployable gives the
boundary benefit with none of that tax. Default to modules; the standing
consensus is "monolith unless you have a really good reason". Extract only
when the boundary buys what a module cannot:

- independent scaling (100× traffic, GPU- or memory-bound);
- independent deploy cadence that is a real bottleneck;
- independent failure domain (a flaky third-party integration isolated);
- independent technology (a Python model inside a Go system);
- regulatory or security isolation (PCI scope, data residency).

A network call takes milliseconds, can time out, can succeed without
responding, and can be retried into duplicates; do not pay that casually.

## One owner per piece of data

Every piece of state has exactly one component that owns its write path; the
owner is the component whose business rules govern the data. Others read
through the owner's API (consistent, one hop), subscribe to its event stream
and build a projection (fast, eventual, needs the outbox), or as a last
resort read a replica (couples them to the owner's schema). No shared
writable store: "both services write the same table" is the most regretted
decision in service-oriented systems. Two components that co-own a concept
have two concepts hiding in one name.

```
Wrong: Orders and Inventory both write `products`; "who set stock to -1?"
Right: Catalog owns `products`; Inventory owns `stock_levels` keyed by
       product id; Orders reads display names through Catalog's API.
```

## Conway's Law and the inverse maneuver

A system copies the communication structure of the organization that builds
it. Two teams produce two components with a contract between them even when
one component would be simpler. If you want a particular shape, organize the
teams to match; reorgs change architectures whether anyone meant them to.
Putting a team on each side ossifies a boundary; giving both sides to one
team dissolves it.

## Extracting a service: the strangler fig

Never big-bang. Identify the seam (a bounded context, its use cases, its
data); put a facade in front of the old code; implement one use case in the
new service and route only that through the facade; migrate data with
dual-write during transition, then flip reads; repeat per use case; delete
the old code. The system is shippable at every step and any single step can
be rolled back.

## Anti-corruption layers

When integrating a system you do not control, wrap it in a driven adapter
that translates its types to yours; the translation is the only place the
external types appear, and it absorbs the external system's quirks (rate
limits, odd auth, undocumented enum values). Without it, partner field names
and nullability leak into your entities within six months.

## Boundary smells

- Two services always deploy together: they are one.
- A change in one service needs another service's migration: a hidden
  shared schema.
- Team A needs team B's approval for every change: the boundary cuts through
  one piece of business value.
- "Just give me direct access to your DB": ownership is unnamed; expose an
  API or an event stream.
- The same rule enforced in three places: one owner, or three concepts
  sharing a name.
- An orchestrator calling four services per request: a hub that turns three
  failure modes into one.
- A "common" service everything depends on: push shared concerns into
  libraries, not runtime dependencies.
