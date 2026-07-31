# Change: Reduce workflow latency and harden proof integrity

## Why

The R5 todo benchmark completed with strong application evidence, but the
control plane consumed 125 model requests and repeatedly re-entered validation,
preflight, proof execution, and external receipt recording. Compact packets did
not create fresh phase contexts, the public CLI did not reliably route to the
project runtime, unrelated edits invalidated supply-chain evidence, and
Playwright-derived accessibility receipts could claim scenarios outside their
declared capability. External receipts could also report `pass` without a
reviewable observation or artifact.

The normal path must become materially faster while retaining or strengthening
browser, mutation, accessibility, review, and audit assurance.

## What changes

- Make the public CLI reliably route nested commands to the installed project
  runtime and expose one atomic `proof run` command plus a non-executing proof
  readiness gate.
- Reject empty or capability-overclaiming external receipts, canonicalize
  workspace paths, and make provider reuse depend on declared provider inputs
  while preserving a final shared proof snapshot.
- Record phase context mode and recommended versus actual model tier so hosts
  can prove that compact handoffs entered fresh contexts rather than merely
  appending packets to a growing session.
- Move review/convergence ahead of the frozen proof snapshot and return
  structured next actions when external evidence or code changes are required.
- Reduce project boilerplate through Node TAP discovery, capability-scoped
  Playwright outputs, a standard mutation result protocol, and deterministic
  change scaffolding.
- Extend metrics with active time, human wait, rework classification, context
  growth, and provider reuse/invalidation reasons.

## Impact

- **Impact:** high
- **Coupling:** coupled
- **Affected surfaces:** public CLI, proof/receipt protocols, workspace
  snapshots, provider adapters, telemetry, installer, documentation, tests
- **Security triggers:** evidence integrity and unsafe proof overclaim

## Non-goals

- Removing required evidence, weakening mutation classification, or allowing a
  stale proof to Land.
- Installing application dependencies on behalf of a project.
- Making model routing mandatory on hosts that cannot select a model.
- Treating the one-off todo benchmark as sufficient statistical evidence;
  rollout still requires repeated measurements.
