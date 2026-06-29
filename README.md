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
| 1 | **Spec** | orchestrator + `pm` | Reads `FOLLOWUPS.md`, distils your pre-`/dev` conversation into a requirements digest, fans out research probes when guessing is risky, interviews you for *only* what's still open (≤4 questions, one batch), then `pm` writes `spec.md`. A `fix` includes a reproduction; a `spike` gets a timebox. |
| 2 | **Plan** | `lead` | Synthesises codebase exploration + best-practice research into `plan.md` (design/strategy — approach, `path#anchor` references, risks, verification) **and `tasks.md`** (a dependency-ordered, executable task list: numbered `T###` tasks, each tagged with the acceptance criteria it delivers and a runnable `verify:` line). For `fix`, the first task is always "write the failing regression test". |
| 2½ | **Test plan** | `lead` combined mode (XS/S) or `qa` (M/L) | *feat/fix/refactor only* — writes `test-plan.md` before any code: which test level proves each acceptance criterion, the edge cases to probe, what's out of test scope, and the fixtures a run needs. Signed off at the gate; `qa` executes it at phase 5. |
| 3 | **Gate** | you | The only mandatory stop. Reply `approve` / `revise <notes>` / `skip <n>` / `run <n>` / `commit on\|off` / `fanout <phase> on\|off` / `swap <n>` (epic only). A `revise` is a targeted in-run edit — never a fresh restart; `skip <n>`/`run <n>` flip a discretionary phase (5 test · 6 review · 8 docs) off or on; **`commit on\|off`** decides whether ship commits (asked every run, default off → you get a ready-to-run commit command); `fanout <phase> on\|off` adds or drops a phase's parallel helpers. The spec's acceptance criteria, the plan, the test plan, the per-task phase plan, **and the fanout plan** (which phases bring in parallel `team-*` helpers, and how many) are all surfaced for sign-off — any deviation from the type matrix needs explicit per-line confirmation. |
| 4 | **Implement** | `engineer` | Works through `tasks.md` with task-level progress tracking. Ticks each acceptance criterion in `spec.md` or files a blocker — unticked criteria block ship. |
| 5 | **Test** | `qa` | Runs **before** review so reviewers judge a green suite. Executes the `test-plan.md` strategy — unit + integration by default (plus a contract test when the plan declares an API/event contract), every acceptance criterion mapped to a test, with advisory diff-coverage floors on the changed code (unit ≥80% · integration ≥70%). **Browser-based e2e + the visual/a11y verification pass are opt-in** (`e2e_visual=on`, set at the interview/gate) — on, qa adds the e2e level (≥50% of critical journeys), the visual pass, and the axe-core a11y check reusing one browser session; off (the default) plans no browser, no install, no slow journeys. For `fix`, verifies the regression test fails on pre-fix code and passes now. Skipped (with a stub) for `chore`/`docs`/`spike`. |
| 6 | **Review** | `lead` | Row-by-row against `plan.md` **and** `spec.md`'s acceptance criteria (error/boundary clauses included), plus Definition-of-Done items and Constraints. Checklist-driven; "looks good overall" is banned. A blocking finding loops back through implement → test, so a review-driven fix is re-validated before ship. |
| 7 | **Security** | `lead` | *Trigger-based* — fires only when the diff touches auth, SQL, crypto, secrets, exec, deserialisation, or untrusted input. High findings are blocking. |
| 8 | **Docs** | `engineer` | Inline comments where the *why* is non-obvious. |
| 9 | **Ship** | `engineer` | Commit opted in at the gate (asked every run, default **no**): off → hands back a ready-to-run commit command; on → commits (spec-aware message) + optional PR via `gh`. Records commit + PR URL in `state.json`. |
| 10 | **Retro** | `retro` | Writes `retro.md`, carries follow-ups into `.workflow/FOLLOWUPS.md` (which `pm` reads on every new run — deferred work doesn't get lost), surfaces memory + skill candidates for your approval. |

**Phase 1 is interactive; Phase 2 is autonomous.** Once you `approve` at the gate, the orchestrator only stops for blocking review issues (max 2 cycles), failing tests (max 3 cycles), or genuine ambiguity.

**The machinery scales with the work.** Type decides *which* phases run; **size** (XS/S/M/L, estimated from your request before any question is asked) decides *how much machinery* each phase gets. A one-line text fix takes the XS fast path — one merged question batch, spec+plan+test-plan in a single `lead` spawn, docs+ship merged, retro inline (~4 worker spawns total) — while an M/L run gets the full pipeline above. A third axis, **field** (greenfield vs brownfield), decides whether the *understand → lock* safety machinery engages: brownfield work (anything that touches existing code) maps the current state before designing and locks a characterization baseline before changing it; greenfield (new, isolated code) skips both. On M/L brownfield that current-state map is built **once** as a shared `context.md` (right after the spec), so the plan, test, and UX slices reuse it instead of each re-walking the codebase. The contract never shrinks: the interview, the gate with per-line acceptance confirmation, and the security trigger run at every size, and any worker can escalate the size or ratchet greenfield → brownfield mid-run (never the reverse).

Full definition: [`WORKFLOW.md`](WORKFLOW.md).

## What's in the box

- **`/dev` slash command** — the single entry point. Pass `--resume <id>` to pick up an interrupted run from its `state.json` cursor.
- **Team-mode commands** — run one role at a time, writing into a shared `.workflow/<id>/` run, so you can drive the pipeline like a team instead of only through the monolithic `/dev`. `/spec` interviews and `pm` writes `spec.md`; `/dev-plan` has `lead` write `plan.md`; `/test-plan` has `qa` design `test-plan.md`; `/uxui-plan` has the `uxui` agent write `uxui-plan.md` (scenes, ASCII wireframes, scenarios, UX direction, AC↔scene mapping); and `/implement` starts **Phase 2** directly — it gates the run (human sign-off, if not already approved) then runs the autonomous build (implement → test → review → security → docs → ship → retro). A typical flow: `/spec` → `/dev-plan` → `/test-plan` (+ `/uxui-plan` if UI) → `/implement`. `/implement` and `/dev --resume <id>` are interchangeable — both run the same gate + Phase 2.
- **Five workflow sub-agents + a UX designer + fanout workers** — `pm`, `lead` (plan / review / security modes), `engineer` (implement / docs / ship modes), `qa` (test-plan / execute modes), `retro`, the team-mode `uxui` designer, plus `team-*` workers for parallel spec research, plan exploration, review, security, and test fanout. Control-plane runs that span multiple repos also fan out review, security, and test **per repo** (one `lead`/`qa` per changed repo) so the read-and-judge phases don't crawl four repos serially; retro reads across all repos in one multi-repo-aware pass. Each has an explicit `model:` for cost/speed tuning.
- **Artifact templates** — `spec.md`, `context.md`, `plan.md`, `tasks.md`, `test-plan.md`, `uxui-plan.md`, `review.md`, `security.md`, `tests.md`, `recommendations.md`, `retro.md`, `epic.md`, `state.json`. Agents copy from `_templates/` into a per-run folder; nothing freeform. (`context.md` is the shared brownfield-M/L current-state map, built once after the spec and read by the plan/test/UX slices.)
- **Type-aware phase matrix + per-task phase plan** — the same numbered phases run for every type; the orchestrator skips or specialises them based on `Type`. The matrix is the default: `lead` writes a reasoned `## Phases for this task` block that may **deviate** for a discretionary phase (review / test / docs) this task doesn't need, and the gate confirms each deviation explicitly (protected phases — interview, plan, gate, security-trigger check, retro — never deviate). See `WORKFLOW.md`.
- **Size-aware execution matrix** — XS/S runs take a fast path (merged question batch, combined spec+plan+test-plan spawn, merged docs+ship, inline retro) while M/L runs get the full machinery; upgrades are one-way via a `SIZE_UPGRADE` signal (see `.claude/orchestrator/references/size-execution.md`).
- **Always-on fundamentals router** — a single lean file `.claude/rules/fundamentals.md` that maps every "by default" trigger to its skill: the conduct layer `coding-discipline` (which wraps the rest), the construction chain `ddd-strategic` → `programming-fundamentals` → `concurrency-fundamentals` → `database-fundamentals` → `hexagonal-backend` → `api-design-fundamentals` → `architecture-fundamentals` → `queue-fundamentals` → `security-fundamentals` → `observability-fundamentals`, the verification skills `debug-fundamentals` / `refactoring-fundamentals` / `testing-fundamentals`, and the delivery channel `git-workflow` / `delivery-engineering`. Full skill bodies load on demand; this router is the single source of truth for triggers and the cross-skill run order.
- **Hooks** — a PreToolUse spawn guard for the `/dev` state machine, a PostToolUse state marker and lint dispatch, and a secrets guard that blocks reads of `.env` and credential files.
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
.claude/hooks/*.sh       PreToolUse spawn guard + secrets guard, PostToolUse lint + state marker  (always refreshed)
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
