# Plan Self-Review

Run this checklist **before** setting `Status: draft` in `plan.md`. The goal is to catch the failure modes that otherwise show up at review time and burn a cycle.

A plan that passes self-review is not "perfect" — it's "internally consistent and free of the known antipatterns". Real surprises will still surface during implementation; this checklist filters out the ones we already know how to spot.

## The four scans

Walk these in order. Each one takes ~30 seconds for an XS/S plan, ~2 minutes for L.

### Scan 1 — Anti-placeholder

Search the entire plan for these strings. Every hit is a fix-before-draft:

| Pattern | Why it's bad |
|---------|--------------|
| `TBD`, `TODO`, `???` | A placeholder is a hole. Either fill it or move it to `Out of scope` / `Open questions`. |
| `appropriate error handling`, `proper validation`, `as needed` | Vague — no engineer can implement "appropriate". State the actual behaviour. |
| `see spec`, `as discussed`, `per the design` | Forces reader to dereference. Plan should be self-contained for the slice it owns. |
| `etc.`, `and so on`, `among others` | Hides scope. List it or scope it out. |
| `path/to/file`, `foo/bar`, `<file>` | Template residue. Replace with real `path:line` or delete the bullet. |
| `e.g.`, `for example` in `Steps` | Steps are imperative actions, not illustrations. Move examples to `Approach`. |
| `should`, `would`, `might` in `Steps` | Steps are commitments, not hedges. "Add `getUserById` at `src/users.ts:42`", not "should probably add a lookup". |

If any pattern appears in `Approach`, that's usually OK — `Approach` carries the *why* and may use hedging. The hard rule is **Steps and Files touched must be placeholder-free**.

### Scan 2 — Acceptance-criteria coverage

Open `spec.md > Acceptance criteria`. For each checkbox:

1. Search the plan for the AC's number (`[AC1]`, `[AC2]`, ...).
2. Confirm at least one `Step` carries that tag.
3. Read that Step. Does executing it actually deliver the AC? If the connection is hand-wavy, the Step is too abstract — split it.

If an AC has no step:
- The plan is incomplete → add the steps.
- OR the AC is out of scope for this run → state it in `Out of scope` and confirm with the orchestrator/user.

If a Step has no AC tag:
- The step doesn't earn its place → delete it, OR it's scope-creep → move to `FOLLOWUPS.md`.
- OR the spec is missing an AC the work actually delivers → go back and add the AC to spec first.

There is no third option. Every Step ↔ at least one AC. Every AC ↔ at least one Step.

### Scan 3 — Diagram ↔ Files alignment

Walk the `Architecture diagram`:

- Every node marked `★` (new piece) → must appear in `Files touched` as a `new` row.
- Every node marked `~~strikethrough~~` (removal) → must appear in `Files touched` as a `delete` row.
- Every `new` row in `Files touched` → must appear as a `★` node in the diagram.
- Every `delete` row → must appear with strikethrough.

Edit rows (existing files modified) don't have to be in the diagram unless the edit is a structural change — but if a file is edited in a way the diagram should show (new exported function, new dependency arrow), surface it with a labeled edge or annotation.

XS plans where Diagram = `Impact: N/A` skip this scan.

### Scan 4 — Verify-per-step completeness

Walk every Step. For each:

- Has a `verify:` clause? (Required for S/M/L; optional for XS)
- Verify clause is a **command** (something runnable: `npm test src/foo.test.ts`, `curl -s :8080/health | jq .status`, `psql -c "\d users"`) OR a **concrete observable** (`column `email_verified` exists`, `feature flag returns true for opt-in users`)?
- If verify is `manually check`, `visually inspect`, `eyeball the output` → reject. Either name what you're checking for (`response includes "ok"`) or the verify isn't real.

If a Step doesn't have a clean verify, the step is doing too many things — split until each piece is verifiable atomically.

## Extra checks for M/L plans

### Alternatives section is honest (M/L feat/refactor)

If you wrote `Alternatives considered`, the rejected options must be plausible — not strawmen. "Considered X, rejected because it would be slower" without naming why or by how much is a strawman. Either give a real reason (benchmark, complexity argument, ecosystem maturity) or drop the section.

If there really *was* only one reasonable approach, write a one-line note in `Approach` saying so (`Approach is the only obvious path because <constraint>`) and skip the section.

### Rollback is real (L plans)

If `Rollback` says anything beyond "revert the commit", read it as a runbook:

- Could an on-call engineer at 2am execute it from the text alone?
- Are the steps copy-pasteable, in order, with no implicit context?
- Is `Data loss?` honest? (Almost no rollback is truly "no data loss" if the change wrote anything — be precise about *what* might be lost.)

### Dependencies are concrete

`External: some library` is not a dependency — `External: pg-listen >= 1.7.2 (for LISTEN/NOTIFY support added in 1.7)` is. `Internal: prior PR` is not a dependency — `Internal: must land after PR #482 (schema migration adds users.tenant_id)` is.

## When to fail the self-review and rewrite

If more than 3 items across the scans need fixing, don't patch in place — that usually means the plan was drafted too quickly and the structure is off. Re-read the spec, re-pick the Size if needed, and re-draft. Faster than chasing scan hits one by one.

## The final question

Before marking `Status: draft`, ask:

> If I handed this plan to an engineer who has never seen the spec, could they implement it without asking me anything except about ambiguities I've already listed in `Open questions`?

If yes → draft.
If no → which scan caught it? Run that scan again.
If "I'm not sure" → run all four scans.

The plan is the *contract* between lead (planner) and engineer (implementer). Self-review is what makes the contract stand on its own.
