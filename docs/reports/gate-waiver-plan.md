# Plan: give a failing gate a recorded way out of the loop

Status: implemented at the root (change-loop-skip lane: the loop's own gate
logic is what changed), verified by `run-all.sh`; recorded per the playbook.
Written against `89d4f13`; line references verified at that revision. The
`codeHash` packet rebinding and the hardening batch are already in HEAD.
Lane: Runtime (`.claude/harness/runtime/**`) plus Instruction
(`commands.json`, command docs) — gates are the wiring test, protocol pins,
a regression at the required-providers seam, and doc consistency.

## Problem

An operator proves a change and twelve of thirteen gates pass. One provider
executed and failed. The loop now has exactly one printed route: re-run.

- `finalize` collects `requiredProviders` and stops on any non-valid receipt
  (`proof-runtime.mjs:26-48`); a receipt whose command exited non-zero carries
  `status: "fail"`, and `receiptValidity` returns that status verbatim as the
  validity code (`receipt-validity.mjs:124`).
- `validityRecovery` has no entry for `fail`, so it falls through to the
  default: "re-run: claude-foundation proof run" (`receipt-validity.mjs:33`).
  Correct when the gate caught a real defect; useless when the gate itself is
  wrong, flaky, or the user has decided the failure is acceptable.
- Land never gets further: `landCheck` refuses without a passing proof
  (`land-runtime.mjs:158`), so the block surfaces at the end of the loop with
  the build already spent.

Every other gate class already has a named exit. Review has two waivers in
`foundation.json` (`review.independence`, `review.diversity` —
`evidence-contract.mjs:559-583`). Acceptance has withdrawal
(`change resolve --acceptance-not-required`, or dropping the capability from
the claim — `proof-readiness.mjs:184-193`). A policy-inferred capability
nobody wired is downgraded to a reported advisory (`bec90ec`,
`change-validation.mjs:437-447`). The one class with no route is the ordinary
one: **a declared capability whose provider ran and failed**.

The sanctioned escape today is to edit the contract — remove the capability
from the claim in `evidence.yaml`, `change validate`, re-prove. Three defects:

1. **Nobody is told.** The `fail` recovery text names only re-run.
2. **The record lies by omission.** A capability deleted from a claim reads
   afterwards as "never required", not "required, then withdrawn by a named
   decision". The review waivers set the standard here: a waiver is a trigger
   that travels into the packet and the receipt "instead of quietly
   disappearing" (`evidence-contract.mjs:559-566`).
3. **The exit costs a full re-prove.** Editing `evidence.yaml` changes
   `contractFingerprint`, which every receipt binds
   (`receipt-validity.mjs:53`), so the twelve valid receipts all go
   `contract-stale` and every provider re-executes to clear the one gate that
   was withdrawn. On a real suite that is minutes to tens of minutes, paid to
   *remove* a requirement.

## Non-goal, stated first

**No force-land.** `proof.status === "pass"` is the invariant the whole
downstream chain trusts — `landCheck`, the receipt manifest, the archive
audit. A flag that lands a failing proof would create archived changes whose
own evidence contradicts them, and under deadline pressure the override
becomes the default path. The codebase already states the principle at the
acceptance gate: *the escape is to withdraw the requirement, not to fake
satisfying it* (`proof-readiness.mjs:186-189`). This plan generalizes that
principle; it does not weaken it.

## Design

**A recorded, user-authorized withdrawal of one capability gate:**

```
claude-foundation change waive <id> --capability <c> --reason <why> --decision-ref <ref>
claude-foundation change waive <id> --capability <c> --revoke --decision-ref <ref>
```

Mechanics, in dependency order:

**1. The waiver is state, like acceptance.** `state.waivers` — a list of
`{ capability, reason, decisionRef, recordedAt }`, written by a new
`waiveGate` beside `resolveChange` in `change-lifecycle.mjs`. `--decision-ref`
is mandatory and carries the same meaning it carries on `change abandon` and
`land record`: a host-user decision happened first; the command records it.
Refusals:

- `review` and `acceptance` cannot be waived here — each owns a route already,
  and a second door would let the generic waiver bypass the provenance those
  routes were built to keep. This guard gets mutation coverage (below).
- A capability not currently in `requiredProviders(id)` is refused: waiving
  what is not required records a decision about nothing.
- Claims are untouched. The claim keeps declaring the capability; only its
  enforcement is withdrawn. That is what makes the record honest — the
  contract still says what the author believed needed proving.

**2. `requiredProviders` subtracts waived capabilities.** One filter at the
end of the derivation (`change-validation.mjs:396-421`): a capability in
`state.waivers` is not added, and provider instances of that capability are
not added. Deliberately *after* the review/acceptance forcing logic, and with
one asymmetry called out: waiving a risk capability (say `security-static`)
does **not** lift the review it forced — `reviewPolicy` reads the claim's
capabilities (`evidence-contract.mjs:543-548`), which the waiver leaves alone.
Withdrawing the automated check must not also silently withdraw the human one.

**3. The waiver is reported everywhere the advisories already flow.**
`advisoryCapabilities` (`change-validation.mjs:460-469`) gains the waived rows
with `reason: "user-waived"`, `decisionRef`, and the recorded why. That single
join point carries them into `proof readiness`, `change validate` output, and
— through the existing `advisories` field — into the proof record
(`proof-runtime.mjs:83`) and therefore the archive. `landCheck`'s LAND READY
line names them (`land-runtime.mjs:191`): landing with a waived gate must be
visible in the same breath as the word READY.

**4. `contractFingerprint` deliberately excludes waivers.** This is the load-
bearing cost decision, so it is argued, not assumed. A waiver is subtractive:
it removes a requirement and cannot change what any other provider's receipt
attested — their commands, claims, and inputs are untouched. Excluding it
means the twelve valid receipts stay valid, and the recovery path after a
waive is: `prove` re-finalizes from existing receipts and **executes zero
providers**. Including it would re-run the entire suite to remove one gate —
the same class of cost `execution.yaml` was carved out of the hash to avoid
(`state-runtime.mjs`, and the same argument as the packet-rebinding plan).
The honesty concern is answered by item 3: the proof record and the archive
carry the waiver; it is not hidden, it is just not a reason to re-earn
unrelated evidence.

**5. The `fail` route says all three exits.** `VALIDITY_RECOVERY` gains an
explicit `fail` entry (`receipt-validity.mjs:9-26`):

```
fail: (id, provider) => `provider '${provider}' executed and failed. Fix the
  code and re-run: claude-foundation proof run ${id}. If the gate itself is
  wrong, rewire it in execution.yaml. If the user decides to land without it,
  withdraw it on record: claude-foundation change waive ${id} --capability
  <c> --reason <why> --decision-ref <ref>`
```

`finalize` and `landCheck` already print `validityRecovery` beside the code
(`proof-runtime.mjs:47-48`, `land-runtime.mjs:170-172`), so the route reaches
both places an operator actually gets stuck.

## Work items

| # | Item | Files | Size |
|---|---|---|---|
| 1 | `change waive` / `--revoke` command | `workflow/change-lifecycle.mjs`, `core/cli-router.mjs`, `commands.json` | ~60 lines |
| 2 | `requiredProviders` subtraction + review asymmetry note | `workflow/change-validation.mjs` | ~15 lines |
| 3 | Waived rows join the advisory flow | `workflow/change-validation.mjs` | ~15 lines |
| 4 | `fail` recovery route | `evidence/receipt-validity.mjs` | ~8 lines |
| 5 | LAND READY names waived gates | `workflow/land-runtime.mjs` | ~6 lines |
| 6 | Docs: the three exits from a failing gate | `WORKFLOW.md`, `.claude/harness/EVIDENCE.md`, `.claude/commands/{change,prove,land}.md` | ~30 lines |

Item 1 wires through the composition root (`foundation.mjs` passes
`waiveGate` into the router the same way `resolveChange` travels), so the
wiring check must stay green. `commands.json` gains the `change waive` entry —
the playbook's Instruction-lane gate for a new agent-facing command.

## Cut line

Items 1, 2 and 4 are the feature: the gate becomes withdrawable and the stuck
operator is told so. Items 3 and 5 are what keep the withdrawal honest in the
record; they land in the same change, not later — a waiver mechanism without
its reporting is exactly the silent drop `advisoryCapabilities` exists to
prevent. Item 6 can trail by one commit.

## Evidence

- `.claude/tests/harness/contracts/evidence-proof.sh` — the behavior seam:
  a change with one failing provider blocks finalize and prints the waive
  route; after `change waive` with `--decision-ref`, `prove` reaches PROVEN
  with **zero provider executions** and the proof record carries the waived
  row; `land check` output names it; `--revoke` restores the requirement and
  finalize blocks again on `missing`; waiving `review`, `acceptance`, or a
  capability not required is refused; missing `--decision-ref` or `--reason`
  is refused.
- Review asymmetry: a claim declaring `security-static` above low impact
  still yields `reviewPolicy.required` after the capability is waived.
- Mutation coverage — follow `run-target-drift-mutation.sh`: invert the
  review/acceptance refusal in item 1 and the `requiredProviders` filter in
  item 2; confirm a suite catches each. The first guard is what keeps this
  from becoming a bypass of review provenance, and it should meet the bar its
  neighbours were held to.
- `harness/wiring-check.mjs` — the new composition-root pass-through.
- No new suite. Full run: `sh .claude/tests/run-all.sh`.

## Protocol pins

- `proofProtocol` unchanged — waived rows ride the existing `advisories`
  field, which is additive and optional by declared precedent
  (`proof-runtime.mjs:78-83`); an older reader ignores them.
- `providerProtocol` unchanged — no receipt field moves.
- `runtimeApi` unchanged expected — `waiveGate` is a new export composed at
  the root, no boundary moves; confirm against `wiring-check.mjs`.
- `contractFingerprint` byte-identical for every change with no waiver — the
  same backwards-compatibility rule the review waivers document
  (`evidence-contract.mjs:573-577`): a project that never opts in must keep
  producing the shape it produced before the feature existed. Guarded by the
  upgrade-compat suite.

## Relationship to the proof re-run cost plan

Independent and complementary. That plan makes re-proving after harmless
edits cheap; this plan makes one specific contract change — withdrawal — cost
nothing to re-prove *by construction* (item 4), because it is the one contract
edit that provably cannot affect other receipts. Neither depends on the other.

## Until this ships

The stuck change has two honest exits today: fix the failing check, or edit
`openspec/changes/<id>/evidence.yaml` to drop the capability from its claim,
then `change validate` → `/prove` (full provider re-run) → `/land`. Record the
why in `proposal.md` so the withdrawal survives in the packet.
