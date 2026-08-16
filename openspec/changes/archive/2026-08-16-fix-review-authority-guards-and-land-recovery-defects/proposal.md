# Change: Fix the five harness defects that blocked the Model Router V1 consumer round

## Why

A consumer round (Model Router V1, feedback artifact 6be265a2) finished its
product work but spent ~1.5 hours blocked between Prove and Land: 28 of 66
harness commands were refused, ~19 of them by harness bugs rather than invalid
work, and the consumer had to hotfix their installed copy — edits the next
install will overwrite. The defects live in this repository's shipped runtime
and must be fixed upstream with regression tests. See
`docs/reports/model-router-v1-harness-defects.md`.

## What changes

- The "completed AI response has no matching recorded receipt" guard in
  `authority-runtime.mjs` reconciles the latest delivered AI attempt against
  the recorded receipt position instead of comparing counts, so a recorded
  delta receipt that overwrote the full receipt, a later human receipt, or an
  errored AI completion no longer block dispatch/record/run — while a genuinely
  unrecorded completed AI response still fails.
- `REVIEW_SCHEMA` in `configured-reviewer.mjs` drops `uniqueItems`, which
  OpenAI structured output rejects; `validReview` keeps enforcing uniqueness
  after parse, so duplicate IDs are still refused.
- A bounded reset route clears the consumed reviewer infrastructure retry after
  the operator repairs the provider, gated on a passing prove-stage doctor and
  an explicit `--decision-ref`, matching what the guard message already
  instructs.
- `sandbox apply --refresh` becomes a real CLI flag routed to the existing
  `refreshAppliedProjection`, giving a sanctioned recovery when the target
  legitimately moved after apply.
- `change validate` runs the OpenSpec strict lint on the change when the
  OpenSpec CLI is available, so missing SHALL/MUST wording surfaces before
  Prove instead of inside `openspec archive`.

## Impact

- **Impact:** medium
- **Coupling:** isolated
- **Affected surfaces:** code (shipped runtime under `.claude/harness/runtime/`), CLI grammar (`sandbox apply --refresh`, `authority reset-infra`), deterministic tests
- **Security triggers:** none

## Non-goals

- Defect 6 from the report (null per-operation requests/cost in
  `operations.jsonl`) — deferred to a follow-up telemetry change.
- Any relaxation of the guards' true-positive behavior: unrecorded completed
  AI responses, exhausted AI review waves, and corrupt attempt chains keep
  blocking.
- Renaming or restructuring the internal-vs-CLI command name mapping.
