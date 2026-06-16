# Size Tiering for Plans

Size determines which sections of `plan.md` are required, which are optional, and which should be deleted. Wrong size = either bloat (XS work dragged through M template) or under-coverage (M work treated as S). When borderline, prefer the larger tier.

This file is the picker. The `lead` agent sets `Size` in the plan's frontmatter before drafting `Steps`. The picker is also the implicit answer to the question *"is this even worth a plan?"* — see [Anthropic's guidance](https://code.claude.com/docs/en/best-practices): "if you could describe the diff in one sentence, skip the plan." That sentence-test is the XS floor.

## The four tiers at a glance

| Size | Files | Logic | Contract / schema | Subsystem reach | Typical Types |
|------|-------|-------|-------------------|-----------------|---------------|
| **XS** | 1 | none | no | none | chore, docs |
| **S**  | ≤ 2 | simple | no | 1 | fix, small feat, small refactor |
| **M**  | 3–10 | real | no | 1 | feat, refactor |
| **L**  | any | real | **yes** (or breaking) | ≥ 2 | feat, refactor, fix at a seam |

"Real logic" = branching, state, side effects to design. "Simple logic" = one branch, no state. "Contract / schema" = public REST/gRPC API, DB schema, queue message shape, IPC, event payload.

> **File count is a proxy, not a gate.** A **self-contained greenfield module** (brand-new, isolated, nothing imports it yet, no published contract, no integration with existing code, first-party storage only) caps at **S regardless of file count** — a 3-file vanilla CRUD app is S, not M. Blast radius, not file spread (see the greenfield signal + edge case below).

## Greenfield vs brownfield (the `field` classification) — canonical

Orthogonal to size, every run is one of two **fields**, recorded in `state.json > field` (the formalisation of the "new project vs existing codebase" detection `/dev` already does). This is the **canonical definition** — `orchestrator.md`, `lead.md`, `WORKFLOW.md`, and `plan-writing > principle 3` point here instead of restating it.

- **greenfield** — new, isolated code: nothing imports it yet, no published contract, no integration with existing code, first-party storage only. This is the *same* condition as the self-contained-module S-cap below, so **a greenfield run is always XS/S**.
- **brownfield** — the change modifies or extends existing behaviour, or wires new code into existing code paths. The default: most work in an existing repo is brownfield, and **every `fix`, every `refactor`, and every M/L run is brownfield** (greenfield caps at S, and changing existing code is the definition of brownfield). When a run is genuinely mixed (a new isolated module *plus* an edit to existing code), it is **brownfield** — the integration is what carries the risk.

`field` is estimated by the orchestrator at digest time (alongside `size`) and re-derived by `lead` at plan time. Like `size` it **only ratchets one way**: a greenfield estimate that the code walk reveals to be an integration becomes brownfield via a first-line `FIELD_UPGRADE: brownfield — <reason>` signal; it never moves back, because discovering isolation late doesn't shed safety the run has already priced in (and wrongly-brownfield only costs an extra current-state note on isolated code — cheap).

**What `field` gates** — brownfield turns each on; greenfield skips them ("nothing to preserve; got the shape right the first time" — `programming-fundamentals` owns the greenfield shape):

- **Understand** — a `Current state` map before designing the change (`plan-writing > principle 3`). All brownfield work.
- **Lock** — a characterization baseline pinning the touched behaviour *before* it is edited (`test-plan.md > Baseline`), for brownfield `feat` and `refactor`; `fix` locks via its regression contract instead.
- **Improve** — the bounded post-test cleanup phase (7½) on the code the change touched: brownfield `feat` (and optionally `fix`); a `refactor` **skips** it, since the refactor itself *is* the improvement.

## Picker — answer in order

1. **Does the change touch a public contract or schema?** (REST/gRPC API, DB schema migration, queue message format, public library function signature, breaking change to any external surface)
   → **L**. Stop.

2. **Does the change cross more than one subsystem in a way that *couples* them?** (e.g., touches both the API layer and the worker layer that must agree; or two bounded contexts; or a service plus a sibling that shares its contract)
   → **L**. Stop. It is *coupling* that makes multi-subsystem reach an L, not raw count — the same trivial edit swept across N **independent** surfaces (no shared contract) is a **parallel sweep**, sized by its deepest single surface (see Signals → "Wide but shallow"), not an automatic L.

3. **Is there real logic to design?** (branching, state machine, retry policy, ordering decision, concurrency)
   → **M** if single-subsystem (multi-subsystem already caught in step 2) — **unless it's a self-contained greenfield module** (brand-new, isolated, nothing imports it yet, no published contract, no integration with existing code, first-party storage only), which caps at **S**: the logic is real but the blast radius is ~zero. See the greenfield signal + edge case below.

4. **Is it more than 2 files, OR does it have any logic at all?**
   → **S**.

5. **Single file, no logic, no behaviour change visible to users or callers?** (typo, dep bump, doc edit, formatter run, comment cleanup)
   → **XS**.

When two answers feel equally true (e.g., "2 files but they're trivial" vs "1 file but the logic is hairy"), pick **the larger size**. The cost of an over-sized plan on small work is a few extra optional sections you skip; the cost of an under-sized plan on real work is missed scope caught at review (cycle burn). **Exception:** the self-contained greenfield S-cap below is a *defined* route, not a "torn" case — don't round a hermetic new module up to M just because it has several CRUD features.

## Signals that override file count

File count is a *proxy*, not a rule. These signals push the size up regardless of file count:

- **One-file change that adds branching, state, or retry policy** → at least S, often M. Complexity lives in the logic, not the file spread.
- **One-file change to a public API signature or DB migration** → L. Contract changes are always L.
- **Many-file change that's pure rename / formatter / mechanical sweep** → still XS or S. Mechanical changes don't carry design risk.
- **Many-file change that's "ripple from removing one thing"** → S or M depending on the call sites' logic. Removal alone isn't M; *design* of the removal is.
- **Wide but shallow — a parallel sweep of the same trivial edit across N *independent* surfaces** (e.g. a 2-line health-endpoint registration added to each of 7 sibling services; one config key added to every package). A **defined route, not a "torn" case** (like the greenfield S-cap below): size by the **single deepest surface**, not by the surface count — *only when all hold*: (a) each per-surface edit is trivial and near-identical, (b) the surfaces are **independent** — none shares a contract/schema with another, so they need no lockstep coordination, and (c) the deepest single surface is itself ≤ M. The *width* then drives **parallel review/test fan-out** (the surface axis — `fanout-team-agents > The third axis: surface (per-repo) fanout`), not ceremony depth. **Shallow ≠ safe:** each swept surface still gets its **own** runtime verification (the bug that only surfaces at `up`/runtime hides per-surface) — the route is *light ceremony + wide parallel verify*, never "skip the verify because each edit is small." If the surfaces are **coupled** (a shared proto/DB/contract change every surface must adopt in lockstep), it is **not** a sweep — that's the L in picker step 2. The same independent-vs-coupled call also gates **review**: a coupled multi-repo change needs a cross-repo coherence check in surface-fanout synthesis (`orchestrator.md > Surface (per-repo) fanout`), because per-repo review reads each repo in isolation and can't see a cross-repo version skew.
- **Touches a security-sensitive path** (auth, crypto, exec, deserialise of untrusted input, raw SQL, file/path handling) → bump up one tier *when the security review fires on it* (it usually does, and the plan benefits from more documentation). **Exception — first-party browser-storage round-trip:** `JSON.parse` of the app's own `localStorage`/`sessionStorage`/`IndexedDB` single-user data is not untrusted deserialisation and earns **no** bump — it doesn't fire the security review either (see `WORKFLOW.md > Security trigger`) — *unless* the stored data crosses a real trust boundary (multi-user / shared-device threat model, server- or other-principal-written data) or the parsed value flows to a dangerous sink (`innerHTML`/`dangerouslySetInnerHTML`/jQuery `.html()`/`eval`/… — open list, any HTML-injection sink).
- **Self-contained greenfield module** (new, isolated, nothing imports it yet, no published contract, no integration with existing code, first-party storage only) → cap at **S** even with multi-feature CRUD logic. M-tier machinery (separate `pm`+`lead` spawns, fanout eligibility, full retro) prices *blast radius into existing systems* and *cross-component coordination*; a hermetic new module carries neither. It re-enters M the moment something depends on it, it grows a published contract or real schema, or it integrates with existing code.
- **Introduces a queue, broker, async worker, or pub/sub topic** → at least M, often L. The contract you're committing to (delivery semantics, idempotency, retry/DLQ, ordering) needs documentation even if the code is one consumer file.

## Edge cases

### "It looks like a chore but it's actually a feature"

Example: "bump library X" sounds XS, but the new version changes the default error handling, so call sites now behave differently. That's a **feat** with **S or M** size — the behaviour change is the feature.

Rule: if user-visible behaviour changes, it's not a chore. Re-pick `Type` first, then `Size`.

### "It's one file but it's a 200-line state machine"

Logic density wins over file count. **M.** A state machine deserves a diagram, AC tags per transition, and observability around state changes — all M-tier sections.

### "It's a greenfield app with several features but all new and self-contained"

A vanilla-JS todolist — add / edit / delete / filter / persist, 3 files, `localStorage` — has several ACs of real logic but is a brand-new isolated module: nothing imports it, no published contract, no integration with existing code, first-party storage only. **S, not M.** Multi-feature CRUD *breadth* ≠ blast *radius*; the coordination-and-contract cost that M-tier machinery exists to cover isn't present. `JSON.parse(localStorage)` does not bump it via the security-path signal — see that signal's first-party-storage exception. It enters M the moment it grows a backend contract, a real schema, or integration with existing code.

### "It's a fix but the fix is one line"

Still run through the picker. A one-line fix to a public API is L. A one-line guard inside a function is S (with the regression test as step 1, per fix-type rule). The fix line count doesn't determine size — the *blast radius* does.

### "It's a docs-only change but it touches 30 files"

Mechanical docs change (e.g., updating an old name across all guides) → **XS**. The plan can list "find/replace + spot-check" as the entire procedure. Don't drag docs work through M ceremony.

If the docs change is rewriting a guide that *explains the system* and the system has changed in real ways → that's not docs-only; the underlying change should have its own plan, and this docs update is the doc step of *that* plan.

### "It's a 4-line change but it touches 11 repos"

A control-plane run that adds the same ~2-line health registration to each of 7 sibling services (plus one compose-file edit) *looks* M/L by subsystem reach, but the 7 service edits are an **independent parallel sweep** — none shares a contract with the others, each is XS on its own. Size by the **deepest single surface** (here the compose/infra edit, with its real healthcheck design — S), not by the 11-repo spread. Width is handled by **per-repo review/test fan-out** (the surface axis), and **each surface still gets its own runtime verify** (`docker compose up --wait`, `go test ./...`) — *light ceremony, wide parallel verify*. It becomes L only if the surfaces are *coupled* (a shared proto/schema bump every service must adopt in lockstep). See Signals → "Wide but shallow".

### "It's a spike"

Spike type is orthogonal to size. The "size" for a spike is about the *exploration scope*, not code spread. Most spikes are S or M — the lead is choosing how deep to explore, not how much code to write (none lands). Use `Timebox` in `spec.md` for the real budget.

### "It crosses DB + API + UI" (full-stack feature)

Default = single L plan, single `/dev` run. Crossing three layers is normal full-stack work, NOT a reason to split. Only split when both are true: `Ship as: staged` in spec frontmatter AND the spec lists ≥ 2 capabilities that can ship independently. See `WORKFLOW.md > Scope` for the epic-mode rule.

## What each size requires (cross-link to template)

| Section | XS | S | M | L |
|---------|----|----|----|----|
| `Approach` (2–3 sentences) | ✓ | ✓ | ✓ | ✓ |
| `Step order` line | skip | optional | ✓ | ✓ |
| `Architecture diagram` | one-line / N/A | mini mermaid (3–5 nodes) | full mermaid by Type | full + before/after |
| `Steps` (action — path#anchor — verify — [AC#]) | verify optional | ✓ | ✓ | ✓ |
| (Optional) Phases above Steps | skip | skip | skip | ✓ if >12 steps |
| `Files touched` table | ✓ | ✓ | ✓ | ✓ |
| `Alternatives considered` | skip | skip | when non-obvious | ✓ |
| `Risks` table | skip | optional | ✓ | ✓ |
| `Observability` | N/A | required if feat/fix | required if feat/fix | ✓ |
| `Dependencies` | skip unless present | skip unless present | skip unless present | ✓ |
| `Rollback` | "revert commit" line | "revert commit" or specific | ✓ if destructive | ✓ runbook |
| `Out of scope` | ✓ | ✓ | ✓ | ✓ |

`skip` means *delete the section*, not leave it empty with placeholder text. Empty sections erode the gating discipline.

## How long should a plan take to write?

Rough budget (for `lead` with the construction skill already loaded):

| Size | Plan-write time | Notes |
|------|-----------------|-------|
| XS | 2–5 min | Almost entirely template fill-in |
| S | 5–15 min | Real thinking about Steps + Diagram |
| M | 20–45 min | Alternatives + Diagram + Risks need real thought |
| L | 1–2 hr | Two diagrams + Dependencies + L-grade Rollback runbook |

If you're spending 2× the budget at any tier, something's wrong: scope grew without a Size bump, or the spec is too vague to plan against. In the latter case, go back to spec — don't paper over with a longer plan.
