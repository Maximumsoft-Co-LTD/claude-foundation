# Consumer Quality: CRAP Score and Mutation Testing

Foundation can run project-owned quality tools across one or many consumer repositories. It starts in report-only mode and never grants permission to edit code outside the approved Change/spec.

Thai version: [consumer-quality.th.md](consumer-quality.th.md)

## Guarantees

- CRAP combines cyclomatic complexity with function coverage; Foundation recomputes the score itself.
- Automated mutation counts only behavioral kills. Timeout, crash, compile/runtime error, no coverage, skipped, and unavailable are not kills.
- Semantic mutation targets domain-specific faults such as a removed tenant filter or skipped transaction.
- Repository lanes keep separate commit, workspace, tool/config, baseline, and assurance identity. Scores are never averaged across repositories.
- Unrelated legacy debt is inventoried without blocking the current changed surface.
- Unsupported, unavailable, and unmapped evidence never becomes zero or pass.
- A quality finding is evidence, not scope authority. Out-of-spec edits fail the scope lane.

CRAP is calculated as:

```text
CRAP = complexity² × (1 − coverage/100)³ + complexity
```

Default changed-code gates require unit coverage of 80%, integration coverage of 70%, and critical-journey coverage of 50%. New functions fail at CRAP 30 or above, existing functions fail on CRAP regression, and changed complexity above 30 fails.

## Onboard a repository

Discovery reads manifests and filenames without executing project commands:

```bash
claude-foundation quality discover
claude-foundation quality init
claude-foundation quality init --write --ci github
claude-foundation quality doctor
```

`quality init` is preview-only until `--write`. It creates `quality/foundation-quality.json`. `--ci github` additionally copies reusable/manual changed-code, four-shard nightly, and full-release workflow templates. The changed-code template must be called by the repository's existing PR workflow; it does not register a `pull_request` trigger itself.

For JavaScript/TypeScript, discovery recognizes the project-owned package scripts `foundation:quality:crap` and `quality:crap`. The command must emit `foundation-crap-v1` at `.foundation/quality/crap.json`; without either script or an explicit provider, CRAP is not measured.

Run against the isolated workspace selected by a Change:

```bash
claude-foundation quality run --change <change-id>
claude-foundation quality report
claude-foundation quality run --change <change-id> --enforce
```

Once the config is committed, evidence bootstrap can wire the enforced run as `static-analysis` evidence. Results are written under `.foundation/quality/results/` and must not be committed.

## Profiles

| Surface | Profile | Controls |
|---|---|---|
| JavaScript / TypeScript | `application-js-ts` | tests, static, Istanbul + complexity, automated/semantic mutation |
| Go | `application-go` | tests, vet, gocyclo + cover, mutation, compatibility, resilience |
| Python | `application-python` | pytest, static, Radon + coverage.py, mutation |
| PHP | `application-php` | Composer/PHPUnit, Clover, mutation |
| Bash | `script-bash` | tests, static, state identity, semantic faults |
| SQL | `database-sql` | isolated integration, compatibility, migration, performance, semantic faults |
| MongoDB | `database-mongodb` | isolated data, schema/query/migration faults |
| HTML | `web-markup` | validation, browser, accessibility |
| CSS / Sass | `web-style` | lint/build, browser, accessibility, responsive evidence |

Foundation does not invent CRAP values for Bash, SQL, MongoDB, HTML, CSS, or Sass. Those surfaces use controls that match their behavior.

## Providers and adapters

The consumer project owns every executable and version. Providers are either:

1. `command`: emit `foundation-crap-v1` or `foundation-automated-mutation-v1` JSON via stdout or `output`;
2. `builtin`: run a project command and normalize its native reports.

Built-in normalizers are `javascript-istanbul`, `go-complexity-cover`, `python-radon-coverage`, `php-clover`, `canonical-functions`, and `generic-mutation-json`.

Reports bind `repository`, `repositoryCommit`, `workspaceDigest`, `language`, and tool `name/version/adapterVersion/configDigest`. Paths are repository-relative. The schemas live in `.claude/harness/runtime/contracts/`.

Example provider:

```json
{
  "kind": "builtin",
  "adapter": "python-radon-coverage",
  "language": "python",
  "command": ["./scripts/generate-python-quality-reports"],
  "inputs": {
    "complexity": ".foundation/quality/radon.json",
    "coverage": ".foundation/quality/coverage.json"
  },
  "tool": { "name": "radon+coverage", "version": "pinned-by-project" },
  "isolation": "read-only"
}
```

## Baselines, debt, and exceptions

After at least three representative pilot runs, review the findings before explicitly creating a baseline:

```bash
claude-foundation quality baseline
claude-foundation quality baseline --write \
  --decision-ref ADR-42 --reason "approved pilot baseline"
```

Baselines are separate per repository/capability and remain compatible only while language, tool version, adapter version, and config digest match. Automated mutation compares the baseline only over the current affected surface.

Nightly inventory uses:

```bash
claude-foundation quality run --full
claude-foundation quality debt
```

Large runs accept `--shard-index <zero-based>` and `--shard-count <n>`. An exception identifies exactly one function or mutant—never a glob—and requires reason, risk, compensating evidence, owner, approver, tracking issue, and expiry within 90 days.

## Safety and rollout

- A selected repository missing from quality config fails closed.
- Profile capabilities cannot be made optional with `required: false`.
- Missing capabilities remain reduced assurance even when compensating evidence permits progress.
- Mutation declares `tool` or `harness-sandbox` isolation; harness-sandbox runs require `--change`.
- Git status before and after a provider must match.
- SQL/MongoDB providers use isolated per-run databases, never shared or production data.
- HTML/style quality remains browser/accessibility/visual evidence, not a fabricated code metric.

Keep `policy.mode: report` through the pilot. Approve stable mappings and baselines before enabling PR enforcement. Use nightly for full debt inventory and release for the full enforced gate.
