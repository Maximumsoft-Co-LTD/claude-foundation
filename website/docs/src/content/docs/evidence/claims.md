---
title: Claims and capabilities
description: How an observable scenario becomes a stable claim, and which of the 19 capabilities can actually demonstrate it.
---

Foundation's central rule: **a passing command is not automatically proof.**

Every observable acceptance scenario gets a stable claim ID. Each claim declares the capabilities that could actually demonstrate it. Missing, stale, failed, erroneous, or inconclusive evidence blocks landing.

## The behavioral contract

`evidence.yaml` holds the stable part. It changes only when observable claims or obligations change:

```json
{
  "version": 2,
  "claims": [
    {
      "id": "profile-update",
      "scenario": "The owner can update their profile",
      "impact": "medium",
      "capabilities": ["test", "browser", "accessibility"]
    }
  ]
}
```

Executable wiring lives separately, in [`execution.yaml`](/docs/evidence/adapters/). That split is deliberate: Build routinely discovers that the real command is `npm run test:unit` rather than `npm test`, and rewiring that should not look like changing what the software promises.

:::tip
`discovery` is an implicit suite-level obligation whenever `test` is selected. Do not repeat it on every claim.
:::

## The capability catalog

Select only what the claim needs — never the full catalog by default.

| Capability | What it asserts |
|---|---|
| `test` | Executable behavioral checks for the declared claim |
| `discovery` | Expected tests were found and the discovered count meets the floor |
| `browser` | Rendered behavior in a real browser with the required input capability |
| `mutation` | A deliberate behavioral fault is detected by the evidence suite |
| `state-identity` | State before, during, or after belongs to the intended actor and revision |
| `integration` | Multiple components or external boundaries work together |
| `compatibility` | Public or persisted contracts remain compatible across supported versions |
| `performance` | Measured latency, throughput, resource, or size budgets are met |
| `security-static` | Static security checks cover the changed trust boundary and unsafe sinks |
| `cross-repo-contract` | Producer and consumer repositories agree on the same versioned contract |
| `review` | Independent risk review covers the declared claims and unresolved findings |
| `acceptance` | A named human accepts an explicitly subjective product or experience decision |
| `static-analysis` | Compilation, type checking, linting, and static quality gates pass |
| `data-migration` | Schema or data evolution is forward-safe, backward-compatible, rollback-aware |
| `accessibility` | Rendered semantics, keyboard use, focus, contrast, assistive access meet policy |
| `resilience` | Timeout, retry, partial-failure, recovery, degraded-dependency behavior is proven |
| `observability` | Required logs, metrics, traces, and alerts expose success and failure safely |
| `deployment` | Packaging, configuration, rollout health checks, and rollback behavior are proven |
| `dependency-supply-chain` | Dependency vulnerability, license, lockfile, and provenance policy passes |

Nineteen capabilities. Most changes use two or three.

## Receipts

A receipt is what a capability produces. It binds to everything that could invalidate it:

```text
provider      browser
adapter       playwright · protocol 7
execution     harness
claims        profile-view, profile-update
workspace     sha256:7f31…
environment   node 22 · darwin-arm64
input         browser-automation
artifacts     trace.zip · screenshot.png
duration      8.42s
```

Change a bound input and the receipt becomes stale. Foundation never silently reuses mismatched evidence.

`execution: harness` is set only by a call site that actually ran a command. See [`/prove`](/docs/loop/prove/) for the full floor on hand-recorded evidence.

## Test and discovery

The configured structured JSON report must expose a non-negative integer such as `numTotalTests`, `totalTests`, `testCount`, or `expected`.

If the command passes but no deterministic count is available, test evidence may pass while discovery is `inconclusive` — and landing stays blocked. Arrays, numeric strings, arbitrary nested keys, and mixed stdout are **not** coerced into a count. A suite that silently discovered zero tests is exactly the failure this catches.

## Traceability

```bash
claude-foundation change audit <change>
```

Audits scenario → claim → task → provider traceability. Every observable scenario should reach a claim, and every claim a provider that can demonstrate it. A scenario with no claim is a promise nobody is checking.
