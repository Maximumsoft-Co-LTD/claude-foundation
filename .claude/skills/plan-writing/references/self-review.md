# Plan Self-Review

Run before `Status: draft` in `plan.md`. Filters failure modes that otherwise surface at review time. ~30s for XS/S, ~2min for L. Walk in order; if any fails, fix before draft.

## Scan 1 — Anti-placeholder

Search the whole plan. Every hit is a fix-before-draft:

| Pattern | Why it's bad |
|---------|--------------|
| `TBD`, `TODO`, `???` | A placeholder is a hole. Fill it, move to `Out of scope`, or replace with an inline `[NEEDS CLARIFICATION: <who> — <what>]` in spec.md at the spot it matters. |
| `appropriate error handling`, `proper validation`, `as needed`, `where appropriate` | Vague — no one can implement "appropriate". State the actual behaviour. |
| `see spec`, `as discussed`, `per the design` | Forces a dereference. The plan is self-contained for the slice it owns. |
| `etc.`, `and so on`, `among others` | Hides scope. List it or scope it out. |
| `path/to/file`, `foo/bar`, `<file>` | Template residue. Replace with a real `path#anchor` or delete the bullet. |
| `e.g.`, `for example` *in tasks* | Tasks are actions, not illustrations. Move examples to `Summary`. |
| `should`, `would`, `might` *in tasks* | Tasks are commitments. "Add `getUserById` at `src/users.ts#getUserById`", not "should probably add a lookup". |
| `consider X`, `think about Y` *in tasks* | Tasks are decisions made. Still deciding → it's an `Open question` in spec. |

Hedging in `Summary` is usually OK (it carries the *why*). The hard rule: **`tasks.md` tasks are placeholder-free**.

## Scan 2 — Requirement coverage: AC + Definition of Done

Tag presence is the floor; sufficiency is the bar. For each acceptance scenario (`AC#`) in `spec.md > User Stories`:

1. Search `tasks.md` for its number (`[AC1]`, …). Confirm ≥ 1 task carries the tag.
2. Read those tasks — taken *together*, do they **fully deliver** the scenario, not merely touch it? Hand-wavy connection → task too abstract, split it.
3. Confirm the acceptance check *runs*: ≥ 1 tagged task's `verify:` exercises the `Then <outcome>`. A tagged AC with no verify checking it is coverage on paper only.
4. **Cover the boundary/error scenario + any measured target.** A separate boundary/error scenario needs a task that delivers the unhappy path AND a `verify:` exercising it (feed bad input / hit the limit / send the unauthorized caller). A `measured:` perf/security/a11y target needs a verify that runs the measurement.

If an AC has no task → add tasks, or state it in `Out of scope` and confirm with orchestrator/user. If a task has no AC tag → tag `[DoD]` if it delivers a `Definition of Done` item (telemetry, doc, flag), else delete/move to `FOLLOWUPS.md`, or add the missing AC to spec first.

**Definition-of-Done coverage** (skip if the spec has none). DoD items carry no `[AC#]`, so the AC checks miss a missing one and review catches it a cycle later. For each DoD item: a `[DoD]` task delivers the artifact AND its `verify:` confirms it (metric emits, doc path present, flag toggles), OR it's genuinely post-ship with an explicit deferred note in `Summary`/`Out of scope`.

Net: every task ↔ ≥ 1 AC **or** a DoD item · every AC ↔ ≥ 1 task · every in-run DoD item ↔ a delivering+verifying task (or an explicit deferred note).

## Scan 3 — Diagram ↔ tasks alignment

- Every `★` node → a `(new)` task, and vice versa.
- Every `~~strikethrough~~` node → a `(delete)` task, and vice versa.
- Edit tasks needn't be in the diagram unless the edit is structural (new exported function, new dependency arrow) — then surface it with a labeled edge.

XS plans where Diagram = `Impact: N/A` skip this scan.

## Scan 4 — Current-state coverage

Skip when principle 3 says skip (greenfield, chore/docs not touching live code, spike). A brownfield feat editing existing code does NOT skip (it carries the proportional note). Otherwise, for each task's `(new|edit|delete)`:

- **`new`** — no coverage required (file doesn't exist yet).
- **`edit`** — the file must appear in `Data/control flow`, OR `Invariants`, OR `## To explore at implement` (a **contained** edit: blast radius mapped, internals deferred — valid **only** when no blast-radius invariant the change depends on lives there; if one does, move it to `Current state`, mapped and cited). In none of the three → do we understand the current file at the edited line? If yes + it constrains → add the bullet/invariant; if yes + contained → defer explicitly; if no → walk it with LSP now.
- **`delete`** — must appear in the caller-walk (nothing else points at it) AND the as-is flow (what it does at the call site).

Then walk `## Current state` itself:
- Every invariant has a `path#anchor` ("the hook fails open on missing `jq` at `dev-state-mark.sh#"command -v jq"`", not "the hook fails open").
- The caller walk gives a concrete count (0 / N / "many — listing non-obvious") per contract-changing symbol.
- `refactor`: Anti-goals tie to Approach's equivalence statement (same invariants, opposite sides). `fix`: Bug path has `← BUG` on the wrong-data step, not the symptom.
- If the orchestrator provided **plan-prep findings**, Current state **synthesises** them (re-cited `path#anchor`, load-bearing claims spot-checked) — do NOT re-derive a prep-covered point; that defeats the push-prep speed-up.

Any check failing = paraphrase, not mapping — re-walk with LSP and cite.

## Scan 5 — Verify-per-task completeness

Every task: has a `verify:` (required S/M/L; optional XS) that is a **command** or a **concrete observable**? `manually check`/`visually inspect`/`looks correct` → reject; name what you check for, or split until each piece is verifiable atomically.

## Scan 6 — Summary reads for a non-technical reader

- `## Summary` + `## Technical Context` + `## Gate check` all present.
- **Summary** is plain language — no `path#anchor`, no symbol a stakeholder wouldn't know (the cited "before" is `## Current state`).
- **Summary** links the spec's User Stories rather than restating the product win.
- **Gate check** names the `rules/fundamentals.md` layers crossed (trust boundary, new dependency, a11y/concurrency/db/observability).
- Summary describes *this* change, not "improves the system". A reader who stops after Summary knows what changes and how.

A failing Summary usually means the planner jumped to tasks without framing the change.

## Extra checks for M / L plans

**Scaffold matches tasks (M/L — required):** `## Scaffold` exists · every `★` file ↔ a `(new)` task · every signature is one a task fills · every decision-bearing type (union/value object/state enum) shown as a **definition**, not just a consuming signature · block stays signatures + type shapes + ≤1-line stub bodies inside the fence · no separate `## Folder structure` duplicating the tree.

**Alternatives honest (M/L feat/refactor):** rejected options are plausible, not strawmen — each names *why*/*by how much* (benchmark, complexity, ecosystem maturity). Only one reasonable approach → a one-line note in `Summary` and skip the section.

**Rollback real (L):** anything beyond "revert the commit" reads as a runbook — an on-call engineer could execute it from the text at 2am, steps copy-pasteable and ordered, `Data loss?` honest (almost nothing that wrote data is truly "no data loss").

**Dependencies concrete:** `External: pg-listen >= 1.7.2 (LISTEN/NOTIFY added in 1.7)`, not "some library". Same pinning applies to any package a **task** introduces — exact existing version, verify confirms it resolves (lockfile / `npm ls pkg@ver`). Unpinned/unconfirmed = how a hallucinated or typo-squatted dep lands.

**Phases coherent (L with Phases):** each phase has a clear name (`schema migration`, `write path`, `read path`, `consumer cutover`) and is roughly independently committable. A "miscellaneous" phase is a smell.

## When to rewrite

More than 3 items need fixing → re-draft rather than patch. If Scan 4 (Current-state) fails, fix it *first* — most downstream gaps trace to the planner not knowing what the existing code does.

## The final question

> Could an engineer who has never seen the spec implement this without asking anything except ambiguities already flagged with `[NEEDS CLARIFICATION]`?

Yes → draft. No → which scan caught it? Run that scan again. Unsure → run all scans.
