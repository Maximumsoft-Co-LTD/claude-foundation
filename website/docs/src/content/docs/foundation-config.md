---
title: Configure foundation.json
description: Understand and safely tune Foundation's project policy for execution, model tiers, escalation, review, sandboxes, and workflow.
---

`foundation.json` is the **committed policy for one project**. It tells
Foundation how much autonomous work is allowed, how work maps to model tiers,
when to escalate, who may review, and how a new Build workspace is prepared.

It does not contain product requirements or live task state:

| Concern | Source of truth |
|---|---|
| What the product should do | `openspec/` |
| What implementation remains | `tasks.md` in the active change |
| Runtime state and receipts | `.foundation/` |
| How Foundation may execute | `foundation.json` |

The installer copies this file only when it is missing. After that, the file is
yours: upgrades do not overwrite it. Commit it so that every developer and
reviewer runs under the same visible policy.

:::caution[Do not delete it to “reset” the policy]
When the file is absent, runtime compatibility defaults may differ from the
profile shipped with a new installation. Restore or edit the committed file
instead.
:::

## Shipped profile

The current profile is optimized for a Claude-Code-only installation. It uses
Claude Opus for configured review and permits the same identity/model family:

```json
{
  "review": {
    "independence": "self",
    "diversity": "single-model",
    "defaultReviewer": "claude-opus"
  },
  "workflow": {
    "grounding": "required",
    "reviewCircuit": "full-delta",
    "reviewPolicy": "risk-tiered"
  }
}
```

The complete committed file also contains execution budgets, model tiers,
escalation triggers, and both shipped reviewer definitions. Edit the existing
object rather than replacing it with the abbreviated example above.

`self` and `single-model` are explicit waivers, not claims that a review was
independent or diverse. Review receipts record
`independence-waived-self-review` and `diversity-waived-single-model` so the
trade-off remains visible.

## Safe editing loop

1. Edit the root `foundation.json` and keep `version` at `1`.
2. Run `claude-foundation doctor --stage change` for general policy validation.
3. If review settings changed, run `claude-foundation doctor --stage prove` to
   check the selected reviewer CLI, authentication, and read-only mode.
4. Inspect model routing with `claude-foundation models`.
5. Commit the policy change before producing evidence under it.

A policy change can invalidate review or proof created under the old contract.
Re-run readiness and Prove rather than editing receipts.

## `execution`: bound the autonomous run

```json
{
  "execution": {
    "maxParallelAgents": 3,
    "packetBytes": {
      "task": 8192,
      "review": 8192,
      "repository": 12288,
      "global": 16384
    },
    "tokenBudgets": { "rapid": 800000, "standard": 1600000 },
    "requestBudgets": { "rapid": 100, "standard": 200 },
    "planSummaryBytes": 4096,
    "leaseMinutes": 45
  }
}
```

| Field | Valid value | What to change it for |
|---|---|---|
| `maxParallelAgents` | Integer `1..16` | Lower it for constrained machines or tightly coupled work; raise it only when tasks can be separated safely |
| `packetBytes.*` | Integer `2048..65536` bytes | Increase only when a bounded task, review, repository description, or whole packet is being truncated |
| `tokenBudgets.rapid/standard` | Integer `10000..100000000` | Cap model tokens for one autonomous run; this is a ceiling, not a target |
| `requestBudgets.rapid/standard` | Integer `10..100000` | Cap model requests for one autonomous run |
| `planSummaryBytes` | Integer `1024..16384` | Bound the compact plan handed between phases |
| `leaseMinutes` | Number `1..1440` | Allow longer workspaces for slow builds or shorten stale-worker recovery |

At 85% of a budget, Foundation enters completion-only mode. At 100%, it
recommends splitting or rescoping model-completable work; deterministic
readiness, receipt reuse, recovery, and archive operations remain available.

:::tip
Do not raise every budget to fix one oversized task. First split independent
work, remove irrelevant packet context, or move durable facts into OpenSpec.
:::

## `models`: route purpose, not a host-specific command

```json
{
  "models": {
    "fast": {
      "family": "haiku",
      "fallbackTier": "standard",
      "purposes": ["inventory", "logs", "mechanical-docs"]
    },
    "standard": {
      "family": "sonnet",
      "fallbackTier": "deep",
      "purposes": ["implementation", "tests", "focused-investigation"]
    },
    "deep": {
      "family": "opus",
      "fallbackTier": null,
      "purposes": ["architecture", "security", "migration", "independent-review"]
    }
  }
}
```

The three keys—`fast`, `standard`, and `deep`—are portable tiers. `family`
describes the preferred family, while the native agent host remains responsible
for actually running it. `fallbackTier` must name one of the three tiers or be
`null`. `deep` cannot fall back to a lower tier.

Keep purpose lists narrow. A high-risk change is escalated by its boundary even
if its diff is small; adding every purpose to `fast` does not make security or
migration work low risk.

## `escalation`: conditions that need deeper judgment

The shipped triggers are:

- `ambiguous-contract` — the requested behavior or exclusion is unresolved;
- `auth-or-sensitive-data` — authorization, secrets, or sensitive data are involved;
- `migration` — persistent state or compatibility must move safely;
- `concurrency` — ordering, races, retries, or idempotency matter;
- `public-compatibility` — a public interface or supported behavior may change;
- `cross-repository-conflict` — repository scopes or versions disagree;
- `evidence-anomaly` — evidence is missing, contradictory, or unexpectedly stale;
- `two-failed-attempts` — the current approach has failed twice.

Escalation selects deeper investigation or review. It does not silently expand
write authority, bypass a budget, or turn external credentials into agent
permissions.

## `review`: choose convenience or separation of duties

Two independent axes control review:

| Field | Relaxed | Strict |
|---|---|---|
| `independence` | `self`: same identity/session may review | `required`: reviewer identity and AI session must differ |
| `diversity` | `single-model`: another provider/family is preferred | `required`: AI reviewer must use another provider and model family |

### Default: one Claude installation

```json
{
  "review": {
    "independence": "self",
    "diversity": "single-model",
    "defaultReviewer": "claude-opus"
  }
}
```

This is the lowest-friction profile. Configured `authority run` review is still
read-only and ephemeral, but policy does not require a distinct identity or
model family.

### Same model, separate reviewer session

```json
{
  "review": {
    "independence": "required",
    "diversity": "single-model",
    "defaultReviewer": "claude-opus"
  }
}
```

Use this when one provider is available but self-review is unacceptable.

### Cross-provider review

For implementation by Claude:

```json
{
  "review": {
    "independence": "required",
    "diversity": "required",
    "defaultReviewer": "codex-sol"
  }
}
```

For implementation by Codex, select `claude-opus` instead. With diversity
required, the default reviewer must actually differ from the implementation
provenance or the receipt fails closed.

Reviewer definitions live under `review.reviewers`. A configured reviewer must:

- use adapter `claude-cli` or `codex-cli` with the matching provider family;
- name an installed executable and model ID;
- use `reasoningEffort: "high"`;
- use `sandbox: "read-only"` and `ephemeral: true`.

Do not put credentials, tokens, or login commands in `foundation.json`. Install
and authenticate the selected CLI through its normal user-level setup, then use
`doctor --stage prove` to verify readiness.

## `sandbox`: prepare every new Build workspace

A Git worktree contains tracked files but not `node_modules`. If evidence needs
dependencies, add a deterministic setup command:

```json
{
  "sandbox": {
    "setupCommand": "npm ci",
    "setupTimeoutMs": 600000
  }
}
```

`setupCommand` must be a non-empty string. `setupTimeoutMs` must be an integer
from `1000` to `3600000`. The command runs once in every new workspace; a
failure keeps the workspace and reports recovery instead of continuing with a
half-prepared sandbox.

For a multi-repository project, keep the root setup here and place repository-
specific setup commands in `openspec/repositories.yaml`. Repository topology,
change scope, provider scope, and landing order are separate contracts; configure
them in that order in the [multi-repository workflow](/docs/multi-repository/).

## `workflow`: keep the modern control circuit enabled

```json
{
  "workflow": {
    "grounding": "required",
    "reviewCircuit": "full-delta",
    "reviewPolicy": "risk-tiered"
  }
}
```

- `grounding` accepts `required` or `optional`;
- `reviewCircuit` accepts `full-delta` or compatibility value `legacy`;
- `reviewPolicy` accepts `risk-tiered` or compatibility value `legacy`.

Use the shipped values for new work. The legacy values exist to read older
projects; they are not the recommended way to weaken review.

## Common mistakes

- **Replacing the whole file with a partial example.** Edit the existing object
  so reviewer definitions and other policy sections remain present.
- **Treating budgets as quotas.** A small change should finish far below them.
- **Requiring diversity while selecting the implementer's model family.** The
  review receipt will correctly fail.
- **Setting `deep` to fall back to `fast` or `standard`.** Downgrading deep work
  is rejected.
- **Adding secrets to setup or reviewer fields.** Keep secrets out of committed
  policy and use normal CLI authentication.
- **Expecting upgrades to change project policy.** The installer preserves this
  file after first creation; update it intentionally and review the diff.

After any edit, the shortest reliable check is:

```bash
claude-foundation doctor --stage change
claude-foundation doctor --stage prove
claude-foundation models
```
