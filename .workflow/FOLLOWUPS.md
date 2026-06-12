# Follow-ups

Items surfaced by past `retro` runs that didn't fit in their original scope. `retro` appends. `pm` reads on every new interview and asks the user whether any open item is now in scope. When a run consumes a follow-up, `retro` marks its status `consumed-by: <run-id>` and leaves the row in place for auditability.

## Open

<!-- First retro appends here. Use F0001 as the first ID. -->

| ID | From run | Item | Type hint | Priority | Status |
|----|----------|------|-----------|----------|--------|
| F0001 | audit-2026-06-12 | Verify in a FRESH session (agent registry caches definitions at session start): (a) combined-mode `SIZE_UPGRADE` tripwires fire on a disguised-XS storage-key rename, (b) combined-mode lead refuses source-file writes | chore | high | open |
| F0002 | audit-2026-06-12 | Trim `lead.md` (~30–35%) and `pm.md` (~20–25%): drop sections that restate orchestrator-side enforcement (skill budgets, fanout signal shapes, NFR/AC rules already enforced pre-spawn) | refactor | med | open |
| F0003 | audit-2026-06-12 | Gate review-fanout workers by diff content (`team-comment-analyzer` only when comments change; `team-type-design-analyzer` only when types are added) and fold `team-silent-failure-hunter`'s checklist into `team-code-reviewer` (activates when the diff contains catch/fallback paths) | refactor | med | open |
| F0004 | audit-2026-06-12 | Cut generic-textbook skill references (~30–40 KB): `programming-fundamentals/{complexity,naming,testing}.md`, `queue-fundamentals/operating.md`, slim `database-fundamentals/indexing.md` (keep the EXPLAIN diagnostic in SKILL.md) | chore | low | open |
| F0005 | audit-2026-06-12 | PreToolUse hook to warn when a /dev worker session Reads multiple full `SKILL.md` bodies (skill-load budget is currently advisory only) | feat | low | open |
| F0006 | audit-2026-06-12 | Live-test the new CI ship gate on a repo with a remote + real CI (sandboxes had neither); includes the `gh pr checks` / MCP / subscription fallback order | chore | low | open |


## Closed

Items consumed by a later run. Keep these — they're the audit trail.

<!-- `retro` moves rows here when a later run consumes the item, or when the user marks `wont-do`. -->

| ID | From run | Item | Consumed by | Date consumed |
|----|----------|------|-------------|---------------|

## Conventions

- **ID** — `F` + 4-digit counter, monotonically increasing across all retros. `retro` reads this file to pick the next number.
- **From run** — the `NNNN-type-slug` of the run that surfaced the item.
- **Type hint** — what *kind* of `/dev` run would consume this. Not binding; `pm` can override after interview.
- **Priority** — `low | med | high`. `high` is reserved for known-broken behaviour or security carry-over from `security.md`.
- **Status** — `open | in-progress | consumed-by:<run-id> | wont-do (reason)`.
- Move rows from `Open` to `Closed` when status becomes `consumed-by:…` or `wont-do`.
