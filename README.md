# claude-foundation

An opinionated command workflow for [Claude Code](https://claude.com/claude-code), built for AI engineers. Drop it into a project and you get a single entry point — `/dev <intent>` — that runs a small team of specialist agents through spec → plan → gate → implement → review → test → retro, with every artifact written to disk.

## What's in the box

- **`/dev` slash command** — single entry point for any change, new project or existing codebase.
- **Six agents** — `orchestrator`, `pm`, `lead`, `engineer`, `qa`, `retro`. Roles are split so the planner is not the implementer and the reviewer is checklist-driven against the plan they wrote.
- **Artifact templates** — `spec.md`, `plan.md`, `review.md`, `tests.md`, `retro.md`, `epic.md`. Agents copy from `_templates/` into a per-run folder; nothing freeform.
- **Always-on skill rules** — pre-flight pointers for `programming-fundamentals`, `database-fundamentals`, `hexagonal-backend`, and `queue-fundamentals`. Each rule loads its full skill before code lands.
- **Installer** — `install.sh` drops the workflow into any target repo, with `--dry-run`, `--force`, and self-copy guard.

## Install

From the repo root:

```bash
./install.sh /path/to/your/project
```

Useful flags:

- `--dry-run` — print the plan, write nothing.
- `--force` — overwrite existing agent/command/template files.
- `--yes` — skip the confirmation prompt.
- `--source <path>` — install from a foundation checkout other than this one.

What lands in the target:

```
.claude/agents/          orchestrator, pm, lead, engineer, qa, retro
.claude/commands/dev.md  the /dev slash command
.workflow/_templates/    spec / plan / review / tests / retro / epic
.workflow/INDEX.md       run registry (only if missing)
WORKFLOW.md              full flow reference at repo root
CLAUDE.md                minimal stub (only if missing)
```

`INDEX.md` and `CLAUDE.md` are never overwritten — they hold user state.

## Using `/dev`

Inside the target project, open Claude Code and run:

```
/dev create a todo app with localStorage
/dev add an audit log to the back-office
/dev fix the login redirect loop
```

The orchestrator picks the next run ID (`NNNN-<type>-<slug>`), creates `.workflow/<id>/`, and drives the flow:

1. **Spec** — `pm` interviews you (≤4 questions, one batch) and writes `spec.md`.
2. **Plan** — `lead` reads the spec, reverse-engineers existing code via LSP, writes `plan.md` with `file:line` references and risks.
3. **Gate** — orchestrator shows you spec + plan; you reply `approve` / `revise <notes>` / `swap <n>` (epic only).
4. **Implement** — `engineer` executes the plan with `TaskCreate` progress tracking.
5. **Review** — `lead` checks the diff against `plan.md` (checklist-driven; "looks good overall" is banned).
6. **Test** — `qa` writes and runs unit + integration + e2e, records results in `tests.md`.
7. **Docs** — `engineer` touches up inline comments where the *why* is non-obvious.
8. **Retro** — `retro` writes `retro.md` and surfaces memory candidates for you to confirm.

Full definition: [`WORKFLOW.md`](WORKFLOW.md).

## Repository layout

```
.claude/
├── agents/         orchestrator, pm, lead, engineer, qa, retro
├── commands/       dev.md
├── hooks/
├── rules/          programming / database / hexagonal / queue fundamentals
└── skills/         full skill bodies referenced by the rules
.workflow/
├── _templates/     blueprints — copy, don't edit in place
└── INDEX.md        run registry
docs/
install.sh
WORKFLOW.md         full flow definition
CLAUDE.md           per-project guidance
```

## Design notes

- **Single entry point.** One command, one flow. No separate `/plan`, `/review`, `/test` — the orchestrator runs them in order so nothing gets skipped.
- **Phase 1 is interactive; Phase 2 is autonomous.** The gate is non-negotiable. Once you `approve`, the orchestrator only stops on blocking review issues (max 2 cycles), failing tests (max 3 cycles), or genuine ambiguity.
- **Artifacts on disk.** Every run leaves a folder behind. You can replay, audit, or hand off a feature by pointing at `.workflow/<id>/`.
- **Scope splits are rare.** Default is one run, even when DB + API + UI all change. The planner enters epic mode only when the spec lists ≥2 independently-shippable capabilities *and* `Ship as: staged` is set.
- **Anti-bias review.** Because `lead` reviews their own plan, review mode is row-by-row against `plan.md`. One verification per file. No vibes.

## License

Not yet specified.
