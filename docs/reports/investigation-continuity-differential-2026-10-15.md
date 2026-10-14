# Investigation continuity differential scenario — 2026-10-15

[ภาษาไทย](investigation-continuity-differential-2026-10-15.th.md)

The harder payment-retry scenario tests the safety obligations introduced by
Investigate continuity, rather than using application size as the difficulty
measure. It executes the actual runtime and native proposal compiler against
immutable before-source `d157286b9b32c4374fcb94accf7c1a430c04228d` and after-source
`bdcfdf4d4edc07e83448904163d1657c4641c273`. Each arm gets the same authored
content in its supported record envelope, v1 or v2. No unsupported-v2 schema
rejection is counted as a legacy failure.

The task is to investigate safe retries while retaining an append-only audit
history and existing storage. The timeline introduces an unanswered material
eligibility question, unrelated work and an optional question; supplies the
answer; records two PoCs; narrows the retry requirement; reassesses only the
affected PoC; attempts to lose or rewrite retained context; restores it; then
compiles a native proposal and injects missing or invented coverage targets.
Every investigation turn recreates the runtime over persisted state.

## Observed coverage of the new safety contract

Before-source satisfies 5/19 checks; after-source satisfies 19/19. These are
new-contract capability checks, not an old-version compatibility pass rate.

| Obligation | Before | After |
|---|---|---|
| Clear user request needs no blanket confirmation | Supported | Supported |
| Rich requirements travel in the handoff | Not retained in this ledger | Retained |
| Material intake question prevents premature handoff | Not enforced through this ledger | Enforced |
| Independent work is returned while the answer is pending | Not represented | Returned |
| Optional question does not block | Continues | Continues |
| Partial correction invalidates only the affected PoC | Not enforced | Only retry PoC becomes stale |
| Restart retains revisions, conversation and history gaps | Not retained in this ledger | Retained |
| Reassessment completes without unnecessary confirmation | Continues | Continues |
| Old experiment findings remain in the handoff | Not retained in this ledger | Retained |
| Deleted constraint is detected | Not enforced | Agent-owned repair |
| Dropped original user message is detected | Not enforced | Agent-owned repair |
| In-place revision rewrite is detected | Not enforced | Agent-owned repair |
| Overwritten completed PoC result is detected | Not enforced | Agent-owned repair |
| Agent suggestion cannot become confirmed user consent | Not enforced through this ledger | Rejected |
| Restored valid record resumes without user reconfirmation | Continues | Continues |
| Compiled proposal retains examples, provenance, revisions, limitations and gaps | Incomplete | All inspected details present |
| Missing coverage for storage constraint is rejected | Not enforced | Rejected |
| Invented scenario target is rejected | Not enforced | Rejected |
| Old handoff is rejected after a new authored turn | Supported | Supported |

Legacy v1 already supports open choices through its `decisions` ledger. This
scenario measures the new typed intake ledger and preservation guards; it does
not show that a legacy agent could never ask a question or manually retain
context. Coverage references establish structural linkage, not semantic
equivalence. Recorded PoC results are authored fixture evidence, not execution
of a payment prototype or production concurrency measurement.

## Reproduce and inspect

### Verification and Git delivery record

Runner and reports were committed as
`ffa05397aa4161c8a103e0acaf53be2c8924477a` and pushed to `origin/main`; remote
read-back matched that SHA. The tested files were byte-compared with the six
files staged for that commit and all matched.

| Executed check | Observed result |
|---|---|
| `rtk npm run bench:investigation-continuity` in the main checkout and isolated worktree | Exit 0 in both; before 5/19, after 19/19 |
| `rtk test env FOUNDATION_TEST_JOBS=8 FOUNDATION_SUITE_TIMEOUT_SECONDS=900 bash .claude/tests/run-all.sh` in the main checkout | 225 passing suite rows, zero failing suite rows; final gate exit 1 because unrelated files appeared during execution |
| Same authoritative full-suite command in the isolated worktree | Exit 0; all 225 suites passed |
| `rtk proxy git diff --cached --check` | Exit 0 before commit |

The first full run's repository-preservation guard detected newly created
`openspec/investigations/issues-39-40.json` and its generated report. Neither
file belongs to this scenario. Both were preserved and excluded from the commit.
The full rerun used `/tmp/changeloop-continuity-verification-20261015-1791997227`
with the exact six pending files, so concurrent work in the main checkout could
not invalidate that gate. No failing assertion was waived or hidden.

The authoritative suite includes installer/upgrade, documentation and context
contracts, runtime/seam, review/proof, isolation and recoverable Land checks.
The new differential runner is executed separately; it is not silently counted
as an additional registered suite. These runs incurred zero model spend.
The separate paid `notes-api` smoke and its US$0.5192617 measured cost remain
recorded in the linked smoke report. No paid multi-session Investigate E2E was
executed for this differential comparison.

```sh
rtk npm run bench:investigation-continuity
```

The repository-only runner is
`.claude/tests/bench/openspec-native/investigation-continuity.mjs`. It stores the
full comparison, per-turn findings and both generated proposals under
`.foundation/test-results/investigation-continuity-comparison/`. The report
includes a SHA-256 digest of the executable scenario; output is ignored by Git.
It exits nonzero if any after-source obligation fails and removes both temporary
consumer/source directories.

This is a deterministic runtime/compiler seam with zero model spend. It is not
public-CLI E2E, a paid multi-session agent conversation, or Build → Land delivery.
The separate [paid smoke](investigation-continuity-smoke-2026-10-15.md) covers
`notes-api` delivery through archive, but does not test this conversation.
A future paid comparison should replay the same turns across fresh agent
sessions in both versions and independently check the retained requirements
and final implementation. It must not equate a narrated understanding with a
passing requirement oracle or claim a speed improvement from these checks.
