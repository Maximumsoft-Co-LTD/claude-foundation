# Foundation change loop

Foundation is an OpenSpec-native software-change harness. The main agent owns one
short loop:

```text
Investigate? → Change → Build → Prove → Land
```

There are no lifecycle subagents or fixed phases. OpenSpec owns durable intent,
the native agent owns implementation, and `.claude/harness/foundation.mjs` owns
deterministic state, evidence validity, budgets, and land guards.

## Sources of truth

- `openspec/changes/<id>/`: proposal, delta specs, design, tasks, evidence claims.
- `execution.yaml`: replaceable provider, service, report, and readiness wiring.
- Code and tests: implementation truth.
- `.foundation/runtime/<id>.json`: machine lifecycle and resolver output.
- `.foundation/receipts/<id>/`: content-bound evidence.
- `tasks.md`: the only task ledger. Never mirror each checkbox into native tasks.

Do not create `.workflow/` state for new work. Existing `.workflow/` runs are
read-only legacy records and may be migrated with `foundation migrate`.

Use the `claude-foundation` CLI as the stable control surface. If it is not on
`PATH` in a project installed directly from source, invoke the matching internal
command with `node .claude/harness/foundation.mjs`; do not change its semantics.

## Resolve

Resolve five independent values before building:

- ambiguity: `clear|unclear` — unclear work uses `/investigate`;
- impact: `low|medium|high`;
- coupling: `isolated|coupled`;
- evidence capabilities required by observable claims;
- size: budget and slicing only, never phases.

Use `claude-foundation runtime resolve <change> ...` to persist the decision. Choose
`foundation-rapid` only when impact is low, coupling is isolated, unit/static
evidence is sufficient, and there is no public contract, persistent migration,
security boundary, irreversible effect, or sensitive data.

Provider selection is claim- and risk-driven, not a checklist. Use
`claude-foundation providers` to inspect the canonical catalog. Add `static-analysis`
for compile/type/lint gates; `data-migration` for persisted evolution;
`accessibility` for user-facing rendered interaction; `resilience` for failure
and recovery behavior; `observability` for operational signals; `deployment`
for rollout/rollback; and `dependency-supply-chain` when dependency or release
integrity changes. Do not select providers unrelated to an observable claim.

Security is semantic. Trigger it for identity/access, secrets, permissions,
cross-user access, network trust, irreversible mutation, sensitive storage,
unsafe sinks, public security contracts, or security-relevant migrations.
Generic syntax such as JSON parsing, DOM use, or HTTP use is not a trigger alone.

## Build

Give the native harness only the goal, change path, delta specs, design
constraints, tasks, evidence obligations, sandbox descriptor, and budget.
Implementation order and tool choice belong to the harness.

- Read only relevant repository context.
- Update `tasks.md` checkboxes as work completes.
- Use native tasks/subagents only for independently verifiable work packages,
  genuine parallelism, resumption, or cross-repository work.
- Prefer focused checks while editing. Do not repeat the full suite at phase
  boundaries; there are no phase boundaries.
- Keep the orchestrator on control-plane decisions. Batch independent reads and
  provider claims, and pass a compact change packet to implementation or review
  work instead of replaying the full conversation.
- Never weaken an evidence obligation to fit a budget.

For medium/large coupled work, slice by coherent behavior. Each slice follows
Build → Prove; finish with one integration proof.

If intent changes during Build, pause implementation, investigate if needed,
revise the same OpenSpec change, then run `claude-foundation sandbox sync <id>`.
Stable task IDs preserve completion. Contract and execution revisions are
tracked separately; wiring changes invalidate affected provider fingerprints
without pretending behavior changed.

## Prove

`/prove` is evidence-driven:

1. validate the OpenSpec change;
2. create one relevant workspace snapshot;
3. resolve claims to providers;
4. reuse receipts only when their hash, provider protocol/version/fingerprint,
   and claim scope match;
5. batch missing or stale claims by provider and run each suite once;
6. verify test discovery;
7. run the required full suite once after convergence;
8. perform independent review only when risk triggers it;
9. re-run evidence invalidated by a proof-time edit;
10. run `proof preflight`, `proof execute`, and `proof audit`; reports, logs,
    and attachments are copied into the immutable evidence vault.

Provider results are `pass|fail|inconclusive|error`. Required `inconclusive`
evidence blocks landing. A mutation crash is not a behavioral kill. Required
rendered behavior cannot pass through a provider lacking the declared input and
foreground capabilities.

Review triggers: high impact, auth/access, public compatibility, migration,
irreversible mutation, concurrency, monetary logic, multi-repo contracts,
evidence anomaly, or explicit policy. Findings are
`verified|hypothesis|disproved|accepted-risk`; only deterministic verified
blockers and missing evidence block land.

## Budget

The native runtime records command duration and result. External runtimes submit
request identity, tool/provider calls, tokens, cache, and cost as events; absent
external measurements remain unknown, never zero. At 70% batch and reuse; at 85% stop
speculative expansion; at 100% stop and split or re-scope. Required proof remains.

## Land

Landing is explicit and transactional:

1. `claude-foundation land check <change>` rejects stale, incomplete, or
   digest-invalid proof;
2. `claude-foundation land archive <change>` applies only the proven sandbox
   diff when needed;
3. the same transaction verifies the applied workspace hash;
4. the same transaction uses OpenSpec archive/spec sync;
5. audit archived receipts and artifact digests;
6. record commit/PR only when explicitly authorized;
7. finalize metrics and clean the sandbox through the resumable Land journal.

Never archive before code application, never apply a diff whose proof hash
changed, and never overwrite unrelated user changes.

## Compatibility

`/dev <intent>` composes `/change → /build → /prove`. It does not land, commit,
or open a PR. `--plan-only` maps to `/change`; `--resume <id>` resumes the named
OpenSpec change. Legacy active runs are routed through `/migrate-workflow`.
