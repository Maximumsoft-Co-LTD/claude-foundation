# claude-foundation

> One command. A full engineering team. Every artifact on disk.

**claude-foundation** turns [Claude Code](https://claude.com/claude-code) from a very smart pair-programmer into a disciplined engineering pipeline. Drop it into any repo and you get a single entry point — `/dev <intent>` — that drives a small team of specialist agents through:

```
spec → plan → gate → implement → test → review → (security) → docs → ship → retro
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
- **Everything is auditable.** `spec.md`, `plan.md`, `tasks.md`, `test-plan.md`, `review.md`, `tests.md`, `retro.md`, `state.json` — written to `.workflow/<run-id>/`, replayable, hand-off-able, resumable with `/dev --resume <id>`.

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
claude-foundation init        # bare `claude-foundation` does the same
```

The CLI surface:

| Command | What it does |
|---|---|
| `claude-foundation init [target-path] [options]` | Install the `/dev` workflow (default target: current dir) |
| `claude-foundation version` | Print the installed version |
| `claude-foundation help` | Top-level command map (also `--help` / `-h`) |
| `claude-foundation dashboard-up\|-status\|-down` | Team-presence client (see [Team presence dashboard](#team-presence-dashboard)) |

Installer flags (`--dry-run`, `--force`, `--yes`, `--source <path>`, `[target-path]`) are forwarded through `init` (and through the bare form) to `install.sh`; run `claude-foundation init --help` to list them.

**Windows / non-brew:** Homebrew is not available on Windows. Clone the repo and run `install.sh` directly — see [Quick start](#quick-start) below.

**Two ways to host the tap** — pick one before others can install:

- **This repo, via the explicit URL (what the commands above use).** Because `brew tap … https://github.com/Maximumsoft-Co-LTD/claude-foundation` passes the repo URL explicitly, Homebrew taps *this* repository directly and finds `Formula/claude-foundation.rb` here — so **no separate tap repo is required**. You only need to push this repo so the URL is reachable.
- **The shorthand tap name (optional).** If you'd rather users type the shorthand `brew tap maximumsoft-co-ltd/claude-foundation` (no URL) or `brew install maximumsoft-co-ltd/claude-foundation/claude-foundation`, Homebrew resolves that name to a repo literally named **`homebrew-claude-foundation`** under the `Maximumsoft-Co-LTD` org. Create that repo, move `Formula/claude-foundation.rb` into it, and publish — then the URL argument is no longer needed. See the [Homebrew tap docs](https://docs.brew.sh/How-to-Create-and-Maintain-a-Tap).

Releasing: the formula ships a stable tagged release (`url` + `sha256`) alongside the `head` block, so `brew install claude-foundation` and `brew upgrade` work the normal way. The repo [`VERSION`](VERSION) is the source of truth for the next release; the formula is updated during the release runbook after the tag exists and the `sha256` can be recomputed. See [`RELEASING.md`](RELEASING.md).

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

The main agent **is** the orchestrator (following [`.claude/orchestrator.md`](.claude/orchestrator.md)) — Claude Code sub-agents can't talk to you, so the interview, the gate, and single-writer `state.json` all live in the main agent. The splittable workers hold `Agent` and self-dispatch their own helpers directly when their work is large (Claude Code v2.1.172+), with the orchestrator-mediated fanout signal as the fallback. The main agent picks the next run ID (`NNNN-<type>-<slug>`), creates `.workflow/<id>/`, and drives:

| # | Phase | Who | The point |
|---|-------|-----|-----------|
| 1 | **Spec** | current Design executor | Main/fork writes when interview + code map are warm; one combined `lead` is used only for a context/isolation proof. `pm` is limited to `/spec` or a proof-gated split chain. |
| 2 | **Plan** | same Design executor | Produces `plan.md` and dependency-ordered `tasks.md`, each task tied to ACs and a runnable `verify:`. |
| 2½ | **Test plan** | same Design executor; `qa` only by proof | Maps each AC to its test level and fixtures. A separate QA worker requires an independent test-contract or tooling reason. |
| 3 | **Contract Gate** | orchestrator + you | Deterministic artifact/AC-set checks run first; human approval validates intent and hard-to-reverse choices. Code-type Test/Ship Gate and triggered Review/Security cannot be skipped. |
| 4 | **Implement** | main for micro work; bounded Sonnet `engineer` for volume | ≥3 code tasks/files, a test-fix loop, or >~2K expected generation justifies one Sonnet worker; size alone and deterministic work do not. |
| 5 | **Change Gate: Test** | main for known harness; `qa` by proof | Runs Impacted and writes authoritative AC evidence in `tests.md`. Browser/e2e, new harness or multi-repo coordination justify QA. |
| 6 | **Change Gate: Review** | main at S; independent `lead` for runtime/Sonnet M/L | Consumes Test evidence and checks task adherence plus semantic/contract risks. Optional non-triggered lightweight review may skip by Type. |
| 7 | **Security** | `lead` | *Trigger-based* — fires only when the diff touches auth, SQL, crypto, secrets, exec, deserialisation, or untrusted input; a fired trigger rides the same `lead` spawn as review (one spawn, two artifacts). High findings are blocking. |
| 7½ | **Ship Gate** | orchestrator | Runs Full + lint/type/static once per converged final diff before docs/ship. |
| 8 | **Docs** | main; S merged exception; `engineer` for substantial docs | Small touch-ups stay inline except the retained S Docs+Ship bundle; new pages or source-heavy restructuring can justify a worker. |
| 9 | **Ship** | orchestrator; S merged exception; `engineer` only by proof | Deterministic stage/commit/PR stays inline at XS/M/L; commit remains opt-in. |
| 10 | **Retro** | orchestrator; `retro` only by proof | Writes `retro.md` inline. A worker is used only for substantial multi-repo synthesis or an explicitly deep retrospective. |

**Phase 1 is interactive; Phase 2 is autonomous.** Once you `approve` at the gate, the orchestrator only stops for blocking review issues (max 2 cycles), failing tests (max 3 cycles), or genuine ambiguity.

**The machinery scales with evidence, not size alone.** Size sets a spawn ceiling: XS/S `fast` (0/≤2), M `standard` (≤3), L `deep` (≤5). Phases may spawn for independent judgment, a material context gap, tooling isolation, proven parallel payoff, or Implement execution volume. This lets main Opus keep decisions while one bounded Sonnet worker handles substantial code generation. L alone means neither a spawn nor an Opus worker.

The route is multi-axis rather than “Size S always does X”: workload profile,
risk, ambiguity, required evidence, implementation volume, and coupling decide the
phase depth. This prevents a Todo UI, a compatibility fix, and authentication/profile
work from buying the same Interview/Test/Review machinery. Opus main carries a
profile-specific turn target/ceiling; phase workers are foreground with structured
terminal returns.

Full definition: [`WORKFLOW.md`](WORKFLOW.md).

## What's in the box

- **`/dev` slash command** — the single entry point. Pass `--fast` for the bounded low-spawn profile (XS 0, S ≤2) or `--resume <id>` to pick up an interrupted run.
- **Team-mode commands** — run one role at a time, writing into a shared `.workflow/<id>/` run, so you can drive the pipeline like a team instead of only through the monolithic `/dev`. `/spec` interviews and `pm` writes `spec.md`; `/dev-plan` has `lead` write `plan.md`; `/test-plan` has `qa` design `test-plan.md`; `/uxui-plan` has the `uxui` agent write `uxui-plan.md` (scenes, ASCII wireframes, scenarios, UX direction, AC↔scene mapping); and `/implement` starts **Phase 2** directly — it gates the run (human sign-off, if not already approved) then runs the autonomous build (implement → test → review → security → docs → ship → retro). A typical flow: `/spec` → `/dev-plan` → `/test-plan` (+ `/uxui-plan` if UI) → `/implement`. `/implement` and `/dev --resume <id>` are interchangeable — both run the same gate + Phase 2.
- **Five workflow sub-agents + a UX designer + fanout workers** — `pm`, `lead`, `engineer`, `qa`, `retro`, `uxui`, plus proof-authorized `team-*` workers. Multi-repo fanout still requires independent substantial surfaces and coordination payoff; repo count alone is not proof.
- **Artifact templates** — `spec.md`, `context.md`, `plan.md`, `tasks.md`, `test-plan.md`, `uxui-plan.md`, `review.md`, `security.md`, `tests.md`, `recommendations.md`, `retro.md`, `epic.md`, `state.json`. Agents copy from `_templates/` into a per-run folder; nothing freeform. (`context.md` is the shared run map and cache, read before code/test discovery at every size.)
- **Type-aware phase matrix + per-task phase plan** — the orchestrator specializes by Type. `lead` may vary optional Review/Docs only; code-type Test/Ship Gate and fired Review/Security remain required.
- **Evidence-routed execution matrix** — size caps machinery; workload profile routes ambiguity/evidence/volume/risk/coupling; `exec_mode` + `exec_reason` explain each phase.
- **Evidence-bearing ACs** — every new-run AC declares structural/behavioral/rendered/integration/measured/security/manual evidence; Contract Gate checks the declaration and Test records actual evidence. Rendered UI evidence gets cheap real-browser smoke even when full E2E is off.
- **Worker lifecycle + Opus budget** — phase workers cannot background accidentally; state records lifecycle, main-turn targets/ceilings, observed spawns, and separated elapsed/active/wait/reconcile timing.
- **Always-on fundamentals router** — a single lean file `.claude/rules/fundamentals.md` that maps every "by default" trigger to its skill: the conduct layer `coding-discipline` (which wraps the rest), the construction chain `ddd-strategic` → `programming-fundamentals` → `concurrency-fundamentals` → `database-fundamentals` → `hexagonal-backend` → `api-design-fundamentals` → `architecture-fundamentals` → `queue-fundamentals` → `security-fundamentals` → `observability-fundamentals`, the verification skills `debug-fundamentals` / `refactoring-fundamentals` / `testing-fundamentals`, and the delivery channel `git-workflow` / `delivery-engineering`. Full skill bodies load on demand; this router is the single source of truth for triggers and the cross-skill run order.
- **Hooks** — a PreToolUse spawn/model/state guard, a compact PostToolUse state marker, cheap edit checks, and a secrets guard. Language lint/type/static commands run once at Ship Gate by default; `CLAUDE_EDIT_LINT=1` restores per-edit file lint.
- **Skill-creator handoff** — `retro` lists skill candidates, you approve, the orchestrator spawns `skill-creator` for each. Nothing auto-creates.
- **Installer** — `install.sh` with `--dry-run`, `--force`, and a self-copy guard.

## What lands in your repo

```
.claude/agents/          pm, lead, engineer, qa, retro, uxui + team-* fan-out workers + TEAM.md  (always refreshed)
.claude/orchestrator.md  orchestrator script for the main agent                             (always refreshed)
.claude/orchestrator/    references/ — on-demand orchestrator detail (fanout, resume,
                         state edge cases) the core loads only when that path fires        (always refreshed)
.claude/commands/        dev + team-mode commands (spec, dev-plan, test-plan,
                         uxui-plan, implement)                                              (always refreshed)
.claude/skills/          fundamentals skills (construction + verification + delivery) +
                         plan-writing, brainstorming, fanout-team-agents, qa-handoff-note,
                         frontend/UX skills, skill-creator                                  (always refreshed)
.claude/rules/           fundamentals.md — one always-on router to the skills              (always refreshed)
.claude/hooks/*.sh       PreToolUse spawn/secrets guards, cheap edit checks + state marker       (always refreshed)
.claude/settings.json    hook wiring                                                        (only if missing; existing files get a merge)
.workflow/_templates/    spec / plan / test-plan / uxui-plan / review / security / tests /
                         recommendations / retro / epic / state.json                        (always refreshed)
.workflow/INDEX.md       run registry                                                       (only if missing)
.workflow/FOLLOWUPS.md   follow-up registry                                                 (only if missing)
WORKFLOW.md              full flow reference at repo root                                   (always refreshed)
CLAUDE.md                minimal stub                                                       (only if missing)
```

**Your state is safe.** `INDEX.md` and `FOLLOWUPS.md` are never overwritten, `.claude/settings.local.json` is never touched, and `CLAUDE.md` is never wholesale overwritten. If `CLAUDE.md` already contains the managed `claude-foundation:rules-imports` block, that block is re-synced in place so rule-router updates land; everything outside the managed block is preserved. Foundation-owned files (agents, orchestrator, commands, skills, rules, hooks, templates, `WORKFLOW.md`) are **always refreshed** on every install so upstream updates land — fork them out of these paths if you don't want a local edit clobbered.

**Already have `.claude/settings.json`?** The installer leaves it alone — your `permissions` / `model` / `env` are not rewritten; only the foundation hook wiring is merged in via jq (`--force` is what makes it overwrite wholesale). If the merge can't apply cleanly, the installer drops a pure-JSON snippet at `.claude/settings.foundation.json` with merge instructions — copy the `hooks` block in (appending to any existing `PostToolUse` array), then delete the snippet. Don't want the lint hook? If the merge failed, delete the snippet instead of merging it; if the merge succeeded, remove the lint entry from `.claude/settings.json`.

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

> **Availability.** The `dashboard-*` subcommands route through `cli.sh` (the top-level router that also dispatches the installer). They ship with source checkouts, `brew install --HEAD`, and stable Homebrew releases that include the dashboard assets.

## Design principles

- **Single entry point.** One command, one flow. No separate `/plan`, `/review`, `/test` to forget — the orchestrator runs them in order so nothing gets skipped.
- **Reproduce before fix.** A `fix` run can't ship without a regression test that fails on pre-fix code and passes now. Enforced at plan time (step 1), implement time (engineer writes it first), and test time (qa verifies the failure mode).
- **Acceptance criteria are first-class.** Engineer ticks them, lead re-checks them, qa maps each to a test, retro reports their final state. Unticked criteria block ship.
- **Coverage as a ratchet, not a gate.** qa measures diff coverage on the *changed* code against per-level floors (unit ≥80% · integration ≥70% · e2e ≥50% of critical journeys, the e2e floor only when `e2e_visual=on`) — advisory, so a below-floor level is a finding you accept or send back, never a number to pad with trivial tests. Floors apply only where the level is in scope for the change.
- **Anti-bias review.** Because `lead` reviews their own plan, review mode is row-by-row against `plan.md` AND `spec.md` — one verification per file, one row per acceptance criterion, DoD item, and Constraint. No vibes.
- **Security as a trigger, not a tax.** Most runs don't touch auth or SQL; those skip the security pass entirely. Runs that do get an inline checklist — nothing outsourced to an external tool.
- **Scope splits are rare.** Default is one run, even when DB + API + UI all change. Epic mode only kicks in when the spec lists ≥2 independently-shippable capabilities *and* `Ship as: staged`.
- **Lean always-on context.** Rules are 3-line pointers; full skill bodies load on demand. Every sub-agent spawn reloads `CLAUDE.md` + rules, so always-on weight is paid *per agent* — keeping it lean compounds across a `/dev` run.
- **Artifacts on disk + resumable.** Every run leaves a folder behind, including `state.json`. Replay it, audit it, hand it off — or if the session dies, `/dev --resume <id>` and keep going.

## Repository layout

```
.claude/
├── agents/         pm, lead, engineer, qa, retro, uxui + team-* fanout workers
├── orchestrator.md script the main agent follows when /dev runs
├── orchestrator/   references/ — fanout, resume, state edge-case detail the core loads on demand
├── commands/       dev.md (loads orchestrator.md) + team-mode spec / dev-plan / test-plan / uxui-plan / implement
├── hooks/          spawn guard, state marker, lint dispatch, secrets guard
├── rules/          fundamentals.md — one always-on router (conduct + run order + fundamentals)
└── skills/         full skill bodies referenced by the router
.workflow/
├── _templates/     blueprints — copy, don't edit in place
├── INDEX.md        run registry
└── FOLLOWUPS.md    carry-over registry
dashboard/          team presence dashboard — Node server + web UI + heartbeat client
├── server.js       zero-dep API + static dashboard
├── public/         the web board (vanilla HTML/CSS/JS)
└── client.sh       dashboard-up / -down / -status
cli.sh              top-level CLI router (init / version / help / dashboard-*)
install.sh          installs the foundation into a target project
VERSION             source of truth for `claude-foundation version`
docs/
WORKFLOW.md         full flow definition
CLAUDE.md           per-project guidance
```

## License

[MIT](LICENSE) © Maximumsoft Co., Ltd.
