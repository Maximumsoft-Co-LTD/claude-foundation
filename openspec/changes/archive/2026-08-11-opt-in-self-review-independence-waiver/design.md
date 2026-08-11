# Design

## Current state

- `runtime/evidence/review-protocol.mjs` `provenanceResult(review)` derives
  three booleans from the review object alone: `complete`, `independent`,
  `diverse`. `independent` is true when the reviewer identity appears in no
  subject identity and no AI subject shares the reviewer's session.
- `runtime/evidence/receipt-runtime.mjs:260` refuses the write:
  `if (!independent) die("reviewer must use an identity and session independent
  of implementation")`. Diversity, one line below, is already conditional on
  `policy.diversity === "required"`.
- `foundation.mjs:1613-1615` re-derives provenance on every read and collapses
  `!complete || !independent` into a single typed validity,
  `review-not-independent`. Diversity is again separately conditional on
  `reviewPolicy(id).diversity`.
- `runtime/evidence/evidence-contract.mjs` `reviewPolicy()` returns
  `{ required, independence: "required", diversity, [diversityWaived], triggers }`.
  `independence` is already a field; it has simply never held another value.
- `contractFingerprint` hashes the whole `reviewPolicy` object, which is why the
  diversity waiver adds `diversityWaived` only when in force.
- `foundation.mjs` `foundationPolicy()` defaults `review: { diversity:
  "required" }` and validates the value against a two-item allowlist.

## Decisions

- **Decision:** the waiver is a `foundation.json` value,
  `review.independence: "self"`, mirroring `review.diversity: "single-model"`.
  - **Why:** the diversity waiver already solved the same problem in this
    codebase, and its comment states the constraint that matters — a committed
    file cannot be edited by the reviewed party at the moment it is caught the
    way a command flag can. Reusing the shape means one mental model, one
    place to look, and one precedent for how a waiver becomes visible.
  - **Rejected:** a `--waive-independence <reason>` flag on `evidence record`.
    It puts the exemption in the hands of whoever is writing the receipt, which
    is the pattern the attestation trust root exists to refuse.
  - **Rejected:** an environment variable. Invisible in the record and absent
    from review of the repository itself.

- **Decision:** `provenanceResult` stays pure and keeps reporting
  `independent: false`; the policy decision moves to the two call sites.
  - **Why:** `independent` is a fact about who reviewed what. A waiver is a
    decision about whether that fact blocks. Folding the policy into the
    predicate would make the receipt claim independence it does not have, and
    `review.policy.independent` is persisted into the receipt — a reader six
    months later must be able to see that a self-review happened and that a
    named waiver is why it passed.
  - **Rejected:** passing the policy into `provenanceResult`. Same persisted
    field, now untrue.

- **Decision:** the read gate keeps one typed validity value.
  `review-not-independent` is returned when provenance is incomplete, or when
  it is not independent and the policy does not waive.
  - **Why:** `review-not-independent` is documented on the website and asserted
    in `run-feedback-review-tests.sh`. Splitting it into two values would be a
    contract change nobody asked for, in a change whose whole point is a
    different gate.
  - **Rejected:** a new `review-provenance-incomplete` value.

- **Decision:** the waiver applies at every impact and every trigger, including
  security and migration semantics.
  - **Why:** the failure it addresses — one session and no second reviewer —
    does not get better on a riskier change; it gets worse, because risk is
    exactly what forces review. Carving out critical work would push the
    maintainer back to downgrading declared impact, which corrupts the record
    in a way the waiver was meant to stop.
  - **Rejected:** waiving only when no diversity trigger fires. Diversity is a
    separate axis and stays enforced on its own terms; a critical self-review
    under `diversity: "required"` still needs a second model family or a human,
    which is the correct remaining pressure.

- **Decision:** the trigger is `independence-waived-self-review`, added
  whenever the waiver is configured, and `independenceWaived: true` appears
  only then.
  - **Why:** `contractFingerprint` hashes this object. A project that never
    opts in must keep producing the byte-identical policy it produced before,
    or upgrading Foundation re-fingerprints every in-flight change and
    invalidates evidence nobody asked to re-earn. `independence` already exists
    with value `"required"`, so only the added key and trigger are new.

## Compatibility and migration

- **Default behavior is unchanged.** Without the key, `reviewPolicy` returns
  the same object it returns today, the same fingerprint, and both gates behave
  exactly as before. No pin in `protocol.json` moves.
- **Old runtime, new receipt.** A receipt written under the waiver carries
  `review.policy.independence: "self"` and `independent: false`. A runtime
  without this change re-derives provenance, finds it not independent, and
  returns `review-not-independent` — a downgrade fails closed, which is the
  correct direction.
- **Turning the waiver off.** Validity is re-derived live on every read, so
  removing the key immediately invalidates previously recorded self-reviews
  rather than letting them carry over. The observed answer is `contract-stale`
  rather than `review-not-independent`: `contractFingerprint` hashes the review
  policy, so withdrawal moves the contract and the receipt is stale before the
  independence branch is reached. That is the stricter of the two and names the
  actual cause, so it stands as the recorded behavior.
- **Rollback** is deleting the key from `foundation.json`.

## Risks

| Risk | Mitigation | Evidence owner |
|---|---|---|
| The waiver silently becomes the default posture and self-review stops being visible | The waiver only exists as a committed key; the policy carries `independence: "self"`, `independenceWaived: true`, and a named trigger into the packet, the authority request requirements, and the receipt | `test` |
| A passing self-review hides unresolved blockers | Untouched: a passing review still requires an explicit `--unresolved-blockers` count and refuses any value above zero | `test` |
| Fingerprint churn invalidates in-flight evidence in projects that never opt in | The added key and trigger are conditional on the waiver being in force; a suite assertion pins the non-opt-in policy shape | `test` |
| A self-review escapes the two-round AI ceiling or the attempt hash chain | Neither code path is touched; round counting and `attemptIsValid` run before and after the independence gate unchanged | `test` |
| Docs keep telling users independence is never waivable | Shipped docs, website EN and TH, and the doc-consistency suite are updated in the same change | `test` |
