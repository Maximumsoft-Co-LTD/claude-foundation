# Claude Foundation

An OpenSpec-native software-change harness for AI coding agents.

```text
Investigate? → Change → Build → Prove → Land
```

Foundation keeps the quality mechanisms that matter—clear behavioral agreement,
test discovery, rendered checks, mutation testing, security triggers, independent
risk review, and safe landing—without paying for a phase orchestrator and a team
of lifecycle personas on every change.

## Install

Requirements: Node.js 20.19+, Git, and OpenSpec 1.7.0.

```bash
npm install -g @fission-ai/openspec@1.7.0
./install.sh /path/to/project
```

Or through the packaged CLI:

```bash
claude-foundation init /path/to/project
```

The installer preserves project-owned `openspec/specs/`,
`openspec/changes/`, `.foundation/` runtime, custom agents/hooks, and legacy
`.workflow/` history. Foundation-owned schemas, commands, harness code, rules,
skills, and hooks refresh on upgrade.

## Use

```text
/change add authenticated profile editing
/build add-authenticated-profile-editing
/prove add-authenticated-profile-editing
/land add-authenticated-profile-editing
```

If the problem is unclear:

```text
/investigate why profile updates occasionally overwrite newer data
```

For compatibility:

```text
/dev add authenticated profile editing
```

`/dev` runs change → build → prove and deliberately stops before land.

## What is different

| Previous workflow | OpenSpec-native Foundation |
|---|---|
| Fixed phase sequence | Change loop |
| Size chooses workflow depth | Risk and evidence choose assurance |
| PM/lead/engineer/QA/retro roles | Native harness plus capabilities |
| Markdown plus `state.json` plus native tasks | OpenSpec artifacts plus one `tasks.md` ledger |
| Repeated test/browser passes | Content-bound reusable receipts |
| Review by default for broad classes | Review on semantic risk triggers |
| Main agent owns budget narration | External event watchdog |
| Ship and retrospective phase | Transactional land and archive |

## Architecture

- `openspec/` — durable intent, delta specifications, and change history.
- `.claude/harness/foundation.mjs` — resolver, hashing, receipts, proof,
  watchdog, sandbox, migration, and land guards.
- `.claude/commands/` — the user-facing change loop.
- `.foundation/` — ignored runtime state, receipts, logs, and worktrees.
- Code and tests — implementation truth.

See [WORKFLOW.md](WORKFLOW.md) for contracts, provider semantics, migration, and
operator commands.

## Rapid and standard changes

`foundation-rapid` is for low-impact isolated work with no contract, data,
security, or irreversible effects. Everything else uses `foundation-standard`.
If risk emerges, the change upgrades without discarding work.

## Evidence

Each observable scenario declares provider capabilities in `evidence.yaml`.
Receipts are tied to a workspace hash. Relevant edits invalidate proof
automatically. Required `fail`, `error`, `inconclusive`, missing, or stale
evidence blocks `/land`.

## Development

```bash
node .claude/harness/foundation.mjs version
sh .claude/tests/run-all.sh
./install.sh /tmp/foundation-demo --dry-run
```

The OpenSpec dependency is pinned in `package.json`; the runtime itself uses
Node core modules so deterministic tests do not require an install.

## Migration from the phase workflow

Old `.workflow/` records remain readable and are never promoted to truth
automatically:

```bash
node .claude/harness/foundation.mjs migrate
node .claude/harness/foundation.mjs migrate 0003-fix-example --apply
```

The second command creates a reviewable migration candidate. Promote only
behavior verified by code, tests, or an accepted contract.

## License

MIT
