# Plan: stop charging a full proof re-run for an edit no provider reads

Status: implemented in the working tree, not entered into the change loop.
Written against `1fec967`. Items 1-5 landed as described, plus one item this
plan did not foresee: `hash <change> [provider]`, because a signed-CI envelope
must state the hash its provider binds and the old command could only print the
change's. Uncommitted.
Lane: Runtime (`.claude/harness/runtime/**`) — gates are the wiring test,
protocol pins, and a regression at the receipt-binding seam.

## Problem

An operator proves a change, then edits something — a note in `design.md`, a
line in a README, a task checkbox — and `proof run` executes every provider
again. On a real suite that is minutes to tens of minutes, paid for an edit no
provider command can read.

The mechanism is in one function. A provider with no declared `inputs` is in
`mode: "global"` (`evidence-contract.mjs:355-362`): its receipt binds the whole
workspace hash, so any file the hash covers invalidates it. And the hash covers
the change packet — `singleRelevantSnapshot` admits
`openspec/changes/<id>/**` and exempts exactly one file inside it,
`execution.yaml` (`state-runtime.mjs:279-281`).

So the packet — proposal, design, tasks, spec deltas — is an input to every
test and lint receipt in the change.

### Measured, not inferred

`repro-packet-edit-cost.sh`: two providers running the identical counting
command. `static-analysis` declares `inputs`, `test` does not. Prove, then
append one line to `openspec/changes/<id>/design.md` and change nothing else.

```
--- proof run (cold) ---
provider executions: 1
  discovery: valid
  static-analysis: valid
  test: valid

--- edit ONLY the change packet (design.md) ---
  discovery: stale
  static-analysis: reusable-inputs
  test: stale

--- re-run proof after the packet edit ---
provider executions: 2
```

`repro-inputs-declared.sh` is the same scenario with `inputs` on `test` as well:
every row reads `reusable-inputs`, and re-running proof after the packet edit
leaves `provider executions: 1`. The reuse path works; almost nobody is on it.

Two facts fall out of the second run and both matter downstream. `discovery`
inherits the test provider's config (`evidence-contract.mjs:288-289`), so
declaring `inputs` once on `test` covers both rows. And `proof run` still
succeeds after the edit — `prove` re-finalizes from the reused receipts. The
expensive half is provider execution, and it is the half that is avoidable.

### Three defects, in the order they bite

1. **The packet is bound as if it were code.** Measured above. Nothing about
   `proposal.md` changes what `npm test` does, and no route around it exists in
   global mode.

2. **Nobody is told the escape hatch exists.** `proof plan` prints `stale` and
   stops; `validityRecovery("stale")` (`receipt-validity.mjs:11`) says only
   "the workspace moved after this receipt was earned; re-run". Neither names
   the binding mode, and neither mentions `inputs`. In the shipped reference the
   feature is one sentence — `EVIDENCE.md:194-195` — with no example.

3. **A hand-recorded receipt can bind the wrong hash.** `recordReceipt` takes
   `state.activeProofRun?.workspaceHash` before falling back to
   `providerWorkspaceHash` (`receipt-runtime.mjs:132`). For a
   repository-scoped provider those are different values: the composite versus
   that repository's own. Harness-executed receipts are unaffected — the adapter
   passes the right hash explicitly (`adapter-runtime.mjs:147,231`) — so this
   bites only manual receipts in multi-repository changes, where it produces a
   receipt that is `stale` the moment it is written.

### A hypothesis raised and disproved

The obvious worry about pushing operators toward `inputs` is a typo:
`inputs: ["srcs/**"]` matches nothing, the fingerprint is then a constant, and
the receipt would be reusable forever regardless of what changes.

It is already closed. `repro-typo-inputs.sh` never reaches a receipt:

```
BLOCKED: passing receipt 'test' declared inputs but matched no files
```

`receipt-runtime.mjs:193`. Shape is validated too — non-empty,
workspace-relative, no `..` (`evidence-contract.mjs:182-186`) — and
`review`/`acceptance` are refused `inputs` outright (`:187-188`). Recorded here
so the question is not reopened. What remains is the operator's own contract: a
pattern that matches the wrong files under-declares, and no guard can know that.

## Design

**Give executable providers a hash that omits the change packet. Leave review
and acceptance bound to the full workspace.**

The seam already exists and is single: `providerWorkspaceHash(id, provider)`
(`evidence-contract.mjs:336-342`) is what the adapter records into a receipt and
what `receiptValidity` compares against (`receipt-validity.mjs:112`). Changing
what it returns for one class of capability changes recording and checking
together, by construction.

Exempting the packet is defensible because nothing is dropped, only rebound.
The packet's contract-bearing content is bound elsewhere already:
`contractFingerprint` covers `evidence.yaml` and is checked on every receipt
(`receipt-validity.mjs:53`), spec deltas are checked by spec-sync at Land, and
the packet snapshot is tracked in workspace state. The precedent is in the same
function: `execution.yaml` was carved out of the hash for exactly this reason
(`state-runtime.mjs:281`).

Review and acceptance keep the full binding. A reviewer reads the proposal; an
edit to it should expire their receipt. That asymmetry is already the rule
elsewhere — those two capabilities are the ones forbidden from declaring
`inputs` at all.

**The proof record and Land keep the full workspace hash.** `finalize` writes
`proof.workspaceHash` from the composite (`proof-runtime.mjs:72`) and
`landCheck` refuses a mismatch (`land-runtime.mjs:162-164`). Leave both alone:
after a packet edit the operator still re-runs `/prove`, and that run executes
zero providers and rewrites the record. The guarantee that nothing lands on an
unproven workspace is untouched; only the cost of restating it drops.

**Not in scope: inferring `inputs` automatically.** `evidence init --write`
emits provider configs without `inputs` (`evidence-bootstrap.mjs:114-157`), and
it should keep doing so. What a `npm test` script reads is not knowable from
`package.json`; a guessed include list that misses one config file silently
converts a real code change into a reused receipt, and that failure is
invisible — the run passes. The harness must not narrow its own evidence
binding on a guess. The operator declares `inputs`; the harness's job is to make
sure they know it exists, which is item 3.

## Work items

| # | Item | Files | Size |
|---|---|---|---|
| 1 | Snapshot carries a packet-free `codeHash` | `core/workspace-surface.mjs`, `core/state-runtime.mjs`, `workflow/repository-snapshot.mjs` | ~30 lines |
| 2 | Executable capabilities bind `codeHash` | `evidence/evidence-contract.mjs` | ~10 lines |
| 3 | `proof plan` names the binding mode and the route | `evidence/receipt-runtime.mjs`, `evidence/receipt-validity.mjs` | ~15 lines |
| 4 | Manual receipts bind the provider's hash | `evidence/receipt-runtime.mjs` | 1 line |
| 5 | Document `inputs` properly | `.claude/harness/EVIDENCE.md`, `WORKFLOW.md` | ~20 lines |

**Item 1** — the packet boundary is a "what counts as surface" decision, so the
predicate belongs in `workspace-surface.mjs` beside `isExcludedPath` and
`sandboxCodePathspec`, exported as `isChangePacketPath(rel, id)`. Today the same
test is written inline twice in `state-runtime.mjs` (`:34-36`, `:279-281`) and a
third time as a pathspec exclude; one of those is already the packet rule the
sandbox applies. Then `singleRelevantSnapshot`, which already walks every path
once and folds it into one digest, adds a second `createHash` fed only by paths
the predicate rejects, published as `codeHash` beside `workspaceHash`. No extra
I/O and no second walk. In `relevantSnapshot`, compose `codeHash` the
same way `workspaceHash` is composed (`repository-snapshot.mjs:33-41`); only the
control repository can differ, since the packet lives at the root, so every
other entry's `codeHash` equals its `workspaceHash`. Keep the cache key as it is
— both digests come from the same walk.

**Item 2** — `providerWorkspaceHash` returns `snapshot.codeHash` unless the
provider's capability is `review` or `acceptance`, which keep
`snapshot.workspaceHash`. Repository-scoped providers take the same branch on
their own repository's entry. The fallback parameter — the global hash the
adapter passes in — becomes the code-scoped hash for the same reason.

**Item 3** — `proofPlan` (`receipt-runtime.mjs:29-43`) prints one line per
provider today. Extend it to name the binding, so the operator can see the cost
before paying it and the route out when they have paid it:

```
PROOF PLAN <id>
  workspace: <hash>
  test: stale (whole-workspace binding; declare inputs to narrow it)
  static-analysis: reusable-inputs (declared: src/**, package.json)
  review: stale (review is bound to the whole workspace by design)
```

Add the same pointer to `VALIDITY_RECOVERY.stale`, which is what every blocked
`prove` prints (`proof-runtime.mjs:47-48`).

**Item 4** — reorder `receipt-runtime.mjs:132` to
`flags.workspaceHash || providerWorkspaceHash(id, provider, state.activeProofRun?.workspaceHash)`.
The adapter path is unchanged; the manual path stops binding the composite hash
for a repository-scoped provider.

**Item 5** — `EVIDENCE.md:194-195` grows a worked example, the
review/acceptance exemption, the `discovery` inheritance, and the matched-no-files
guard. `WORKFLOW.md`'s prove section gains one sentence: editing the packet
after proving re-finalizes but does not re-execute providers.

## Cut line

Items 1 + 2 remove the measured cost and need no operator action; 3 and 5 are
what make the remaining cost — real code edits during Build — narrowable by
someone who reads the output. 4 is adjacent and one line. Nothing here depends
on 3 or 5, so they can follow.

## Evidence

Put the regressions where the reuse contract already lives.

- `.claude/tests/harness/contracts/evidence-proof.sh` — beside the existing
  reuse assertions at **lines 507-516**. Cases: a packet-only edit leaves a
  global-mode executable receipt `valid` and executes nothing; the same edit
  leaves a `review` receipt `stale` (the exemption must not leak to review); a
  code edit still expires a global-mode receipt. `repro-packet-edit-cost.sh` is
  the seed — it already reproduces the defect end to end.
- `.claude/tests/harness/run-proof-loop-tests.sh` — the end-to-end walk: prove,
  edit `design.md`, `proof run` reaches PROVEN with zero provider executions.
  This suite already owns "the hash moved under a run" and this is its sibling.
- `.claude/tests/harness/run-workspace-surface-tests.mjs` — `isChangePacketPath`
  as a pure predicate, where that suite already pins the surface rules, plus the
  case that keeps it agreeing with `sandboxCodePathspec`'s packet exclude.
- `.claude/tests/harness/run-upgrade-compat-tests.sh` — the `providerProtocol`
  bump below.
- Mutation coverage — follow `run-land-surface-mutation.sh` and
  `run-target-drift-mutation.sh`: invert the review/acceptance exemption in item
  2 and confirm a suite catches it. That exemption is the guard keeping this
  change from weakening review evidence, and it should meet the bar its
  neighbours were held to.

No new suite. Full run: `sh .claude/tests/run-all.sh`.

## Protocol pins

- `providerProtocol` **7 → 8**. Receipts record the hash they bound; after item
  2 an in-flight receipt's recorded hash no longer matches what
  `receiptValidity` expects, so it would read as `stale` with no explanation.
  Bumping the pin makes it one honest forced re-prove per in-flight change on
  upgrade instead of a mystery. `receipt-validity.mjs:49-50` already reports
  `provider-version-stale` for this, and `validityRecovery` already routes it.
- `proofProtocol` unchanged — the proof record still binds `workspaceHash`.
- `runtimeApi` unchanged expected: `codeHash` is an additive snapshot field and
  no composition boundary moves. Confirm against `wiring-check.mjs`.
- Snapshot files under `.foundation/` gain a field; readers that ignore it
  behave as before.

## Reproductions

Kept outside the repo, under the job's scratch directory:

- `repro-packet-edit-cost.sh` — the primary defect: a packet-only edit re-runs
  a global-mode provider.
- `repro-inputs-declared.sh` — the same scenario with `inputs` declared; zero
  executions.
- `repro-typo-inputs.sh` — the disproved fingerprint-freeze hypothesis.
