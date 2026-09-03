# User scenario release status

Last verified: 2026-09-03

## Summary

The backend simplification is implemented. Public command names, arguments,
and phase order are unchanged. Change, Build, Prove, and Land now follow one
convergent contract:

1. Evaluate the gate once and collect all independent findings.
2. Turn in-contract findings into one dependency-ordered repair plan.
3. Repair the batch and rerun only invalidated checks.
4. Continue while the subject or repair strategy makes progress; there is no
   fixed product-repair limit.
5. Preserve the change and give an exact resume route only at a real authority,
   resource, conflict, budget, or repeated no-progress boundary.

Success for a code-delivery scenario means `archived`, not merely `proven`.
The hidden task oracle runs before Land, so an incorrect implementation cannot
be archived by a passing Change Loop proof alone.

## What changed

| Concern | New backend behavior | Primary source |
|---|---|---|
| Policy | Compile risk, authority, evidence, workspace, budget, and Land requirements once | `.claude/harness/runtime/core/execution-contract.mjs` |
| Lifecycle | Apply transitions through one reducer and derive runtime/proof/journal views | `.claude/harness/runtime/core/lifecycle-reducer.mjs`, `state-projections.mjs` |
| Gates | Aggregate findings, plan batch repairs, fingerprint progress, and resume without a repair-count cap | `.claude/harness/runtime/core/convergent-gate.mjs` |
| Authority | Stop before agent dispatch when signed CI, external review, or another real decision is unavailable | `.claude/harness/runtime/core/authority-policy.mjs` |
| Evidence | Use typed outcomes, signed semantic acceptance, stable cases/partitions, and automatic npm lockfile evidence | `.claude/harness/runtime/evidence/` |
| Isolation | Fail closed for unsafe or ambiguous writes while honoring declared host capability | `.claude/hooks/phase-mutation-guard.mjs` |
| Land | Require current proof, pre-Land oracle success, recoverable archive checkpoints, and truthful measured telemetry | `.claude/harness/runtime/workflow/land-runtime.mjs`, `apply-runtime.mjs` |
| Release evidence | Freeze seven fixtures, bind results to commit + patch digest, and separate paid runs from zero-model revalidation | `.claude/tests/bench/openspec-native/` |

User-facing behavior and recovery are documented in `README.md`,
`README.th.md`, and `WORKFLOW.md`. Release and rollout operations are documented
in `RELEASING.md` and `docs/reports/rollout-operations.md`.

## Verified state

| Check | Result |
|---|---|
| Authoritative repository suite | PASS — 197/197 registered suites |
| Documentation consistency | PASS — 98/98 assertions |
| Public documentation build | PASS — 37 static pages, English and Thai |
| Frozen deterministic scenario sentinel | PASS — 7/7 scenarios |
| Public command compatibility | PASS — 8 host commands and 72 CLI commands pinned |
| Candidate paid evidence | NONE — the clean candidate has 0/18 required runs |
| Previous dirty-source smoke | Historical only — `bare-node-boundary` reached `archived`, oracle 6/6, but cannot satisfy the clean candidate |
| Assurance report | BLOCKED — all six paid scenarios report `authorized-paid-smoke-missing` |
| Artifact publication | ALLOWED after clean structural, deterministic, and package checks |

The earlier strict smoke and interrupted `bare-node-current-repeat2-20260903`
execution do not count for the clean candidate. The strict smoke belongs to a
different dirty source identity; the interrupted execution has no manifest.

## Remaining assurance work

The implementation and deterministic safety slice are complete. Publishing a
versioned artifact does not require the paid portfolio or rollout observations.
Production assurance still requires:

- three independent passes for each of the six paid scenarios;
- 18 paid executions in total from the clean candidate cohort;
- a retained aggregate report from one immutable source cohort;
- dogfood and pilot observation required by the rollout policy.

Deterministic tests, historical runs, zero-model revalidation, and a published
artifact do not substitute for assurance. A benchmark or rollout report exit
code of 2 is a truthful assurance blocker, not a publication blocker or test
failure.

## Reproduce the evidence

```bash
bash .claude/tests/run-all.sh
npm run bench:openspec-native:sentinel
node .claude/tests/bench/openspec-native/lab.mjs \
  --scenario bare-node-boundary
npm run bench:openspec-native:release-report -- \
  .claude/tests/bench/results/openspec-native-lab
npm run release:preflight
```

Paid runs require explicit spend authority. The lab creates a disposable
consumer, installs the current source, executes through Land, verifies delivery
from a clean install, preserves a content-bound evidence bundle, and removes the
consumer unless `--keep-project` is explicitly supplied.

## Commit boundary

Before committing this change:

- rerun the authoritative suite and documentation consistency check;
- review the diff by runtime, tests, documentation, and release automation;
- keep ignored benchmark output and temporary consumers out of Git; and
- do not label the commit or release as `production-observed` without the
  required assurance report.

The clean commit creates a new source identity. Paid evidence collected from a
dirty patch remains useful development evidence, but assurance sign-off must be
generated from one immutable source identity.
