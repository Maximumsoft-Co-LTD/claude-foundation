# Change: opt-in self-review independence waiver

## Why

Reviewer independence is the one review property Foundation refuses to relax.
`provenanceResult` computes `independent` from reviewer identity and session
against every implementation subject, and two gates enforce it unconditionally:
`receipt-runtime` refuses to write a review receipt, and `receiptValidity`
marks any already-written one `review-not-independent`. The reasoning was that
a fresh session costs nothing.

For a solo maintainer driving one main session it is not free. There is no
second session to hand the packet to, so every high-impact or coupled change —
which is most product work on the harness itself — stalls at Prove waiting for
a reviewer that will never arrive. The available answers today are to abandon
the change, downgrade its declared impact until review stops being required, or
record the receipt by hand outside the gate. All three teach the loop to lie.

Diversity already has the honest shape for exactly this problem:
`"review": { "diversity": "single-model" }` in `foundation.json` relaxes the
rule, stamps a named trigger onto the policy, and travels into the packet and
the receipt so the waiver is visible in the record rather than hidden in
config. Independence gets the same treatment.

## What changes

- `foundation.json` accepts `"review": { "independence": "required" | "self" }`,
  defaulting to `required`. Any other value fails the policy read.
- With `independence: "self"`, `reviewPolicy` reports `independence: "self"`,
  adds `independenceWaived: true`, and appends an
  `independence-waived-self-review` trigger. Projects that never opt in keep a
  byte-identical policy object, so no in-flight `contractFingerprint` moves.
- A review receipt may be written, and stays valid on re-read, when the
  reviewer shares an identity or session with an implementation subject —
  including a passing one. Provenance is still recorded truthfully: the receipt
  keeps `review.policy.independent: false` alongside the waiver that let it
  through.
- The waiver applies at every risk level. It is deliberately not a command
  flag, for the same reason the diversity waiver is not: a flag lets the party
  under review write its own exemption at the moment it is caught.
- Shipped docs, website docs (EN + TH), and the review contract tests state the
  new rule.

## Impact

- **Impact:** high
- **Coupling:** coupled
- **Affected surfaces:** evidence runtime (`review-protocol`, `receipt-runtime`,
  `evidence-contract`), `foundation.mjs` policy read and receipt validity,
  shipped reference docs, website docs, review contract tests
- **Security triggers:** none

## Non-goals

- Relaxing reviewer diversity, the two-round AI ceiling, the attempt hash
  chain, or the passing-review blocker count. Those gates stay exactly as they
  are, and a self-review still has to clear all of them.
- A per-receipt or per-change escape hatch. The waiver lives only in a
  committed policy file.
- Changing acceptance. Human acceptance remains external and human-only.
- Turning the waiver on in this repository's own `foundation.json`.
