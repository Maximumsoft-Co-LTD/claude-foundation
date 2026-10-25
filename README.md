# Change Loop

**English** | [ภาษาไทย](README.th.md)

Change Loop helps an AI coding agent agree on a change, build it in an isolated
workspace, check it with your project's tools, and deliver it back for review.

```text
Investigate? → Change → Build → Prove → Land
```

[OpenSpec](https://github.com/Fission-AI/OpenSpec) stores the agreement.
Your coding agent implements it; the harness manages state, isolation,
evidence, and recovery. Keep using your existing test framework, Git, and CI.

**Version 3.6.8** · Installed package and CLI: `claude-foundation`.

## Where to start

This README is for people using Change Loop. The [file ownership guide](https://claude-foundation.dev/docs/artifacts/)
separates project documents, installed system instructions, and runtime records.
Upstream development instructions are linked separately below.

| I want to… | Start here |
|---|---|
| Use Change Loop in my project | [Install](#install), then [Your first change](#your-first-change) |
| Follow a guided example | [Quickstart](https://claude-foundation.dev/docs/quickstart/) |
| Understand a command or decision | [Workflow overview](https://claude-foundation.dev/docs/loop/) and [human approval](https://claude-foundation.dev/docs/approval/) |
| Develop Change Loop itself | [Contributing](CONTRIBUTING.md) → [maintainer guide](CLAUDE.md) → [test guide](.claude/tests/README.md) |
| Integrate tools or debug the harness | [Operator guide](.claude/harness/README.md) and [evidence reference](.claude/harness/EVIDENCE.md) |
| Prepare a release or read past findings | [Release procedure](RELEASING.md) and [report index](docs/reports/README.md) |

## Install

Requires Node.js **20.19 or later**. Git is recommended for worktree isolation.
The installer prepares the pinned OpenSpec CLI when needed; npm access is
required if it is not already available.

```bash
brew tap maximumsoft-co-ltd/claude-foundation \
  https://github.com/Maximumsoft-Co-LTD/claude-foundation
brew install claude-foundation
claude-foundation init /path/to/your-project --yes
```

Claude Code works without an adapter. For another host, add
`--host cursor`, `--host opencode`, or `--host codex` to the init command.
Open a new agent session after installation.

Review and commit the installation files before your first change in a Git
project. The installer does not grant commit authority to the agent.

For source installation, prerequisites, host differences, headless/CI trust,
and upgrades, follow the [installation guide](https://claude-foundation.dev/docs/install/).
The agent can check readiness with `claude-foundation doctor --stage change`.

## Your first change

Suppose an account owner needs to edit their display name. Enter these commands
in your coding agent session, using the change ID it returns.

### 1. Create the agreement

```text
/change allow an account owner to edit their display name
```

The agent investigates the relevant code and creates an agreement under
`openspec/changes/<change-id>/`. Review the intended behavior, scope, failure
cases, and checks, then approve the compiled spec before Build.
The compiled OpenSpec packet—not chat or the temporary draft—is the source of truth.

If the problem is still unclear, start with
`/investigate why profile updates sometimes overwrite newer data`.
Investigation produces findings without starting implementation.

### 2. Build in an isolated workspace

```text
/build <change-id>
```

The agent implements code and tests in the declared isolated workspace.
It handles routine setup and repair. You provide consequential decisions;
you do not need to assemble internal harness commands.

### 3. Prove the result

```text
/prove <change-id>
```

The harness runs project-owned checks and reuses evidence that is still valid.
Build may already have advanced through Prove; this command resumes what remains.
Missing, failed, or inconclusive evidence is reported honestly. The agent fixes
repairable findings and reruns checks invalidated by its changes.

### 4. Land the current change

Review the result and remaining risks, then explicitly authorize Land:

```text
/land <change-id>
```

Land applies the current isolated change, synchronizes specs, and archives it.
The delivered diff stays **uncommitted**, with Git HEAD and index unchanged.
Only `archived` means code delivery is complete; it does not mean deployment
or production verification.

Land is the single hard gate: it lands only a passing proof of the current
workspace, and proves again first when that proof is stale. Before Land, the
harness stops only for your decisions. Target conflicts must be resolved.
See the [Land contract](WORKFLOW.md#land-change) for exact behavior.

### 5. Optionally deliver a pull request

```text
/deliver <change-id>
```

This separately authorizes the delivery workflow for an isolated commit, branch
push, and PR. Land alone never authorizes these actions. Deliver does not merge
or deploy. See [Deliver](WORKFLOW.md#deliver-change-optional).

## Which command should I use?

| Need | Command |
|---|---|
| Understand a problem before choosing a change | `/investigate <question>` |
| Agree on a change | `/change <intent>` |
| Implement the agreed change | `/build <change-id>` |
| Check or resume proof | `/prove <change-id>` |
| Apply and archive the change | `/land <change-id>` |
| Send the archived change for PR review | `/deliver <change-id>` |
| View active changes and next actions | `/changes` |
| Drive the lifecycle with one entrypoint | `/dev <intent>` |

`/dev` uses the same agreement and authority boundaries. Tell the agent when a
requirement changes; it amends the existing change and rechecks affected work.
For exact semantics, use [WORKFLOW.md](WORKFLOW.md).

## Safety boundaries

- **Agreement:** approve the compiled spec before Build. Settled decisions carry
  forward; new consequential choices remain yours.
- **Isolation:** a worktree or directory copy protects workspace integrity.
  It is not a process-security sandbox.
- **Evidence:** tools produce proof. Users never need to construct receipt commands
  or edit machine-owned proof JSON.
- **Acceptance:** deciding whether you must accept the result is separate from
  spec approval and review. The agent records that choice with
  `--acceptance-required` or `--acceptance-not-required`.
- **Review:** defaults `independence: "self"` and `diversity: "single-model"` are
  explicit assurance waivers. Risk-tiered routing does not restore reviewer independence or model diversity.
- **Authority:** Land, Git operations, and external actions have separate
  authority. See [human approval](https://claude-foundation.dev/docs/approval/).

## Operator commands and troubleshooting

| What happened | What to do |
|---|---|
| Commands are missing after installation | Open a new agent session |
| Build cannot start | Ask the agent to check readiness and repair setup |
| Proof became stale | Resume `/prove`; valid evidence is reused |
| Requirements changed | Tell the agent; amend the current change |
| Land stopped or conflicted | Resume `/land`; preserve edits and resolve the named conflict |
| You need the current state | Use `/changes` |

The agent owns routine recovery. If the target changed or Land was interrupted,
resume the same change; do not create a new change to recover it.
For diagnostics, use the
[operator guide](.claude/harness/README.md#troubleshooting).
Do not manually repair `.foundation/` records.

<!-- Preserve existing section links; detailed topics are indexed below. -->
<a id="how-the-ai-and-harness-divide-responsibility"></a>
<a id="why-use-it"></a>
<a id="headless--ci-claude--p"></a>
<a id="investigate-before-committing-to-a-change"></a>
<a id="the-workflow-in-one-picture"></a>
<a id="understanding-openspec"></a>
<a id="files-in-an-active-change"></a>
<a id="standard-and-rapid-lanes"></a>
<a id="understanding-change-states"></a>
<a id="what-evidence-means"></a>
<a id="when-the-requirement-changes-during-build"></a>
<a id="multiple-repositories"></a>
<a id="how-change-loop-scopes-agents-and-skills"></a>
<a id="execution-policy-in-foundationjson"></a>
<a id="what-is-the-source-of-truth"></a>
<a id="human-approval"></a>
<a id="verify-or-upgrade-an-installation"></a>

## Read more

| Topic | Detailed guide |
|---|---|
| Roles, states, lanes, and lifecycle rules | [WORKFLOW.md](WORKFLOW.md) |
| Files created, ownership, and sources of truth | [Artifacts](https://claude-foundation.dev/docs/artifacts/) |
| Review policy and execution limits | [foundation.json](https://claude-foundation.dev/docs/foundation-config/) |
| Multiple repositories | [Multi-repository workflow](https://claude-foundation.dev/docs/multi-repository/) |
| Providers, receipts, and proof freshness | [Evidence reference](.claude/harness/EVIDENCE.md) |
| Agent skills and runtime integration | [Harness guide](.claude/harness/README.md) |
| Current release evidence versus historical reports | [Report index](docs/reports/README.md) |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development and verification.
Report security issues through [SECURITY.md](SECURITY.md).
The [Code of Conduct](CODE_OF_CONDUCT.md) applies to all project spaces.

## License

MIT
