# Agent evals

**Audience:** maintainers of `claude-foundation`. Repository-only; nothing here
ships to consumers.

Evals check that the agent and harness still behave correctly on real tasks.
Each case is one JSON file in [cases/](cases/) named `<id>.json`.

| Field | Meaning |
|---|---|
| `id` | Same as the file name |
| `source` | `incident:<record id>` for an incident in `openspec/incidents/`, else `task:<what it covers>` |
| `layer` | `deterministic` (runs on every change, no model) or `paid` (real agent run) |
| `description` | The behavior the case protects |
| `command`, `expect` | Deterministic only: the command run from the repository root, its exit code (default 0), and `stdoutIncludes` |
| `scenario` | Paid only: a paid scenario id in `.claude/tests/bench/config/openspec-native-matrix.json` |

## Rules

- Every **closed** incident record needs at least one case whose `source` is
  `incident:<record id>`. The suite fails otherwise.
- A deterministic case should fail without the fix it protects. Prefer a
  focused command (`--test-name-pattern`) and assert on a test name, so a
  pattern that matches nothing cannot pass silently.

## Commands

| Command | What it does |
|---|---|
| `npm run evals` | Validates the catalog and runs deterministic cases (also in `run-all.sh`) |
| `npm run evals:owed` | Says whether a change to skills, rules, hooks, commands, `AGENT.md`, `orchestrator.md`, `CLAUDE.md`, or `AGENTS.md` owes paid evals; never fails |
| `npm run evals:paid -- --dry-run` | Shows the paid plan and this month's budget without calling a model |
| `npm run evals:paid -- --authorize-spend <decision-ref> [--case <id>]` | Runs paid cases through the bench lab in disposable consumers |

## Paid budget

Paid evals spend at most **$100 per calendar month (UTC)**. Before any model
call the runner adds this month's recorded spend to the planned per-case cost
ceilings and refuses when the total would exceed $100. Every run appends a row
to `.claude/tests/bench/results/evals-ledger.jsonl` (ignored by Git) with the
case, the authorizing decision, its ceiling, and the measured cost. A run whose
cost could not be measured counts at its full ceiling. Every paid run needs a
maintainer's explicit spend authorization; CI never runs them.
