# Foundation workflow

Foundation is an OpenSpec-native harness for safe, economical software changes
in brownfield repositories.

```text
Investigate? → Change → Build → Prove → Land
```

## Why this shape

The previous workflow encoded quality as a long sequence of agent roles and
phases. That preserved quality but made the control plane dominate cost and
latency. The new workflow separates three concerns:

- OpenSpec stores the agreement.
- The native coding agent implements the agreement.
- Deterministic providers prove the agreement.

Rigor scales with risk and evidence needs, not with a task-size phase matrix.

## Commands

### `/investigate <problem>`

Use only when the problem or direction is unclear. Exploration is bounded,
read-only with respect to product code, and may produce an investigation note.
Its output is facts, hypotheses, options, tradeoffs, and a next decision.

### `/change <intent>`

Creates or completes `openspec/changes/<id>/`. The resolver records:

- ambiguity: clear or unclear;
- impact: low, medium, or high;
- coupling: isolated or coupled;
- evidence capabilities;
- size for budget and slicing only;
- semantic security and review triggers.

Standard changes contain proposal, delta specs, design, tasks, and evidence.
Rapid changes contain proposal, tasks, and evidence and upgrade in place if risk
emerges.

### `/build <change>`

The native harness reads the compact change packet and implements it. `tasks.md`
is the only ledger. Focused checks run during convergence. Native task primitives
or subagents are used only for independently verifiable parallel/resumable work
packages, not lifecycle personas.

For a Git project, create an isolated worktree with:

```bash
node .claude/harness/foundation.mjs sandbox create <change>
```

### `/prove <change>`

Proof validates artifacts, hashes relevant inputs, resolves claims to providers,
reuses valid receipts, executes missing/stale evidence, and writes a proof bound
to the workspace hash.

```bash
node .claude/harness/foundation.mjs proof-plan <change>
node .claude/harness/foundation.mjs run-provider <change> test -- npm test
node .claude/harness/foundation.mjs receipt <change> discovery pass --discovered 42 --minimum 1
node .claude/harness/foundation.mjs prove <change>
```

Required evidence that is failed, missing, stale, erroneous, or inconclusive
blocks landing.

### `/land <change>`

Landing checks proof freshness, applies a proven sandbox diff when applicable,
verifies state identity, then delegates semantic spec sync and archive to the
pinned OpenSpec CLI.

```bash
node .claude/harness/foundation.mjs land-check <change>
node .claude/harness/foundation.mjs sandbox apply <change>  # worktree changes
node .claude/harness/foundation.mjs archive <change>
```

Commit, push, and pull-request effects require explicit authorization.

### `/changes`

Lists active changes and distinguishes in-progress, proven, stale-proof, and
ready-to-land states.

### `/dev`

Compatibility composition:

```text
/change → /build → /prove
```

It never lands by implication. `--plan-only` stops after `/change`;
`--resume <id>` resumes an active OpenSpec change.

## Schemas

### `foundation-rapid`

Allowed only when all are true:

- low impact;
- isolated;
- no public contract change;
- no persistent migration;
- no semantic security trigger;
- no irreversible effect;
- unit/static evidence is sufficient.

### `foundation-standard`

Used for all other changes. Design remains concise and records only decisions
that constrain implementation, compatibility, rollout, rollback, or proof.

## Evidence

`evidence.yaml` is JSON-compatible YAML so the runtime can validate it without a
second parser dependency.

```json
{
  "version": 1,
  "claims": [
    {
      "id": "owner-updates-profile",
      "scenario": "An authenticated owner updates their profile",
      "impact": "medium",
      "capabilities": ["test", "discovery"]
    }
  ]
}
```

Supported capabilities:

- `test`
- `discovery`
- `browser`
- `mutation`
- `state-identity`
- `integration`
- `compatibility`
- `performance`
- `security-static`
- `cross-repo-contract`
- `review`

Test evidence automatically requires discovery evidence. Risk-triggered changes
automatically require review evidence.

Each receipt records provider/version, change, claims, workspace hash, result,
observations, capability metadata, command/log, and timestamps. Status is one of
`pass`, `fail`, `inconclusive`, or `error`.

## Review

Review is required for high impact, authentication/authorization, public
compatibility, migration, irreversible mutation, concurrency, monetary logic,
multi-repository contracts, anomalous evidence, or explicit policy.

Findings are `verified`, `hypothesis`, `disproved`, or `accepted-risk`.
Hypotheses require deterministic reproduction before becoming confirmed major
findings.

## Security resolver

Triggers are semantic: identity/access, secrets, permissions, cross-user data,
network trust, irreversible mutation, sensitive storage, unsafe sinks, public
security contracts, and security-relevant migrations. Syntax alone is not risk.

## Invalidation

Foundation hashes relevant project content plus the selected change artifacts.
It excludes runtime receipts, sandboxes, dependencies, legacy workflow records,
other active changes, and archived changes. Any relevant edit makes prior
receipts and proof stale.

## Sandbox safety

- Git projects use detached temporary worktrees.
- The target HEAD must remain at the recorded base before apply.
- `git apply --check` runs before target mutation.
- The applied target and proven sandbox hashes must match.
- Conflicts stop without overwriting unrelated user edits.
- Mutation testing happens only in isolation.

Non-Git projects use an isolated temporary copy with a before/after content
manifest. Apply rejects any target path changed since the baseline, then verifies
that target and sandbox identities match. Multi-repository changes use one
OpenSpec change plus a repository manifest and require cross-repository contract
evidence before each repository is landed in its declared order.

## Watchdog

The external event ledger requires unique request identity and records operation,
agent/model, parent request, tokens, cache, cost, tool, hash, and change.

Budget actions:

- 70%: batch remaining work and reuse evidence;
- 85%: stop speculative exploration;
- 100%: stop and split or re-scope.

Required evidence is never removed to meet budget.

## Legacy migration

`.workflow/` is no longer runtime state. Existing records remain read-only.

```bash
node .claude/harness/foundation.mjs migrate
node .claude/harness/foundation.mjs migrate <legacy-id> --apply
```

Apply creates migration candidates, not authoritative specs. Only statements
corroborated by code, tests, or accepted contracts may be promoted.

## Runtime layout

```text
openspec/
  config.yaml
  schemas/
  specs/
  changes/

.foundation/
  runtime/
  receipts/
  logs/
  sandboxes/
```

The contents under `.foundation/` are machine-owned and ignored by Git.

## Requirements

- Node.js 20.19 or later
- OpenSpec pinned to `@fission-ai/openspec@1.7.0`
- Git for worktree isolation
- `jq` for automatic settings merge during installation

## Quality invariants

- Zero discovered tests cannot silently pass.
- Missing expected evidence cannot silently pass.
- Browser capability mismatch is inconclusive.
- Mutation crash is not a behavioral kill.
- Stale proof cannot land or archive.
- A sandbox diff cannot overwrite a conflicting target.
- OpenSpec performs semantic spec sync before archive.
- Required assurance is never dropped because of size or budget.
