# Tasks

> This is the sole implementation ledger. Check an item only when its verify
> condition passes.

- [x] **T001** `foundation.json` carries `review.independence`, defaulting to
      `required` and refusing any value outside `required|self` —
      `.claude/harness/foundation.mjs` — verify: an unknown value fails naming
      the allowlist; an absent key reads back as `required`
      [claims:independence-policy-is-read-and-validated] [repo:root]
      [paths:.claude/harness/foundation.mjs]

- [x] **T002** `reviewPolicy` reports the waiver without moving the fingerprint
      of projects that never opt in — `.claude/harness/runtime/evidence/evidence-contract.mjs`
      — verify: with the key set the policy is `independence: "self"` plus
      `independenceWaived: true` plus an `independence-waived-self-review`
      trigger; without it the policy object is byte-identical to today's
      [claims:independence-policy-is-read-and-validated,a-configured-waiver-is-named-in-the-record]
      [repo:root] [paths:.claude/harness/runtime/evidence/evidence-contract.mjs]

- [x] **T003** The receipt write gate consults the policy while
      `provenanceResult` keeps reporting the observed fact —
      `.claude/harness/runtime/evidence/receipt-runtime.mjs` — verify: a
      same-identity, same-session reviewer writes a passing receipt under the
      waiver and that receipt records `review.policy.independent: false`; the
      same write is refused without the waiver
      [claims:a-waived-self-review-writes-and-reads-back-valid] [repo:root]
      [paths:.claude/harness/runtime/evidence/receipt-runtime.mjs]

- [x] **T004** The receipt read gate honors the same policy through one typed
      validity value — `.claude/harness/foundation.mjs` — verify: a waived
      self-review receipt reads back valid, and reads back
      `review-not-independent` once the waiver is removed
      [claims:a-waived-self-review-writes-and-reads-back-valid] [repo:root]
      [paths:.claude/harness/foundation.mjs]

- [x] **T005** Review contract tests pin the waived and unwaived behavior on
      both gates, the untouched neighbors, and the non-opt-in policy shape —
      `.claude/tests/harness/run-feedback-review-tests.sh` — verify: the suite
      passes and its assertion count rises
      [claims:independence-policy-is-read-and-validated,a-configured-waiver-is-named-in-the-record,a-waived-self-review-writes-and-reads-back-valid]
      [repo:root] [paths:.claude/tests/harness/run-feedback-review-tests.sh]

- [x] **T006** The review suite gains a TAP view so it can carry evidence, with
      its README row — `.claude/tests/harness/run-review-gate-tap.sh`,
      `.claude/tests/README.md` — verify: the wrapper emits a TAP plan whose
      count matches the suite's assertions and bails out on zero
      [claims:a-waived-self-review-writes-and-reads-back-valid] [repo:root]
      [paths:.claude/tests/harness/run-review-gate-tap.sh,.claude/tests/README.md]
      [depends:T005]

- [x] **T007** Shipped and published docs state that independence is waivable
      only by committed policy — `.claude/harness/EVIDENCE.md`,
      `.claude/harness/README.md`, `WORKFLOW.md`,
      `website/docs/src/content/docs/**` — verify: no shipped or published
      sentence still claims independence is never waivable, and the doc
      consistency suite passes
      [claims:a-configured-waiver-is-named-in-the-record] [repo:root]
      [paths:.claude/harness/EVIDENCE.md,.claude/harness/README.md,WORKFLOW.md,website/docs/src/content/docs/**]
