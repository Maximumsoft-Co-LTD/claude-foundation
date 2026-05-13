# claude-foundation

An opinionated command workflow for [Claude Code](https://claude.com/claude-code), built for AI engineers. Drop it into a project and you get a single entry point — `/dev <intent>` — that runs a small team of specialist agents through spec → plan → gate → implement → review → (security) → test → docs → ship → retro, with every artifact written to disk. The flow is **type-aware**: a `chore` skips QA, a `fix` writes its regression test first, a `spike` is timeboxed and produces a recommendation instead of code.

## What's in the box

- **`/dev` slash command** — single entry point for any change. Pass `--resume <id>` to pick up an interrupted run from its `state.json` cursor.
- **Six agents** — `orchestrator`, `pm`, `lead` (plan / review / security modes), `engineer` (implement / docs / ship modes), `qa`, `retro`. Roles are split so the planner is not the implementer and the reviewer is checklist-driven against the plan they wrote and the spec's acceptance criteria.
- **Artifact templates** — `spec.md`, `plan.md`, `review.md`, `security.md`, `tests.md`, `recommendations.md`, `retro.md`, `epic.md`, `state.json`. Agents copy from `_templates/` into a per-run folder; nothing freeform.
- **Type-aware phase matrix** — the same numbered phases run for every type, but `orchestrator` skips or specialises them based on `Type` (see `WORKFLOW.md`).
- **Carry-over follow-ups** — `retro` appends to `.workflow/FOLLOWUPS.md`; `pm` reads it on every new interview so deferred work doesn't get lost.
- **Skill-creator handoff** — after `retro` lists skill candidates, the orchestrator asks the user which to create and spawns `skill-creator` for each approval. Nothing auto-creates.
- **Resume** — every step writes `state.json`; `/dev --resume <id>` continues where the run left off.
- **Always-on skill rules** — pre-flight pointers for `programming-fundamentals`, `database-fundamentals`, `hexagonal-backend`, `queue-fundamentals`, `debug-fundamentals`. Each rule loads its full skill before code lands.
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
.workflow/_templates/    spec / plan / review / security / tests / recommendations / retro / epic / state.json
.workflow/INDEX.md       run registry (only if missing)
.workflow/FOLLOWUPS.md   follow-up registry (only if missing)
WORKFLOW.md              full flow reference at repo root
CLAUDE.md                minimal stub (only if missing)
```

`INDEX.md`, `FOLLOWUPS.md`, and `CLAUDE.md` are never overwritten — they hold user state.

## Using `/dev`

Inside the target project, open Claude Code and run:

```
/dev create a todo app with localStorage
/dev add an audit log to the back-office
/dev fix the login redirect loop
/dev spike compare bullmq vs sidekiq
/dev --resume 0003-fix-login-redirect
```

The orchestrator picks the next run ID (`NNNN-<type>-<slug>`), creates `.workflow/<id>/`, and drives the flow:

1. **Spec** — `pm` reads `FOLLOWUPS.md`, interviews you (≤4 questions, one batch), writes `spec.md`. For `fix`, includes a reproduction; for `spike`, a timebox.
2. **Plan** — `lead` reads the spec, reverse-engineers existing code via LSP, writes `plan.md` with `file:line` references, risks, and (when relevant) a rollback section. For `fix`, plan step 1 is "write failing regression test"; for `refactor`, includes a behavior-equivalence statement.
3. **Gate** — orchestrator shows you spec + plan + the type-aware step list; you reply `approve` / `revise <notes>` / `swap <n>` (epic only).
4. **Implement** — `engineer` executes the plan with `TaskCreate` progress tracking. For `fix`, writes the failing regression test BEFORE the fix. Before signalling done, ticks each acceptance criterion in `spec.md` or files a blocker.
5. **Review** — `lead` checks the diff against `plan.md` AND `spec.md > Acceptance criteria` (checklist-driven; "looks good overall" is banned).
6. **Security review** *(trigger-based)* — fires when the diff touches sensitive paths (auth, SQL, crypto, secrets, exec, deserialise, untrusted input). `lead` writes `security.md` from an inline checklist. High findings are blocking.
7. **Test** — `qa` writes and runs unit + integration + e2e, mapping every acceptance criterion to a test. For `fix`, verifies the regression test fails on pre-fix code and passes now. Skipped (with one-line stub) for `chore` / `docs` / `spike`.
8. **Docs** — `engineer` touches up inline comments where the *why* is non-obvious.
9. **Ship** — `engineer` stages, commits with a spec-aware message, and (if opted in) opens a PR via `gh`. Records commit + PR URL in `state.json`. Skipped for `spike` unless requested.
10. **Retro** — `retro` writes `retro.md`, appends new items to `FOLLOWUPS.md`, marks consumed ones closed, surfaces memory + skill candidates. For each approved skill candidate, orchestrator hands off to `skill-creator`.

Full definition: [`WORKFLOW.md`](WORKFLOW.md).

## Repository layout

```
.claude/
├── agents/         orchestrator, pm, lead, engineer, qa, retro
├── commands/       dev.md
├── hooks/
├── rules/          programming / database / hexagonal / queue / debug fundamentals
└── skills/         full skill bodies referenced by the rules
.workflow/
├── _templates/     blueprints — copy, don't edit in place
├── INDEX.md        run registry
└── FOLLOWUPS.md    carry-over registry
docs/
install.sh
WORKFLOW.md         full flow definition
CLAUDE.md           per-project guidance
```

## Design notes

- **Single entry point.** One command, one flow. No separate `/plan`, `/review`, `/test` — the orchestrator runs them in order so nothing gets skipped.
- **Phase 1 is interactive; Phase 2 is autonomous.** The gate is non-negotiable. Once you `approve`, the orchestrator only stops on blocking review issues (max 2 cycles), failing tests (max 3 cycles), or genuine ambiguity.
- **Type-aware.** `feat`, `fix`, `refactor`, `chore`, `docs`, `spike` don't all need the same phases. The phase matrix in `WORKFLOW.md` is the source of truth.
- **Reproduce before fix.** A `fix` run can't ship without a regression test that fails on the pre-fix code and passes on the current code. The contract is enforced at plan time (step 1), implement time (engineer writes it first), and test time (qa verifies failure mode).
- **Acceptance criteria are first-class.** Engineer ticks them, lead re-checks them, qa maps each to a test, retro reports their final state. Unticked criteria block ship.
- **Artifacts on disk + resumable.** Every run leaves a folder behind, including `state.json`. You can replay, audit, hand off, or — if the session dies — resume with `/dev --resume <id>`.
- **Scope splits are rare.** Default is one run, even when DB + API + UI all change. The planner enters epic mode only when the spec lists ≥2 independently-shippable capabilities *and* `Ship as: staged` is set.
- **Anti-bias review.** Because `lead` reviews their own plan, review mode is row-by-row against `plan.md` AND `spec.md`. One verification per file, one row per acceptance criterion. No vibes.
- **Security as a trigger, not a tax.** Most runs don't touch auth or SQL; those don't get a security pass. Runs that do touch sensitive paths run an inline checklist; nothing is outsourced to an external tool.

## License

Not yet specified.
