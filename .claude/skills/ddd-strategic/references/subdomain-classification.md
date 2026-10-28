# Subdomain classification

A subdomain is a coherent area of the business problem space, not a piece of
the software. Classify each before designing aggregates or drawing maps; the
most common DDD failure is "we did it everywhere".

## The three categories

| Category | What it is | Investment | DDD payoff |
|---|---|---|---|
| **Core** | What customers pay for and competitors cannot easily copy: the recommendation engine, the matching algorithm, the risk model | Maximum: senior engineers, deep domain conversations, advanced techniques when they earn their cost; always build in-house | Highest: full strategic and tactical toolkit |
| **Supporting** | Necessary but not differentiating: order management around a search moat, internal tooling, admin surfaces, integration glue | Pragmatic: clean module, rich-enough types, no heroic abstraction; often a well-modularised piece of a monolith | Moderate: bounded contexts and language still pay; full tactical DDD is usually overkill |
| **Generic** | Commodity every company has: auth, transactional email, standard payments, search, object storage, error tracking | Minimal: buy or use maintained OSS; write only glue and configuration | Zero: the vendor already modeled it |

```
Wrong: a small e-commerce startup builds custom auth, billing, search, and email.
       60% of engineering quarters go to commodity work; the differentiator,
       curated recommendations, ships as anemic CRUD.
Right: auth/billing/search/email → buy. Order management → clean module in the
       monolith. Recommendations → core, full design effort, dedicated team.
```

## The differentiation test

> Would the business lose any differentiation if we used a commodity version
> of this subdomain?

Yes, significantly → core. No, but we would lose efficiency, operational fit,
or data quality → supporting. No, and a commodity version would arguably be
better → generic. Domain experts and product leaders, not engineers, answer
this; "our auth has special requirements" is true of almost no organization.

## Build, buy, borrow

| Subdomain | Decision |
|---|---|
| Core | Build; outsourcing it outsources the moat |
| Supporting | Build pragmatically, or buy a flexible base and customise; watch for SaaS that becomes a constraint |
| Generic | Buy, or borrow (OSS); time here is stolen from core |

The two visible mistakes: treating supporting as core (over-engineering the
admin tool) and treating core as generic (shipping the differentiator as
CRUD because "the framework already does that").

## Classifications drift

Core → supporting when the differentiator moves; supporting → generic when a
vendor finally builds it well; generic → supporting when scale outgrows the
commodity (a multi-currency marketplace outgrows plain Stripe); supporting →
core, rarely, when internal infrastructure becomes the product. Re-classify
at least annually and whenever strategy shifts.

## Practical move

Produce a one-page subdomain map: list the 5–30 subdomains, classify each,
name the explicit reason for every generic subdomain built in-house, confirm
each core subdomain has senior attention, and confirm each supporting
subdomain is neither over-engineered nor anemic CRUD over real state-machine
rules. The map is the artifact; the conversations it forces are the point.
