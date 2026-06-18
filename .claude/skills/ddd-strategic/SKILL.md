---
name: ddd-strategic
description: Apply strategic Domain-Driven Design before deciding where a business model lives and what language it speaks. Use for subdomain classification, bounded contexts, ubiquitous language, context mapping, event-storming/domain-storytelling, aggregate sizing, domain vs integration events, or any feature that spans contexts with real business rules. This skill decides semantic/model boundaries; [[architecture-fundamentals]] decides runtime/component boundaries, communication, resilience, and contracts after those meanings are clear. Skip generic CRUD, throwaway prototypes, single-context work, and pure code-level changes.
---

# DDD Strategic

Most "we need to split this service" or "this codebase is unintelligible" stories are model problems: a `Customer` class with thirty nullable fields, teams using `record`/`row`/`entity`/`account`/`user` for the same thing, in-house CRM/auth/invoicing built instead of bought, microservices drawn around technologies instead of domain boundaries. Each is the same missed fundamental: **the strategic half of DDD** — where the model lives, what language it speaks per place, and which parts deserve full domain investment.

The **tactical** half (aggregates, entities, value objects, repositories, domain services) is covered by the construction skills already in this library. The one tactical piece kept here is **aggregate sizing** — Vernon's four rules sit between strategic design and code in a way nothing else in the library covers.

## Skills this sits next to

The cross-skill run order, triggers, and the `ddd-strategic` ↔ `architecture-fundamentals` seam are owned by `.claude/rules/fundamentals.md` (canonical) — point there, don't restate the seam. What's specific to *this* strategic skill is where each tactical piece it produces is governed:

- [[programming-fundamentals]] — the code inside an aggregate or value object (illegal-state elimination, pure core, error handling).
- [[hexagonal-backend]] — layering within one bounded context (domain/application/infrastructure); aggregates and value objects live in the domain layer, repositories are ports.
- [[database-fundamentals]] — one bounded context's persistence: schema, transactions, indexes.
- [[queue-fundamentals]] — the integration-event channel: internal domain events may not need a broker; integration events cross contexts and need outbox, idempotency, DLQ.
- [[debug-fundamentals]] — when a bug crosses contexts, this skill names the structural fix; debug-fundamentals finds the cause.

## The 6 principles

Run them in roughly this order — early ones unblock later ones.

---

### 1. Classify the subdomain before applying DDD

**Rule:** Before designing aggregates, drawing context maps, or running event storming, classify the subdomain: **core** (your differentiator — full custom design), **supporting** (necessary but not differentiating — build pragmatically), or **generic** (commodity — buy or use off-the-shelf). DDD investment follows the classification.

**Why:** The most common DDD failure is "we did it everywhere." Teams apply full tactical DDD to a 5-table admin tool and pay full tax for zero domain leverage — then under-invest in the one subdomain that actually differentiates by shipping it as anemic CRUD. Classification flips both errors at once.

**How to apply:**
- **Core** is the subdomain that gives the business its reason to exist. Invest senior engineers, deep domain conversations, full tactical DDD if it earns its cost, event sourcing/CQRS if justified. *Always* build in-house.
- **Supporting** is necessary infrastructure that isn't the moat — internal tools, admin surfaces, workflow glue. Build pragmatically: clean module, rich enough model, no heroic abstraction. Often a well-modularised piece of a monolith.
- **Generic** is commodity — auth, billing infrastructure, search, email, storage, payment processing for standard cases. *Buy* it (Auth0, Stripe, Algolia, SendGrid, S3) or use a well-maintained OSS package. Every "but we have unique requirements" justification on a generic subdomain deserves three rounds of "are you sure?" before any code lands.
- The boundary is not fixed. Re-classify periodically — a core subdomain today (a recommendation algorithm) can become supporting tomorrow; a generic subdomain can become supporting when your scale outgrows the commodity.
- See [[subdomain-classification]] for the differentiation test, the Wardley mapping relationship, and the build/buy/borrow decision frame.

**Example:**
```
Wrong: small e-commerce startup builds custom auth, billing, search, and transactional email.
       All four are generic. 60% of engineering quarters on commodity work; the actual
       differentiator — curated recommendations — ships as anemic CRUD with a single SQL query.

Right: Auth/billing/search/email → generic, buy. Order management/inventory → supporting, clean
       modules in the monolith. Recommendations → core, full design effort, dedicated team.
```

---

### 2. Discover boundaries from events, not entities

**Rule:** When bounded contexts aren't yet known, find them by walking the domain's *events* — what happens, in what order, with what consequences — not by listing nouns. Run an Event Storming or Domain Storytelling workshop with domain experts present; contexts reveal themselves at seams where language and actors change.

**Why:** Entity-first design ("we have User, Order, Product, Invoice — draw boxes around each") produces god-objects because the same noun means different things to different parts of the business. Event-first design ("someone places an order → payment captured → inventory reserved → invoice issued") makes seams visible: the team that talks about "placing an order" is not the team that talks about "recognizing revenue."

**How to apply:**
- **Don't skip the workshop just because it sounds heavy.** A 3-hour Event Storming session with five domain experts and four engineers can save quarters of refactoring. Events become domain events, commands become use-case methods, policies become event handlers, read models become projections — the output is an executable plan.
- **Three flavors of Event Storming:** *Big Picture* (whole business line, find contexts), *Process Modelling* (one process end-to-end with commands, policies, and reactions), *Software Design* (zoom into one process, identify aggregates and contexts). Pick the flavor matching the question.
- **Domain Storytelling** is the lighter alternative — pictographic actor/work-object/activity diagrams via facilitator interview. Better for narrative cooperation flows; weaker for event-driven systems.
- **Boundary signals:** language changes ("order" until it ships, then "shipment"); actors change (sales hands off to operations); clock changes (real-time vs. nightly batch); hotspot pink stickies cluster.
- The output is a *list of candidate bounded contexts* plus events that cross them. Validate against principles 3–4 before cementing in code.
- See [[event-storming]] for the workshop format, sticky-color grammar, facilitation tips, and artifact-to-code mapping.

**Example:**
```
Wrong: team lists nouns: User, Order, Product, Invoice. Draws boxes, calls them services.
       Six months later, every feature touches User and Order because each noun means four
       things. The "model" is the source of friction.

Right: 3-hour Event Storming reveals: cart-built → payment-captured → order-confirmed →
       inventory-reserved → shipment-scheduled → invoice-issued → revenue-recognized.
       Natural seams: Checkout owns cart-to-confirmed; Fulfillment owns reserved-through-
       delivered; Finance owns invoice-and-revenue. Each has its own "order" concept. No god-object.
```

---

### 3. One ubiquitous language per bounded context

**Rule:** Inside a bounded context, code, conversations, tickets, dashboards, schemas, and API contracts all use the *same words the domain experts use*, with the same meanings. Across contexts, the same word may mean a different thing — that's correct. Translation, if needed, happens at the boundary via an anticorruption layer or published language, never in code that pretends one model serves both contexts.

**Why:** The translation tax — `record` in code, `row` in DB, `entity` in API, `account` in CRM, `user` in talk-track — is paid on every conversation, review, onboarding, and bug report, forever. Worse, when language drifts, bugs drift: developers and domain experts agree they understood each other and then ship the wrong thing because "an active customer" meant two different things.

**How to apply:**
- **Build a glossary per bounded context.** Twenty terms, one sentence each, ratified by domain experts. Living document. Code must use these terms verbatim.
- **Rename ruthlessly.** When the glossary says `policy`, rename `record`/`entry`/`agreement`/`contract` to `policy` across the codebase, DB schema, API, dashboards, and runbooks. The translation cost is paid once at rename time and saved forever after. (This deliberate, glossary-driven rename is a scoped change — not the incidental adjacent-code rename [[coding-discipline]]'s *surgical-changes* warns against.)
- **The same word in two contexts is two different concepts.** `IdentityCustomer` and `BillingCustomer` can both exist, different fields, invariants, lifecycles. They share an ID but not a model.
- **The smell:** developers and domain experts have parallel vocabularies. Domain expert says "renewal grace period"; engineer says "the field on the subscription table that controls whether we still let them log in for 7 days." Close it by adopting the expert's term in code.

**Example:**
```
Wrong: insurance system uses `Policy` in three contexts (underwriting: draft proposal; billing:
       recurring relationship; claims: coverage agreement). One class with thirty nullable fields.
       Every bug is "we treated a quoted policy as a billable one."

Right: three bounded contexts, three named concepts: `Quote` (underwriting), `BillableSubscription`
       (billing), `CoverageAgreement` (claims). Each has its own fields and lifecycle. The shared
       identifier is a `PolicyNumber`. Translation at explicit integration points.
```

---

### 4. Name the relationship between contexts deliberately

**Rule:** For each pair of bounded contexts that must integrate, pick one of the seven context-mapping patterns and *name it* — in the context map, in team vocabulary, and (when relevant) in code. The pattern names what the contract is, who owns the translation, and what the failure modes are.

**Why:** Most cross-context pain is unnamed coupling. Two contexts agreed-by-accident to share a model and now neither can evolve. The seven names let two teams have a five-minute conversation about which one applies instead of a six-month conversation about who broke the build.

**How to apply (the seven patterns):**

| Pattern | When to use it | Cost / risk |
|---|---|---|
| **Shared Kernel** — two contexts jointly own a small shared model. | Concept is genuinely identical in both contexts AND teams cooperate closely. Examples: a `Money` type, a small shared protobuf. | Brittle; any change needs coordination. Use *sparingly* — most "shared" things differ subtly between contexts. |
| **Customer / Supplier** — downstream depends on upstream but has political pull on upstream's roadmap. | Both teams inside the same org; supplier *accepts responsibility* for serving customer's needs. | Real cooperation cost; works only when the relationship the pattern names is real. |
| **Conformist** — downstream slavishly accepts whatever upstream publishes. | Upstream won't accommodate (different org, vendor, regulator) AND downstream model fits cleanly onto upstream. | Couples downstream forever to upstream's choices. Acceptable when upstream is stable and fine. |
| **Anticorruption Layer (ACL)** — translation shell at the boundary. | Upstream's model leaks concepts you don't want in your domain: vendor APIs, legacy systems. **Most common defensive pattern.** | Real translation code at the boundary; pay it deliberately, not implicitly throughout the codebase. |
| **Open Host Service (OHS)** — upstream publishes a stable, deliberately-designed protocol for *many* consumers. | Upstream is consumed by enough downstreams that pairwise integration is unmaintainable. Pair with Published Language. | Upstream pays the cost of a stable public surface forever. |
| **Published Language** — a shared, deliberately-designed interchange schema neither side owns. | Industry-standard formats (HL7, FIX, ISO 20022) or internal org-standard schemas in a schema registry. | Governance cost — but replaces N pairwise translations. |
| **Separate Ways** — explicit decision *not* to integrate. | Integration genuinely isn't worth its cost; two contexts are near-duplicates by accident. | The cost of *not* using this when it applies is dragging a useless integration for years. |

- **A context map** is a single diagram listing every integrating pair and the pattern between them. Keep it one page. Update when the relationship changes.
- **Most common patterns in practice:** ACL when integrating with anything outside your team's control; OHS + Published Language when you are upstream for many consumers; Customer/Supplier for two friendly internal teams; Separate Ways when someone proposes an integration nobody actually needs.
- **Be suspicious of:** Shared Kernel (ages badly) and Conformist (often means you skipped the ACL conversation).
- See [[bounded-contexts]] for the full pattern catalog, context-map drawing recipe, and ACL depth.

**Example:**
```
Wrong: platform integrates with a legacy ERP; maps cryptic field names (`STK_BAL`, `LOC_CD`,
       `WHSE_NUM`) directly into its types. Six months in, half the domain model speaks the
       ERP's language; renaming ERP fields requires touching forty files.

Right: platform puts an ACL at the boundary. `LegacyErpInventoryAdapter` emits clean
       `InventoryLevel` values in the platform's ubiquitous language. When the ERP changes,
       only one module changes. The rest of the codebase stays unpoisoned.
```

---

### 5. Size aggregates around invariants, not entities

**Rule:** An aggregate is a *transactional consistency boundary* — the smallest set of entities and value objects that must change atomically to keep a business invariant true. Design aggregates *small*, reference other aggregates *by identity*, modify *one aggregate per transaction*, and let everything outside the boundary be *eventually consistent*. The test: "what business rule is invalidated if these two things are modified in separate transactions?" If you can't name one, they belong in different aggregates.

**Why:** The classic DDD-gone-wrong shape is an oversized aggregate — a `Project` owning all `Releases` owning all `Sprints` owning all `BacklogItems` — and it fails in production via transactional contention: two users modify the same root, the optimistic lock collides, retries pile up, throughput collapses. Vernon's empirical observation: ~70% of well-designed aggregates are a single root entity with only value-typed properties; ~30% have 2–3 entities total. Bigger is almost always a smell.

**How to apply (Vernon's four rules):**
1. **Model true invariants in consistency boundaries.** An aggregate's job is to enforce one or a few business rules atomically. Everything else lives outside.
2. **Design small aggregates.** Default to root + value-typed properties. Add entities only when an invariant *requires* them in the same transaction. Beware `0..*` collections inside an aggregate — they grow unbounded.
3. **Reference other aggregates by identity.** Hold an `OrderId`, not a reference to the `Order` object. Cross-aggregate modification becomes impossible by construction.
4. **Use eventual consistency outside the aggregate.** Aggregate A commits → emits domain event → handler updates aggregate B in a *separate* transaction. Combine with the **outbox** pattern (see [[queue-fundamentals]]).

- **The sizing test.** Before putting two entities in the same aggregate, name the invariant that breaks if they're in separate transactions. "It's convenient to load them together" is not an invariant — that's a query concern, solvable with a read model.
- **The collection trap.** Bounded, small collections inside the aggregate are fine (a `Cart` with ≤50 items). Unbounded collections (`Project.backlogItems`, `Customer.orders`) mean the items are their own aggregates referenced by ID.
- **When the rule pushes back:** if the business *requires* strong consistency across what looks like two aggregates, they're probably one. Verify by asking the domain expert "what breaks if these are inconsistent for 200ms?"
- **Aggregates and the rest of the library:** the code inside is governed by [[programming-fundamentals]] (illegal states unrepresentable, invariants in constructors); persistence via [[hexagonal-backend]]'s repository ports; the transaction by [[database-fundamentals]]; emitted events cross to [[queue-fundamentals]] when leaving the context.
- See [[aggregate-design]] for the four rules with worked examples, the sizing test, the Vernon Scrum-aggregate split walkthrough, and ORM/persistence concerns.

**Example:**
```
Wrong: `Project` aggregate owns `Release` → `Sprint` → `BacklogItem`. Adding an item loads the
       entire graph, modifies the root, saves. Two users adding items concurrently fight for the
       root's optimistic lock. Under load, throughput collapses.

Right: four aggregates — `Project` (id, name, code, owner), `Release` (id, project_id, name,
       window), `Sprint` (id, release_id, capacity, start, end), `BacklogItem` (id, sprint_id,
       title, story_points, state). Each holds *its own* invariants. Cross-aggregate coordination
       via domain events in separate transactions. Throughput scales with aggregates touched.
```

---

### 6. Separate internal domain events from cross-context integration events

**Rule:** Domain events *inside* one bounded context can be rich, evolve freely, and use the full ubiquitous language. Events crossing *into* another context (or external consumers) are a *contract* — narrower, versioned, deliberately stable, often a different shape. Don't publish your internal event directly as an integration event; that couples model evolution to every downstream forever.

**Why:** Internal domain events and integration events look similar but have opposite lifecycle properties. Internal events are *implementation detail*: rename a field, restructure an aggregate, and the internal event changes in lockstep in one repo. Integration events are *contract*: every change must respect every downstream consumer, deploy on a different schedule, and survive consumer versions not yet upgraded. Conflating them is one of the top DDD failure modes — every internal refactor breaks downstream, and "small" changes ship over quarters.

**How to apply:**
- **Two distinct event types in the codebase.** `OrderConfirmed` (internal domain event, rich, evolves with the model) and `OrderConfirmedV1` (integration event, narrow contract, versioned, lives in a schema registry). The integration event is *produced from* the internal at the boundary, never *equated* to it.
- **Integration events are smaller, not bigger.** Strip internal-only fields, denormalise what downstream consumers actually need, version explicitly. Tolerant readers make backwards-compatible evolution safe.
- **Outbox pattern for the publish.** Internal events emitted by the aggregate inside the same DB transaction as the state change; an outbox relay publishes the translated, contract-shaped integration event to the broker. This is [[queue-fundamentals]]' territory operationally — this skill's contribution is *which event is which* and *where the translation happens*.
- **Naming convention.** Domain events use the ubiquitous language verbatim (`PolicyBound`, `ClaimSubmitted`). Integration events use the same verb with a version suffix (`PolicyBoundV1`). The version is part of the name, not a header.
- **Schema registries** (Avro/Protobuf/JSON Schema) encode compatibility rules and reject breaking changes in CI.
- **The cross-context boundary is the same line as the language boundary (principle 3).** Translation of payload and translation of language happen at the same point.

**Example:**
```
Wrong: Billing publishes its internal `InvoiceCreated` event directly to the broker. It carries
       `pricing_engine_version`, `applied_promotion_tree`, `tax_jurisdiction_resolution_trace`
       — internal debug fields. Three downstream consumers code against them. Six months later,
       Billing rewrites its pricing engine; all three consumers break overnight.

Right: Billing emits an internal `InvoiceCreated` to its own outbox. A relay translates each into
       `InvoiceCreatedV1` — invoice id, customer ref, amount, currency, line items, due date —
       and publishes that to the broker. Internal evolution and external contract are decoupled.
```

---

## Pre-flight checklist

Before strategic DDD work (designing or naming a context, integrating with another team, sizing an aggregate, running a discovery workshop, naming an event contract):

1. **Subdomain classification:** is the subdomain **core**, **supporting**, or **generic**? Am I over-engineering a generic subdomain or under-investing in a core one?
2. **Discovery:** if boundaries aren't known and the domain has real complexity, have I run (or planned) an Event Storming or Domain Storytelling with actual domain experts?
3. **Ubiquitous language:** can I produce a 20-term glossary the domain experts would ratify? Does the code use those exact terms? If a word means different things in two contexts, are they named distinctly?
4. **Context relationships:** for each integrating pair, have I named which of the seven patterns applies? Is the context map drawn and shared with the teams?
5. **Aggregate sizing:** for each aggregate, can I name the *specific business invariant* that requires its entities to change atomically? Am I referencing other aggregates by ID?
6. **Domain vs integration events:** for each event, is it *internal* (rich, evolves freely) or *integration* (contract, versioned, narrow)? Where is the translation? Where is the outbox?

If any answer is "I don't know," stop and find out before cementing the design in code.

## Failure-mode diagnostics

| Symptom | Failure | Fix |
|---|---|---|
| Entities are bags of getters/setters; all logic in `*Service` classes; logic duplicated across services. | **Anemic domain model.** | Move invariants into entity methods; private setters; constructors validate; see [[programming-fundamentals]]. |
| Transactional contention under load; large object graphs loaded for small operations. | **Aggregate too big.** | Find true invariants (principle 5); split; reference by ID; integrate with domain events. |
| Cross-aggregate try/catch + compensating writes; business rules silently violated under concurrency. | **Aggregate too small.** | Merge — the missing invariant *is* the boundary. |
| Internal domain events published directly as integration events; downstream breaks on every internal rename. | **Leaky bounded context.** | Separate domain and integration events (principle 6); introduce ACL or Published Language. |
| Developers use technical terms (`record`, `row`, `DTO`) in standups; domain experts use different words; bugs trace back to "we thought we agreed." | **Missing ubiquitous language.** | Glossary per context (principle 3); rename in code. |
| Team applies aggregates, repositories, and value objects to a 5-table admin tool. | **Strategic skipped.** | Classify the subdomain (principle 1); if generic or trivial supporting, use boring CRUD with rich-enough types. |
| Internal field rename ripples to forty files because every layer speaks the upstream vendor's vocabulary. | **Missing ACL.** | Insert a translation layer at the boundary (principle 4). |
| Two teams co-own a "shared" library nobody wants to touch. | **Shared Kernel rot.** | Give the kernel an owner or split it; shared-kernel-by-default is the trap. |

## Below the principles: operational concerns

- **Domain experts are the bottleneck.** Strategic DDD's primary lever is the developer/domain-expert conversation. Without access to domain experts, most of the payoff is unavailable — you're in DDD Lite territory (~30% of the value, per Three Dots Labs).
- **Context boundaries can be logical, not physical.** Two bounded contexts can live in one deployable (a well-modularised monolith). The boundary is about *model and language*; deployment shape is a separate decision (see [[architecture-fundamentals]]).
- **CQRS and Event Sourcing are amplifiers, not requirements.** They pair naturally with aggregates but have their own cost and failure modes. Plain CRUD-shaped persistence with rich aggregates is a fine starting shape for most contexts.
- **Conway's Law is a design input.** One bounded context per stream-aligned team is the modern default. If team shape doesn't fit context shape, either reorganise or accept the friction.
- **ORMs and aggregates have an awkward relationship.** Lazy loading, cascade rules, identity tracking — ORMs are built for the entity-graph view. The compromises (eager-load the whole aggregate, suppress lazy loading inside the boundary, repository hides the ORM) are workable but not free.

## When to skip this skill

- Generic CRUD with no real domain logic — use boring CRUD with rich-enough types ([[programming-fundamentals]]).
- Throwaway prototypes, internal scripts, one-shot data fixes, proofs-of-concept before production.
- Single-context features with no cross-boundary concerns — run [[programming-fundamentals]] + [[hexagonal-backend]] + [[database-fundamentals]].
- Pure code-level work (renaming a function, adding a parameter, fixing a bug on screen) — [[debug-fundamentals]] or [[programming-fundamentals]] own that.
- Pure architecture-level operational decisions (timeouts, retries, instrumentation) — [[architecture-fundamentals]].
- Domains with no access to domain experts — fall back to whatever model exists, accept DDD Lite, apply [[hexagonal-backend]] + [[programming-fundamentals]] within existing boundaries.

## Reference files

- `references/subdomain-classification.md` — core/supporting/generic with the differentiation test, Wardley mapping, build/buy/borrow, drift between classifications, worked examples. Use for principle 1.
- `references/bounded-contexts.md` — bounded contexts as linguistic + model boundaries, glossary discipline, the seven context-mapping patterns, context-map drawing recipe, ACL depth, boundary smells. Use for principles 3 and 4.
- `references/event-storming.md` — Big Picture/Process Modelling/Software Design formats, sticky-color grammar, facilitation tips, Domain Storytelling as alternative, artifact-to-code mapping. Use for principle 2.
- `references/aggregate-design.md` — Vernon's four rules with examples, sizing test, Scrum-aggregate split walkthrough, aggregates and bounded contexts, ORM/persistence concerns. Use for principle 5.

## How to use this skill in a conversation

Always-on for strategic-DDD work — triggers and the cross-skill run order (this skill leads the construction chain) are owned by `.claude/rules/fundamentals.md`. If the task is in "When to skip," say so in one sentence and proceed without it.
