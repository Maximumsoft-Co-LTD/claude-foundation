# Change: Ship Foundation v3.3 risk-tiered review, Codex reviewer orchestration, grounded observability intake, and proof hardening

## Why

Teams using Foundation still lose hours in Build and Prove even after one-batch
intake. A green aggregate test count can hide skipped critical cases, review
round two can reopen the whole change, and material risk questions can surface
again after Build. Cross-service activation hazards and the
signals needed to diagnose them are also discovered by review instead of being
grounded before implementation. Developers also inherit AWS, IAM, secret,
Terraform, deployment, and production-verification checkboxes they are not
authorized to perform, so completed code remains artificially unfinished and
cannot reach Land.

The desired outcome is a bounded workflow that catches production-path, wire,
failure, observability, and service-boundary gaps before Build, uses Codex as a
real independent reviewer when diversity permits, and never turns closure into
an unbounded fresh review loop.

## What changes

- Add one risk-tiered review policy: low uses one AI review; medium and high
  permit one full review plus one delta-only closure after one correction batch.
  High-risk decisions are asked once during intake, not as a human Prove gate.
- Add configured Codex CLI and Claude Code CLI reviewers with structured output,
  read-only execution, model/session provenance, diversity routing, and
  adapter-specific doctor guidance. A committed single-model waiver permits a
  same-family reviewer only in a distinct fresh session.
- Extend the single Decision Sheet and grounding ledger with conditional
  cross-service and observability decisions, production entries, real wire
  boundaries, critical case IDs, and activation failure semantics.
- Replace count-only proof for material claims with named critical-case and
  mutation reports; missing or skipped critical cases block even when the test
  process exits zero.
- Make proof/review mutations serialized, crash-recoverable, content-fresh, and
  capability ordered so review precedes acceptance and waiting never polls.
- Separate implementation tasks from permission-bound external operations.
  Emit a durable DevOps handoff with owner, timing, activation safety,
  evidence, rollback, and tracking state; allow Land only for accepted
  post-Land operations proven safe before activation, and report every other
  unresolved operation as `WAITING_EXTERNAL` rather than developer rework.
- Ship the behavior as Foundation 3.3.0/runtime API 20 and preserve it through
  clean install, upgrade, Claude, Codex, Cursor, and OpenCode host adapters.

## Impact

- **Impact:** high
- **Coupling:** coupled
- **Affected surfaces:** change lifecycle, evidence contracts, proof and
  authority state, reviewer dispatch, CLI/doctor, commands/skills, schemas,
  installers, compatibility migration, documentation, release metadata
- **Security triggers:** reviewer child-process execution is read-only and
  argument-safe; high-risk classification includes auth, secrets, money,
  destructive migration, concurrency, replay, wire contracts, and cutover

## Non-goals

- Foundation does not replace project test frameworks, observability backends,
  or the developer's explicit material-risk decisions with a model-generated pass.
- No third AI review, polling loop, automatic acceptance, automatic Land,
  release tag, package publication, merge, or consumer-project product change.
- Foundation does not grant cloud permissions, store secret values, execute a
  human-only production operation, or call an activation-coupled operation
  complete without named external evidence.
