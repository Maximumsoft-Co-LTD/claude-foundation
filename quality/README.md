# Release mutation gate

This directory holds the repository-internal policy and baseline for the
automated dashboard mutation gate that `.github/workflows/release.yml` runs
before publishing. It is separate from Foundation's consumer-facing quality
feature; for gates installed into consumer projects, use
`claude-foundation quality …` and see
[`docs/consumer-quality.md`](../docs/consumer-quality.md).

## Commands

```bash
npm run test:mutation:dashboard
npm run quality:mutation:coverage:dashboard
npm run quality:mutation:normalize:dashboard
npm run quality:mutation:changed
```

Stryker's command runner cannot identify uncovered mutants by itself, so the
coverage step runs the same tests under c8 and the normalize step rewrites
unexecuted survivors to `NoCoverage`. `quality:mutation:changed` then compares
the normalized report with `baselines/dashboard-mutation-v1.json` under
`policy.json` and fails on a score regression, new `NoCoverage` mutants, or a
baseline snapshot mismatch. Reports are written under
`.foundation/test-results/quality/` (ignored).

Semantic mutation of shipped boundaries is not run here: the registered suites
in `.claude/tests/run-all.sh` own it, including
`scripts/quality/run-shipping-semantic-mutation.mjs`.
