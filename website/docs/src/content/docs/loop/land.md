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
verifies target identity, archives through OpenSpec, and cleans up. Completion
means runtime status `archived`; `proven` is not completion.

Only the harness-owned recoverable Land transaction may apply product files and
synchronize the agreement; the agent does not edit them ad hoc. Land never
implies permission to commit, push, publish, or open a pull request. Those are separate authorities. A moved
base, projection conflict, interrupted transaction, missing permission, child
repository delivery, or pending pre-Land handoff stops with `WAIT`, `REPAIR`,
`RUN_EXTERNAL`, or `ASK_USER`. The result names the cause, responsible actor,
safe alternatives, state retained, and exact resume route.

Safe automatic recovery runs within current authority. Manual transaction
recovery, external delivery records, and multi-repository resume remain
available as advanced `land`/`handoff` primitives under `help --all`. An already
archived change returns `DONE` successfully.

Metrics preserve unknowns: when the host cannot report usage, cost stays `null`
rather than becoming a misleading zero.
