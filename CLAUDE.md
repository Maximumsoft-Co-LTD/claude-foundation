# Change Loop maintainer guide

## What this repository is

**Audience:** agents and maintainers developing Change Loop itself. This file
is the upstream repository's instruction manual, not a template that replaces
a consumer project's `CLAUDE.md`. Installed file ownership and writer rules
live in [the harness reference](.claude/harness/README.md#file-ownership-and-writers).

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

New changes use semantic draft v4: the harness owns risk-derived discovery
coverage and decision-frontier validation, while the compiler owns stable
cross-ledger links and creates optional artifacts only for real concerns. Draft
v3 remains compatible. The normal host path
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
- The harness prepares required tools and retries failed repository setup before
  execution; host permission or harness bookkeeping never becomes a user-run
  recovery command.
- Real authority, resource, budget, conflict, or repeated no-progress boundaries
  preserve state and return an exact resume route.
- The normal code-delivery flow succeeds at `archived`, never merely `proven`.
- Land leaves an uncommitted target diff and never commits, pushes, or opens a
  pull request; only the optional `/deliver` command may, under its own explicit
  authority. `WORKFLOW.md` owns the full Land and Deliver contracts.

## Sources of truth

| Question | Source |
|---|---|
| User entrypoints and first-change summaries | `README.md`, `README.th.md` |
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

## Documentation ownership

This section owns repository documentation rules. `AGENTS.md` and contributor
guides link here; do not copy this policy into each file. The author changing a
contract owns its documentation update in the same change. A reviewer checks
meaning and English/Thai parity; automated checks cover structure, links, and
the explicit contracts they test, not every claim's truth.

### File responsibilities

| File or family | Purpose | Update when | Keep elsewhere |
|---|---|---|---|
| `README.md`, `README.th.md` | Product entry, install summary, one first change, reading routes | User entry flow, install command, or release version changes | Protocol details, full configuration, internal command chains, experiment results |
| `AGENTS.md` | Short repository-wide constraints and pointers for coding agents | Working rules or canonical source locations change | Detailed lifecycle and duplicated documentation policy |
| `CLAUDE.md` | Maintainer source map, shipping boundary, development and documentation rules | Repository structure, ownership, or development policy changes | Consumer tutorial and full runtime contract |
| `CONTRIBUTING.md` | Contributor setup, check selection, contribution and DCO process | Dependencies, verification entrypoints, or contribution process change | Complete suite inventory and instructions to commit unfinished work to test it |
| `WORKFLOW.md` | Canonical lifecycle, authority, recovery, and invalidation contract | Runtime lifecycle semantics change | Release anecdotes and repository-only operational dependencies |
| `.claude/harness/README.md` | Runtime structure, operator commands, state locations, troubleshooting | Operator surface or runtime layout changes | A second copy of provider semantics |
| `.claude/harness/EVIDENCE.md` | Canonical provider, receipt, proof, and reviewer semantics | Evidence or review contracts change | Product onboarding and historical benchmark claims |
| `.claude/harness/CONSUMER-QUALITY.md` | Installed consumer quality operation and policy | Quality discovery, enforcement, or reports change | Repository-only performance experiments |
| `.claude/tests/README.md` | Check selection, suite ownership, fixtures, execution controls | Suite registration, ownership, or runner behavior changes | Another lifecycle specification |
| `RELEASING.md` | Release preparation, verification, publication and recovery procedure | Release machinery or authority requirements change | A claim that an old candidate proves the current source |
| `docs/reports/README.md` | Index of current operating documents and dated evidence | A report is added or a document's current/historical status changes | Full report content or user tutorials |
| `docs/reports/user-scenario-release-status.md` | Current release assurance and known gaps | New candidate or release evidence is available | Fabricated pass, cost, or completion claims |
| `docs/reports/user-scenario-test-plan.md` | Scenario portfolio and acceptance requirements | Scenario scope or acceptance contract changes | Results presented as requirements |
| Other `docs/reports/*.md` | Dated observation, proposal, or implementation record with explicit status | New evidence needs a new record; corrections must be labeled | Silent rewriting of historical results as current facts |
| `website/docs/src/content/docs/index.md` and `th/index.md` | Product orientation and routes into the guides | Product positioning or navigation changes | Internal skill inventories and migration history |
| `website/docs/src/content/docs/quickstart.md` and `th/quickstart.md` | One task from intent through archive, with expected outcomes | The first-change journey changes | Advanced configuration and low-level recovery recipes |
| Other `website/docs/src/content/docs/**/*.md` | Task-specific explanations derived from canonical contracts; every page has an EN/TH counterpart | Its documented command, configuration, or behavior changes | Independent definitions that contradict the canonical contract |
| `website/docs/astro.config.mjs` | Navigation and locale routing | Pages are added, moved, or regrouped | Links to nonexistent or untranslated pages |
| `openspec/changes/**` | Change-specific agreement and implementation ledger | That change is approved, amended, implemented, or archived | General product manuals or a second implementation ledger |
| `openspec/investigations/**` | Source-bound findings and unresolved questions | Investigation evidence or the question changes | Treating recommendations as approved implementation |

For other documentation, identify its reader, purpose, canonical source, and
update trigger before adding it. Extend the nearest family above or add a row
only when its responsibility differs. Do not create a new guide merely to
repeat an existing one.

Website page responsibilities below apply to both the English path under
`website/docs/src/content/docs/` and its `th/` counterpart:

| Page | Reader's question | Source to check when updating |
|---|---|---|
| `install.md` | How do I install, prepare a host, or upgrade? | Installer/CLI behavior and host adapters |
| `loop.md`, `loop/*.md` | What happens in each lifecycle step? | The matching `WORKFLOW.md` section |
| `artifacts.md` | What files appear, who owns them, and what may I edit? | `install.sh` ownership and the harness README's state inventory |
| `foundation-config.md` | What policy can I configure? | Runtime config validation/defaults and `foundation.json` |
| `multi-repository.md` | How do I scope and deliver across repositories? | `WORKFLOW.md` repository safety and harness repository execution |
| `approval.md` | Which decisions and permissions are mine? | `WORKFLOW.md` authority, review, acceptance, and external-operation contracts |
| `consumer-quality.md` | How do I enable and operate optional quality checks? | `.claude/harness/CONSUMER-QUALITY.md` |
| `evidence/claims.md` | How does a promised behavior become a check? | `.claude/harness/EVIDENCE.md` claim/capability contracts |
| `evidence/adapters.md` | How do I connect project tools? | `.claude/harness/EVIDENCE.md` and the runtime provider catalog |
| `evidence/receipts.md` | What does a result mean and when is it stale? | `.claude/harness/EVIDENCE.md` receipt and freshness contracts |
| `cli.md` | Which commands and protocol versions are supported? | `.claude/harness/commands.json`, `protocol.json`, and operator reference |

### Editing and review rules

1. Change the canonical contract first, then only the summaries and examples
   affected by it. If code and contract disagree, report and resolve the mismatch;
   copying the current code's behavior into prose is not sufficient validation.
2. Keep each root README at **300 lines or fewer** and each website quickstart
   at **160 lines or fewer**, excluding blank lines and compatibility anchors.
   These are reading budgets, not correctness scores. Move detail to the existing
   reference instead of compressing paragraphs into unreadable long lines.
3. Keep English and Thai pages aligned in behavior, authority, examples, and
   next steps in the same change. Preserve command names and identifiers;
   translate explanations naturally. File pairing alone does not prove parity.
4. Link to the canonical section for details. Preserve existing public anchors
   or redirects when moving sections, and repair inbound links when moving files.
5. Examples must use supported commands and state what the reader should see.
   Keep routine agent-owned commands out of the user's required action list.
6. Distinguish intended behavior, executed evidence, and historical observation.
   A report states its source/version, environment, and verification limits;
   unknown measurements stay unknown. Never refresh a date to imply revalidation.
7. Run the docs consistency suite for documentation changes and build the website
   when its pages or navigation change. Inspect changed pages for readability;
   passing checks do not establish semantic accuracy or usability.
8. Label every website page with one `docs-audience` category: `users`,
   `project-maintainers`, or `agents-integrators`, and a visible reader note.
   English and Thai counterparts use the same category. Audience describes who
   reads the page, not who owns or writes the files it discusses. The harness
   ownership reference owns that separate contract. Never describe generated
   records as disposable or project-owned packets as freely hand-editable.

The documentation guardrails run inside
`.claude/tests/docs/run-doc-consistency.sh`, which is already in the full suite.
They check reading budgets, bilingual page presence, and local links in the
repository entry guides. Existing checks cover protocol pins, public commands,
selected lifecycle semantics, and sidebar locales. Use focused checks while
editing; the full-suite policy under Verification commands remains unchanged.

## Repository map

Shipped product:

- `.claude/orchestrator.md` and `.claude/commands/` — agent-facing lifecycle.
- `.claude/harness/foundation.mjs` — composition root and compatibility entry.
- `.claude/harness/runtime/` — core, evidence, workflow, observability, and
  portable contracts.
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
- Consumer `.workflow/` directories are read-only legacy migration input; do
  not extend that format.

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

`install.sh` copies `.claude/harness` except its `tests/` and `fixtures/`
(`UNSHIPPED`); those stay repository-only.

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

Use the full registered suite runner as the final deterministic gate. Paid scenario
runs are separate release evidence: they require explicit spend authority,
must use disposable consumers, and must finish at `archived` with oracle and
clean-install verification. A release-report exit code 2 is a truthful promotion
blocker, not a deterministic test failure.

Before every new version, complete the scenario checkpoint in
[RELEASING.md](RELEASING.md). Retain a dated curated comparison in `docs/reports/`
and the raw evidence outside Git. Historical results never satisfy a new
candidate's checkpoint; paid execution remains explicitly budget-authorized.

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
- Keep user interaction to intent, consequential semantics, explicit Land, or
  external-side-effect authority. Agent work stays with the agent and
  deterministic workflow/setup/permission/recovery work stays with the harness.
- Before Land, only user decisions stop the flow; Land is the single hard gate
  ([WORKFLOW.md § Blocking policy](WORKFLOW.md#blocking-policy)).
- Optimize for delivery: reuse identity-valid work and run only dependency-
  invalidated Build, Review, and Prove work across all selected repositories.
- Preserve fail-closed isolation and unknown-as-unavailable measurement semantics.
- Do not weaken evidence, silently widen scope, infer user authority, or report
  `proven` as completion for a delivery flow.
- Do not commit, push, publish, or start paid execution without the corresponding
  user authority.
