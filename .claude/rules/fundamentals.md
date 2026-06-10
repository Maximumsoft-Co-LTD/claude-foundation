# Rule: Fundamentals routing — run order

When several construction skills apply, run them in this order (decide model & boundaries → code → storage → one service's layering → cross-service → async channel):

`ddd-strategic` → `programming-fundamentals` → `database-fundamentals` → `hexagonal-backend` → `architecture-fundamentals` → `queue-fundamentals`

`coding-discipline` wraps every code task and runs **first** as the conduct check. For a bug, `debug-fundamentals` runs first to find the cause, then the construction skill that owns the fix layer. `git-workflow` is the delivery channel for what the construction skills produce.

This file is the single source of truth for the cross-skill run order — other rules and skills point here instead of restating the chain.
