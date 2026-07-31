---
description: Land and archive a proven OpenSpec change.
argument-hint: <change>
---

Land **$ARGUMENTS** explicitly.

Run `claude-foundation land check`. For multi-repo work inspect `land plan`,
bind only authorized child commits/CI with `land record`, then `land pointers`.
Pointer changes require a fresh Prove; use `land resume`.

Run `claude-foundation land archive` only when ready. Its journal applies the proven projection,
preserves unrelated edits, syncs specs, audits evidence, and cleans isolation.
`ALREADY ARCHIVED` is success.

Never commit, push, or open a PR without separate authority.
