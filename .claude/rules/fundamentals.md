# Rule: Fundamentals routing — run order

When several construction skills apply, run them in this order (decide model & boundaries → code → in-process concurrency → storage → one service's layering → cross-service → async channel → harden → make observable):

`ddd-strategic` → `programming-fundamentals` → `concurrency-fundamentals` → `database-fundamentals` → `hexagonal-backend` → `architecture-fundamentals` → `queue-fundamentals` → `security-fundamentals` → `observability-fundamentals`

Only invoke the ones whose layer the task actually touches — the chain is the order to apply them in, not a checklist to run every time. `concurrency-fundamentals` fires only for in-process "many things at once" (cross-process async is `queue-fundamentals`, transaction isolation is `database-fundamentals`). `security-fundamentals` and `observability-fundamentals` are cross-cutting — they sit at the end of the chain because you harden and instrument the surface once it exists, but they apply to whichever layers carry a trust boundary or a runtime op surface.

`coding-discipline` wraps every code task and runs **first** as the conduct check. For a bug, `debug-fundamentals` runs first to find the cause, then the construction skill that owns the fix layer. For a refactor, `refactoring-fundamentals` runs first (pick the safe path, capture the behaviour baseline), then the construction skill that owns the target layer. `testing-fundamentals` is the verification companion — design-time test strategy for whatever the construction skills produce (the `qa` agent executes it at phase 7). `git-workflow` and `delivery-engineering` are the delivery channel: `git-workflow` owns branches/commits/PRs/recovery, `delivery-engineering` owns the pipeline/build/deploy that carries the merged code to production.

This file is the single source of truth for the cross-skill run order — other rules and skills point here instead of restating the chain.
