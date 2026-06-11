# Follow-ups

Items surfaced by past `retro` runs that didn't fit in their original scope. `retro` appends. `pm` reads on every new interview and asks the user whether any open item is now in scope. When a run consumes a follow-up, `retro` marks its status `consumed-by: <run-id>` and leaves the row in place for auditability.

## Open

<!-- First retro appends here. Use F0001 as the first ID. -->

| ID | From run | Item | Type hint | Priority | Status |
|----|----------|------|-----------|----------|--------|
| F0002 | 0002-feat-brew-install | Create a `homebrew-claude-foundation` tap repo (or rename) under `Maximumsoft-Co-LTD` so `brew tap maximumsoft-co-ltd/claude-foundation` resolves without a URL argument (standard short tap form). | chore | med | open |
| F0003 | 0002-feat-brew-install | Fix ship-mode `state.json` write: worker produced malformed JSON (missing comma, duplicate `notes` key, premature `done_at`) in run 0002, requiring manual orchestrator repair. Add a `jq empty` validation gate before the file is written. | fix | high | open |
| F0004 | 0002-feat-brew-install | Harden `install.sh:166-168` self-copy guard: prefix string match is not symlink-resolved on both sides — inert for the brew path but a defensive hardening note for any future `install.sh` revisit. | fix | low | open |
| F0005 | 0002-feat-brew-install | Expose `install-cursor.sh` via Homebrew: formula bundles it in libexec but only exposes `claude-foundation` (wrapping `install.sh`). Future run could expose `claude-foundation-cursor` or a `--cursor` flag. | feat | low | open |


## Closed

Items consumed by a later run. Keep these — they're the audit trail.

<!-- `retro` moves rows here when a later run consumes the item, or when the user marks `wont-do`. -->

| ID | From run | Item | Consumed by | Date consumed |
|----|----------|------|-------------|---------------|
| F0001 | 0002-feat-brew-install | Cut a tagged GitHub release + add `url`/`sha256` to the formula (versioned upgrades, supply-chain pin). **Done.** Branch protection on `main` was documented in `RELEASING.md` but left **disabled** by choice. The short `brew install` form remains F0002 (needs a separate tap repo). | v1.3.0 release (PR #5, direct fix) | 2026-06-11 |

## Conventions

- **ID** — `F` + 4-digit counter, monotonically increasing across all retros. `retro` reads this file to pick the next number.
- **From run** — the `NNNN-type-slug` of the run that surfaced the item.
- **Type hint** — what *kind* of `/dev` run would consume this. Not binding; `pm` can override after interview.
- **Priority** — `low | med | high`. `high` is reserved for known-broken behaviour or security carry-over from `security.md`.
- **Status** — `open | in-progress | consumed-by:<run-id> | wont-do (reason)`.
- Move rows from `Open` to `Closed` when status becomes `consumed-by:…` or `wont-do`.
