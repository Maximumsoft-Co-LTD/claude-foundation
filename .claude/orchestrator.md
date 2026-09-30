# Foundation change loop

```text
Investigate? → Change → Build → Prove → Land
```

OpenSpec owns the agreement, code owns truth, and Harness owns lifecycle
controls. `tasks.md` is the ledger;
`handoffs.yaml` is the external-operation contract. `.workflow/` is read-only
legacy state.

Shared agent rules live only in `.claude/harness/AGENT.md`; each phase's
procedure lives only in its command (`commands/change.md`, `commands/build.md`,
`commands/prove.md`, `commands/land.md`). Do not duplicate runtime logic in prompts.

## Resolve

Follow `commands/change.md` and compile one v4 draft. Never hand-create
cross-ledger IDs or empty artifacts. Persist ambiguity, impact, coupling, evidence,
and size; size controls slicing, not assurance. Investigate ambiguity.

Rapid schema requires low impact, isolated coupling, unit/static evidence, and no
public contract, migration, trust boundary, irreversible effect, or sensitive data.

## Build

Approve before Build.

Start from the compact packet. Read needed files and edit only the
sandbox's allowed paths; `advance` ticks `tasks.md` when verification passes.

Follow `commands/build.md`. Plans, packets, leases, and dispatch are compatible primitives, not a model-built chain.

Worktrees isolate files, not processes or host authority. Unattended work must
pass the runtime guard; never enable a host permission bypass by implication.

Classify follow-ups with `commands/references/build-policy.md` before editing.
The agent authors required amendments; Harness validates and revises. Repository
scope changes require explicit topology; never expose an unsandboxed repository.

Unauthorized external work enters `handoffs.yaml` only through a semantic
amendment, never unchecked tasks; unresolved operations return the owner and
resume route.

## Prove

Use `advance <change> --through proven`; it owns validation, receipt reuse,
provider execution, authority routing, and proof finalization. Low-level proof
commands are diagnostics/integration paths.

Validate the active change, snapshot relevant workspaces once, resolve claims to
providers, reuse only fingerprint/hash-valid receipts, and execute missing
evidence by a safe DAG. Required failed, missing, stale, error, or inconclusive
evidence blocks a `PROVEN` result; explicit `/land` records the assurance and
may still apply the current workspace. External waits never cause provider reruns.

Review independently when risk policy requires it. Findings are
`verified|hypothesis|disproved|accepted-risk`; only deterministic verified
blockers and missing evidence block.

Proof artifacts and receipts are immutable and content-bound. Proof-time edits
invalidate affected evidence. A mutation crash is not a behavioral kill, and a
rendered claim cannot pass through an incapable provider.

## Phase boundaries

A phase boundary is a context boundary: each phase inherits only its packet.
`metrics` reports inheritance under `context.carryover`.

## Budget

When `execution.budgetWatchdog` is true: count input, output, and cache writes; unknown is never zero. At 70%, batch and
reuse. At 85%, allow focused fixes and proof only: no scope expansion.
At 100%, the harness auto-opens a new same-size window every time; budget is
advisory and never asks the user. Never silently reduce acceptance criteria
or move unfinished work out of the contract.

## Land

Land moves the current workspace projection into its main workspace.
`/land` follows `commands/land.md`; Harness owns readiness, Apply,
verification, archive, recovery, and cleanup. Record stale or failed proof truthfully,
preserve unrelated edits, and never commit, push, or open a PR without separate authority.

Multiple repositories use one saga: prepare all writable targets, apply
dependency waves, verify unchanged HEAD/index, then archive. Diffs remain
uncommitted; never manufacture child commits or gitlink SHAs.

`/dev` runs the four phase commands in order without inferring Land
authority; with Land authority it succeeds only at `archived`.

## Deliver (optional)

After `archived`, `/deliver <change>` grants separate optional authority. Harness
owns isolation, proven-path staging, commit, non-default feature push, PR rendering,
provider read-back, retry, and checkpoints. The agent may compose only from archived
sources and asks only for authority or content-identity decisions. Never force-push,
merge, deploy, publish, expose credentials, or edit product code. No invocation means
no delivery work; `DONE` requires provider-verified PR URLs.

## Human interaction boundary

Match the user's language. Lead with outcome, work done, verification, remaining
work, and next action; omit empty sections. Do not paste runtime protocol or ask
the user to run a safe authorized operation the agent can run. Hook
resumeAction values follow the same control-data rule; expose them only for
requested diagnosis. A `WAIT` is not a user command. Keep hashes, receipts, provider codes, and task IDs internal.

On any structured `decision`, read
`.claude/commands/references/decision-policy.md` completely. Execute only its
named deterministic recovery automatically; otherwise wait for the user's
explicit answer. Never infer approval from silence. The agent owns requests, responses,
flags, and provenance; users never assemble harness commands or JSON.
