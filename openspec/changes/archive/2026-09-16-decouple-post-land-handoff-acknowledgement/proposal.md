# Change: Let activation-safe post-Land operational handoffs remain declared without human acknowledgement while preserving enforceable safety gates and durable follow-up visibility.

## Why

A code change must not deadlock at Land on work that can only occur after deployment, and users must decide semantics rather than perform harness bookkeeping.

## What changes

- Land remains ready, the operation is reported as a declared post-Land obligation, and no user decision or actor/reference bookkeeping is requested.
- The harness reports WAITING_EXTERNAL and does not weaken the activation safety gate.
- The harness can list it across active and archived changes and record completed, cancelled, or superseded outcomes without reopening tasks.md.
- Runtime and documentation report code delivery separately from deployment, activation, and production verification.
- The runtime continues to read it without migration while acknowledgement remains optional for safe post-Land delivery.

## Impact

- **Impact:** medium
- **Coupling:** coupled
- **Affected surfaces:** code
- **Security triggers:** 

## Non-goals

- Deploy or activate production from Change Loop.
- Add webhook, ticket-system, or dashboard integrations.
- Treat Land or archive as proof that deployment or production verification completed.

## Requirement discovery coverage

| Dimension | Status | Requirements | Sources | Rationale |
|---|---|---|---|---|
| current-behavior | covered | none | .claude/harness/runtime/workflow/handoff-runtime.mjs, .claude/harness/tests/handoff-policy.test.mjs | none |
| affected-actor | covered | declaration-unblocks-land, post-archive-obligation-lifecycle | none | none |
| desired-behavior | covered | declaration-unblocks-land, unsafe-activation-still-blocks, post-archive-obligation-lifecycle, delivery-language-remains-truthful, legacy-records-remain-readable | none | none |
| success-path | covered | declaration-unblocks-land, post-archive-obligation-lifecycle | none | none |
| failure-path | covered | unsafe-activation-still-blocks | none | none |
| input-boundary | covered | none | .claude/harness/runtime/workflow/handoff-runtime.mjs | none |
| compatibility | covered | legacy-records-remain-readable | none | none |
| non-goals | covered | none | WORKFLOW.md | none |
| verification | covered | declaration-unblocks-land, unsafe-activation-still-blocks, post-archive-obligation-lifecycle, delivery-language-remains-truthful, legacy-records-remain-readable | none | none |
| data-migration | covered | legacy-records-remain-readable | none | none |
| rollout-rollback | covered | unsafe-activation-still-blocks, delivery-language-remains-truthful | none | none |
| recoverability | covered | post-archive-obligation-lifecycle, legacy-records-remain-readable | none | none |
| security-privacy | covered | none | .claude/harness/runtime/workflow/handoff-runtime.mjs | none |
| permission-rejection | covered | unsafe-activation-still-blocks | none | none |

## Amendment discovery coverage

Reason: Repository validation proved that the aggregate runtime command also needs an explicit shipped shell route.

| Dimension | Status | Requirements | Sources | Rationale |
|---|---|---|---|---|
| current-behavior | covered | none | cli.sh, .claude/tests/harness/run-single-source-tests.mjs | none |
| affected-actor | covered | public-obligation-list-route | none | none |
| desired-behavior | covered | public-obligation-list-route | none | none |
| success-path | covered | public-obligation-list-route | none | none |
| failure-path | covered | none | .claude/tests/harness/run-guard-fix-cli-tests.mjs | none |
| input-boundary | covered | none | cli.sh | none |
| compatibility | covered | none | .claude/harness/commands.json | none |
| non-goals | covered | none | WORKFLOW.md | none |
| verification | covered | public-obligation-list-route | none | none |

## Amendment discovery coverage

Reason: The new read-only handoff list command intentionally expands the frozen public command contract and agent command budget by one.

| Dimension | Status | Requirements | Sources | Rationale |
|---|---|---|---|---|
| current-behavior | covered | none | .claude/harness/tests/public-command-golden.test.mjs, .claude/tests/harness/run-installer-tests.sh | none |
| affected-actor | covered | public-command-contract-remains-frozen | none | none |
| desired-behavior | covered | public-command-contract-remains-frozen | none | none |
| success-path | covered | public-command-contract-remains-frozen | none | none |
| failure-path | covered | none | .claude/harness/tests/public-command-golden.test.mjs | none |
| input-boundary | covered | none | .claude/harness/fixtures/public-command-contract-v1.json | none |
| compatibility | covered | public-command-contract-remains-frozen | none | none |
| non-goals | covered | none | WORKFLOW.md | none |
| verification | covered | public-command-contract-remains-frozen | none | none |

## Amendment discovery coverage

Reason: Repair the complete first-review finding batch without changing the approved handoff semantics.

| Dimension | Status | Requirements | Sources | Rationale |
|---|---|---|---|---|
| current-behavior | covered | none | .claude/harness/runtime/workflow/handoff-runtime.mjs, .claude/harness/tests/handoff-policy.test.mjs | none |
| affected-actor | covered | operational-list-remains-truthful | none | none |
| desired-behavior | covered | operational-list-remains-truthful | none | none |
| success-path | covered | operational-list-remains-truthful | none | none |
| failure-path | covered | operational-list-remains-truthful | none | none |
| input-boundary | covered | none | .claude/harness/runtime/workflow/handoff-runtime.mjs | none |
| compatibility | covered | none | .claude/harness/commands.json, .claude/harness/runtime/core/lifecycle-phase.mjs | none |
| non-goals | covered | none | WORKFLOW.md | none |
| verification | covered | operational-list-remains-truthful | none | none |

## Amendment discovery coverage

Reason: Make the combined test-discovery adapter persist the critical-case observations it already evaluates so deterministic review repair can close against current evidence.

| Dimension | Status | Requirements | Sources | Rationale |
|---|---|---|---|---|
| current-behavior | covered | none | .claude/harness/runtime/evidence/adapter-runtime.mjs, .claude/tests/harness/contracts/evidence-proof.sh | none |
| affected-actor | covered | combined-evidence-preserves-critical-cases | none | none |
| desired-behavior | covered | combined-evidence-preserves-critical-cases | none | none |
| success-path | covered | combined-evidence-preserves-critical-cases | none | none |
| failure-path | covered | combined-evidence-preserves-critical-cases | none | none |
| input-boundary | covered | none | .claude/harness/runtime/evidence/adapter-runtime.mjs | none |
| compatibility | covered | none | .claude/tests/harness/contracts/evidence-proof.sh | none |
| data-migration | covered | none | .claude/harness/runtime/evidence/adapter-runtime.mjs | none |
| rollout-rollback | covered | none | .claude/tests/harness/contracts/evidence-proof.sh | none |
| recoverability | covered | none | .claude/harness/runtime/evidence/adapter-runtime.mjs | none |
| non-goals | covered | none | WORKFLOW.md | none |
| verification | covered | combined-evidence-preserves-critical-cases | none | none |

## Amendment discovery coverage

Reason: Allow deterministic review closure to recognize the current audited spec approval when a change has no grounding ledger and therefore cannot produce a grounding reopen record.

| Dimension | Status | Requirements | Sources | Rationale |
|---|---|---|---|---|
| current-behavior | covered | none | .claude/harness/runtime/evidence/receipt-runtime.mjs, .claude/harness/tests/review-closure-helpers.test.mjs | none |
| affected-actor | covered | non-grounding-contract-revision-can-close-review | none | none |
| desired-behavior | covered | non-grounding-contract-revision-can-close-review | none | none |
| success-path | covered | non-grounding-contract-revision-can-close-review | none | none |
| failure-path | covered | non-grounding-contract-revision-can-close-review | none | none |
| input-boundary | covered | none | .claude/harness/runtime/evidence/receipt-runtime.mjs | none |
| compatibility | covered | none | .claude/harness/tests/review-closure-helpers.test.mjs | none |
| data-migration | covered | none | .claude/harness/runtime/evidence/receipt-runtime.mjs | none |
| rollout-rollback | covered | none | .claude/harness/tests/review-closure-helpers.test.mjs | none |
| recoverability | covered | none | .claude/harness/runtime/evidence/receipt-runtime.mjs | none |
| non-goals | covered | none | WORKFLOW.md | none |
| verification | covered | non-grounding-contract-revision-can-close-review | none | none |
