# Model Router V1 consumer round: harness defect report

Source: user feedback 2026-08-16 plus the round report artifact
`claude.ai/code/artifact/6be265a2-2daf-4edb-a44b-c7a39a0a1cb4` ("Model Router
V1"). The consumer round finished its product work quickly but spent ~1.5 hours
blocked between Prove and Land by defects in the installed Foundation harness.
28 of 66 harness commands were refused; roughly 19 refusals trace to harness
bugs, not to invalid work. The consumer hotfixed 3 files in their installed
copy (`.claude/harness/`, +17/−10); those edits will be overwritten by the next
install, so the fixes must land upstream here.

## Defects

1. **Receipt guard miscounts attempts** — `runtime/workflow/authority-runtime.mjs`
   blocks dispatch/record/run with "a completed AI response has no matching
   recorded receipt" by comparing counts: delivered AI attempts vs attempts
   whose digest equals the single `receipt.review.attemptDigest`. Three false
   positives: (a) the run-path guard counts completions whose `resultStatus`
   is `error`, which never gain a receipt; (b) a recorded delta receipt
   overwrites the full receipt's `attemptDigest`, so the earlier delivered
   attempt stops counting as recorded; (c) a later human receipt supersedes the
   AI `attemptDigest` entirely. Blocked 11 commands in the round.
2. **`REVIEW_SCHEMA` uses `uniqueItems`** — `runtime/evidence/configured-reviewer.mjs`
   sends a JSON Schema containing `uniqueItems` to OpenAI structured output,
   which rejects the keyword, so every `authority run` with a codex reviewer
   fails as an infrastructure error. `validReview`/`validStringList` already
   enforce uniqueness after parse.
3. **Infra-retry quota has no reset** — `runtime/evidence/review-attempt-store.mjs`
   fails with `REVIEW_INFRASTRUCTURE_ERROR` telling the operator to "repair the
   configured provider and run doctor --stage prove", but no route ever resets
   the consumed retry, so after repair the change is permanently locked out of
   AI review and forced onto human review.
4. **`sandbox apply --refresh` has no caller** — `runtime/workflow/apply-runtime.mjs`
   implements `refreshAppliedProjection` for a target that legitimately moved
   after apply, but `runtime/core/cli-router.mjs` strict-parses `sandbox apply`
   with no flags ("refresh has no caller"), so archive stays blocked on
   projection-mismatch with no sanctioned recovery.
5. **SHALL/MUST lint surfaces only at archive** — the OpenSpec strict lint that
   requires normative wording in spec deltas first runs inside
   `openspec archive`, after code has landed, forcing a re-prove for pure
   wording. It should run at `change validate`.
6. **Per-operation requests/cost are null** — `operations.jsonl` rows carry no
   requests/cost, so per-phase cost reporting is impossible. (Deferred:
   telemetry wiring is a separate change.)

## Scope decision

One upstream change fixes defects 1–5 with a regression test per defect at the
lowest deterministic boundary. Defect 6 is deferred to a follow-up change.
