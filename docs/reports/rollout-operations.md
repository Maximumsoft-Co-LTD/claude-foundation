# Change Loop rollout operations

## Assurance boundary

Production status is earned only from a
`foundation-production-validation-report-v1` result with status
`production-observed`. Deterministic tests, paid benchmark passes, model final
messages, and a release publication cannot substitute for the required real
consumer count, observation window, rollback rehearsal, and immutable evidence.
These gates control the `production-observed` assurance claim, not whether a
clean deterministic artifact may be tagged, published, bottled, or installed.

Claude Code and OpenCode enforce phase boundaries live. Cursor and Codex retain
runtime terminal truth, stale-proof, and explicit-Land enforcement, but their
shipped adapters do not claim equivalent live mutation hooks. Unattended writes
on those hosts require a separately proven isolated boundary.

## Stages and rollback

The canonical thresholds and stop conditions are in
`.claude/tests/bench/config/rollout-policy.json`:

1. Dogfood: at least one consumer for 24 hours.
2. Pilot: at least three consumers for seven days.
3. General availability: at least ten consumers for fourteen days.

Every stage requires a rollback rehearsal. Roll back on false success,
wrong-side writes, an unbound Land projection, authority bypass, data loss,
unrecoverable journal state, secret exposure, sandbox escape, or an unavailable
measurement represented as zero.

Rollback means stopping new adoption, reinstalling the last immutable release,
and preserving active OpenSpec changes plus `.foundation` state for diagnosis.
Do not edit receipt, proof, or Land journal JSON by hand.

## Diagnose and resume

Run these from the candidate source:

```bash
npm run release:preflight
npm run bench:openspec-native:release-report
npm run release:upgrade-matrix -- --output <durable-path>/upgrade-matrix.json
npm run release:rollout-report -- <privacy-safe-observation.json>
```

For benchmark and rollout reports, exit 2 means a truthful, resumable assurance
blocker; it does not block artifact publication. For `release:preflight`, exit 2
means the candidate is not structurally publishable or is not immutable.
Resolve the named condition and rerun the same command. Exit 1 means malformed
input or a harness execution fault and must be diagnosed before relying on the
report.

For a consumer workflow stop, use the exact recovery command returned by the
runtime. Common routes are `proof advance <change>`, `sandbox sync <change>`,
and an authorized `land recover <change> --decision-ref <reference>`. Never
replace an external review, signed CI result, or acceptance verdict with a
manual pass.

## Privacy-safe observation input

Collect counts and durations only: terminal truth, phase violations, Proof
failures, Land recovery, reviewer/CI waits, resumptions, model requests, cost
availability, and wall time. Do not retain prompts, transcripts, credentials,
secrets, file contents, or product content. Every metric is either a nonnegative
measured number or `{ "value": null, "availability": "unavailable" }`.

Each incident must link its minimal reproduction, failing-then-passing
regression, and scenario disposition. Open P0/P1 incidents block promotion.
Every metric that differs from its content-bound WP-08 baseline must be
classified as product regression, host/provider drift, consumer topology, or a
measurement defect; an unexplained difference blocks the report. Before a
release candidate, manually review language, host, dependency, signing, model
policy, security, and deprecated-protocol coverage. That review does not grant
release or spend authority.
