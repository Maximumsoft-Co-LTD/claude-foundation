# Follow-ups

Items surfaced by past `retro` runs that didn't fit in their original scope. `retro` appends. `pm` reads on every new interview and asks the user whether any open item is now in scope. When a run consumes a follow-up, `retro` marks its status `consumed-by: <run-id>` and leaves the row in place for auditability.

## Open

| ID | From run | Item | Type hint | Priority | Status |
|----|----------|------|-----------|----------|--------|
| F0001 | 0001-feat-todolist-app | _example: add localStorage migration when schema bumps_ | feat | low | open |

## Closed

Items consumed by a later run. Keep these — they're the audit trail.

| ID | From run | Item | Consumed by | Date consumed |
|----|----------|------|-------------|---------------|
| — | — | _example placeholder_ | — | — |

## Conventions

- **ID** — `F` + 4-digit counter, monotonically increasing across all retros. `retro` reads this file to pick the next number.
- **From run** — the `NNNN-type-slug` of the run that surfaced the item.
- **Type hint** — what *kind* of `/dev` run would consume this. Not binding; `pm` can override after interview.
- **Priority** — `low | med | high`. `high` is reserved for known-broken behaviour or security carry-over from `security.md`.
- **Status** — `open | in-progress | consumed-by:<run-id> | wont-do (reason)`.
- Move rows from `Open` to `Closed` when status becomes `consumed-by:…` or `wont-do`.
