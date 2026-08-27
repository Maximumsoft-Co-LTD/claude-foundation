---
title: Consumer quality gates
description: Add changed-code CRAP, mutation testing, language profiles, baselines, and quality debt to one or many repositories.
---

Foundation can orchestrate project-owned quality tools without pretending one metric fits every language. The feature is opt-in and starts in **report-only** mode.

```text
discover → preview config → diagnose tools → pilot reports → approve baseline → enforce
```

Quality findings are evidence, not permission to edit. A high score outside the approved Change becomes debt; it does not expand task or repository scope.

## What the gates measure

**CRAP Score** combines cyclomatic complexity with function coverage:

```text
CRAP = complexity² × (1 − coverage/100)³ + complexity
```

Foundation recomputes the score rather than trusting a provider-supplied value. By default, changed unit code needs 80% coverage, changed integration code 70%, and a critical journey 50%. A new function fails at CRAP 30 or above; an existing function fails when it regresses from a compatible baseline. Changed complexity above 30 also fails.

**Automated mutation** checks whether ordinary tests distinguish small code changes. Killed mutants count; survived, no-coverage, timeout, compile error, runtime error, and unavailable results do not. A skipped mutant is not assumed equivalent. Equivalent suppression needs an explicit reason or a narrow approved exception.

**Semantic mutation** targets domain faults—removing a tenant filter, skipping a transaction, ignoring a returned error, or breaking keyboard focus. Its kill-rate threshold is independent of aggregate automated mutation.

## Start safely

Discovery reads manifests and filenames but executes no project command:

```bash
claude-foundation quality discover
claude-foundation quality init
claude-foundation quality init --write --ci github
claude-foundation quality doctor
```

`quality init` only previews until `--write`. It creates `quality/foundation-quality.json`. With `--ci github`, it also installs:

- a reusable/manual changed-code workflow;
- a four-shard nightly inventory workflow; and
- a full enforced release workflow.

The reusable workflow is not a `pull_request` trigger by itself. Call it from the repository's existing PR workflow and pass the Foundation Change ID. Add each project's language setup before `quality doctor`; Foundation does not install runtimes or quality tools.

Run a pilot against the isolated workspace for a Change:

```bash
claude-foundation quality run --change <change-id>
claude-foundation quality report
claude-foundation quality run --change <change-id> --enforce
```

Once the committed quality config exists, evidence bootstrap can wire the enforced run as a `static-analysis` provider. Its receipt records the aggregate assurance and retains the per-repository report in the command log.

## Language profiles

| Surface | Profile | Appropriate controls |
|---|---|---|
| JavaScript / TypeScript | `application-js-ts` | tests, static checks, Istanbul + complexity, automated and semantic mutation |
| Go | `application-go` | `go test`, `go vet`, gocyclo + cover, mutation, compatibility and resilience |
| Python | `application-python` | pytest, static checks, Radon + coverage.py, mutation |
| PHP | `application-php` | Composer/PHPUnit, Clover, mutation |
| Bash | `script-bash` | tests, ShellCheck/static, state identity and semantic faults |
| SQL | `database-sql` | isolated integration, compatibility, migration, performance and semantic faults |
| MongoDB | `database-mongodb` | isolated data fixtures, schema/query/migration faults |
| HTML | `web-markup` | validation, browser and accessibility evidence |
| CSS / Sass | `web-style` | lint/build, browser, accessibility and responsive evidence |

Foundation deliberately does **not** invent CRAP values for Bash, SQL, MongoDB, HTML, CSS, or Sass. Unsupported, unavailable, and unmapped capabilities never become zero or pass.

## Providers and built-in normalizers

The project owns every command and pinned tool version. A `command` provider emits a Foundation protocol from stdout or a declared output file. A `builtin` provider runs a project command and normalizes native reports with one of these adapters:

- `javascript-istanbul`
- `go-complexity-cover`
- `python-radon-coverage`
- `php-clover`
- `canonical-functions`
- `generic-mutation-json`

CRAP and mutation reports bind the repository ID, commit, workspace digest, language, tool version, adapter version, and configuration digest. A report from another workspace or incompatible tool configuration cannot silently become the baseline for the current run.

## Baselines, debt, and exceptions

Review pilot findings before creating a baseline:

```bash
claude-foundation quality baseline
claude-foundation quality baseline --write \
  --decision-ref ADR-42 --reason "approved pilot baseline"
```

Baselines are versioned per repository and capability. Mutation comparison scopes the baseline to the current affected paths, so a previous Change's mutant set is not compared with an unrelated Change.

Run the inventory and render debt without widening the active Change:

```bash
claude-foundation quality run --full
claude-foundation quality debt
```

Large inventories accept `--shard-index <zero-based>` and `--shard-count <n>`. Each lane is assigned deterministically; failed repositories are never hidden by an average.

An exception names exactly one function or mutant—never a glob—and requires an owner, approver, risk, compensating evidence, tracking issue, and expiry no more than 90 days away.

## Safety and rollout

- Mutation uses tool isolation or a Foundation Change sandbox. A `harness-sandbox` provider without `--change` is unavailable.
- Foundation compares Git status before and after a provider; failure to restore the workspace fails the lane.
- SQL and MongoDB providers must use per-run isolated databases, never a shared or production database.
- A selected repository missing from quality config fails closed.
- Missing capabilities lower assurance and remain visible even when policy permits compensating evidence.

Keep `policy.mode` at `report` for at least three representative runs. Inspect function/path mapping and false positives, approve the initial baselines, then enable enforcement in the PR caller. Nightly owns full debt inventory; release owns the full enforced gate.

