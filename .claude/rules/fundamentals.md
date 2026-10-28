# Rule: Fundamentals router

This always-on file detects which one skill to load. Skill bodies hold the
procedure; do not preload them.

## Conduct

- Think before coding. State consequential assumptions; investigate genuinely
  ambiguous direction.
- Put user decisions through the host's structured question tool
  (AskUserQuestion) when the session provides one, options with your
  recommendation first; otherwise ask in plain text. Verify every open
  decision was asked; record the answers in the change packet, not chat.
- Prefer no code, then stdlib/platform, installed dependencies, and finally the
  smallest new implementation.
- Keep every changed line traceable to the request. Do not bundle cleanup.
- Define a checkable outcome and continue until it is met.
- For a standard change, surface material NFRs in requirements and evidence;
  use Grounding v3 only for decisions the compiler cannot derive.
- The compiled OpenSpec agreement is the behavioral source of truth. Code and
  tests provide evidence; discoveries that change the agreement use one
  semantic amendment before implementation continues.
- Choose the faster of equally safe paths. Never cut security, error/data-loss
  handling, accessibility, evidence, regression contracts, or Land guards.
- Be terse but complete. Durable intent belongs in OpenSpec; machine status
  belongs in `.foundation/`.
- Skills supply judgment and procedures; the harness owns lifecycle, authority,
  evidence execution, receipts, budgets, and Land. Never create parallel state
  or treat a skill checklist as proof.
- Author one semantic draft or amendment with meaningful keys. The compiler
  owns artifact selection, stable IDs, cross-links, defaults, and validation;
  after Change, use `advance` instead of composing lifecycle primitives.

Load `coding-discipline` only when scope, assumptions, or diff shape remain
unclear after this digest.

## Process skills

| Trigger | Load |
|---|---|
| Bugfix with unknown cause: crash, regression, or flake | `debug-fundamentals` first |
| Measured slow, memory growing, or a speedup to prove | `performance-investigation` |
| Changing an API, schema, config, or shared behavior without knowing who depends on it | `change-impact-analysis` |
| Refactor: extract, move, rename, split, deduplicate, simplify without changing behavior | `refactoring-fundamentals` first |
| Scenarios to prove: failing-first tests, test level, doubles | `testing-fundamentals` |

## Construction skills

Load one primary construction skill for the task's hardest decision. Add
`security-fundamentals` only for a trust boundary and
`observability-fundamentals` only for a changed runtime failure surface. Do not
load adjacent layers merely because the code imports them. Read a skill
reference only when its named decision is active.

| Trigger | Load |
|---|---|
| Business terms, bounded contexts, aggregates, model ownership unclear | `ddd-strategic` |
| User flows, hierarchy, forms, navigation, accessibility, responsive layout | `ux-ui-principles` |
| Look up product, style, palette, typography, chart guidance | `ui-ux-pro-max` |
| Implement or polish web UI after UX direction is settled | `frontend-design` |
| Shared Tailwind v4 tokens, variants, themes, v3 migration | `tailwind-design-system` |
| Nontrivial local logic, types, state, error paths, module boundary, abstraction depth | `programming-fundamentals` |
| Threads, async tasks, locks, shared mutable state, cancellation, races | `concurrency-fundamentals` |
| Schema, query, index, transaction, migration, persisted file | `database-fundamentals` |
| One backend service: domain logic isolated through ports and adapters | `hexagonal-backend` |
| Request, response, status code, error body, pagination, version other code consumes | `api-design-fundamentals` |
| How services, runtimes, or deployables split, talk, fail, or scale | `architecture-fundamentals` |
| Broker, stream, job queue, worker: delivery, idempotency, retries, ordering | `queue-fundamentals` |
| Access control, authorization, secrets, external integration, input to reject | `security-fundamentals` |
| Logs, metrics, traces, SLOs, alerts for a runtime failure surface | `observability-fundamentals` |

Transaction isolation is database work, in-process races are concurrency work,
cross-process async is queue work. Choose the deepest decision actually being
made, then add only required cross-cutting skills.

## Delivery skills

| Trigger | Load |
|---|---|
| Asked to branch, commit, rebase, merge, push, clean up, or open a PR | `git-workflow` |
| CI/CD, builds, containers, deploys, rollouts, rollbacks | `delivery-engineering` |

Non-lifecycle skills trigger from their descriptions or explicit commands.

Catalog maintenance uses `skill-suite-auditor`; observed skill/description
comparisons use `skill-evaluation`. Neither a static audit nor a worker summary
creates proof. Author approved edits through `skill-creator`.
