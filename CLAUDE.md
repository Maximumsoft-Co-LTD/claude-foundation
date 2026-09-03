# Change Loop maintainer guide

## What this repository is

This is the upstream source of `claude-foundation`, not a consumer project.
Change Loop is an installable, OpenSpec-native control plane for AI-assisted
software changes:

```text
Investigate? → Change → Build → Prove → Land
```

OpenSpec stores the agreement, the native coding agent implements it, project
tools produce evidence, and the deterministic harness owns lifecycle state,
isolation, budgets, proof freshness, authority boundaries, and Land recovery.
Change Loop does not replace the coding agent, Git, CI, or the project's test
framework.

New changes use semantic draft v3: the compiler owns stable cross-ledger links
and creates optional artifacts only for real concerns. The normal host path
after Change is `advance --through build|proven|archived`; low-level commands
remain supported operator and integration primitives. OpenSpec stays canonical.

Work here changes the harness shipped to real consumer repositories. A broken
command, skill, hook, or runtime rule is this project's bug to fix—not a rule to
work around. Public command names and arguments are compatibility contracts.

## Why it exists

An agent can produce plausible code while misunderstanding intent, testing the
wrong surface, editing the main checkout too early, or claiming success from
stale evidence. Change Loop makes completion content-bound and resumable:

- Build occurs in a declared isolated workspace.
- Every phase uses one compiled execution contract and lifecycle reducer.
- Gates evaluate independent findings once, repair one ordered batch, and rerun
  only invalidated checks.
- Product repair has no fixed retry count while progress changes.
- Real authority, resource, budget, conflict, or repeated no-progress boundaries
  preserve state and return an exact resume route.
- A code-delivery flow succeeds at `archived`, never merely `proven`.
- Land applies only the proven projection and never commits, pushes, or opens a
  pull request without separate authority.

## Sources of truth

| Question | Source |
|---|---|
| User workflow and commands | `README.md`, `README.th.md` |
| Detailed lifecycle contract | `WORKFLOW.md` |
| Runtime structure and operator commands | `.claude/harness/README.md` |
| Providers, receipts, and proof semantics | `.claude/harness/EVIDENCE.md` |
| Public CLI registry | `.claude/harness/commands.json` |
| Wire-visible versions | `.claude/harness/protocol.json` |
| Installed-file ownership | `install.sh` `MANAGED` array |
| Deterministic suite ownership | `.claude/tests/README.md` |
| Current scenario/release status | `docs/reports/user-scenario-release-status.md` |
| Scenario acceptance portfolio | `docs/reports/user-scenario-test-plan.md` |
| Release procedure | `RELEASING.md` |

Do not copy a detailed contract into several documents. Update its canonical
source and link to it from summaries. Dated reports are historical evidence and
must not be rewritten as current status.

## Repository map

Shipped product:

- `.claude/orchestrator.md` and `.claude/commands/` — agent-facing lifecycle.
- `.claude/harness/foundation.mjs` — composition root and compatibility entry.
- `.claude/harness/runtime/` — core, evidence, workflow, observability,
  reliability, and portable contracts.
- `.claude/rules/`, `.claude/skills/`, `.claude/hooks/` — routing, procedures,
  and host enforcement.
- `openspec/schemas/` — rapid and standard assurance profiles.
- `WORKFLOW.md` — installed lifecycle reference.

Repository-only development surfaces:

- `.claude/tests/` — deterministic unit, seam, integration, mutation, and
  consumer-install suites.
- `.claude/tests/bench/` — frozen scenario lab and release evidence tooling.
- `scripts/release/`, `RELEASING.md`, `Formula/`, `.github/workflows/` — release
  and distribution tooling. Paid portfolio execution is manual and explicitly
  authorized; there is no scheduled paid workflow.
- `dashboard/`, `website/`, and `examples/` — observability UI, public docs, and
  sample consumers.
- `.workflow/` — read-only legacy migration input; do not extend it.

## Shipping boundary

`install.sh` is authoritative. These paths are managed and overwritten during
installation:

```text
.claude/orchestrator.md
.claude/commands
.claude/harness
.claude/skills
.claude/rules
.claude/hooks
openspec/schemas
.foundation/.gitignore
.foundation/README.md
WORKFLOW.md
```

These are project-owned and must be preserved: `.claude/settings.json`,
`openspec/config.yaml`, `openspec/repositories.yaml`, `foundation.json`,
`CLAUDE.md`, `AGENTS.md`, active OpenSpec changes, and `.foundation` state.
Installers may seed or merge them only through their documented ownership rules.

Never make a shipped file depend on repository-only tests, reports, or release
paths. Never store benchmark history, incidents, or cost observations in the
installed runtime.

## Development workflow

1. Classify the change before editing: runtime, instruction, shipping,
   repository-only, or release.
2. Read the smallest canonical source and nearest tests. Preserve unrelated
   dirty-worktree changes.
3. For ordinary product work, dogfood the same Change → Build → Prove → Land
   loop. For bootstrap-breaking runtime pins, installer ownership, or release
   mechanics, edit at root and use deterministic verification directly.
4. Put runtime code in the appropriate `.claude/harness/runtime/` domain and
   keep `foundation.mjs` as the composition root.
5. Add the lowest-level regression that would have caught the defect. A new
   suite requires its script, registration in `.claude/tests/run-all.sh`, and a
   row in `.claude/tests/README.md`.
6. Update canonical documentation and English/Thai public mirrors together.
   Change `.claude/harness/protocol.json` only for a wire-visible contract.
7. Run affected checks while iterating, then the authoritative full suite before
   commit. Review `git diff --check` and the final status; do not commit generated
   benchmark output or temporary consumers.

## Verification commands

Prefix shell commands with `rtk`; in a command chain, prefix every segment.

```bash
rtk test bash .claude/tests/run-all.sh --affected
rtk test bash .claude/tests/run-all.sh
rtk test bash .claude/tests/docs/run-doc-consistency.sh
rtk npm run build                         # from website/docs
rtk npm run bench:openspec-native:sentinel
rtk npm run release:preflight
rtk git diff --check
```

Use the full 197-suite runner as the final deterministic gate. Paid scenario
runs are separate release evidence: they require explicit spend authority,
must use disposable consumers, and must finish at `archived` with oracle and
clean-install verification. A release-report exit code 2 is a truthful promotion
blocker, not a deterministic test failure.

## Change-specific gates

| Change touches | Required focused checks in addition to the full suite |
|---|---|
| Runtime/composition | nearest unit/seam tests, wiring and architecture checks |
| Commands, skills, hooks, docs | context budgets, command contracts, docs consistency |
| Installer, schemas, protocol | installer smoke, managed ownership, upgrade matrix |
| Evidence or Land | freshness/receipt seams, recovery checkpoints, semantic acceptance |
| Website docs | English/Thai parity and `website/docs` build |
| Release tooling | release preflight, local rehearsal, `RELEASING.md` |

The runtime API has four pins and all must agree: `cli.sh
EXPECTED_RUNTIME_API`, `.claude/harness/foundation.mjs RUNTIME_API_VERSION`,
`.claude/harness/runtime/version.mjs RUNTIME_MODULE_API`, and
`.claude/harness/protocol.json runtimeApi`.

## Working rules

- Use `tasks.md` as the sole implementation ledger; do not create shadow status
  files.
- Treat risk and evidence—not diff size—as the assurance selector. Size controls
  budget and slicing only.
- Do not inspect or patch generated receipts, proof, or Land journal JSON.
- Preserve fail-closed isolation and unknown-as-unavailable measurement semantics.
- Do not weaken evidence, silently widen scope, infer user authority, or report
  `proven` as completion for a delivery flow.
- Do not commit, push, publish, or start paid execution without the corresponding
  user authority.
