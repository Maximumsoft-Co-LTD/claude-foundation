# claude-foundation

> One command. A full engineering team. Every artifact on disk.

**claude-foundation** turns [Claude Code](https://claude.com/claude-code) from a very smart pair-programmer into a disciplined engineering pipeline. Drop it into any repo and you get a single entry point — `/dev <intent>` — that drives a small team of specialist agents through:

```
spec → plan → gate → implement → review → (security) → test → docs → ship → retro
```

No vibes-based "looks good overall" reviews. No regression-test-shaped holes. No "wait, what did we decide last week?" — every run leaves a folder of artifacts behind, and every run is resumable.

```
/dev fix the login redirect loop
```

…and the pipeline writes the failing regression test **before** the fix, because a `fix` that can't prove the bug existed can't ship.

## Why this exists

AI coding fails in predictable ways: silent assumptions, skipped tests, reviews that rubber-stamp, context that evaporates between sessions. The fix isn't a smarter model — it's **process**. claude-foundation encodes that process so you don't have to remember it:

- **The planner is not the implementer.** Roles are split across sub-agents (`pm`, `lead`, `engineer`, `qa`, `retro`) so review is adversarial, not self-congratulatory.
- **The flow is type-aware.** A `chore` skips QA. A `fix` reproduces the bug first. A `spike` is timeboxed and produces a recommendation instead of code. Same pipeline, different teeth.
- **Everything is auditable.** `spec.md`, `plan.md`, `review.md`, `tests.md`, `retro.md`, `state.json` — written to `.workflow/<run-id>/`, replayable, hand-off-able, resumable with `/dev --resume <id>`.

## Install via Homebrew

On macOS (and Linux with Homebrew), add the tap, trust it, then install:

```bash
brew tap maximumsoft-co-ltd/claude-foundation https://github.com/Maximumsoft-Co-LTD/claude-foundation
brew trust maximumsoft-co-ltd/claude-foundation   # required — Homebrew refuses untrusted third-party taps
brew install claude-foundation
```

> **Stable vs latest.** `brew install claude-foundation` installs the latest tagged release (recommended) — `brew update && brew upgrade claude-foundation` then picks up new releases the normal way. To track the bleeding edge of `main` instead, use `brew install --HEAD claude-foundation`; a HEAD install only updates via `brew upgrade --fetch-HEAD claude-foundation` or `brew reinstall --HEAD claude-foundation` (plain `brew upgrade` skips HEAD installs).

> **`brew trust` is required.** Recent Homebrew refuses to load formulae from a third-party/private tap until you trust it — without it you'll see `Refusing to load formula … from untrusted tap`. Run `brew trust maximumsoft-co-ltd/claude-foundation` (whole tap) once after tapping.

> **Seeing `No available formula with the name "claude-foundation"` right after `brew tap`?** Your tap clone is stale (it was tapped before the formula reached the default branch). Homebrew does not auto-refresh taps on install — run `brew update` (or `brew untap maximumsoft-co-ltd/claude-foundation` then re-tap) to pull the latest, then install again.

Then run inside any target project to scaffold the foundation there:

```bash
cd /path/to/myproject
claude-foundation
```

All flags from `install.sh` are forwarded unchanged (`--dry-run`, `--force`, `--yes`, `--help`, `[target-path]`).

**Windows / non-brew:** Homebrew is not available on Windows. Clone the repo and run `install.sh` directly — see [Quick start](#quick-start) below.

**Two ways to host the tap** — pick one before others can install:

- **This repo, via the explicit URL (what the commands above use).** Because `brew tap … https://github.com/Maximumsoft-Co-LTD/claude-foundation` passes the repo URL explicitly, Homebrew taps *this* repository directly and finds `Formula/claude-foundation.rb` here — so **no separate tap repo is required**. You only need to push this repo so the URL is reachable.
- **The shorthand tap name (optional).** If you'd rather users type the shorthand `brew tap maximumsoft-co-ltd/claude-foundation` (no URL) or `brew install maximumsoft-co-ltd/claude-foundation/claude-foundation`, Homebrew resolves that name to a repo literally named **`homebrew-claude-foundation`** under the `Maximumsoft-Co-LTD` org. Create that repo, move `Formula/claude-foundation.rb` into it, and publish — then the URL argument is no longer needed. See the [Homebrew tap docs](https://docs.brew.sh/How-to-Create-and-Maintain-a-Tap).

Releasing: the formula now ships a stable tagged release (`url` + `sha256`, currently `v1.3.0`) alongside the `head` block, so `brew install claude-foundation` and `brew upgrade` work the normal way. See [`RELEASING.md`](RELEASING.md) for the runbook to cut the next version (bump `CHANGELOG` → tag → recompute `sha256` → update the formula).

## Quick start

From this repo's root, install into any target project:

```bash
./install.sh /path/to/your/project
```

Then open Claude Code inside that project and go:

```
/dev create a todo app with localStorage
/dev add an audit log to the back-office
/dev fix the login redirect loop
/dev spike compare bullmq vs sidekiq
/dev --resume 0003-fix-login-redirect
```

Installer flags:

| Flag | What it does |
|---|---|
| `--dry-run` | Print the plan, write nothing |
| `--force` | Also overwrite `.claude/settings.json` (foundation-owned files are already refreshed every run) |
| `--yes` | Skip the confirmation prompt |
| `--source <path>` | Install from a foundation checkout other than this one |

## How a run flows

The main agent **is** the orchestrator (following [`.claude/orchestrator.md`](.claude/orchestrator.md)) — Claude Code sub-agents can't spawn agents or talk to you, so the interview, fanout dispatch, and the gate all live in the main agent. It picks the next run ID (`NNNN-<type>-<slug>`), creates `.workflow/<id>/`, and drives:

| # | Phase | Who | The point |
|---|-------|-----|-----------|
| 1 | **Spec** | orchestrator + `pm` | Reads `FOLLOWUPS.md`, distils your pre-`/dev` conversation into a requirements digest, fans out research probes when guessing is risky, interviews you for *only* what's still open (≤4 questions, one batch), then `pm` writes `spec.md`. A `fix` includes a reproduction; a `spike` gets a timebox. |
| 2 | **Plan** | `lead` | Synthesises codebase exploration + best-practice research into `plan.md` with re-resolvable `path#anchor` references, risks, and verification. For `fix`, step 1 is always "write the failing regression test". |
| 3 | **Gate** | you | The only mandatory stop. Reply `approve` / `revise <notes>` / `swap <n>` (epic only). A `revise` is a targeted in-run edit — never a fresh restart. |
| 4 | **Implement** | `engineer` | Executes the plan with task-level progress tracking. Ticks each acceptance criterion in `spec.md` or files a blocker — unticked criteria block ship. |
| 5 | **Review** | `lead` | Row-by-row against `plan.md` **and** `spec.md`'s acceptance criteria (error/boundary clauses included), plus Definition-of-Done items and Constraints. Checklist-driven; "looks good overall" is banned. |
| 6 | **Security** | `lead` | *Trigger-based* — fires only when the diff touches auth, SQL, crypto, secrets, exec, deserialisation, or untrusted input. High findings are blocking. |
| 7 | **Test** | `qa` | Unit + integration + e2e, every acceptance criterion mapped to a test. For `fix`, verifies the regression test fails on pre-fix code and passes now. Skipped (with a stub) for `chore`/`docs`/`spike`. |
| 8 | **Docs** | `engineer` | Inline comments where the *why* is non-obvious. |
| 9 | **Ship** | `engineer` | Stages, commits with a spec-aware message, optionally opens a PR via `gh`. Records commit + PR URL in `state.json`. |
| 10 | **Retro** | `retro` | Writes `retro.md`, carries follow-ups into `.workflow/FOLLOWUPS.md` (which `pm` reads on every new run — deferred work doesn't get lost), surfaces memory + skill candidates for your approval. |

**Phase 1 is interactive; Phase 2 is autonomous.** Once you `approve` at the gate, the orchestrator only stops for blocking review issues (max 2 cycles), failing tests (max 3 cycles), or genuine ambiguity.

**The machinery scales with the work.** Type decides *which* phases run; **size** (XS/S/M/L, estimated from your request before any question is asked) decides *how much machinery* each phase gets. A one-line text fix takes the XS fast path — one merged question batch, spec+plan in a single `lead` spawn, docs+ship merged, retro inline (~4 worker spawns total) — while an M/L run gets the full pipeline above. The contract never shrinks: the interview, the gate with per-line acceptance confirmation, and the security trigger run at every size, and any worker can escalate the size mid-run (never the reverse).

Full definition: [`WORKFLOW.md`](WORKFLOW.md).

## What's in the box

- **`/dev` slash command** — the single entry point. Pass `--resume <id>` to pick up an interrupted run from its `state.json` cursor.
- **Five workflow sub-agents + fanout workers** — `pm`, `lead` (plan / review / security modes), `engineer` (implement / docs / ship modes), `qa`, `retro`, plus `team-*` workers for parallel spec research, plan exploration, review, security, and test fanout. Each has an explicit `model:` for cost/speed tuning.
- **Artifact templates** — `spec.md`, `plan.md`, `review.md`, `security.md`, `tests.md`, `recommendations.md`, `retro.md`, `epic.md`, `state.json`. Agents copy from `_templates/` into a per-run folder; nothing freeform.
- **Type-aware phase matrix** — the same numbered phases run for every type; the orchestrator skips or specialises them based on `Type` (see `WORKFLOW.md`).
- **Size-aware execution matrix** — XS/S runs take a fast path (merged question batch, combined spec+plan spawn, merged docs+ship, inline retro) while M/L runs get the full machinery; upgrades are one-way via a `SIZE_UPGRADE` signal (see `WORKFLOW.md`).
- **Always-on skill rules** — lean rules in `.claude/rules/` (each ~3 lines: trigger + one-sentence why + skill pointer), led by `coding-discipline` (the conduct layer that wraps the rest), then the construction chain `ddd-strategic` → `programming-fundamentals` → `concurrency-fundamentals` → `database-fundamentals` → `hexagonal-backend` → `architecture-fundamentals` → `queue-fundamentals` → `security-fundamentals` → `observability-fundamentals`, the verification skills `debug-fundamentals` / `refactoring-fundamentals` / `testing-fundamentals`, and the delivery channel `git-workflow` / `delivery-engineering`. Full skill bodies load on demand; the cross-skill run order lives in exactly one file, `.claude/rules/fundamentals.md`.
- **Hooks** — a PreToolUse spawn guard for the `/dev` state machine, a PostToolUse state marker and lint dispatch, and a secrets guard that blocks reads of `.env` and credential files.
- **Skill-creator handoff** — `retro` lists skill candidates, you approve, the orchestrator spawns `skill-creator` for each. Nothing auto-creates.
- **Installer** — `install.sh` with `--dry-run`, `--force`, and a self-copy guard.

## What lands in your repo

```
.claude/agents/          pm, lead, engineer, qa, retro + team-* fan-out workers + TEAM.md   (always refreshed)
.claude/orchestrator.md  orchestrator script for the main agent                             (always refreshed)
.claude/commands/dev.md  the /dev slash command                                             (always refreshed)
.claude/skills/          fundamentals skills (construction + verification + delivery) +
                         plan-writing, brainstorming, fanout-team-agents, qa-handoff-note,
                         frontend/UX skills, skill-creator                                  (always refreshed)
.claude/rules/           16 always-on pointers to the skills                                (always refreshed)
.claude/hooks/*.sh       PreToolUse spawn guard + secrets guard, PostToolUse lint + state marker  (always refreshed)
.claude/settings.json    hook wiring                                                        (only if missing; existing files get a merge)
.workflow/_templates/    spec / plan / review / security / tests / recommendations /
                         retro / epic / state.json                                          (always refreshed)
.workflow/INDEX.md       run registry                                                       (only if missing)
.workflow/FOLLOWUPS.md   follow-up registry                                                 (only if missing)
WORKFLOW.md              full flow reference at repo root                                   (always refreshed)
CLAUDE.md                minimal stub                                                       (only if missing)
```

**Your state is safe.** `INDEX.md`, `FOLLOWUPS.md`, and `CLAUDE.md` are never overwritten, and `.claude/settings.local.json` is never touched. Foundation-owned files (agents, orchestrator, commands, skills, rules, hooks, templates, `WORKFLOW.md`) are **always refreshed** on every install so upstream updates land — fork them out of these paths if you don't want a local edit clobbered.

**Already have `.claude/settings.json`?** The installer leaves it alone — your `permissions` / `model` / `env` are not rewritten; only the foundation hook wiring is merged in via jq (`--force` is what makes it overwrite wholesale). If the merge can't apply cleanly, the installer drops a pure-JSON snippet at `.claude/settings.foundation.json` with merge instructions — copy the `hooks` block in (appending to any existing `PostToolUse` array), then delete the snippet. Don't want the lint hook? Just delete the snippet file.

## Team presence dashboard

Beyond the `/dev` pipeline, claude-foundation ships a small **team awareness dashboard**. Each machine runs a background client; a zero-dependency Node server (deploys to Railway in minutes) serves one shared web page that shows, in real time:

- **Presence** — who's online right now (git name + host; in-memory, 30s window).
- **Working in** — which repos each person has uncommitted changes in, with the local folder path and an optional label (`git config dashboard.label "…"`) so nested or same-named sub-repos stay distinct.
- **/dev activity** — the in-flight run and phase, read straight from `state.json`.
- **Potential conflicts** — when two people's changed line ranges in the same file overlap, both are warned **before** anyone merges (it catches uncommitted work a git server can't see yet).

Control it from any machine on the flow:

```bash
claude-foundation dashboard-up   --key <shared-key>   # start reporting (background, no port)
claude-foundation dashboard-status                    # is it running?
claude-foundation dashboard-down                      # stop — drops you off the board immediately
```

- **No port, no collisions.** The client binds nothing — it's a background process tracked by a PID file (`~/.claude-foundation/dashboard.pid`) that only sends outbound heartbeats. The one port in the system is the server's, and Railway assigns that automatically.
- **Identity** on the board = a shared key (auth) + a stable per-machine id + your `git config user.name`.
- **Presence is in-memory.** "Online" means a heartbeat arrived within the last 30s; stop the client (or close the laptop) and you fall off the board within the window.

**Try it now:** the board has a **demo mode** that renders sample data through the real UI — no key needed. **[View the live demo →](https://claude-foundation-dashboard-production.up.railway.app/?demo)**

Stand up your own server and wire it in a few minutes — full deploy steps, API endpoints, and security notes live in [`dashboard/README.md`](dashboard/README.md).

> **Availability.** The `dashboard-*` subcommands route through `cli.sh` (the top-level router that also dispatches the installer). They ship with a source checkout and `brew install --HEAD` today, and fold into the stable Homebrew release next version.

## Design principles

- **Single entry point.** One command, one flow. No separate `/plan`, `/review`, `/test` to forget — the orchestrator runs them in order so nothing gets skipped.
- **Reproduce before fix.** A `fix` run can't ship without a regression test that fails on pre-fix code and passes now. Enforced at plan time (step 1), implement time (engineer writes it first), and test time (qa verifies the failure mode).
- **Acceptance criteria are first-class.** Engineer ticks them, lead re-checks them, qa maps each to a test, retro reports their final state. Unticked criteria block ship.
- **Anti-bias review.** Because `lead` reviews their own plan, review mode is row-by-row against `plan.md` AND `spec.md` — one verification per file, one row per acceptance criterion, DoD item, and Constraint. No vibes.
- **Security as a trigger, not a tax.** Most runs don't touch auth or SQL; those skip the security pass entirely. Runs that do get an inline checklist — nothing outsourced to an external tool.
- **Scope splits are rare.** Default is one run, even when DB + API + UI all change. Epic mode only kicks in when the spec lists ≥2 independently-shippable capabilities *and* `Ship as: staged`.
- **Lean always-on context.** Rules are 3-line pointers; full skill bodies load on demand. Every sub-agent spawn reloads `CLAUDE.md` + rules, so always-on weight is paid *per agent* — keeping it lean compounds across a `/dev` run.
- **Artifacts on disk + resumable.** Every run leaves a folder behind, including `state.json`. Replay it, audit it, hand it off — or if the session dies, `/dev --resume <id>` and keep going.

## Repository layout

```
.claude/
├── agents/         pm, lead, engineer, qa, retro + team-* fanout workers
├── orchestrator.md script the main agent follows when /dev runs
├── commands/       dev.md (loads orchestrator.md)
├── hooks/          spawn guard, state marker, lint dispatch, secrets guard
├── rules/          16 lean always-on pointers (conduct + run order + fundamentals)
└── skills/         full skill bodies referenced by the rules
.workflow/
├── _templates/     blueprints — copy, don't edit in place
├── INDEX.md        run registry
└── FOLLOWUPS.md    carry-over registry
dashboard/          team presence dashboard — Node server + web UI + heartbeat client
├── server.js       zero-dep API + static dashboard
├── public/         the web board (vanilla HTML/CSS/JS)
└── client.sh       dashboard-up / -down / -status
cli.sh              top-level CLI router (installer ↔ dashboard subcommands)
install.sh          installs the foundation into a target project
docs/
WORKFLOW.md         full flow definition
CLAUDE.md           per-project guidance
```

## License

[MIT](LICENSE) © Maximumsoft Co., Ltd.
