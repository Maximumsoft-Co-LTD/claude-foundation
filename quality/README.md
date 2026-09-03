# Code quality controls

This directory owns the enforced changed-code CRAP Score and mutation-testing
policy for the complete repository. It is intentionally separate from Foundation's
consumer-facing runtime configuration.

For quality gates installed into consumer projects, use
`claude-foundation quality …` and see
[`docs/consumer-quality.md`](../docs/consumer-quality.md). The files, protocols,
baselines, output paths, and rollout policy are separate; do not copy this
repository's internal thresholds into a consumer config blindly.

## Commands

```bash
npm run test:quality
npm run quality:config
npm run quality:static
npm run quality:exceptions
npm run quality:coverage:dashboard
npm run quality:coverage:runtime
npm run quality:coverage:examples
npm run quality:coverage:website
npm run quality:complexity
npm run quality:crap
npm run quality:report:validate
npm run quality:base -- --base-ref <ref>
npm run quality:changed
npm run quality:mutation:changed
npm run quality:mutation:runtime
npm run quality:mutation:examples
npm run quality:mutation:website
npm run quality:trend
npm run quality:summary
npm run quality:debt
npm run quality:enforce
npm run test:mutation:dashboard
npm run test:mutation:runtime
npm run test:mutation:examples
npm run test:mutation:website
npm run test:mutation:semantic
```

`quality:report:dashboard` composes the fast dashboard report. Runtime coverage
executes the complete deterministic harness and belongs in scheduled CI.
Semantic draft compilation, transactional amendment, and protocol-v3 `advance`
belong to that runtime surface. Website Markdown and both root READMEs belong to
the documentation surfaces, so changed-file selection cannot skip them merely
because they are documentation rather than executable JavaScript.

## Result locations

Generated evidence is ignored under:

```text
.foundation/test-results/quality/
```

The main outputs are `crap.json`, `changed-quality.json`, `summary.md`,
`debt.json`, `debt.md`, `trend.json`, automated mutation reports and
`mutation-semantic.json`.

## Enforcement state

The policy is `enforce` for changed functions and mutation regressions. Existing
project debt remains inventory and does not block unrelated changes. Coverage
lanes synthesize 0% for production files that a completed collector did not
load; paths belonging to a collector that did not run remain explicitly
unavailable. Merge-base reports distinguish new functions, existing regressions
and untouched debt. Versioned mutation baselines ratchet dashboard, selected
runtime, example and website scopes without demanding a blind 100% score.
Because Stryker's command runner cannot identify uncovered mutants by itself,
each shard runs the same test command under c8 and normalizes unexecuted
survivors to `NoCoverage` before comparison.

Required semantic mutation remains blocking independently of aggregate CRAP or
automated mutation score. All catalog entries emit mutation-v2 evidence; a
crash, timeout, compile failure, non-applying fault, missing ID, failed restore,
or wrong critical killer is not a pass.

See `docs/reports/project-wide-crap-and-mutation-testing-plan.md` for scope,
rollout, exceptions, ownership and Definition of Done.
