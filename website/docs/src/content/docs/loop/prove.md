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

## Four outcomes, not two

Evidence returns `pass`, `fail`, `inconclusive`, or `error`. Everything except `pass` blocks landing.

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

Some evidence cannot be executed locally — an independent review, a subjective acceptance, a CI run on another machine. Those use the resumable authority bridge:

```bash
claude-foundation proof collect <change>
claude-foundation authority request <change> --type review|acceptance
claude-foundation authority status <change> --request <id>
claude-foundation authority record <change> --request <id> --response <file>
```

Requests carry bounded packets, expire, and go stale with the workspace. A response must match the request identity and workspace, then pass the ordinary review or acceptance validator. Completed requests cannot be replayed.

Your agent translates the packet into ordinary language and asks whether to inspect, send, or pause. You answer in ordinary language — you are never asked for receipt syntax, provenance fields, or placeholders.

**Review.** Critical policy requires a different provider/model family, or a human. A change-level hash chain binds the complete receipt payload and limits AI to two recorded attempts, even if the current receipt is deleted or its provider renamed. Corrupt history fails closed.

**Acceptance.** External and human-only. A passing receipt requires explicit claim scope, `--acceptor`, `--decision accept`, unique non-blank `--criterion` values, `--observed`, provenance, and a durable artifact or reference. Every read revalidates all of it against the final workspace identity.

## Signed CI

An external provider may declare an issuer and an Ed25519 public key, then import a signed, workspace-bound envelope:

```bash
claude-foundation evidence verify-ci <change> <provider> signed-result.json
```

The envelope binds the change, provider, workspace hash, optional commit, run URL, status, observation, and artifact digests. An invalid signature, stale workspace, wrong issuer, or unsigned passing artifact is rejected before a receipt is written.

## What Prove must never do

It never substitutes self-review for independent review unless the project's committed policy declares that waiver, never claims an unproven pass, and never Lands.
