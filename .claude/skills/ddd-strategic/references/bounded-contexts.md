# Bounded contexts

## What a bounded context is

The region of the domain inside which a model is consistent and the language
is shared. Not a service, not a module, not a team: a linguistic and semantic
boundary. Inside Checkout, `Order` is an in-progress cart; inside Fulfillment
it is a packed box; inside Finance it is a ledger line. One `Order` class for
all three becomes thirty fields, half nullable, that nobody wants to touch.
Draw the boundary where the meaning changes, give each context its own
concept (`Cart`, `Shipment`, `RevenueLineItem`), and share only an identifier.

| Concept | What it is | Rule |
|---|---|---|
| Bounded context | model and language boundary | decided first, from the domain |
| Service | deployment unit: process, pipeline, on-call | decided second, from operations |
| Module | code-organisation unit | a modular monolith is several contexts in one process; the right starting shape for most systems |

Splitting one context across services pays every distributed cost for no
independence benefit. Deployment shape is `architecture-fundamentals`' call.

## One ubiquitous language per context

Code, conversations, tickets, schemas, and API contracts use the domain
experts' words with their meanings. The translation tax (`record` in code,
`row` in the DB, `account` in CRM) is paid on every review and bug report
forever; worse, when "active customer" means two things, the wrong thing
ships.

Symptoms: parallel vocabularies between developers and experts; one concept
with 3+ names; bug reports using words absent from the code; comments doing
translation work (`// 'pending' here means not yet reviewed, not pending
payment`).

Practice: a per-context glossary in the repo (twenty terms, one sentence
each, ratified by experts, enforced in review); rename ruthlessly when the
glossary says `policy`; the same word in two contexts is two concepts
(`IdentityCustomer` and `BillingCustomer` share an id, not a model).

```
Wrong: one `Policy` class across underwriting (draft proposal), billing
       (recurring relationship), and claims (coverage agreement).
Right: `Quote`, `BillableSubscription`, `CoverageAgreement`, linked by a
       `PolicyNumber`, translated at explicit integration points.
```

## The seven context-mapping patterns

Name the relationship for every integrating pair; unnamed coupling is where
most cross-context pain lives.

| Pattern | Use when | Cost / risk |
|---|---|---|
| **Shared Kernel** — jointly owned small model | concept is genuinely identical in both contexts and teams cooperate closely (`Money`, a small protobuf) | brittle; grows into the code nobody owns; use sparingly |
| **Customer / Supplier** — downstream has pull on upstream's roadmap | both teams in one org and the supplier really accepts responsibility | fictional when "backlog" means "maybe next year" |
| **Conformist** — downstream accepts upstream's model as is | upstream will not accommodate and its model fits cleanly | coupled to upstream's choices forever; often means the ACL conversation was skipped |
| **Anticorruption Layer** — translation shell at the boundary | upstream's model leaks concepts you do not want (vendor APIs, legacy systems); the most common defensive pattern | real translation code, paid deliberately at one boundary |
| **Open Host Service** — a stable published protocol | upstream has many consumers; pairwise integration is unmaintainable | a public surface maintained forever |
| **Published Language** — shared interchange schema neither side owns | industry standards (HL7, FIX, ISO 20022) or an internal schema registry | governance, in exchange for N fewer pairwise translations |
| **Separate Ways** — explicit decision not to integrate | the integration is not worth its cost | honesty; skipping it drags a useless integration for years |

Be suspicious of Shared Kernel (ages badly) and Conformist (usually an
unexamined ACL).

## Anticorruption layer in depth

An ACL is one module with three jobs: talk to the upstream (the only place
that knows its wire format); translate concepts, not field names (`STK_BAL:
-1` becomes `InventoryLevel.outOfStock()`); and absorb the upstream's failure
modes so the rest of the code sees clean types or a clean error. It is not a
cosmetic rename wrapper, not an "add later" promise (retrofitting costs far
more than day one), and not infinitely big. When the upstream model is
genuinely fine and stable, Conformist is a conscious alternative.

```
Wrong: the platform maps `STK_BAL`, `LOC_CD`, `WHSE_NUM` straight into its
       types; renaming an ERP field touches forty files.
Right: `LegacyErpInventoryAdapter` emits `InventoryLevel` in the platform's
       language; an ERP change touches one module.
```

## Context map

One page listing every integrating pair and the pattern between them.
Update it when a context, an integration, a pattern, or team ownership
changes; the conversation that produces it is half the value.

## Boundary smells

- The same word means two things but uses one class: a boundary inside what
  is treated as one context.
- Every feature touches two "contexts" together: one context split too
  early; merge.
- One team cannot ship without coordinating every release: wrong boundary,
  missing ACL/OHS, or team shape that does not match context shape.
- A class with thirty fields, half nullable: a god-object spanning contexts.
- A small upstream field change broke five downstreams: missing OHS and
  Published Language, or missing ACLs.
- A co-owned shared library nobody touches: Shared Kernel rot; give it an
  owner or split it.
- Vendor vocabulary leaking into domain code: missing ACL.
