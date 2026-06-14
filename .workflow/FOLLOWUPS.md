# Follow-ups

Items surfaced by past `retro` runs that didn't fit in their original scope. `retro` appends. `pm` reads on every new interview and asks the user whether any open item is now in scope. When a run consumes a follow-up, `retro` marks its status `consumed-by: <run-id>` and leaves the row in place for auditability.

## Open

<!-- First retro appends here. Use a run-namespaced ID `F-<run-id>-01` (run folder + per-run counter). -->

| ID | From run | Item | Type hint | Priority | Status |
|----|----------|------|-----------|----------|--------|
| F0001 | manual (surface-fanout) | Surface (per-repo) fanout parallelises only review, security, and test for control-plane multi-repo runs; branch creation, implement, gate, and ship still operate on the single primary `repo_root`. Make these phases multi-repo-aware (per-repo branch/checkout, multi-repo implement, multi-repo ship/PR) so a cross-repo run is coherent end-to-end, not just at review/security/test. | feat | med | open |

## Closed

Items consumed by a later run. Keep these — they're the audit trail.

<!-- `retro` moves rows here when a later run consumes the item, or when the user marks `wont-do`. -->

| ID | From run | Item | Consumed by | Date consumed |
|----|----------|------|-------------|---------------|

## Conventions

- **ID** — run-namespaced `F-<run-id>-NN` (`<run-id>` is the surfacing run's folder name, `NN` a per-run counter from `01`) — collision-proof under parallel runs. `retro` mints these; it never picks "the next number after the highest existing ID" (which races when two runs claim the same number). Legacy global `F0001`-style IDs already in the file keep their form — a mixed ID space is expected; history is not renumbered.
- **From run** — the `NNNN-type-slug` of the run that surfaced the item.
- **Type hint** — what *kind* of `/dev` run would consume this. Not binding; `pm` can override after interview.
- **Priority** — `low | med | high`. `high` is reserved for known-broken behaviour or security carry-over from `security.md`.
- **Status** — `open | in-progress | consumed-by:<run-id> | wont-do (reason)`.
- Move rows from `Open` to `Closed` when status becomes `consumed-by:…` or `wont-do`.
