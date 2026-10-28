# Failure modes and operational concerns

## Diagnostics

| Symptom | Failure | Fix |
|---|---|---|
| Entities are bags of getters/setters; logic lives in `*Service` classes and is duplicated | Anemic domain model | Move invariants into entity methods; private setters; constructors validate |
| Contention under load; large object graphs loaded for small operations | Aggregate too big | Find true invariants, split, reference by id, coordinate with events ([aggregate design](aggregate-design.md)) |
| Cross-aggregate try/catch with compensating writes; rules silently violated under concurrency | Aggregate too small | Merge; the missing invariant is the boundary |
| Internal events published as integration events; downstream breaks on every rename | Leaky bounded context | Separate domain and integration events; add an ACL or Published Language |
| Developers say `record`/`row`/`DTO`, experts say something else; bugs trace to "we thought we agreed" | Missing ubiquitous language | Glossary per context; rename in code ([bounded contexts](bounded-contexts.md)) |
| Aggregates and repositories on a 5-table admin tool | Strategic skipped | Classify the subdomain; generic or trivial supporting gets boring CRUD with rich-enough types ([subdomain classification](subdomain-classification.md)) |
| A vendor field rename ripples to forty files | Missing ACL | Translation layer at the boundary |
| Two teams co-own a shared library nobody wants to touch | Shared Kernel rot | Give it an owner or split it |

## Operational concerns

- Domain experts are the bottleneck; without them most of the payoff is
  unavailable.
- Context boundaries can be logical, not physical: two contexts can share one
  deployable. Deployment shape is a separate decision
  (`architecture-fundamentals`).
- CQRS and Event Sourcing are amplifiers, not requirements; plain persistence
  with rich aggregates is a fine starting shape.
- Conway's Law is a design input: one context per stream-aligned team is the
  default; mismatch means reorganise or accept the friction.
- ORMs and aggregates fit awkwardly (lazy loading, cascades, identity
  tracking); the compromises are workable but not free.
