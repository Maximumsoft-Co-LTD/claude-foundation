# Workflow

**Version 2.4.0** — tracks the release in [`VERSION`](VERSION) (source of truth) and [`CHANGELOG.md`](CHANGELOG.md).

Primary entry point: `/dev <intent>` (or `/dev --resume <id>` to pick up an interrupted run). The command detects context (new project vs. existing codebase) and runs the same two-phase flow, branching on **run type** so we don't drag a `chore` through e2e tests or implement a `fix` without first reproducing it. Same artifacts in both cases, written to `.workflow/<id>/`.

**Team mode** ([below](#team-mode--run-one-role-on-its-own)) splits that same flow into role-scoped commands — `/spec` (pm), `/dev-plan` (lead), `/test-plan` (qa), `/uxui-plan` (uxui), `/implement` (Phase 2) — so a team can divide the work by role. Each writes into the **same** `.workflow/<id>/` run and shares the gate, so the artifacts compose exactly as the one-shot `/dev` run produces them, and `/dev --resume <id>` (or `/implement`) carries a hand-assembled run the rest of the way.

> **Orchestration runs in the main agent, not a sub-agent.** A Claude Code sub-agent **cannot call `AskUserQuestion`** (it can't talk to the user), so the `/dev` slash command loads [`.claude/orchestrator.md`](.claude/orchestrator.md) and the main agent runs the interview + drives the flow. Sub-agents (`pm`, `lead`, `engineer`, `qa`, `retro`) do the file work. **Fan-out has two paths:** the splittable agents (`pm`, `lead`, `qa`, `engineer`, and the self-splitting `team-*` workers) hold `Agent` and **spawn their own helpers directly** when their work is large (direct nesting, Claude Code v2.1.172+); the orchestrator-mediated `FANOUT_REQUESTED:` signal is the fallback (and the path for background implement-fanout). `state.json` stays single-writer (the orchestrator) regardless — helpers never write it.

## Flow at a glance

The happy path with its three feedback loops (review, security, test). Diamonds are decision points; the dotted edge is the `--resume` re-entry. Phase numbers match the [type-aware matrix](#type-aware-phase-matrix) and the prose below.

```mermaid
flowchart TD
    Start(["/dev &lt;intent&gt;"]) --> Setup["Setup (orchestrator)<br/>read INDEX · pick NNNN-type-slug · create folder · copy state.json"]

    subgraph P1["Phase 1 — Requirements (interactive)"]
        direction TB
        S1["1. Interview + spec<br/>orchestrator asks · pm writes spec.md"]
        S2["2. Plan<br/>lead → plan.md (or epic.md)"]
        S2T["Test plan<br/>qa → test-plan.md (feat/fix/refactor)"]
        S3{"3. Gate"}
        S1 --> S2 --> S2T --> S3
    end

    Setup --> S1
    S3 -- "revise (incremental, in-run) / swap" --> S1
    S3 -- "approve" --> S4

    subgraph P2["Phase 2 — Implementation (autonomous)"]
        direction TB
        S4["4. Implement<br/>engineer · fix → failing test first"]
        S5{"5. Review<br/>lead vs plan + acceptance"}
        S6{"6. Security<br/>trigger-based · lead"}
        S7{"7. Test<br/>qa · regression for fix"}
        S7H["7½. Improve<br/>engineer · brownfield feat/fix"]
        S8["8. Docs touch-up<br/>engineer"]
        S9["9. Ship<br/>engineer · commit + PR"]
        S10["10. Retro<br/>retro.md · memory + skill candidates"]
        S4 --> S5
        S5 -- "pass" --> S6
        S6 -- "pass / not triggered" --> S7
        S7 -- "pass" --> S7H --> S8 --> S9 --> S10
    end

    S5 -- "blocking · ≤2 cycles" --> S4
    S6 -- "high finding" --> S4
    S7 -- "fail · ≤3 cycles" --> S4

    S10 --> Skill["skill-creator<br/>per user-approved candidate"]
    Skill --> Done(["Summary · done"])

    Resume(["/dev --resume &lt;id&gt;"]) -. "continue from state.json cursor" .-> P2
```

## Naming convention

Each run gets an ID: **`NNNN-<type>-<kebab-slug>`**

- `NNNN` — 4-digit sequential counter (`0001`, `0002`, …). `orchestrator` reads `.workflow/INDEX.md` to pick the next number.
- `<type>` — conventional-commits style: `feat` | `fix` | `refactor` | `chore` | `docs` | `spike`
- `<kebab-slug>` — short, ≤5 words, lowercase, hyphen-separated. No dates in the slug — the index tracks dates.

Examples: `0001-feat-todolist-app`, `0002-feat-audit-log`, `0003-fix-login-redirect`, `0004-refactor-auth-middleware`.

## Folder layout

```
.workflow/
├── INDEX.md                       # registry: id, type, title, status, dates
├── FOLLOWUPS.md                   # carry-over items surfaced by past retros
├── _templates/                    # blueprints — copy, don't edit in place
│   ├── spec.md
│   ├── plan.md
│   ├── test-plan.md
│   ├── uxui-plan.md                # team-mode UX plan (/uxui-plan, UI work)
│   ├── review.md
│   ├── tests.md
│   ├── security.md
│   ├── recommendations.md          # spike-only deliverable
│   ├── retro.md
│   ├── epic.md
│   └── state.json                  # per-run resume cursor
├── 0001-feat-todolist-app/
│   ├── state.json
│   ├── spec.md
│   ├── plan.md
│   ├── test-plan.md                # design-time test strategy (feat/fix/refactor)
│   ├── review.md
│   ├── security.md                 # only if security review fired
│   ├── tests.md
│   └── retro.md
└── 0003-fix-login-redirect/
    └── ...
```

Rules:
- One folder per `/dev` run. Never mix two pieces of work in one folder.
- `_templates/` is the source of truth for artifact shape. Copy when starting; never write to it during a run.
- `INDEX.md` is append-only on start, status-updated as phases progress. `retro` writes the `Finished` date.
- `FOLLOWUPS.md` is shared. `retro` appends; `pm` reads on every new interview to ask if any carry-overs are now in scope.
- `state.json` is the per-run cursor. The orchestrator writes it after each step so `/dev --resume <id>` knows where to pick up after a context exhaustion or cancel.
- Parallel work is fine — folder IDs make runs independent. If two features touch the same files, the `lead` flags the conflict in `risks`.

## Artifacts

All artifacts have a template in [`.workflow/_templates/`](.workflow/_templates/). Agents copy the template into the run folder and fill it in — never write freeform.

| File | Owner | Template | Purpose |
|---------|---------------|----------|---------|
| `spec.md` | `pm` | [`_templates/spec.md`](.workflow/_templates/spec.md) | **Outcome** (before → after → benefit), users, scope, non-goals, acceptance criteria, **Type**, bug-repro (fix), timebox (spike), discovery notes from spec fanout |
| `plan.md` | `lead` (plan mode) | [`_templates/plan.md`](.workflow/_templates/plan.md) | **Outcome** (before → after → benefit), **phases for this task** (matrix defaults + any justified deviation), step-by-step plan, current-state + best-practice research notes, **scaffold skeleton** (file tree + key signatures, M/L), files to touch (`path#anchor`), risks, **rollback** |
| `test-plan.md` | `qa` (test-plan mode) | [`_templates/test-plan.md`](.workflow/_templates/test-plan.md) | **Design-time test strategy** (feat/fix/refactor) — coverage plan (level per AC), edge cases to probe, out-of-test-scope, fixtures/data/env, regression contract (fix) / baseline (refactor, or a brownfield feat editing uncovered existing behaviour), coverage targets. Authored after `plan.md`, **signed off at the gate**; `qa` executes it at the test phase |
| `uxui-plan.md` | `uxui` (team mode) | [`_templates/uxui-plan.md`](.workflow/_templates/uxui-plan.md) | **Design-time UX plan** for UI-bearing work — Scenes (screens/states), Scenarios (user flows), UX direction & components, AC↔scene mapping. Written by the `/uxui-plan` team-mode command (not part of the linear `/dev` state machine); `frontend-design` builds from it and `qa > Visual verification` checks against it |
| `review.md` | `lead` (review mode) | [`_templates/review.md`](.workflow/_templates/review.md) | Plan-adherence + **acceptance verification** against `spec.md` |
| `security.md` | `lead` (security mode) | [`_templates/security.md`](.workflow/_templates/security.md) | Security findings; only written when the diff trips the sensitive-paths trigger |
| `tests.md` | `qa` (execute mode) | [`_templates/tests.md`](.workflow/_templates/tests.md) | **Test execution record** — acceptance-criteria mapping (actual tests), run results, regression verification (fix), measured per-level diff coverage, edge-case gaps found. Executes the strategy from `test-plan.md` |
| `recommendations.md` | `engineer` (spike) | [`_templates/recommendations.md`](.workflow/_templates/recommendations.md) | Spike deliverable — what we learned, recommended next step. Replaces test/ship phases. |
| `retro.md` | `retro` | [`_templates/retro.md`](.workflow/_templates/retro.md) | What worked, what to change, memory + skill candidates, commit/PR refs |
| `epic.md` | `lead` (rare) | [`_templates/epic.md`](.workflow/_templates/epic.md) | Decomposition into slices when `Ship as: staged` + ≥2 capabilities |
| `state.json` | `orchestrator` | [`_templates/state.json`](.workflow/_templates/state.json) | Resume cursor: phase, step, cycle counters, run timestamps (`created_at` at setup, `last_updated` per step, `done_at` just before the retro spawn so the build→ship duration is exact) |

## Optional artifact gate

[`.claude/hooks/artifact-lint.sh`](.claude/hooks/artifact-lint.sh) is an **optional** linter that validates a run's artifacts against the templates. It is *not* wired into the `/dev` state machine — it does not run automatically and never blocks a tool call. Invoke it by hand, in a pre-commit step, or in CI when you want a fast structural check that a run's artifacts are template-complete and placeholder-free.

```sh
sh .claude/hooks/artifact-lint.sh .workflow/<id>/
```

What it checks, per directory:

- **Required sections** — `spec.md` must declare a `**Type**:` and an `## Acceptance criteria` section; `plan.md` must have a fenced `mermaid` block, at least one inline AC tag (`[AC<n>]` or `[DoD]`), and a runnable verify section (a `verify:` clause).
- **No leftover placeholder markers** — `TODO`, `TBD`, `FIXME`, `lorem` (word markers, case-insensitive) and `<...>` angle-bracket placeholders, in any recognised artifact. A marker that sits inside an inline code span (backticks) or a fenced code block is treated as documentation/example syntax and ignored — only bare-prose markers are flagged, so an artifact that *documents* the markers still passes.

It prints a per-check report (`[OK]` / `[FAIL] <file>:<line>: …`) and **exits non-zero on any failure, zero when clean** (and non-zero if the path is missing/empty or holds no recognised artifact). Dependency-light: POSIX `sh` + the base `grep`/`awk` toolchain, no new packages, and it does not read `.workflow/_templates/` at runtime (the rules are encoded in the script) so it works in an adopting repo that installs `.workflow/` without the templates. Its fixtures test suite is [`.claude/hooks/tests/run-artifact-lint-tests.sh`](.claude/hooks/tests/run-artifact-lint-tests.sh).

## Type-aware phase matrix

The same numbered phases run for every type, but `orchestrator` **skips or specializes** some of them based on `Type`. Everything ticked (✓) runs; `skip` means the orchestrator records "skipped — type=<x>" and moves on; `light` means a thinner pass.

| Phase | feat | fix | refactor | chore | docs | spike |
|-------|------|-----|----------|-------|------|-------|
| 1. Interview + spec | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (timeboxed) |
| 2. Plan | ✓ | ✓ (step 1 = regression test) | ✓ (equivalence note; baseline-capture step 1 if coverage thin) | ✓ | ✓ | ✓ (exploration plan) |
| 2½. Test plan | ✓ | ✓ (regression contract) | ✓ (baseline contract) | skip | skip | skip |
| 3. Gate | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 4. Implement | ✓ | ✓ (write regression test FIRST, then fix) | ✓ | ✓ | ✓ | ✓ (exploration) |
| 5. Review | ✓ | ✓ | ✓ | ✓ · skip @XS | ✓ · skip @XS | light |
| 6. Security review | trigger-based | trigger-based | trigger-based | trigger-based | trigger-based | skip |
| 7. Test | ✓ | ✓ (regression must pass) | ✓ (verify behaviour vs captured baseline) | skip | skip | skip |
| 7½. Improve | ✓ (brownfield only) | optional (brownfield, light) | skip (the refactor *is* the improvement) | skip | skip | skip |
| 8. Docs touch-up | ✓ | optional | optional | optional | ✓ | skip |
| 9. Ship (commit + PR) | ✓ | ✓ | ✓ | ✓ | ✓ | optional (commit only) |
| 10. Retro | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

**Review at XS for `chore`/`docs` — default skip.** A `chore` or `docs` change sized **XS** (one file, pure text/config, no behaviour surface) skips phase 5 by default — a plan-adherence + acceptance review finds nothing the lint hook and the gate's per-line AC confirmation didn't already cover. The gate's run-plan line shows it (`review:type=<chore|docs>@XS`) and a user who wants the pass keeps it with `run 5`. This is a **size×type matrix default** (shown like any type-skip, not a per-line deviation needing sign-off): `chore`/`docs` at **S or larger** still review (✓), every other type reviews at XS, and the orchestrator enforces it at step 11 (`orchestrator.md` Phase-plan guard).

**Test plan** — phase 2½ is the design-time half of testing: `qa` writes `test-plan.md` (the coverage plan, edge cases to probe, fixtures, regression/baseline contract) right after `plan.md`, the gate signs it off, and phase 7 (`qa` execute mode) runs it. It runs for exactly the types whose phase-7 test runs — `feat`/`fix`/`refactor` — and is skipped for `chore`/`docs`/`spike`. It is numbered 2½ rather than renumbering 3–10; it folds into the Plan phase's slot and is surfaced at the Gate. At XS the orchestrator writes it inline (no `qa` spawn), mirroring inline-retro.

**Greenfield vs brownfield (the `field`)** — orthogonal to type and size, every run is classified **greenfield** (new, isolated code — nothing imports it, no published contract, no integration with existing code, first-party storage only; always XS/S) or **brownfield** (the change modifies/extends existing behaviour or wires into existing code — the default; every `fix`/`refactor` and every M/L run is brownfield). The orchestrator records `field` in `state.json` at the digest; `lead` re-derives it at plan time and ratchets greenfield → brownfield (one-way) via a `FIELD_UPGRADE: brownfield` signal if the code walk reveals an integration. This formalises the "new project vs existing codebase" detection above into a recorded slot, and it is what gates the **brownfield discipline of understand → lock → change → improve**: brownfield turns on the `Current state` map (understand — `plan-writing > principle 3`), the characterization baseline (lock — `test-plan.md > Baseline`, for feat/refactor; `fix` locks via its regression contract), and the improve phase below; greenfield skips all three ("nothing to preserve; got the shape right the first time"). Canonical definition: `plan-writing > references/size-tiering.md > Greenfield vs brownfield`.

**Improve phase** — phase 7½ is the **improve** of understand → lock → change → improve: after the test phase passes (the suite is green), `engineer` (Mode D) makes a **bounded, behaviour-preserving, simplify-first** cleanup of *only the code this run changed to deliver spec/plan* — the footprint `plan.md` declared (`Files touched`); the improve scope is **spec/plan's, not the engineer's to extend** (pre-existing code the change merely *exposed* is a follow-up, not this phase) — and re-runs the suite (green-or-revert). **Simplify first:** a simplification pass leads (the `team-code-simplifier` lens — reduce the complexity this change introduced: shorten a long function, drop duplication/dead branches, flatten a tangled conditional), *then* the lower-stakes cosmetic touch-ups (rename, tighten a type). Reducing complexity is the point; cosmetics ride second. **Commit handling is type-aware:** a `fix` (already committed at implement, clean tree) gets a separate `[improve]` commit; a `feat` (uncommitted until ship — the only uncommitted-at-13½ type that reaches this phase) leaves the edits in the working tree for ship to commit — folded into the single run commit, exactly as the docs phase folds in (the engineer must NOT commit there, or it would sweep up the uncommitted feature). It runs for a **brownfield `feat`** (and, lightly and optionally, a brownfield `fix`); a `refactor` skips it (the refactor itself was the improvement), and greenfield/chore/docs/spike skip it. A `nothing to improve` no-op is a normal outcome. The diff is behaviour-preserving and re-verified green, so it does **not** re-trigger review or test — **security re-runs only if the cleanup touched a security sink** (the green suite is not a sufficient net on the security axis). The safety contract is bounded scope + behaviour-preserving + the re-verified green suite (plus that security re-scan; and for `fix`, an independently-revertable commit); any improvement that would spread beyond the touched code is deferred to a follow-up `refactor` run, never widened in place. It is numbered 7½ rather than renumbering 8–10, mirroring the 2½ test-plan slot. Discretionary (the gate can `skip 7½`), and the lowest-stakes one — a skip carries no contract waiver.

**Security trigger** — phase 6 runs when the diff touches any of: auth/session/token code, password handling, crypto primitives, SQL/query building, raw HTML rendering, file/path handling, exec/shell calls, deserialisation of untrusted input, secret-bearing files (env, config), or new external network endpoints. **Not a trigger on its own — first-party browser-storage round-trip:** the app reading back its own single-user `localStorage`/`sessionStorage`/`IndexedDB` data via `JSON.parse` is *not* untrusted deserialisation and does not fire phase 6 — **provided** the diff has no dangerous sink (`innerHTML`/`outerHTML`/`insertAdjacentHTML`/`document.write`/`eval`/`Function`/`dangerouslySetInnerHTML`/jQuery `.html()`/ any other HTML-injection sink — the list is **open, not closed**); the presence of any such sink is itself a "raw HTML rendering" trigger and fires regardless. It also fires when the stored data crosses a real trust boundary: a multi-user or shared-device threat model is in scope, or the data is written by a server or another principal. `orchestrator` decides; `lead` executes in security mode using the inline checklist (no separate skill required).

### Per-task phase plan (deviation from the matrix)

The matrix above is the **default, not the final word**. `lead` (plan mode) writes a reasoned **`## Phases for this task`** block in `plan.md` that starts from the matrix and may **deviate** when *this* task genuinely doesn't need a discretionary phase. Four phases are **discretionary** (a task-specific judgment can drop or lighten them): **5 Review**, **7 Test**, **7½ Improve**, **8 Docs** (7½ Improve is itself matrix-gated to brownfield `feat`/`fix` — a deviation only applies where the matrix would run it). A disposition that turns a matrix-`✓` into `light`/`skip` is a **deviation**: the block tags it `(deviates from matrix)` with a one-line justification. No deviation → the section is one line (`Matrix defaults for type=<T> — no deviations.`).

**Protected — never deviatable, at any size, even with user confirmation:** **1 Interview + spec**, **2 Plan**, **3 Gate**, the **6 security-trigger *check*** (the phase-6 trigger scan always runs; the plan may *predict* whether it fires but can never suppress it), and **10 Retro** — plus state-discipline writes and the per-line AC confirmation. Implement (4) and Ship (9) are not discretionary either (implement is the work; ship/PR is governed by `Ship as` + the gate's PR question).

**The gate owns the deviation, not the plan.** Every deviation is surfaced at the gate for **explicit per-line confirmation** — the same treatment as `Hard-to-reverse decisions`; it does **not** ride a plain `approve`. `lead` proposes; the user disposes. The gate levers are `approve | skip <n> | run <n> | revise <notes>` — `skip <n>`/`run <n>` flip a discretionary phase's disposition directly (a `skip` of a protected phase is refused). Approved dispositions are recorded in `state.json > phase_plan` (keyed `review`/`test`/`improve`/`docs` → `run|light|skip`; empty `{}` = matrix defaults), and Phase 2 honours them: a phase the approved plan skips is recorded in `skipped_steps` as `<phase>:per-task-plan (user-approved)` and not run. **Skipping `7 Test` on `fix`/`refactor` also waives that type's regression/baseline contract** — the gate confirmation is where that waiver is made explicit, so it carries the highest justification bar. Skipping `7½ Improve` waives nothing (it's pure behaviour-preserving cleanup) — the lowest-stakes deviation.

This subsection is the **canonical definition**; `plan.md` (the section), `lead.md` (authoring), and `orchestrator.md` (the gate + Phase-2 honouring) point here rather than restating it.

### Fanout plan (declared in the plan, signed off at the gate)

`/dev` is single-pass-first (`orchestrator.md > Single-pass-first`). The **Fanout plan** makes that stance explicit and gated, the sibling of the per-task phase plan above: `lead` declares the planned fanout strategy (single-pass by default, fanout only where the work clears the cost bar) in a `## Fanout plan` block in `plan.md`, the gate surfaces it for sign-off, and `state.json` records both the gated intent and the runtime outcome.

**What `lead` declares** — one row per **gate-authorized Phase-2 fanout phase**: **Review** (the 6 lenses), **Security** (per threat bucket), **Test** (per test category), **Implement** (per parallelizable feat phase). These are the phases the gate is about to authorize for the autonomous Phase 2 — so they are what the user signs off and can steer. Each row: `Fanout` (yes/no) · `Workers (×N)` · `Reason`. Review/security/test rows are *predictions* (no diff exists at plan time) made from the planned scope; the **Implement** row is **derived from the `Parallelizable: yes` phase markers in `## Steps`** — it mirrors them (those markers are the single source of truth the runtime reads), never an independent claim. **Plan-fanout and spec-prep-fanout run *before* the gate** (steps 8 and 6), so they can't be gate-steered and are not in this table — their provenance lives in `## Research notes` / `spec.md > Discovery notes`, and their outcome is still recorded in `fanout_log` (telemetry, below).

```
## Fanout plan
| Phase     | Fanout | Workers (×N)          | Reason          |
|-----------|--------|-----------------------|-----------------|
| Review    | yes    | 6 review lenses ×1    | cross-module    |
| Security  | yes    | code-reviewer ×2      | 2 buckets trip  |
| Test      | no     | —                     | 1 category      |
| Implement | no     | —                     | no ∥ phases     |
```

At XS / pure-greenfield / a single straightforward change the whole block is one line — `No fanout — single-pass (XS).`

**Same worker, N instances — horizontal scaling is first-class.** A fanout is **not** one-of-each-worker. The plan-prep, security, and test axes spawn **N copies of the *same* `team-*` worker** — one instance per independent unit (one `team-codebase-explorer` per integration point, one `team-code-reviewer` per security bucket, one `team-pr-test-analyzer` per test category) — which is exactly what the `×N` column records. Only Review spawns six *different* lenses ×1. Cap the total at **6 concurrent** and group beyond it; never spawn N for N's sake — N is the count of genuinely independent units, no more.

**The gate owns it.** The Fanout plan is surfaced alongside the phase plan; the levers are `fanout <phase> on` / `fanout <phase> off`, recorded in `state.json > fanout_plan.<review|security|test|implement>`. `off` forces single-pass for that phase; `on` forces the fanout even when the runtime cost heuristic would skip it (the user accepts the cost). A gated `on`/`off` is a **soft-guardrail override only** — it cannot defeat: (a) the **hard feasibility guardrails** — a forced `on` can't split work that isn't independent, and can't fan out implement phases that aren't pairwise-disjoint (`fanout implement on` only **re-enables** parallel phases the plan already declared; it never manufactures them); (b) the **size-tier machinery** — a forced `fanout review on` on an XS/S run, where review-fanout is refused as too heavy for the tier, becomes a `SIZE_UPGRADE` prompt ("this fanout means the run is bigger than its size"), not a silent honour. When a forced `on` is blocked either way, surface it to the user and record the blocked outcome in `fanout_log` (`fired:false, path:single, reason:"forced-on blocked: <guardrail>"`) rather than ignoring it. **Runtime can still diverge from a signed-off prediction:** a phase approved `Fanout: yes` may still run single-pass at runtime (e.g. the actual diff turned out small) — the **runtime heuristic wins and the divergence is logged** (not re-surfaced at the gate; a forced `on` is the way to pin it). Absent a gated entry, the phase's runtime heuristic decides (`orchestrator.md > Where fanout fires`).

**Telemetry — the outcome is recorded.** Every fanout point appends one entry to `state.json > fanout_log` as part of that step's terminal `state.json` write (re-read the array and append — never regenerate it from memory, the same array discipline as `impl_phases_done`): `{phase, eligible, fired, path, n, reason}`, keyed by **phase name**, where `path` ∈ `direct` (self-dispatched direct-nesting, the primary) / `signal` (orchestrator-mediated `FANOUT_REQUESTED:` fallback) / `single` (no fanout). The log is **broader than the gated `fanout_plan`**: it records *every* fanout point — `spec-prep` (step 6) and `plan` (step 8), which run before the gate and carry no `fanout_plan` key, plus the four gate-steerable Phase-2 phases. `retro` surfaces it so under-firing becomes a measurable finding to calibrate, not a vibe — and a divergence between a gated intent and the runtime outcome (planned fanout, went single-pass) shows up with its reason.

**Registry & dispatch.** Whether a fanout runs as live `team-*` spawns or the inline `general-purpose` fallback is the **registry preflight** decision, made once per run and recorded in `state.json > team_registry` (`orchestrator.md > Fanout dispatch > Registry preflight`); a registry miss never downgrades a planned fanout to single-pass. Direct nesting (the worker self-dispatches its own helpers, no orchestrator re-spawn) is the **primary** dispatch path for read/research fanout; the `FANOUT_REQUESTED:` signal is the fallback + the background-implement path (`fanout-team-agents > Two dispatch paths`).

This subsection is the **canonical definition**; `plan.md` (the section), `lead.md` (authoring), `orchestrator.md` (the gate lever + telemetry + dispatch), and `retro.md` (surfacing the log) point here rather than restating it.

## Size-aware execution matrix

Type decides *which* phases run; **size decides how much machinery each phase gets** — the same contract scaled to the work, so a one-line text fix doesn't pay a migration's process cost. The orchestrator estimates size (XS/S/M/L — picker in `plan-writing > references/size-tiering.md`) right after the requirements digest and records it in `state.json`. The plan's `Size` field is a different knob: it governs plan *section gating* and `lead` sets it from the code walk (smaller than the estimate is fine); `state.json > size` governs *machinery* and only moves up — a larger plan `Size` is a `SIZE_UPGRADE` signal, a smaller one never shrinks the machinery mid-run.

| Step | XS | S | M / L |
|------|----|---|-------|
| Setup + interview questions | one merged batch (≤4 questions) | one merged batch | setup batch + interview batch (+ bounded dig loop) |
| Spec + plan | one `lead` spawn (combined mode, `pm` skipped), no prep fanout | same as XS | `pm` + `lead` spawns, prep fanout default when independent points exist |
| Test plan (feat/fix/refactor) | inline (orchestrator writes `test-plan.md`) | `qa` test-plan spawn | `qa` test-plan spawn |
| Gate (per-line AC confirm) | full | full | full |
| Implement | one `engineer` spawn | one spawn | one spawn (+ parallel-phase fanout: default when the **L-tier** feat plan declares disjoint phases) |
| Review | `lead` sonnet, fanout refused (skipped for `chore`/`docs` — size×type default) | sonnet, fanout refused | sonnet/opus per stakes, fanout default for non-trivial diffs |
| Security review | trigger-based (unchanged) | trigger-based | trigger-based |
| Test | per type matrix (unchanged) | per type matrix | per type matrix (+ fanout default when suite splits ≥ 2 categories / ≥ 3 tests) |
| Improve (brownfield feat/fix) | rarely applies — trivial diff / greenfield skips | `engineer` Mode D, light pass | `engineer` Mode D |
| Docs + ship | one merged `engineer` spawn | one merged spawn | two spawns |
| Retro | inline (orchestrator writes `retro.md`) | `retro` spawn, light pass | `retro` spawn, full |

**Never shrinks at any size:** the interview (merged, not skipped) · the gate + per-line AC confirmation · `state.json` discipline · the security trigger check · the type matrix. **Upgrades are one-way:** any worker can return `SIZE_UPGRADE: <S|M|L> — <reason>` as its first line; the orchestrator re-records `size` and runs the remaining steps with the bigger tier's machinery. Size never moves down mid-run. Mechanics: `.claude/orchestrator.md > Size-aware execution`.

**Fanout availability** — `/dev` is **single-pass-first** (canonical stance: `.claude/orchestrator.md > Single-pass-first`): a phase *defaults* to a single sequential pass and fans out only when its sub-investigations are independent, disjoint, AND substantial enough to repay the coordination + N× worker cold-start cost. The fanout points are spec-prep/research (step 1), plan (2), implement (4 — feat-only, one write-only `engineer` per disjoint `Parallelizable: yes` phase, then a sequential integration engineer; phase-granular resume via `state.json > impl_phases_done`), review (5 — the six lenses), security (6 — per bucket), and test (7 — per category); the **per-size defaults are the fanout cells in the matrix above**. The **gate-steerable subset** (review/security/test/implement) — its `## Fanout plan` declaration, the `fanout <phase> on|off` lever, the `fanout_log` telemetry, and `×N` horizontal scaling — is the canonical `### Fanout plan` above; the per-step runtime heuristics + registry handling are `.claude/orchestrator.md > Where fanout fires` / `> Registry preflight`. The pattern + worker roster live in `.claude/skills/fanout-team-agents/SKILL.md` and `.claude/agents/TEAM.md`. A third, orthogonal **surface (per-repo) axis** fans review/security/test out **one agent per changed repo** on a multi-repo control-plane run (`state.repos`) — its full contract (incl. that branch/implement/gate/ship stay single-`repo_root`, so a blocking finding in a non-primary repo surfaces to the user, follow-up F0001) is `.claude/orchestrator.md > Surface (per-repo) fanout`. **Registry caveat:** the `team-*` registry is session-scoped — mid-session `team-*.md` files (and edits to an existing agent's `.md`) aren't discoverable until a session restart, so after changing any `.claude/agents/*.md` restart the session before trusting it; inside a run the orchestrator decides the live-vs-inline path once and never drops a fanout to single-pass over a miss (`.claude/orchestrator.md > Fanout dispatch > Registry preflight`).

## Skill routing

The `/dev` workflow uses skills as phase-specific procedural knowledge, not as extra agents. Load the narrowest skill that owns the current decision:

- Conduct on any code task: `coding-discipline` as the behavioral pre-flight before producing or editing code — surface assumptions, keep the change minimal and surgical, set a verifiable goal. It wraps and routes to the skills below; it does not replace them.
- Ambiguous product scope or approach trade-offs: `brainstorming` before `pm` writes `spec.md`.
- Fixes with unknown cause: `debug-fundamentals` before construction skills, then encode the regression in `plan-writing`.
- Refactors: `refactoring-fundamentals` first — pick the safe path and capture the behaviour baseline (characterization test when coverage is thin) — then the construction skill that owns the target shape. The baseline becomes plan step 1 in `plan-writing`.
- Construction decisions: `ddd-strategic` first when business language/context boundaries are unclear; then `programming-fundamentals`; then `concurrency-fundamentals` (in-process), `database-fundamentals`, `hexagonal-backend`, `api-design-fundamentals`, `architecture-fundamentals`, `queue-fundamentals` (cross-process), and the cross-cutting `security-fundamentals` / `observability-fundamentals` — each only when its layer is actually touched. Full run order: `.claude/rules/fundamentals.md`.
- Verification: `testing-fundamentals` for test strategy and design (the `qa` agent designs the strategy into `test-plan.md` at phase 2½ and executes it at phase 7); `debug-fundamentals` when a failure's cause is unknown; `refactoring-fundamentals` to capture a characterization baseline before a behaviour-preserving change.
- Delivery: `git-workflow` before staging/committing/PR; `delivery-engineering` when the task touches the CI/CD pipeline, build, deploy, or release path.
- Planning: `plan-writing` when `lead` drafts `.workflow/<id>/plan.md`; it sequences the decisions produced by the construction skills.
- UI work: `ui-ux-pro-max` for UX/design decisions and review, `frontend-design` for implementing polished UI code, and `tailwind-design-system` only for Tailwind v4 shared tokens/components/migration mechanics.
- Parallel research/review/test slices: `fanout-team-agents`, dispatched only by the orchestrator.
- Ship: `git-workflow` before staging, committing, rebasing, or opening a PR.
- Retro skill creation: `skill-creator` only after `retro` proposes a candidate and the user approves it.

### Skill-load budget (critical path)

On the plan / implement / review critical path the always-on `CLAUDE.md` rule summaries ARE the fundamentals pre-flight — a full `SKILL.md` body is 30–114 KB of sequential Reads over a growing context, the dominant avoidable cost. **Default: load no full skill body.** Read **at most one** targeted `references/<file>` section, and only for a specific friction the summary genuinely doesn't settle (a reviewer catches a missed fundamental far more cheaply than loading the library mid-task). **Exempt:** a user-cited `References / examples to follow` entry — always open every one (it is not a skill body). Each agent applies this budget in its own steps and points here for the rule.

Phase numbering below matches the matrix above (1–10) so the gate output, prose, and agent docs all speak the same language. The orchestrator runs a few extra setup actions (read INDEX, pick ID, create folder, copy state.json, append INDEX row) before phase 1; those are internal to the orchestrator, not numbered phases.

## Phase 1 — Requirements (interactive)

1. **Interview + spec** — the **orchestrator (main agent)** reads `FOLLOWUPS.md` first. **It then distills the entire pre-`/dev` conversation into a requirements digest** — every goal, constraint, decision, concrete example, and edge case the user already stated — and treats it as a first-class, authoritative requirement source passed to `pm`, so nothing discussed before `/dev` is dropped. When existing code, APIs, security-sensitive paths, unfamiliar domain terms, or multiple independent research questions make guessing risky, it fans out spec-prep probes before the interview: `team-codebase-explorer` maps relevant current behaviour/invariants, and `team-best-practice-researcher` gathers focused best-practice constraints. It skips this fanout for XS pure-greenfield work. The orchestrator then uses `AskUserQuestion` (≤4 questions per batch; one batch by default, a bounded dig loop of at most 3 narrowing batches when ambiguity is genuinely high) — asking **only what the digest leaves unspecified**, and closing with one free-text "anything I missed or want to correct?" catch-all so the user is never boxed into the multiple-choice slots — to capture: goal, users, scope, non-goals, constraints, **Type**, `Ship as`, a measurable NFR target (mandatory binary ask for runtime-shipping feat/fix — on `yes` written as an AC, verify = its `measured:` clause, never a standalone orphaned section), a concrete `input → output` example AND the `on error / at boundary:` behaviour per consequential *behavioural* AC (the EARS unhappy-path clause that stops the implementer guessing; an NFR-class AC instead carries just its `measured:` clause), and whether any open follow-up is now in scope. For `fix`, it also asks for a concrete reproduction. The orchestrator then spawns `pm` with the full Q&A plus fanout findings in the prompt; `pm` writes `spec.md` from the answers — including the `Type` slot, `Discovery notes`, any `References / examples to follow` (external-URL refs are fetched + inlined by the orchestrator first, since `pm`/`engineer` have no web access, so the engineer is required to open a self-contained section rather than chase a dead link), and (for `fix`) a Reproduction section. `pm` itself cannot call `AskUserQuestion` (sub-agent limitation), which is why the interview lives in the main agent.
2. **Plan** — `lead` (plan mode) reads `spec.md`, runs the scope check, then:
   - *Always*: writes a `## Phases for this task` block — the matrix defaults for this `Type`, deviating (with justification) only when a discretionary phase (5 Review / 7 Test / 7½ Improve / 8 Docs) genuinely isn't needed. See `Per-task phase plan` above for the rule; the gate confirms each deviation.
   - *M/L size*: includes a `## Scaffold` section — the target file tree (`★` new) + each new file's key signature — the concrete skeleton the gate surfaces before the long build (subsumes `## Folder structure` for M/L). S touching existing code may include a mini version; XS skips it.
   - *New project*: proposes structure + stack in `plan.md`.
   - *Existing code*: by default fans out for S/M/L plans with independently-researchable integration points (especially unclear/high-risk ones) — self-dispatching helpers directly, or returning `FANOUT_REQUESTED: plan:<point-list>` as the orchestrator-mediated fallback; `team-codebase-explorer` + `team-best-practice-researcher` run per integration point and `lead` synthesises the results into `Current state`, `Research notes`, `Approach`, steps with `path#anchor` references, risks, and verification. A point with nothing independent to research is written directly.
   - *Fix type*: plan step 1 MUST be "write failing regression test for <bug>".
   - *Refactor type*: includes a behavior-equivalence note (what stays stable, how it gets verified). When the touched behaviour isn't already covered by a test, plan step 1 captures a characterization baseline (golden-master of current behaviour) before the structural change — the refactor's equivalence is then checked against that baseline.
   - *Spike type*: plan reads as an exploration outline with a timebox; `Out of scope` calls out "no production code lands from this run".
   - *Epic case* (rare): writes `epic.md` instead and recommends a starting slice.
2½. **Test plan** (feat/fix/refactor only) — after the plan, `qa` (test-plan mode) writes `test-plan.md` from `spec.md` + `plan.md` + the codebase: a coverage plan mapping every AC (happy path AND its `on error / at boundary:` clause) to the test **level** that owns it and what each test asserts, the edge cases to probe (discovered against the plan, **before** code — the shift-left of qa's old phase-7 discovery), what's out of test scope, the fixtures/data/env a run needs, and the type-specific contract (regression-test contract for `fix`, characterization baseline for `refactor` — and for a **brownfield `feat`** editing uncovered existing behaviour, the lock around the existing code the feature modifies). It's authored after the plan so it can cite files-touched, surfaced at the gate as part of the approved contract, and executed by `qa` at phase 7. Skipped for `chore`/`docs`/`spike`; written inline by the orchestrator (no `qa` spawn) at XS.
3. **Gate** — `orchestrator` shows the `spec.md` summary with the **acceptance criteria presented as the contract for per-line confirmation** (each AC + its example + its `on error / at boundary:` behaviour, framed "done when each is true — confirm or correct each"), any `Assumptions (inferred from repo — correct any that are wrong)`, the `plan.md` outline (or epic slices) — plus the `## Scaffold` skeleton (target file tree + key signatures) for M/L, so the concrete shape is signed off before the long build — plus the `test-plan.md` coverage plan + edge cases (feat/fix/refactor), so the user signs off *how it'll be proven* alongside *what's built* — and the **per-task phase plan** from `plan.md > Phases for this task` ("will run: 1-2-2½-3-4-5-7-9-10; skipping 6,8 — type=fix, no sensitive paths, docs not in scope"), with **any deviation from the matrix surfaced for explicit confirmation** (it doesn't ride a plain approve — see `Per-task phase plan`). Wait for `approve` / `skip <n>` / `run <n>` (flip a discretionary phase) / `revise <notes>` / `swap <n>` (epic only). A correction to any AC line or inferred assumption is a `revise`. **Revise is an incremental, in-run edit — never a Phase 1 restart**: plan-only notes re-edit just the affected `plan.md` steps (`lead` plan-revise mode — no re-fanout, no LSP re-walk); requirement notes re-edit just the affected `spec.md` sections (`pm` spec-patch mode — no full rewrite, re-interview only for a genuinely new slot), then propagate into the affected plan steps; test-plan notes (a wrong level, a missing edge case) re-edit just the affected `test-plan.md` rows (`qa` test-plan-revise mode). Free-form "chat about this" feedback at the gate is treated as `revise` for the **same** run; the orchestrator re-verifies consistency (AC ↔ steps ↔ test-plan rows, no dangling cross-refs, no markers) before re-presenting only the changed parts.

## Phase 2 — Implementation (autonomous after approval)

4. **Implement** — `engineer` executes `plan.md` step by step using `TaskCreate` to track progress. Marks each task done as it lands. **For `fix` runs, the very first task must be reproducing the bug via a failing test** (engineer writes it as its own commit so qa can verify the fail-on-pre-fix-code contract in phase 7). Before signalling done, engineer ticks each `spec.md > Acceptance criteria` checkbox or files a blocking note explaining why one cannot be ticked.
5. **Review** — `lead` (review mode) reads the diff against `plan.md` AND the `spec.md` acceptance criteria (each AC's `on error / at boundary:` clause and any `measured:` target included), AND walks the non-AC correctness slots — `Definition of Done` items (artifact present?) and `Constraints` (diff honours each?) — which don't thread through AC tags and would otherwise ship unchecked. It may fan out to the six review workers for large, cross-module, critical, type/contract/test-sensitive, or uncertain diffs; otherwise it reviews directly. Writes `review.md`. Blocking issues → `engineer` fixes → re-review (max 2 cycles before escalation).
6. **Security review** — *trigger-based*. If the diff matches the security-trigger list, `orchestrator` spawns `lead` in security mode. Writes `security.md`. Findings of severity `high` are blocking; `medium` and below are non-blocking and carry into `retro.md`. After an engineer fix for a `high` finding, orchestrator re-spawns lead in security mode on the new diff — same trigger, same cycle budget as review.
7. **Test** — `qa` (execute mode) runs the strategy from `test-plan.md` (phase 2½) — writing the planned unit + integration + e2e tests (plus a **contract test** when `plan.md` declares a `## API / event contracts` section — on the request/response or event shape both sides depend on, consumer-driven when a separate consumer exists, folding into integration for the coverage floors), mapping each planned coverage row to an actual test — and records results in `tests.md` (the plan is the design; this is the record). For `fix`, the regression test from step 4 MUST fail on the pre-fix code (engineer should have committed the test separately so qa can `git checkout <fix-commit>^` and re-run; otherwise qa falls back to a scratch branch with the fix reverted) and pass on the current code. For `refactor`, qa confirms a behaviour baseline existed before the change, runs the existing suite, verifies the captured characterization baseline still holds, and adds tests only for behaviours that weren't already covered. Acceptance criteria are mapped to specific tests in `tests.md` — including each AC's `on error / at boundary:` clause (a test that drives the unhappy path) and any `measured:` perf/security/a11y target (a test that runs the measurement). `qa` also measures **diff coverage on the changed code** against per-level floors — unit ≥ 80% (unit-testable lines), integration ≥ 70% (boundary-crossing lines only, not pure logic), e2e ≥ 50% of critical user journeys — in `tests.md > Coverage (diff vs floor)`. Each floor covers only the slice that level owns and applies only where that slice is non-empty. The floors are **advisory ratchets** (`testing-fundamentals` Principle 7 — on the diff not the whole repo, e2e by *journeys* not lines): a below-floor level is a finding the orchestrator escalates (accept the risk → retro, or back to `engineer`), not a ship-block, never padded with trivial tests. **Visual + a11y verification (content-trigger — like security, fires on the diff, not the type):** when the diff changes rendered UI (`.html`/`.css`/`.jsx`/`.tsx`/`.vue`/`.svelte`/templates/styling), `qa` adds a visual + accessibility pass inside the feat/fix/refactor test phase (never `chore`/`docs`/`spike`) — a real layout/readability defect or a serious WCAG violation (contrast, accessible name/role) is blocking like a failing assertion; cosmetic nits go to `tests.md > Edge-case gaps`. Full procedure — reuse the open e2e browser, settled-render capture, `Read` the screenshot, axe routing, and the orchestrator MCP backstop when no live session exists — is owned by `qa.md > Visual verification pass`. Failing tests block step 9 (max 3 fix-retry cycles before escalation). Skipped for `chore` / `docs` — qa writes a one-line stub in `tests.md` saying so (at XS the orchestrator writes that stub inline instead of spawning qa). `spike` skips the test phase entirely — no qa spawn, no `tests.md` (the engineer's `recommendations.md` is the deliverable).
7½. **Improve** (*brownfield `feat`*, and optionally a brownfield `fix`) — with the test suite green, `engineer` (Mode D) makes a **bounded, behaviour-preserving, simplify-first** cleanup of *only the code this run changed to deliver spec/plan* — the footprint `plan.md` declared (`Files touched`), **not targets the engineer picks by discretion** (a simplification pass first — extract, de-duplicate, flatten a conditional, drop a dead branch — *then* cosmetic touch-ups like rename; no new behaviour; pre-existing code the change merely *exposed* is a follow-up) — and re-runs the suite (green-or-revert). The cleanup is committed type-aware: a separate `[improve]` commit for `fix` (clean tree), or folded into the ship commit for `feat` (uncommitted until ship). A `nothing to improve` no-op is normal. Because the diff is behaviour-preserving and re-verified green, it does not re-enter review or test (security re-runs only if a security sink was touched); improvement that would spread beyond the touched code is deferred to a follow-up `refactor` run, never widened in place. Skipped for `refactor` (the refactor *was* the improvement), `chore`/`docs`/`spike`, and any greenfield run. This is the **improve** of understand → lock → change → improve (the `field` gates it — see the brownfield discipline above).
8. **Docs touch-up** — `engineer` updates inline comments where the *why* is non-obvious and any user-facing docs the change actually touches. No new docs unless the spec asked. Light pass for `fix`/`refactor`/`chore`; skipped for `spike`.
9. **Ship** — `engineer` in ship mode stages the changed files, writes a commit message referencing the run ID + spec goal, and (if the repo has a remote and the user opted in at the gate) opens a PR. The commit hash + PR URL are recorded in `state.json` and lifted into `retro.md`. Skipped for `spike` unless the user explicitly asks to commit the exploration.
10. **Retro** — `retro` reads `plan.md` + `review.md` + `security.md` (if any) + `tests.md` + diff + commit, writes `retro.md`. Appends any new follow-ups to the shared `FOLLOWUPS.md` and marks any consumed ones closed. Surfaces *memory candidates* (facts) and *skill candidates* (procedures) for user confirmation. The orchestrator then asks the user which skill candidates to actually create and spawns `skill-creator` for each approved item. After this step the orchestrator prints the final summary (artifacts written, files changed, commit hash, PR URL, open follow-ups, skills created) — that summary is the run's terminator, not its own numbered phase.

After every step, `orchestrator` updates `.workflow/<id>/state.json` with `phase`, `step`, and the relevant `cycle` counter. If the session dies mid-run, `/dev --resume <id>` reads `state.json` and continues from the next step.

## Scope: when to split (rare path)

**Default**: one `/dev` run, regardless of file count, step count, or layers touched. Crossing DB + API + UI is normal full-stack work, NOT a reason to split.

`lead` enters epic mode **only when both are true**:
1. The spec lists ≥ 2 capabilities that can ship to users independently, **and**
2. `Ship as: staged` is set in `spec.md` — the user explicitly wants separate releases.

If only one is true → one `plan.md`. If the plan ends up heavy (say >15 steps), note it in `plan.md > Risks` ("scope is on the larger side, watch for fatigue") — **do not split**.

The `Ship as` answer is captured in the Phase 1 interview and recorded in `spec.md` frontmatter. It's the user's call, not the planner's.

### Epic mode flow

1. `lead` writes [`epic.md`](.workflow/_templates/epic.md) (decomposition into 2–5 vertical slices) instead of `plan.md`. Each slice must be independently shippable.
2. `INDEX.md` status for this ID = `epic`. No implementation runs against this folder.
3. `lead` recommends a starting slice and opens a child `/dev` run (e.g., `0006-feat-audit-viewer`) with `Parent: 0005-feat-audit-system` in its `spec.md`.
4. Remaining slices are separate `/dev` runs later. Each references the same parent.
5. User can `swap <n>` at the gate to pick a different slice as the first one.

## Agent map

Five sub-agents drive the `/dev` file work, plus the team-mode `uxui` designer (spawned only by `/uxui-plan` — see [Team mode](#team-mode--run-one-role-on-its-own)). The **orchestrator is not a sub-agent** — it's the role the main agent plays when `/dev` (or a team-mode command) runs, following [`.claude/orchestrator.md`](.claude/orchestrator.md). Several sub-agents have multiple modes so the count stays low.

| Role | Where it runs | Phase steps | Reads | Writes | Primary tools |
|------|---------------|-------------|-------|--------|---------------|
| `orchestrator` | main agent (`/dev` slash command) | drives all + runs the interview | user input, INDEX, FOLLOWUPS, state.json | INDEX status, state.json, follow-up cursor | `AskUserQuestion`, `Agent`, `Bash` |
| `pm` | sub-agent | 1 (spec) | intent + interview Q&A passed in prompt + FOLLOWUPS | `spec.md` | `Read`, `Write`, `Agent` |
| `lead` | sub-agent | 2 (plan), 5 (review), 6 (security) | `spec.md`, codebase, diff | `plan.md` / `epic.md`, `review.md`, `security.md` | `Read`, `Grep`, `LSP`, `Write`, `Edit`, `Bash`, `Agent` |
| `engineer` | sub-agent | 4 (implement), 8 (docs), 9 (ship) | `plan.md`, `spec.md`, diff | source, inline comments, commit, PR | `Read`, `Edit`, `Write`, `Bash`, `Grep`, `LSP`, `TaskCreate`, `TaskUpdate`, `TaskList`, `Agent` |
| `qa` | sub-agent | 2½ (test plan), 7 (test) | `spec.md`, `plan.md`, `test-plan.md`, source, diff | `test-plan.md` (design), tests + `tests.md` (execution) | `Read`, `Write`, `Edit`, `Bash`, `LSP`, `Grep`, `Agent` |
| `retro` | sub-agent | 10 | all artifacts + diff + existing memory/skills + FOLLOWUPS | `retro.md`, INDEX status, FOLLOWUPS append | `Read`, `Write`, `Edit`, `Bash` |
| `uxui` | sub-agent (team mode) | `/uxui-plan` only (not a `/dev` step) | `spec.md`, existing design system/components, `ui-ux-pro-max` | `uxui-plan.md` | `Read`, `Grep`, `LSP`, `Write`, `Edit`, `Agent` |
| `team-*` agents | sub-agents (workers) | dispatched from fanout phases (steps 1, 2, 4, 5, 6, 7) | the spec question / codebase area / best-practice question / diff slice / bucket / path range the orchestrator scopes them to | findings (returned to the calling /dev sub-agent for synthesis; no artifact write) | varies by worker — see `.claude/agents/TEAM.md` |

Sub-agent constraints:
- **Direct nesting (Claude Code v2.1.172+):** the splittable agents are granted `Agent` and spawn their own helpers when their work is large — `pm`, `lead`, `qa`, `engineer`, and the self-splitting `team-codebase-explorer` / `team-best-practice-researcher` / `team-code-reviewer` (each has a "Recruit help when the work is large" section). The other `team-*` review workers stay read-only (no `Agent`). Helpers do one level of split only (no re-escalation) and never write `state.json` — single-writer = the orchestrator.
- **Enforced by Claude Code (not optional):** sub-agents cannot call `AskUserQuestion` — any user prompt has to come from the main agent. Sub-agents that hit ambiguity return a `BLOCKER:` line and the orchestrator surfaces the question.

External: when `retro` surfaces skill candidates and the user approves, the orchestrator (main agent) invokes the `skill-creator` skill (built-in) for each approved candidate. The handoff is explicit — no candidate is created silently.

**Anti-bias rule** — because `lead` reviews the plan they wrote, review mode is checklist-driven (one row per plan step, one row per acceptance criterion incl. its error/boundary clause, one row per DoD item and Constraint, one verification per file). "Looks good overall" is banned.

## Team mode — run one role on its own

`/dev` is the full pipeline; **team mode** lets you summon one specialist at a time and produce a single artifact, so requirements can be built up like a team rather than only through the monolithic run. Each command writes into the **same `.workflow/<id>/` run folder**, so the artifacts compose — and the run can be carried the rest of the way with `/dev --resume <id>`.

| Command | Role (agent) | Writes | Notes |
|---------|--------------|--------|-------|
| [`/spec`](.claude/commands/spec.md) | `pm` | `spec.md` | The main agent runs the Phase-1 interview (sub-agents can't), then `pm` writes the spec and the run stops at `step=spec`. Always spawns `pm` (no XS combined-mode shortcut). Pass a run id instead of an intent to refine an existing spec (spec-patch mode). |
| [`/dev-plan`](.claude/commands/dev-plan.md) | `lead` (plan mode) | `plan.md` / `epic.md` | Resolves a run (id arg or most-recent), runs plan-prep fanout, then `lead` plans against `spec.md` (sonnet by default, opus for L-tier). Needs a ready spec; stops after the plan check at `step=plan`. No gate, no implement. |
| [`/test-plan`](.claude/commands/test-plan.md) | `qa` (test-plan mode) | `test-plan.md` | Resolves a run (id arg or most-recent), reads `spec.md` + `plan.md`, designs the strategy. Needs a spec; warns if there's no plan yet. `chore`/`docs`/`spike` get no test plan. |
| [`/uxui-plan`](.claude/commands/uxui-plan.md) | `uxui` | `uxui-plan.md` | UI-bearing work only. Reads `spec.md`, drives `ui-ux-pro-max` / `frontend-design`, writes Scenes + Scenarios + UX direction + AC↔scene mapping. **Not a linear state-machine step** — it leaves `step`/`next_step` untouched and just records the artifact in `state.json > notes`. |
| [`/implement`](.claude/commands/implement.md) | `engineer` + `lead` + `qa` + `retro` | source, `review.md`, `tests.md`, `retro.md`, commit/PR | **Phase 2 entry point.** Confirms the run is ready (spec + plan + test-plan), runs the **gate** if it hasn't been approved yet (human sign-off before autonomous work), then runs the whole autonomous build — implement → review → security → test → improve → docs → ship → retro. Same Phase 2 and same `state.json` as `/dev`, so it's interchangeable with `/dev --resume <id>` mid-build. |

Mechanics shared with `/dev`: the command's **main agent plays the orchestrator** (setup, interview, the gate, single-writer `state.json`); the named worker does the file work. The spawn guard ([`dev-agent-guard.sh`](.claude/hooks/dev-agent-guard.sh)) still applies — spawn `pm`/`lead`/`engineer`/`qa`/`retro`/`uxui` by name, never `general-purpose`. A typical team flow: `/spec` → `/dev-plan` → `/test-plan` (+ `/uxui-plan` if UI) → `/implement` (gate → build → ship). `/implement` and `/dev --resume <id>` are interchangeable — both run the same gate + Phase 2 against the run's `state.json`. **`/dev-plan`, `/test-plan`, and `/uxui-plan` can run in parallel on one run** — each writes its own `state.<slice>.json` shard rather than the shared cursor (so concurrent slices don't clobber each other), and the gate folds the shards into `state.json` single-writer; see [`.claude/orchestrator.md`](.claude/orchestrator.md) > State discipline > Team-mode Phase-1 sharding.

## Example: `/dev create todolist app`

Phase 1 → interview (one merged batch — **Size S**: self-contained greenfield, fast path, so feature breadth ≠ blast radius) → `lead` in **combined mode** (`pm` skipped, no scaffold for S greenfield) writes `spec.md` (Type=feat, CRUD tasks, single user, no auth, localStorage) + `plan.md` + `test-plan.md` in one spawn (the test-plan folds into the same combined spawn for feat/fix/refactor — no separate `qa` design-time spawn: each AC → unit/e2e level + assertions, **plus a Visual verification row** since the diff is UI; runner = Playwright headless, flagged dev-only) → **gate** ("Size: S → fast path"; spec ACs + test plan + the one-line dev-only-runner veto presented; will run 1-2-2½-3-4-5-7-8-9-10; **skip 6** — a first-party localStorage round-trip rendered via `textContent` is not a deserialise trigger and carries no dangerous sink) → `approve`.
<!-- step 6 = security review; first-party single-user localStorage + textContent-only rendering = no untrusted-deserialise trigger, no HTML-injection sink, so it doesn't fire -->

Phase 2 → implement (engineer ticks acceptance) → review (sonnet) → tests pass **+ visual verification (mobile ≈375px + desktop screenshots eyeballed — catches a mid-word title break that a `scrollWidth` assertion passes over)** → merged docs+ship (one `engineer` spawn) → `retro.md` (light) → done.

## Example: `/dev fix login redirect loop`

Phase 1 → interview → `spec.md` (Type=fix, reproduction = "log in from /admin, lands back on /login") → `lead` writes `plan.md` with step 1 = "add failing test `auth.spec.ts:redirect-loop`" and step 2 = "fix the redirect" → `qa` writes `test-plan.md` (regression contract: which test, how it's confirmed to fail on pre-fix code) → **gate** (will run 1-2-2½-3-4-5-6-7-9-10; security review on — diff touches auth; skip 8 — docs not in scope) → `approve`.
Phase 2 → engineer writes failing test → engineer fixes redirect → review → security review (passes) → qa confirms regression test fails on pre-fix code, passes now → docs skipped → commit (no PR — flagged at gate) → `retro.md` → done.

## Example: `/dev spike compare bullmq vs sidekiq`

Phase 1 → interview → `spec.md` (Type=spike, timebox=1 day, deliverable=recommendation) → `lead` writes exploration plan → **gate** (will run 1-2-3-4-5-10; skip 6-7-8 always, skip 9 unless user opts to commit) → `approve`.
Phase 2 → engineer explores both → writes `recommendations.md` → light review → `retro.md` → user decides whether to open follow-up `feat` runs.

## Stop conditions

- User says `revise` at the gate (or chats free-form about the spec/plan/test-plan) → targeted in-run edit of only the affected spec/plan/test-plan sections, then re-verify and re-present the changed parts. Never a fresh Phase 1 run.
- User says `skip <n>` / `run <n>` at the gate → flip that discretionary phase's disposition (5 Review / 7 Test / 7½ Improve / 8 Docs only; a `skip` of a protected phase is refused), record it in `state.json > phase_plan`, re-present, and stay in the gate loop until `approve`.
- Reviewer blocking issues → fix → re-review, max 2 cycles, then escalate.
- Security review `high` finding → fix → re-review, counts against the review cycle budget.
- Test failures → fix → re-run, max 3 cycles, then escalate.
- Any agent unsure → stop and ask user, never invent requirements.
- Context exhaustion / cancel → next `/dev --resume <id>` reads `state.json` and continues from the recorded step.
