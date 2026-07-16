# Rule: Fundamentals router (always-on)

The always-on **detection layer**: match a trigger below, then load that one skill (`.claude/skills/<name>/SKILL.md`) — why/how, checklist, skip list — **before** the work it governs. Thin by design; the prose lives in each skill body.

## Conduct digest (always-on)

The 4-principle core of `coding-discipline`, applied to **every** code task without loading the body (load it only on friction — see the Process table): **(1) Think before coding** — state assumptions; >1 reasonable reading → name them, never pick silently; a genuinely open design → `brainstorming`. **(2) Simplicity first** — the Ponytail section below. **(3) Surgical changes** — every changed line traces to the request; no reformat/rename/refactor riding along; mention nearby bugs, don't fix them inline; remove only what *your* change orphaned. **(4) Goal-driven** — restate the task as a checkable definition of done before starting; loop until met.

## Ponytail (always-on minimalism)

**The best code is the code you never wrote.** Before writing code, stop at the first rung that holds: (1) does it need to exist? → no: skip it (YAGNI); (2) stdlib / built-in does it? → use it; (3) native platform/framework feature? → use it; (4) already-installed dependency? → use it (a *new* dependency is **not** free — `security-fundamentals` owns that call); (5) one line? → one line; (6) only then: the minimum that works. **Lazy, not negligent** — never cut trust-boundary validation, error/data-loss handling, security, or accessibility. Mark deliberate shortcuts inline with a `ponytail: <upgrade path>` comment. Always-on digest of `coding-discipline` principle 2.

## Output discipline (always-on)

Terse-first — every response, artifact, agent report. Cut preamble, restated context, narration. **Terse ≠ lossy**: never drop a result, caveat, or needed step. Throwaway prose (chat, agent report, `state.json notes`) → minimize hard, tags not paragraphs. Consumed artifacts → trim prose, but keep every field a later phase reads (ACs, tasks, mermaid diagram, `path#anchor` citations, regression contract, `--resume` keys) — cut those and the next phase breaks.

## Process layer (wraps the work)

| When the task is… | Load skill | Order |
|---|---|---|
| Producing or editing **code** (implement, fix, refactor, "clean up") | `coding-discipline` | **on friction only** — the always-on Conduct digest above is the default pre-flight; load the body when a checklist answer is genuinely unclear (ambiguous ask, oversized scope, contested diff shape) |
| An **unknown-cause failure** (bug, crash, regression, flaky test, perf cliff, prod surprise) | `debug-fundamentals` | first — find the cause, *then* the construction skill for the fix layer |
| **Restructuring** working code without changing behaviour (extract, rename, untangle, de-dupe, simplify, pay down debt) | `refactoring-fundamentals` | first — pick safe path + baseline, *then* construction skill |
| Writing tests / deciding what to test / choosing a test level / reviewing coverage | `testing-fundamentals` | design-time companion to the construction skills |

## Construction layer (run in this order when several apply)

Model & boundaries → code → in-process concurrency → storage → service layering → API surface → cross-service → async channel → harden → observe:

`ddd-strategic` → `programming-fundamentals` → `concurrency-fundamentals` → `database-fundamentals` → `hexagonal-backend` → `api-design-fundamentals` → `architecture-fundamentals` → `queue-fundamentals` → `security-fundamentals` → `observability-fundamentals`

| When the task is… | Load skill |
|---|---|
| Deciding **where a model lives / what language it speaks** — bounded contexts, subdomain build-vs-buy, aggregate sizing, context mapping | `ddd-strategic` |
| Any code with **real logic** — function, module, data model, non-trivial bug, review | `programming-fundamentals` |
| **In-process** "things run at once" — threads, async/await, shared mutable state, locks, parallel tasks, event loops, racing callbacks | `concurrency-fundamentals` |
| Touching a **database** — schema, non-trivial query, index, migration, slow-query, persistent data modeling | `database-fundamentals` |
| **Backend with real domain logic** — services, APIs, repositories, use cases, persistence, message handling (define ports before controllers/DB) | `hexagonal-backend` |
| Designing/changing an **API surface** a client codes against — endpoint, resource/URL model, request/response body, status codes, error shape, pagination, idempotency, version bump | `api-design-fundamentals` |
| A **system-level** decision — new system, split/merge services, new cross-component call, event schema, failure modes, scaling, how components relate at runtime | `architecture-fundamentals` |
| A **queue-based** path — broker, event stream, background job, async worker, pub/sub | `queue-fundamentals` |
| A **trust boundary** — auth/session/token, password/crypto, input handling, SQL/query building, raw HTML/template, file/path, exec/shell, deserialisation of untrusted input, secrets, new external endpoint, pulling in a dependency | `security-fundamentals` |
| Shipping runtime code that adds a **failure mode or op surface** — logging/metrics/tracing, an SLO/alert, a prod blind spot | `observability-fundamentals` |

## Delivery layer

| When the task is… | Load skill |
|---|---|
| Any write to `.git` — branch, commit, message, rebase, merge, force-push, PR, destructive cleanup (`reset --hard`, `push --force`, `checkout --`) | `git-workflow` |
| How code **reaches production** — CI/CD pipeline, build, deploy strategy, release, containerization, env config, rollout/rollback | `delivery-engineering` |

## Seams that blur

- **concurrency vs queue vs database** — in-process is `concurrency-fundamentals`; cross-process/broker async is `queue-fundamentals`; transaction isolation is `database-fundamentals`.
- **api-design vs architecture** — `api-design-fundamentals` owns one service's published surface (after `hexagonal-backend` defines the port, before `architecture-fundamentals` draws runtime relationships).
- **ddd-strategic vs architecture** — `ddd-strategic` decides semantic/model boundaries; `architecture-fundamentals` decides runtime/component boundaries afterward.
- **security & observability are cross-cutting** — applied last, to whichever layer carries a trust boundary or op surface.

**Outside this router:** the non-lifecycle skills (`brainstorming`, `plan-writing`, `fanout-team-agents`, `claude-md`, `qa-handoff-note`, `init-project-docs`, `frontend-design`, `tailwind-design-system`, `ui-ux-pro-max`, `skill-creator`) trigger by their own frontmatter descriptions or explicit `/dev`-pipeline wiring — intentional, not an omission; the table lives in `CLAUDE.md > Skills outside the router`.

This file is the single source of truth for triggers and cross-skill run order. `README.md` mirrors the chain; `CLAUDE.md` and `WORKFLOW.md` name this file canonical without restating it. When you add/remove/reorder a skill, update the chain here + `README.md` (grep chain head `ddd-strategic`) and re-check the two canonical-pointer mentions.
