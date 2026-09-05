---
title: /land
description: Explicitly apply, verify, archive, and clean up a proven change.
---

```text
/land <change>
```

This slash command is the explicit Land authority boundary. It runs:

```bash
claude-foundation advance <change> --through archived
```

The coordinator checks proof freshness and external-operation disposition,
prepares the recoverable apply transaction, applies the proven projection,
verifies target identity, archives through OpenSpec, and cleans up. Every
writable repository receives an uncommitted diff while its HEAD and index stay
unchanged. Completion
means runtime status `archived`; `proven` is not completion.

Only the harness-owned recoverable Land transaction may apply product files and
synchronize the agreement; the agent does not edit them ad hoc. Land never
implies permission to commit, push, publish, or open a pull request. While Land
is active, the phase guard rejects those mutating shell commands unless they are
children of the marked runtime transaction. After archive, delivery uses the
project's normal process under separate authority. A moved
base, projection conflict, interrupted transaction, unavailable external owner, child
repository delivery, or pending pre-Land handoff stops with `WAIT`, `REPAIR`,
`RUN_EXTERNAL`, or `ASK_USER`. The result names the cause, responsible actor,
safe alternatives, state retained, and exact resume route.

Safe automatic recovery—including host-permission integration and journal
resume—runs within current authority. External delivery records and legacy
transaction diagnostics remain available as advanced primitives under
`help --all`; they are not user workflow steps. An already
archived change returns `DONE` successfully.

Metrics preserve unknowns: when the host cannot report usage, cost stays `null`
rather than becoming a misleading zero.
