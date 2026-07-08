# Current State Mapping

Reverse-engineer the existing code *before* designing the change. Deep-dive for `plan-writing > principle 3`: LSP queries, hop count, what counts as an invariant, and worked examples per Type.

> **Brownfield M/L — mapped once, shared.** Produced **once** as `.workflow/<id>/context.md` (step 7a), read by every plan slice (`lead`/`qa`/`uxui`). When it's in your prompt: synthesise + cite, spot-check load-bearing claims (re-resolve a sample), verify only what it misses. **Evidence, not authority** — you own the final map; an unre-resolvable claim is a finding.

## Boundary-depth, not full-depth — read less, defer the rest

Read deep on three things only: **blast radius**, **invariants** the change must preserve, **insertion points** — the safety-critical subset the gate signs off on. Everything else the engineer reads **at edit time**; pre-reading code whose *contract you don't change* is a read done twice.

A file in scope whose internals don't constrain the plan (a contained edit, a flow you won't alter, a helper you call but don't change) → **don't walk it here.** Write a one-line pointer in `plan.md > ## To explore at implement` (*what to read · why safe to defer*) — **instead of** walking it, so `## Current state` shrinks to the blast-radius subset rather than growing a second list.

Depth bar: **(a)** gate can make a sound go/no-go, **(b)** approach is feasible, **(c)** blast radius is known — not "know the file". Uncertain approach → read a thin feasibility slice, then defer. **Never defer a blast-radius invariant** — it belongs in `## Current state`, mapped and cited. Defer mechanics, never safety.

## The LSP-walk technique

*Trace the change*, don't read every file. Do this in order:

1. **Anchor on the spec's integration points.** Open `spec.md > Constraints > Integration points` (or the equivalent — the spec's list of existing files this run will touch). Each one is a starting node for the walk. If the spec doesn't list integration points, the spec is under-specified — fix the spec first.

2. **Entry-point query.** For each integration point, ask: "where does control enter this file?" Examples:
   - HTTP route handler → which router file mounts it? `grep`/LSP find-references on the handler symbol.
   - Hook script → which hook event triggers it? Check `.claude/settings.json` or the hook config.
   - Library function → which callers exist? LSP find-references on the exported symbol.
   - CLI subcommand → which command parser registers it?
   - Cron job → which scheduler config names it?
   Cite the entry point with `path#anchor` — the symbol for code, a unique quoted snippet/heading for shell/markdown/config. A bare line number goes stale once an earlier step edits the file; an anchor stays re-resolvable with LSP or `grep`.

3. **Forward walk (3–7 hops).** From the entry point, walk *forward* through the code being touched. Each hop is: function call → next function. Use LSP go-to-definition. Stop when you reach a leaf (DB write, external API call, return value, terminal log). Cap at 7 hops — if you need more, the spec slice is too large and should split.

4. **Caller walk.** For every symbol whose contract you will change (rename, delete, change signature, change return type, change behaviour observed by callers): LSP find-references. Three buckets:
   - **0 callers** — write "no callers — safe to change". Load-bearing fact.
   - **1–3 callers** — list each with `path#anchor`. Each caller is a potential break point.
   - **4+ callers** — count, then list only the *non-obvious* ones (cross-module, test files, external consumers). "12 callers, all internal to the same file" reads differently from "12 callers across 6 modules" — both are worth recording.

5. **Invariant scan.** Re-read the forward walk and ask, for each hop:
   - Does this code rely on input arriving in a particular order?
   - Does it assume the database row already exists / doesn't exist?
   - Does it swallow errors silently (`|| return`, `try { } catch { /* ignore */ }`, `?.`)?
   - Does it open a transaction / commit / rollback? At what boundary?
   - Does it write to shared state (file, env var, global)? Single writer or many?
   - Does it have a timeout / retry default that callers depend on?
   - Does it fail-open or fail-closed on a missing dependency?
   Anything you'd answer with "yes, and the new code must preserve it" → write it as an invariant with `path#anchor`.

6. **Stop when the section is "actionable for the engineer who will implement this."** Not "everything I noticed". The goal is to give the engineer the load-bearing facts about the as-is so they can change it without breaking it — not to teach them the file.

## What counts as an invariant

A useful invariant is:
- **Silent** — the code relies on it but doesn't document it. (If already in a docstring or `WORKFLOW.md`, link there.)
- **Load-bearing** — breaking it changes observable behaviour or violates a downstream assumption.
- **Citable** — you can point to `path#anchor` where the assumption lives.

Examples worth writing:

- `dev-state-mark.sh#"command -v jq" — fails open on missing jq (silently exits 0); new emit calls must mirror this guard`
- `OrderService.charge — assumes idempotency key already validated upstream by the API layer; called from anywhere else, this assumption breaks`
- `users.findById — returns null (not throw) on not-found; 14 callers depend on this`
- `events.jsonl appends are non-atomic — relies on single-writer assumption (only one /dev run per workflow dir at a time)`

Examples NOT worth writing:

- "The function takes a string and returns a number" — that's the type signature, not an invariant.
- "The handler logs at info level" — unless callers depend on the exact log line, this is just behaviour, not an invariant.
- "The file is 200 lines long" — irrelevant.
- "The function uses `async/await` rather than `.then()`" — implementation style, not a contract.
- "There's a `// TODO` comment at line 42" — a known-debt marker, but not an invariant your change has to preserve.
- "The class extends `BaseService`" — relevant if subclassing matters, but on its own it's just inheritance, not load-bearing behaviour.
- "The variable is named `userId`" — naming isn't an invariant; if a caller depends on the *value* of `userId`, that's the invariant, and the name is incidental.
- "The handler returns 200" — that's just behaviour; only worth capturing if a caller depends on it being *exactly* 200 (e.g., a healthcheck probe) rather than "any 2xx".

### The one-line bar

**Would silently breaking this change observable behaviour or violate a caller's assumption?**
- Yes → invariant; write it with a citation.
- No → code style or trivia; cut it.

A 12-bullet list with 8 trivia items is worse than 4 load-bearing bullets — trivia dilutes the signal.

## Section template

Structure for the `## Current state` section in `plan.md`. Adapt per Type — fields marked *(type)* apply only to that Type. **Scale it to the run** (principle 3's trigger is the `field`): a full M/L or refactor/fix walk fills every field below; a **brownfield `feat` at XS/S** needs only the proportional version — the **Entry point(s)** of the code you edit and its **Callers / blast radius** (one to three lines), enough to prove you walked it rather than guessed. Greenfield skips the section entirely.

```markdown
## Current state

**Entry point(s)**:
- `<path#anchor>` — <one-line role> (e.g., "PostToolUse hook fired by Claude Code after every tool call")

**Data / control flow** (LSP-walked):
1. `<path#anchor>` — <what this hop does> → calls `<symbol>` at `<path#anchor>`
2. ...
N. `<path#anchor>` — terminal write / return / external call

**Callers / blast radius**:
- `<symbol>` (`<path#anchor>`): N callers — <summary; list non-obvious ones with path#anchor>
- `<symbol2>`: 0 callers — safe to change

**Invariants the current code relies on**:
- `<one-line invariant>` — `<path#anchor>` <why it's load-bearing>
- ...

**Anti-goals** *(refactor only)*:
- <behaviour that stays identical>, verified by <existing test / golden file / character test>

**Bug path** *(fix only)*:
```
<input> → step1 (`path#anchor`) → step2 (`path#anchor`) ← BUG: <what goes wrong here> → step3 → <symptom>
```
```

For **L** tier + refactor, add an *as-is* mermaid diagram immediately under the section title (before the bullets), then the *to-be* in the regular Architecture diagram section.

## Worked examples per Type

### feat — touching an existing API surface

Spec: "Add `/dev-metrics` slash command that regenerates `.workflow/METRICS.md` from `events.jsonl`."

```markdown
## Current state

**Entry point(s)**:
- `.workflow/0002-feat-dev-audit-trail/events.jsonl` — written by hooks + orchestrator (no entry point in code yet; this file is *read by* the new command)
- Existing similar command: `.claude/commands/dev.md` — the `/dev` slash command, the shape we'll mirror

**Data / control flow** (today):
1. Orchestrator and hooks append JSONL events to `events.jsonl` per run (no reader yet)
2. `retro.md` aggregates "What to change" per run (read by humans, not yet by tooling)
3. `.workflow/INDEX.md` — flat list of all runs (also read by humans only)

**Callers / blast radius**:
- `events.jsonl` schema — 0 readers today; the new generator is the first. Free to design the read path against the JSONL we know the writers produce.
- `.workflow/INDEX.md` — read by orchestrator at run init (`.claude/orchestrator.md#"INDEX.md"`); generator must not break the existing read.

**Invariants the current code relies on**:
- Events are append-only — generator must read, never write `events.jsonl`. (Writers only ever append; the read path must never truncate or rewrite the file.)
- `events.jsonl` is *per run*, not global — generator must walk `.workflow/*/events.jsonl`, not assume a single file.
- `jq` is available on this developer's machine but not guaranteed everywhere; hooks fail-open on missing `jq` (`.claude/hooks/dev-state-mark.sh#"command -v jq"`). Generator script can hard-require `jq` or stay POSIX — see spec Open question.
```

### fix — bug-path with marker

Spec: "Fix: `dev-agent-guard.sh` blocks legitimate retry spawns after a stale state.json triggers the guard."

```markdown
## Current state

**Entry point(s)**:
- `.claude/hooks/dev-agent-guard.sh` — PreToolUse hook triggered before every `Agent(` invocation

**Data / control flow** (today):
1. Hook reads `tool_input` from stdin via `jq` (`.claude/hooks/dev-agent-guard.sh#"tool_input"`)
2. Checks if `subagent_type` is `orchestrator` → block (`#"orchestrator"`)
3. Checks if `subagent_type` starts with `worker-` → block (`#"worker-"`)
4. Reads `state.json` mtime via `stat -f` (`#"stat -f"`)
5. Compares against `.last_worker_return` mtime (`#".last_worker_return"`)
6. If `state.json` is newer than marker → block as "stale" (`#"-gt"`) ← BUG: the comparison uses `-gt` on mtimes, but on macOS with sub-second resolution, two events in the same second register equal, NOT newer, so the guard fires when it shouldn't (and DOESN'T fire when it should)

**Callers / blast radius**:
- Hook is called by Claude Code itself via `PreToolUse` config (`.claude/settings.json#"PreToolUse"`). 1 caller, can't be skipped.

**Invariants the current code relies on**:
- `.last_worker_return` is `touch`-ed at second granularity by `dev-state-mark.sh#".last_worker_return"` — the guard's comparison must be coarser than 1s or use a different signal.
- Hook exits 0 = allow, exits non-zero with a message on stdout = block — must preserve this contract.

**Bug path**:
```
Agent spawn (T=N) → guard reads state.json (mtime=N-2) → guard reads .last_worker_return (mtime=N-2) → -gt comparison: equal, NOT newer ← BUG: but state.json updated since spawn, so the "stale" check returns false-negative, OR a fresh spawn within 1s of a state update returns false-positive
```
```

### refactor — anti-goals

Spec: "Extract the retry-with-backoff logic that's duplicated in `PaymentsClient.charge` and `PaymentsClient.refund` into a shared `withRetry` helper, no behaviour change."

```markdown
## Current state

**Entry point(s)**:
- `src/payments/PaymentsClient.ts#PaymentsClient` — class exported as the single entry to all payment-provider calls

**Data / control flow** (today):
1. `PaymentsClient.charge` — inline `for (let i = 0; i < 3; i++) { try { return await ...; } catch (e) { ... } }` with hard-coded 3 attempts and a fixed 500ms sleep
2. `PaymentsClient.refund` — near-identical loop with 3 attempts and the same 500ms sleep, but catches one extra error class (`PartialRefundError`) before retrying
3. Both call `this.provider.<op>()` which throws on network failure; success path returns the provider response object

**Callers / blast radius**:
- `PaymentsClient.charge` (`src/payments/PaymentsClient.ts#charge`): 4 callers — `OrderService.placeOrder`, `SubscriptionService.renew`, two tests. None inspect retry count or sleep duration; safe to refactor.
- `PaymentsClient.refund` (`src/payments/PaymentsClient.ts#refund`): 2 callers — `OrderService.cancel`, one test. Same — no caller depends on retry mechanics.

**Invariants the current code relies on**:
- *Total wall-clock budget is roughly 1.5s* (3 attempts × ~500ms) — `OrderService.placeOrder` is called from inside a 2s API timeout; the new helper must default to ≤ 1.5s total or callers' timeouts will start firing first.
- *`PartialRefundError` is retried in `refund` but not in `charge`* — `src/payments/PaymentsClient.ts#"PartialRefundError"` catches it explicitly; this is intentional (partial refunds are eventually-consistent on the provider side). The helper must accept a per-call retryable-error predicate, not hard-code the exception list.
- *Sleep is `setTimeout`, not a real backoff timer* — tests at `tests/payments/PaymentsClient.test.ts#"jest.useFakeTimers"` rely on `setTimeout` being the sleep mechanism. The helper must call `setTimeout` (or expose an injectable sleeper) so the existing tests don't break.

**Anti-goals** (refactor — these MUST stay identical):
- Same number of attempts (3) with the same sleep duration (500ms) for both `charge` and `refund` for the same input → verified by the existing `tests/payments/PaymentsClient.test.ts` suite, which counts retry attempts via a mock provider.
- The `PartialRefundError`-retried-only-in-refund behaviour stays intact — verified by the existing "refund retries partial-refund errors but charge does not" test pair.
- Provider response object shape is passed through unchanged → verified by existing serialization tests at `tests/orders/checkout.golden.json`.
```

## The "no callers / single caller / many callers" framing

Caller count changes how you size the risk of the change:

| Callers | Implication | Plan response |
|---------|-------------|---------------|
| 0 | Safe to change the contract — nothing breaks. | Note it; move on. |
| 1 | Coordinate the caller change in the same plan. | The caller's update is a Step in this plan. |
| 2–5 | Each caller is a potential break. | List them all in Current state; each gets a verify step or a coverage-check step. |
| 6+ | Contract change is structural — likely belongs in a bigger plan or staged rollout. | Either bump Size to L, or split the contract change off into its own run with a deprecation path (expand → migrate → contract). |

If you find 20+ callers on a symbol the spec wants you to rename, push back on the spec — the work is bigger than a single run.

## When to draw an "as-is" mermaid

Required when:
- L tier and the change is structural (multiple files, shifted boundaries).
- Any `refactor` where the structural before/after isn't obvious from prose bullets.

Otherwise, prose bullets in Current state are enough. Don't draw an as-is diagram for an XS fix — it's noise.

When you do draw one, put it directly under the `## Current state` heading (before the bullets), label it `As-is`, and let the Architecture diagram (principle 4) be the labelled `To-be`.

## Common failure modes

- **Paraphrase without citations** — "the hook writes state.json, then exits" with no `path#anchor`. Walk it again; cite every claim.
- **Including everything you noticed** — Current state is the *load-bearing* subset, not a file tour.
- **Skipping the caller walk** — the caller walk reveals blast radius before you commit to the change.
- **Treating the type signature as the invariant** — invariants are what the compiler *can't* tell you (ordering, idempotency, error semantics).
- **Bug path that's just the stack trace** — mark the data-turned-wrong step with `← BUG`, often *above* the symptom.

Skip triggers (greenfield / chore-docs off live paths / spike) live in `SKILL.md > principle 3`.
