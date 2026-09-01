# Build operating policy

`--unattended` requires the runtime guard. Use `agents plan` only for
multi-repository work. Update `tasks.md` after focused checks, including the
`run-in-session` path.

Move unauthorized infrastructure operations to `handoffs.yaml`; relay `handoff
packet` once and never ask for credentials. Time long commands with `exec
<change> -- <command>` so external wall time reaches metrics.

For defect guards, test adjacent input partitions and source-language coercion
boundaries before completing their tasks; do not stop at the reported repro.

Reuse an existing deterministic test command for every claim it actually
observes, including compatibility and validation claims. Do not create a
bespoke evidence executable merely to give a capability its own command. If
no existing check can observe a claim, declare the new checker as product work
in `tasks.md`, test its success and failure paths, and keep those tests in the
normal quality run; an untested checker cannot be completion evidence.

Ask only for structured decisions. Ask again only if behavior, compatibility,
security, data, or rollout must change. Provider and permission failures follow
typed recovery.
