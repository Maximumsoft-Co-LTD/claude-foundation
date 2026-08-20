---
description: Land and archive a proven OpenSpec change.
argument-hint: <change>
---

Land **$ARGUMENTS** explicitly.

Never edit product or packet files during Land; new work belongs in
`handoffs.yaml` or another change.

From `packet <change> --phase land`, run resumable `land advance`: it checks,
resumes multi-repo Land, archives when ready. On `automaticRecovery`,
Execute returned steps before asking; explain blockers in plain language. For
`control-head-moved`, run `sandbox sync`, `proof advance`, then advance again.
Stop on replay conflict or no automatic route; never paste raw JSON/hashes.

Resolve interrupted apply with authorized `land recover --decision-ref`;
manual recovery adds `--resolution`. Bind authorized child commits/CI with
`land record`, resume, and re-Prove.

Check `handoff status`; only accepted, proven-safe `post-land` work
remains. On `WAITING_EXTERNAL`, send its packet and resume after evidence.
Store no credentials.

`ALREADY ARCHIVED` succeeds. Explain effects.
Never commit, push, or open a PR without separate authority.
