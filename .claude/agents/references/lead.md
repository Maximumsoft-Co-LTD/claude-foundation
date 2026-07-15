# lead — extended rules

Load a section when its trigger (in `agents/lead.md`) fires. Single-repo single-pass runs — the common case — never need most of this.

## Skill routing (all modes)

Default: **no full skill body** — the always-on summaries + `agents/lead.md` are pre-flight. Read **at most ONE** targeted `references/<file>` for the friction hit:
- `plan-writing`: size unclear → `size-tiering.md`; which mermaid → `diagrams.md`; LSP-walk → `current-state.md`; plan feels off → `self-review.md`.
- Review finding needs depth (suspected N+1) → `database-fundamentals/references/query-performance.md`.

Construction skills — **summary, not body** (same budget). At most ONE construction skill's ONE reference section, only for a novel/high-risk decision the summary doesn't settle. Domains + run order:
- Non-trivial code → `programming-fundamentals`
- Schema/query/migration/index → `database-fundamentals`
- Backend with real domain logic → `hexagonal-backend`
- System-level/cross-service → `architecture-fundamentals`
- Queue/broker/async worker → `queue-fundamentals`
- Frontend/UI (screens, components, client state, navigation) → `ui-ux-pro-max` for the UX/IA/accessibility decisions shaping `UI component & state plan` (`frontend-design`/`tailwind-design-system` are build-layer — name them in the design-direction line, don't load here).
- Bug with unknown cause → `debug-fundamentals` first.

When in doubt, draft from the summary and ship — Mode B catches a missed fundamental cheaper than loading a 100 KB body. (One `SKILL.md`-body exception: `plan-writing > ## Parallelizable phases`, for a parallel-phase feat plan.)

**Model note:** sonnet by default (plan/review are `plan-writing`-guided; measured on the Claude 4-era family as ≈ opus at ~½ wall-clock — generation-dated, re-validate before leaning on it); opus only for high-stakes (L-tier, cross-subsystem, schema migration, public API/event contract, breaking change, large/cross-module critical-path review, public-contract/type-shape change). Mode C always opus. Policy home: `orchestrator/references/model-tiers.md`.

## Current state (Mode A — current-state map) — full stance

Required for **brownfield** (by `field`, not Type/Size): full when Size ∈ {M,L} or Type ∈ {refactor,fix}; a proportional entry-point + blast-radius note for a brownfield `feat` at XS/S; skip for greenfield isolated new files, `chore`/`docs` not touching live code, `spike`.

If the prompt has **`context.md`** (shared brownfield-M/L map from `/spec`) or plan-prep findings, **synthesise them** — re-cite each `path#anchor`, spot-check load-bearing claims (re-resolve a sample), LSP-walk only what they didn't cover. **`plan.md > ## Current state` must NOT duplicate `context.md` — point, don't paste:** open the section with `> Full map: context.md > ## Current state` and write ONLY this change's overlay (the blast-radius subset THIS plan touches + any claim you re-resolved that differs). With no `context.md` (greenfield edits / brownfield XS-S) write the map inline. The engineer reads the same map for orientation at implement, so the pointer keeps one source of truth. **Evidence, not authority** — you own the final map; an unre-resolvable claim is a finding, not a fact. For points you walk, use **LSP find-references + go-to-definition**, not memory:
- Entry point(s) with `path#anchor`
- Data/control flow (3–7 hops, each `path#anchor`)
- Callers / blast radius for every symbol whose contract changes (LSP find-references)
- Invariants the current code relies on, each `path#anchor`
- `refactor`: anti-goals — behaviours that stay identical
- `fix`: the bug path with `← BUG` on the wrong-data step

For L + structural refactor, draw an "as-is" mermaid alongside the to-be diagram. **Map at boundary-depth** — blast radius + invariants + insertion points, not a file tour; defer internals to a one-line pointer in `## To explore at implement` (never defer a blast-radius invariant). Full: `plan-writing > references/current-state.md > Boundary-depth, not full-depth`.

## Type rules (Mode A — type-specialised tasks) — full detail

- **`feat`** — standard plan. **Brownfield baseline:** when the feat edits existing untested behaviour (`field` = brownfield), task 1 in `tasks.md` MUST be "capture characterization baseline for <touched behaviour> at `path#anchor`" before the feature tasks (`test-plan.md` records it under `Baseline`); greenfield skips it.
  - **Parallel-phase option (L-tier only — implement-fanout producer):** when the feat is L-tier (>12 tasks) AND decomposes into ≥ 2 **additive, independently-completable sub-features touching disjoint files** (new adapters/modules wired at the end — NOT a field threaded through shared existing code), mark those `tasks.md` phases `**Parallelizable:** yes` with their own `**Files touched (exclusive):**` set + `**Depends on:** none`, and add a final sequential `### Phase <last>: integration` (`**Parallelizable:** no`) owning ALL shared glue (barrel/router/DI/lockfile/generated output) + dependency installs + every `verify:` + AC reconciliation. Without these markers the run falls back to single-pass. Full rationale: `plan-writing > ## Parallelizable phases`.
- **`fix`** — task 1 in `tasks.md` MUST be "write failing regression test for <bug> at `path#anchor`", encoded against `spec.md > Reproduction`. The fix is task 2+.
- **`refactor`** — one-line *behavior-equivalence statement* in `Summary`. Lean on the existing suite where it covers the touched behaviour; where coverage is thin, **task 1 in `tasks.md` MUST be "capture characterization baseline for <behaviour> at `path#anchor`"** (golden-master/snapshot) — without it the equivalence claim can't be verified.
- **`chore`** — minimal plan; one or two tasks. Skip `Risks` for XS.
- **`docs`** — tasks are doc edits, one per doc file. No tests.
- **`spike`** — exploration outline. `Out of scope` MUST say "no production code lands — engineer writes `recommendations.md` only". Tasks may be open-ended.

## Sections & scaffold (Mode A — plan sections) — full detail

`## Summary` leads (2–3 sentences: technical approach + why over the obvious alternative; each User Story = one vertical slice), then `## Technical Context` (lang/framework, storage, testing, target, perf→`SC-###`, scale) and `## Gate check` (the `rules/fundamentals.md` layers crossed — trust boundary, new-dependency, a11y/concurrency/db/observability — one line each; the spec-kit Constitution-Check stand-in). No `path#anchor` in Summary — the cited walk is `## Current state`.

Optional sections, two passes:
- **Pass 1 — trigger check**: `_templates/plan.md` is a clean skeleton; the authoritative trigger + placement list for every optional section (Reviewer summary, Hard-to-reverse decisions, Current state, Scaffold, **Folder structure**, API/event contracts, UI component & state plan, Risks, Rollback, …) lives in `plan-writing > references/plan-sections.md` (size-axis companion: `plan-writing > SKILL.md > Section gating by Size`). Any firing condition MUST include the section.
- **Pass 2 — active reasoning**: for each non-firing section, ask "given THIS task's risk/blast-radius/unfamiliar-paths and what a reviewer needs, would omitting it cause a miss or a follow-up?" Include if yes. The trigger list is a floor.
- **Current state → tasks Guardrails (brownfield):** when `## Current state` fires, digest its invariants into the `tasks.md > ## Guardrails` header (backticked `` `path#anchor` `` + why per line) — the engineer's **only** up-front invariant read; the full map stays in `plan.md`, pulled per-task via `[ref:]`.

**Hard-to-reverse decisions.** When the plan commits to anything expensive to undo (schema/migration shape, public API/event contract, architecture/topology, data backfill/destructive script), list each under `## Hard-to-reverse decisions` (one line: decision · why now · cost to reverse), right after `## Summary`. The gate surfaces these for per-line confirmation. Omit when nothing qualifies.

**Scaffold (M/L — required).** For Size ∈ {M,L}, write `## Scaffold` after `## Architecture diagram` (the last `plan.md` design section; the `tasks.md` tasks build to it) — one fenced block with the target file tree (`★` new · `~` edited) and each new/changed file's key exported signature(s) (interface/type/function → params → return/error). Where a consumed type carries a decision (discriminated union, value object, state enum — anything where the wrong shape leaves an illegal state representable), inline its **definition** too (not every DTO). Signatures + type shapes + at most a one-line stub body (no real bodies). For M/L it **subsumes `## Folder structure`** (don't write both). S touching existing code MAY include a mini Scaffold; XS skips it.

**Folder structure / new project.** Propose stack in `Summary` (one-sentence justification) and write `## Folder structure` (directory tree, one-line purpose per node, unchanged subtrees omitted) **for new-project / S cases where Scaffold isn't required**; existing-project feats adding ≥ 3 new packages/modules at S include it for the new subtree only.

**API / event contracts.** If the task introduces/changes public HTTP endpoints, event schemas, cross-service message formats, **OR a new internal port/interface boundary**, write `## API / event contracts`: transport → method · path · request/response fields · error codes per endpoint; internal port → interface name + method signatures. **Name the contract BEFORE the `tasks.md` tasks that implement it** — for M/L the signature is already in `## Scaffold`, so write this only when a contract needs field/error-code detail beyond that one-liner. These live in `plan.md` after `## Architecture diagram`.

**Existing-code research (step 9 of the original — folds into step 3/9 here).** LSP first, grep second. **Single-pass-first** (`orchestrator.md > Single-pass-first`): write `plan.md` from your own walk by default. Self-dispatch a worker per point (see *Recruit help*), or return `FANOUT_REQUESTED: plan:<point-list>` (integration-point names from `spec.md > Constraints > Integration points`) as the fallback, **only** when **2+ integration points in disjoint surfaces** (separate modules/folders/repos) AND the research is substantial. **Disjoint surface, not raw count, is the bar.** If `context.md` (or plan-prep) already mapped current state, signal fanout only for residual best-practice research — never to re-map current state. Skip fanout for XS/pure-greenfield/straightforward.

## Parallel-phase integrity scan (Mode A self-review — when any `Parallelizable: yes`)

`plan-writing > principle 8`: ≥ 2 such phases; pairwise-disjoint `Files touched (exclusive)`; each `Depends on: none`; a final sequential `### Phase <last>: integration` owning shared glue; **no parallel phase imports a symbol defined in another's exclusive file**; **any AC split across ≥ 2 phases has its acceptance-verifying task in integration** (parallel phases run no `verify:`). Any failure → the orchestrator refuses fanout.

Other self-review additions: Size=L or ≥ 3 sign-off decisions → `## Reviewer summary` exists above `## Summary`; if phases are used, grep for bare `step [0-9]` and fix to the task's `T###` id; M/L `## Scaffold` exists, every `★` maps to a `(new)` task and vice versa, block stays signatures/one-line stubs, no `## Folder structure` duplicates its tree; `## Fanout plan` `Implement` row matches the `Parallelizable: yes` markers.

## Combined variant (XS/S fast path — spec + plan + test-plan in one spawn)

When spawned in **combined mode** (`pm` skipped for XS/S), write all design-time artifacts in one pass — `spec.md`, `plan.md` + `tasks.md`, and (feat/fix/refactor) `test-plan.md`:

1. Copy `_templates/spec.md` → `.workflow/<id>/spec.md`, fill from the digest + Q&A under `pm`'s rules: floor is User Stories (priority-ordered) + acceptance scenarios (`AC#`, Given/When/Then) + FR-### + SC-### + `Type`; every scenario keeps its boundary/error scenario; user-stated digest content is authoritative (only repo-derived facts are inferences); unresolved slots get `[NEEDS CLARIFICATION: <who> — <what>]` (`pm.md > Contract`), never guesses.
2. **Re-derive size yourself — never anchor on the orchestrator's estimate** (made from the digest, pre-code-walk). Hard tripwires that mean NOT XS: >~2 files, ANY persisted-data/storage-key/schema/API-contract change (**a data migration is never XS**), or a blast radius needing current-state mapping. Tier exceeds estimate → STOP, return `SIZE_UPGRADE: <size> — <reason>` first line (your `spec.md` stands). **Re-derive `field` the same way:** an estimated-greenfield run editing/wiring into existing code → `FIELD_UPGRADE: brownfield — <reason>` first line (the fast path stays, but the plan gains a `Current state` note + the lock baseline); else record the resolved field in the `plan.md` `**Field**:` slot. Otherwise write `plan.md` + `tasks.md` per Mode A at XS/S compactness.
3. No spec-prep/plan-prep fanout. Needing `FANOUT_REQUESTED` is itself evidence the run isn't XS/S — return the `SIZE_UPGRADE` line.
4. **Test plan — fold it in (feat/fix/refactor only).** After `plan.md` + `tasks.md`, write `.workflow/<id>/test-plan.md` per `qa.md > Mode: Test plan` (map every acceptance scenario + its boundary/error scenario + any `measured:` target to the owning level + assertion; edge cases; fixtures + a **proactively-picked** runner in `Execution mechanism`; `fix` Regression contract / `refactor` Baseline; coverage floors; and **only when `e2e_visual=on`** — for a UI-touching diff the `Visual verification` rows + settled-render note). **Write it as an adversarial check on your plan** — is every AC verifiable, what unhappy path is unstated, is any reachable input `undefined → spec gap`; a reachable security/data-integrity undefined path → `BLOCKER:` first line. **chore/docs/spike → no test-plan.** `qa` executes it in Phase 2.
5. **This mode writes ONLY `.workflow/<id>/` artifacts (`spec.md`, `plan.md` + `tasks.md`, feat/fix/refactor `test-plan.md`). Touching ANY source file is a role violation** — the gate hasn't run; implementation is `engineer`'s after approval. The orchestrator checks `git status` and reverts undisclosed source writes.

Return: artifact paths + Size + the Mode A done-summary fields + (when a test-plan was written) the count of ACs mapped + whether any reachable input is a blocking spec gap.

## Revise variant (gate revise — incremental, NOT a fresh plan)

When re-spawned with gate-revise notes (Phase 1 step 3 (gate) `revise`), you patch the **existing** `plan.md`, not regenerate it:
- **Edit only the affected tasks/sections** (`Edit` tool); leave the rest byte-stable so the orchestrator re-presents only the diff.
- **No plan-prep fanout, no LSP re-walk of unaffected points** (`Current state`/`Research notes` stand; re-derive only what the notes change). **No skill-body reload** (the budget applies doubly).
- Keep the strict `tasks.md` task format + AC tags: if a note adds/removes/retargets a task, fix its `[AC#]` + `verify:`, re-check every AC still has delivering + verifying task(s) and no dangling `T###` / phase ref. That edited-region self-check is the consistency verification the orchestrator relies on.
- **Re-check `field` only if the revise pulls in existing-code integration** — if it turns an estimated-greenfield run brownfield, return `FIELD_UPGRADE: brownfield — <reason>` first line (same ratchet as step 2 of Mode A). Already-brownfield needs no re-check.
- Return: plan path + a 1–2 line summary of **only what changed** + confirmation the self-check passed.

## Recruit help when the work is large (direct nesting — all modes)

You hold `Agent` — when scope is too big for one serial pass, **spawn helpers directly** (v2.1.172+), integrate their returns, stay the sole writer of your artifact. This is the primary path (skips the orchestrator's collect-then-re-spawn round-trip); `FANOUT_REQUESTED:` is the fallback. **Honour the gated `## Fanout plan`** (`state.json > fanout_plan`): `off` → single-pass, `on` → fan out even if your heuristic would skip. **Registry path** (`.claude/skills/fanout-team-agents/SKILL.md`) — read `team_registry`: `live` → `team-*` by name; `inline-fallback` → `general-purpose` + `model="sonnet"` with `.claude/agents/team-<role>.md` inlined (Case 6 blocks an unpinned general-purpose spawn); `unknown` → try named, fall to inline on `not found`, report the path used (an inline fallback for a haiku-pinned role runs a tier UP at the sonnet floor — say so, cost drift stays auditable). A miss never drops you to single-pass.

- **Plan mode** — ≥ 2 integration points **in disjoint surfaces** → **one `team-codebase-explorer` per point**; ≥ 1 unfamiliar framework/API/security choice → add a `team-best-practice-researcher`. **Dedup:** if the prompt already has plan-prep explorer findings, recruit ONLY for uncovered points + residual best-practice research.
- **Review mode** — follow the Review-fanout tiering below.
- **Security mode** — follow the Security-fanout rule below.

**How** — split into non-overlapping sub-scopes; one helper per sub-scope **in one message** (parallel), **cap 6**; self-contained prompt (scope + what to return + what NOT to touch). **Integrate + verify** each return; re-drive a strayed result.

**Guardrails** — helpers are read-only, never write your artifact or `state.json`. One level of split; dispatch mechanics + stop-line: `.claude/skills/fanout-team-agents/references/dispatch-mechanism.md > Worker-side nesting contract`.

## Review fanout (Mode B step 1) — tiering + simplicity lens

**Tier by size + risk** (review is the one phase where the default flips to fanout at M/L — models under-reach for parallelism, so the default carries the reach; `orchestrator.md > Single-pass-first` still governs every other phase):
- XS/S → always direct (or `SIZE_UPGRADE` if the diff proves larger).
- M → **default the core 3 lenses** (`team-code-reviewer`, `team-pr-test-analyzer`, `team-silent-failure-hunter`); go direct only with a stated reason in the `## Fanout plan` Review row (a trivially-scoped diff is a valid reason — "cheaper" alone is not).
- L-tier / public-contract / type-shape / high-stakes → **default the full 6** (+ `team-code-simplifier`, `team-comment-analyzer`, `team-type-design-analyzer`), minus the per-lens skip rules below; direct needs a stated reason.

A comment-sparse diff skips `team-comment-analyzer`; no new types skips `team-type-design-analyzer`; an already-simple diff skips `team-code-simplifier`. Fanout per-agent sections go in `review.md > Per-agent findings`; Tasks-adherence + Acceptance-criteria rows are still walked one-by-one (`WORKFLOW.md > Anti-bias rule`).

**Synthesis precision gate.** `team-code-reviewer` (and the other lenses) return **all** findings scored 0-100 — they do not pre-filter. YOU apply the gate at synthesis: findings ≥ 80 become `review.md` findings; 26-79 collapse to one-line FYIs under `Per-agent findings` (path:line + a clause); ≤ 25 drop silently. Cross-worker duplicates merge, keeping the highest score.

**Simplicity lens (single-pass reviews only — when fanout ran, `team-code-simplifier` owns it).** Scan against `coding-discipline > Simplicity First` + its decision ladder: speculative abstraction, unrequested config/flags, a hand-rolled routine the stdlib/an installed dep does, a block that could be a fraction of its size. Flag genuine over-engineering as **non-blocking** (`path:line`, name the simpler form) — blocking only if it hides a real correctness/security risk. "Could be shorter" is not a finding.

## Security fanout (Mode C step 1)

**Per-bucket fanout (single-pass-first).** Each bucket is an independent threat surface; **fan out only when the diff trips ≥ 2 buckets** AND the per-bucket work is substantial — self-dispatch one `team-code-reviewer` per bucket (primary path, see *Recruit help*), or return `FANOUT_REQUESTED: security:<bucket-list>` as the fallback. A single-bucket or quick multi-bucket diff stays single-pass.

## Epic mode (Mode A step 1 — rare)

Write `epic.md` instead of `plan.md`. Decompose into 2–5 vertical slices, each shippable on its own. Recommend a starting slice.

## Surface (multi-repo) variants (Mode B / Mode C)

On a multi-repo control-plane run you may be spawned as a **per-repo reviewer/security-reviewer** or the **surface-coordinator** (which nests per-repo helpers and writes the unified `review.md`/`security.md`). Both contracts live in `orchestrator/references/fanout-dispatch.md > Lead — Mode B (Review)` / `> Lead — Mode C (Security review)` — loaded on demand; a single-repo run never needs them.
