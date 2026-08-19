---
description: Land and archive a proven OpenSpec change.
argument-hint: <change>
---

Land **$ARGUMENTS** explicitly.

Start from `packet <change> --phase land`; run `land advance` as the
resumable path: it checks, resumes multi-repo Land, and archives when ready. If
its outcome returns `automaticRecovery`, Execute returned steps before
asking; explain the blocker and repair in plain language. For
`control-head-moved`, run `sandbox sync`, `proof advance`, then advance again.
Stop on replay conflict or no automatic route; never paste raw JSON or hashes.

Resolve interrupted apply with authorized `land recover --decision-ref`; manual
recovery also needs `--resolution`. Bind authorized child commits/CI with `land
record`, resume, and re-Prove.

Check `handoff status`; only accepted, proven-safe `post-land` work may remain.
On `WAITING_EXTERNAL`, send its packet and resume after evidence. Store no credentials.

`ALREADY ARCHIVED` succeeds. Explain effects.
Never commit, push, or open a PR without separate authority.
