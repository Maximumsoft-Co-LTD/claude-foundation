# Design

## Current state

- `authority-runtime.mjs:198-208` (dispatch) and `:468-473` (`authority run`)
  guard with `deliveredAi.length > completedAi.length`, where `completedAi` is
  `recordedCompletedAiReviews` — delivered attempts whose digest equals the
  single `receipt.review.attemptDigest`. A receipt records only the latest
  attempt, so `completedAi.length` is at most 1; any second delivered attempt,
  human supersede, or (run path only, which filters on `status === "completed"`
  without excluding `resultStatus === "error"`) errored completion trips the
  guard forever.
- `configured-reviewer.mjs:9-44` `REVIEW_SCHEMA` uses `uniqueItems: true` in
  three places; OpenAI structured output rejects the keyword, so every codex
  dispatch returns an infrastructure error. `validStringList`/`validReview`
  (`:58-80`) already reject duplicates after parse.
- `review-attempt-store.mjs:115-119` counts every non-delivered AI attempt as
  a consumed infrastructure retry with no way to acknowledge them after the
  provider is repaired; `:148-149`/`:209-210` then fail permanently while
  telling the operator that repairing the provider and running doctor is the
  remedy.
- `apply-runtime.mjs:278-310` implements `refreshAppliedProjection` and
  `applySandbox` honors `options.refresh`, but `cli-router.mjs:343-350`
  strict-parses `sandbox apply` with no flags.
- `change validate` (`change-validation.mjs`) never invokes the OpenSpec CLI;
  the strict SHALL/MUST lint first runs inside `openspec archive`
  (`apply-runtime.mjs:558`), after code has landed. `land-runtime.mjs`
  already sets the precedent of surfacing archive-time failures early
  (`assertNoDroppedScenarios`, `assertOpenSpecCli`).

## Decisions

- **Decision:** Reconcile latest-vs-latest instead of counting: locate the
  receipt's recorded attempt in the chain and fail only when the latest
  delivered AI attempt is newer than the newest recorded receipt (of any
  reviewer type), using error-excluding `deliveredAiAttempts` at both guard
  sites.
  - **Why:** The receipt stores one `attemptDigest`; count comparison is
    structurally wrong the moment a second receipt or a human receipt exists.
    Latest-vs-latest preserves the true positive (a delivered AI response with
    no newer recorded receipt) in every observed false-positive scenario.
  - **Rejected:** Recording every historical receipt digest in the receipt
    file — a wire-visible receipt format change with migration cost, not
    needed to make the guard sound.
- **Decision:** Delete `uniqueItems` from `REVIEW_SCHEMA`; keep post-parse
  uniqueness enforcement in `validReview`.
  - **Why:** OpenAI structured output rejects the keyword; the invariant is
    already enforced where it matters.
  - **Rejected:** Provider-conditional schemas — two schema variants to keep
    honest for one keyword that adds no enforcement.
- **Decision:** Add `authority reset-infra <change> --decision-ref <ref>`,
  which re-runs the prove-stage provider diagnosis in-process and, when it
  passes, records the acknowledged infrastructure attempt digests in
  `state.reviewHistory` so `infrastructureAiAttempts` stops counting them.
  - **Why:** Matches the guard's own instruction (repair provider, run
    doctor); decision-ref keeps it an audited operator action, not an
    automatic loophole; acknowledgment leaves the attempt chain immutable.
  - **Rejected:** Auto-reset whenever doctor passes — silently unbounded
    retries; deleting attempt records — breaks the hash chain.
- **Decision:** Route `sandbox apply --refresh` as a strict boolean flag to
  the existing `options.refresh`; `controlPlane` stays internal.
  - **Why:** The runtime path exists and self-guards (refuses divergent
    paths); only the router lock is wrong.
  - **Rejected:** A separate `sandbox refresh` command — new surface for an
    option `applySandbox` already models.
- **Decision:** In `change validate`, when the OpenSpec CLI probe succeeds,
  run `openspec validate <id> --strict --json --no-interactive` and fail with
  its findings; when the CLI is absent, warn and continue (land keeps the
  hard requirement).
  - **Why:** Same lint, same tool, earlier — no drift risk from reimplementing
    OpenSpec's rules; absence tolerance keeps `change validate` usable in
    minimal environments exactly as today.
  - **Rejected:** Reimplementing the SHALL/MUST regex in the harness — a
    second lint that drifts from the tool that actually gates archive.

## Compatibility and migration

- No wire-visible protocol contract changes: receipt format, review response
  format, and packet schemas are unchanged, so no `protocol.json` pin bump.
  `REVIEW_SCHEMA` only relaxes the request-side JSON Schema sent to the
  provider SDK.
- CLI grammar grows two additive surfaces (`sandbox apply --refresh`,
  `authority reset-infra`); existing invocations are unchanged.
  `commands.json` gains the new agent-facing command entry.
- `state.reviewHistory` gains an optional acknowledged-infrastructure field;
  absent field means no acknowledgments — existing states read unchanged.
- `change validate` becomes stricter only where the OpenSpec CLI is present
  and the packet was already going to fail at archive; nothing that could
  archive before is newly refused.
- Rollback: revert the commit; no persisted-state migration in either
  direction.

## Risks

| Risk | Mitigation | Evidence owner |
|---|---|---|
| Guard relaxation admits a genuinely unrecorded AI response | Regression case keeps the true-positive failing (latest delivered AI attempt newer than newest recorded receipt) | test |
| Infra reset becomes an unbounded retry loophole | Reset requires passing provider diagnosis + unused `--decision-ref`; acknowledged digests are recorded and auditable | test |
| `--refresh` bypasses divergence safety | `refreshAppliedProjection` already fails on diverged paths; regression case covers the refusal | test |
| Validate-time lint diverges from archive-time lint | Same CLI, same `--strict` mode; case proves a SHALL-less spec fails validate and a corrected one passes | test |
| Regression elsewhere in shipped runtime | Full deterministic suite (`run-all.sh`) runs as the compatibility provider | compatibility |
