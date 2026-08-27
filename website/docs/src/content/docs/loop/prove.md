---
title: /prove
description: Produce content-bound evidence — reuse valid receipts, run only what is missing or stale, and never accept an assertion as a pass.
---

```text
/prove <change>
```

Prove is where a claim stops being a claim. It runs in a **fresh context**, starting from `packet <change> --phase prove` rather than Build's history — the agent that wrote the code does not get to carry its own confidence into the step that checks the code.

## What runs

```bash
claude-foundation proof readiness <change>   # typed blockers + next commands
claude-foundation proof run <change>         # readiness, execute, finalize, audit
```

`proof run` is atomic over those four stages. Before it, `readiness` tells you exactly what is missing without executing anything.

## Reuse before rerun

A receipt binds to code, agreement, claims, configuration, environment, protocol, and artifacts. If every bound input is unchanged, the receipt is reused and the work is not repeated. Change one and it goes stale.

Three savings compound:

- **Persistent reuse** — valid receipts survive across proof attempts.
- **In-flight dedup** — identical command, arguments, environment, working directory, timeout, and readiness run once per execution.
- **Resource-aware parallelism** — read-only providers overlap; `workspace-write`, browser, dev-server, and database resources stay exclusive.

A provider may declare workspace-relative `inputs`, so its receipt can be rebound when *those* files are unchanged even if unrelated workspace files moved.

For multi-repository evidence, `repository` selects the command's working
directory and `repositories` declares every repository the command reads. The
command resolves isolated paths from `FOUNDATION_REPOSITORIES_FILE`; it must not
assume sibling checkouts. The repository set is part of execution and receipt
identity. Configure this only after topology and change scope are correct; the
[multi-repository workflow](/docs/multi-repository/) shows the full order.

When `quality/foundation-quality.json` is committed, consumer quality can run
as project-owned static-analysis evidence. Its receipt records full or reduced
assurance, while the command log retains every repository lane. Missing or
unmapped quality never becomes a passing zero. Configure the report-only pilot,
baselines, and enforcement policy in
[Consumer quality gates](/docs/consumer-quality/).

## Four outcomes, not two

Evidence returns `pass`, `fail`, `inconclusive`, or `error`. Everything except `pass` blocks landing.

A gate that ran and **failed** has three exits, and the blocker prints all three: fix the code and re-prove, rewire the provider if the gate itself is wrong, or waive that one capability on a recorded user decision:

```bash
claude-foundation change waive <change> --capability <c> --reason <why> --decision-ref <ref>
```

The claim keeps declaring the capability; the waiver travels as a `user-waived` advisory into readiness, the proof record, the archive, and the `LAND READY` line, and `--revoke` restores the requirement. A waiver is subtractive — it cannot change what any other provider attested, so receipts already earned stay valid and the re-prove after a waive executes zero providers. There is deliberately no route that lands a failing proof, and `review` and `acceptance` are refused here in favor of their own documented waiver routes.

`inconclusive` is the one people underestimate. A browser suite that exits 0 without the required claim annotations is inconclusive — the process succeeded, but nothing demonstrated the claim. A test command that passes but exposes no deterministic test count leaves discovery inconclusive. Neither is a soft pass.

## A receipt records how it was produced

This is the floor that makes `PROVEN` mean something:

- Receipts the harness executed carry `execution: "harness"` and their command log. That value is set only by a call site that actually ran a command, through an argument the command line cannot supply.
- Everything recorded by hand is `execution: "manual"` and must include `--observed`, provenance (`--source` or `--reviewer`), and at least one `--artifact` or `--reference`.
- A `--reference` must be a URI or a path that exists. Free text is not a reference.

A passing receipt **cannot** be hand-recorded for a provider the harness executes. `evidence record` refuses `--adapter command`, `test-discovery`, `playwright`, and `contract-digest`, and refuses any passing receipt for a provider configured with one of them. Run `proof run` so the declared command is what executes.

:::note[Why this is strict]
In an earlier version the real-evidence requirements were gated on the adapter *the caller supplied*, so the caller effectively chose whether to be checked. Repeating one hand-recorded pass for each required provider produced a change reporting `PROVEN` and `LAND READY` having executed nothing at all.
:::

## Human and external authority

Some evidence cannot be executed locally — an independent review, a subjective acceptance, a CI run on another machine. Normally you advance the state machine once:

```bash
claude-foundation proof advance <change>
```

`proof advance` executes missing project evidence once, routes review before acceptance, and returns a stable waiting handoff. Repeating it on an unchanged open request does not poll, rerun providers, or dispatch another reviewer. Configured AI review uses `authority run`; named-human review reserves its exact packet with `authority dispatch` before `authority record`; acceptance does not use a review dispatch.

Requests carry bounded packets, expire, and go stale with the workspace. A response must match the request identity and workspace, then pass the ordinary review or acceptance validator. Completed requests cannot be replayed. A crashed, aborted, or tool-failed AI dispatch is infrastructure rather than a delivered verdict and receives at most one bounded full retry.

Staleness refusals state their recovery order rather than a bare no: `proof is stale` says to finish contract and code edits, sync, and run one fresh prove; a stale authority request says to request review and acceptance last, after the workspace stops changing — each naming the resuming command.

Your agent translates the packet into ordinary language and asks whether to inspect, send, or pause. You answer in ordinary language — you are never asked for receipt syntax, provenance fields, or placeholders.

**Review.** Low risk uses one full AI review. A corrected low change promotes to the same bounded full/delta route used by medium and high. The delta must close the first-round finding IDs and stay within changed artifacts. If that final delta finds an in-contract blocker, it must bind the finding to declared claims and critical cases; after repair, current passing provider receipts close those exact IDs deterministically. There is no third AI and no mandatory human-final gate. A real behavior, compatibility, security, data, or rollout contradiction reopens one batched Decision Sheet; missing environment authority becomes a DevOps handoff. A change-level hash chain binds dispatch, completion, scope, findings, closure evidence, and receipt; corrupt history fails closed.

**External operations.** Build and Prove do not ask a developer for cloud credentials. AWS/IAM/secret/Terraform/deploy/restart work lives in `handoffs.yaml`; send `handoff packet` once and continue evidence. Land waits for pre-Land or activation-coupled work, while accepted tracked post-Land work may remain only when the merged artifact is proven safe before activation.

**Acceptance.** External and human-only. A passing receipt requires explicit claim scope, `--acceptor`, `--decision accept`, unique non-blank `--criterion` values, `--observed`, provenance, and a durable artifact or reference. Every read revalidates all of it against the final workspace identity.

## Signed CI

An external provider may declare an issuer and an Ed25519 public key, then import a signed, workspace-bound envelope:

```bash
claude-foundation evidence verify-ci <change> <provider> signed-result.json
```

The envelope binds the change, provider, workspace hash, optional commit, run URL, status, observation, and artifact digests. An invalid signature, stale workspace, wrong issuer, or unsigned passing artifact is rejected before a receipt is written.

## What Prove must never do

It never substitutes self-review for independent review unless the project's committed policy declares that waiver, never claims an unproven pass, and never Lands.
