# Event Storming and domain discovery

## Why event-first

Entity-first design ("we have User, Order, Product, Invoice; draw boxes")
produces god-objects because the same noun means different things to
different parts of the business. Asking "what happens, in what order, who
cares?" surfaces the seams: the team that talks about placing an order is not
the team that talks about recognizing revenue. The boundary goes where the
language and the actors change.

```
Wrong: nouns → boxes → services. Six months later every feature touches User
       and Order because each noun means four things.
Right: cart-built → payment-captured → order-confirmed → inventory-reserved →
       shipment-scheduled → invoice-issued → revenue-recognized.
       Checkout owns cart-to-confirmed; Fulfillment owns reserved-through-
       delivered; Finance owns invoice-and-revenue. Each has its own "order".
```

## Three flavors

| Flavor | Question | Format | Output |
|---|---|---|---|
| Big Picture | What does the whole business do? Where are the contexts? | 15–30 people, half a day | timeline of domain events with hotspots, actors, external systems |
| Process Modelling | How does one process work end to end? | 5–10 people, 2–3 h | one process with commands, policies, read models |
| Software Design | How does this process map to aggregates and code? | 3–6 people, 1–2 h | aggregate groupings and context boundaries |

Grammar: orange = domain event (past tense), blue = command, small yellow =
actor, pink = hotspot (disagreement or unknown; capture, do not resolve in
the room), lilac = policy ("whenever X, then Y"), green = read model, large
yellow = external system. Run order: chaotic exploration of events →
enforce the timeline → add hotspots → add commands, actors, policies, read
models → draw aggregates and contexts → photograph the wall.

## Reading the wall

- Dense event clusters are the heart of a context; sparse stretches between
  them are the seams.
- Policies that fan out widely mark cross-context integration points:
  candidates for integration events, not internal domain events.
- Clustered hotspots mean the team does not yet know that area; resolve
  before coding it.
- A read model spanning several actor types suggests a missing split or a
  deliberate published-language view.
- An event no actor reads is either noise or a missing actor.

## Mapping output to code

| Workshop element | Code element |
|---|---|
| Domain event | a record in the domain layer, emitted by an aggregate |
| Command | an aggregate method or application use case |
| Policy | an event handler that issues the next command |
| Read model | a projection populated from events |
| Actor | a role used in authorization, rarely a class |
| Aggregate boundary | an aggregate class sized per [aggregate design](aggregate-design.md) |
| Bounded context boundary | a module, package, or service ([bounded contexts](bounded-contexts.md)) |
| Hotspot | a follow-up to resolve before coding around it |
| External system | an anticorruption layer at the context edge |

## Pitfalls and when to skip

Pitfalls: no domain experts in the room (you get engineers' guesses);
mixing aspirational events into a current-state wall; treating the wall as a
final specification; 800 stickies nobody reads (consolidate to under 200);
resolving hotspots in the session. Domain Storytelling (actor/work-object
pictographs narrating one scenario) is the lighter alternative for
cooperation-heavy, non-event-driven domains and small teams.

Skip the workshop for generic subdomains, trivial supporting subdomains,
domains the team already understands, and throwaway prototypes. For anything
else with real complexity and accessible experts, half a day is among the
highest-return activities available.
