# Recovery review fixes

Scope: address the completed independent review without starting a Change,
committing, pushing, deploying, or invoking paid/live providers. Preserve the
existing uncommitted recovery and amendment-replay work.

User owns scope, acceptance, budget and external authority. Agent owns code,
regression tests and documentation. Harness owns repeatable recovery and checks.

- [x] R1 Route stopped configured reviewers through existing bounded authority recovery; cover crashes before and after result checkpointing and preserve live-worker waits and provenance.
- [x] R2 Restore the verified replay base together with the sandbox, preserve newer agent edits, and recheck evidence; reproduce A → B → C without upstream-only conflicts.
- [x] R3 Bind accepted waits to their owner, condition and checking route; require a new answer when the dependency changes.
- [x] R4 Update canonical documentation and English/Thai summaries; run focused regressions, full registered suite, documentation consistency/build, and final status/diff checks.

## Implemented and verified — 2026-09-16

- R1: stopped controllers and checkpoint-only dispatched requests return the
  existing `RUN_CONFIGURED_REVIEW` handoff to `authority run`, rather than a
  read-only status command. New controller records retain original subject
  provenance; checkpoint recovery reuses its bound subject. Legacy records with
  no retained provenance ask the agent to supply the original implementer context
  instead of inventing a human subject. Live controllers remain waits. The real
  authority-store/attempt-store integration test follows the returned command and
  resumes proof after both interruption points; a checkpoint adds no model call.
- R2: recovery records the verified staging base in both workspace and matching
  root repository state. If the restored tree has later agent commits, its base
  remains the replay base rather than swallowing those commits into the baseline.
  Aggregate proof is invalidated, snapshot caches cleared, and an old base-move
  rebind journal discarded; provider receipts and exact spec approval are retained.
  Real-Git tests cover target A → B → C across staging, moved-worktree, and newer
  agent-commit recovery. Only the product diff is replayed; upstream C is preserved.
- R3: wait keys include owner, condition and check command. A changed field yields
  a distinct decision fingerprint and requires a new explicit wait answer.

Regression-first evidence: the new recovery tests failed before R1/R3 fixes;
the real-Git replay regression failed on the stale base A before the R2 fix.
All now pass on the delivered source.

Validation:

- Focused `advance-recovery`, `advance-runtime`, `sandbox-replay-preparation`,
  `sandbox-runtime-sync`, and `workflow-policy` tests: exit 0.
- `rtk test bash .claude/tests/run-all.sh`: exit 0; all 208 registered suites pass.
- `rtk test bash .claude/tests/docs/run-doc-consistency.sh`: 134/134 assertions pass.
- `rtk npm run build` in `website/docs`: exit 0, 37 pages; existing non-fatal
  empty-i18n/missing-404-content warnings remain.
- `rtk git diff --check`: exit 0. Root/subsystem status inspected; unrelated
  subsystem changes preserved and no index changes made.

Sorted modified/untracked source fingerprint (excluding this ledger) was identical
before and after the final full suite:
`310f9927f6b1839e4a82d53bfb03e1e629dd018305663fdc96013a562b334de0`.
HEAD remains `58a026eb85c66451e841491c383527f363ce72c5`. No real project Change,
commit, push, deployment, paid scenario, or live-provider execution was performed.
All Git and authority crash simulations used disposable test fixtures.

## Deliver release review fixes — 2026-09-16

User authorized direct fixes without entering Change. Scope is the three
confirmed Deliver findings; no commit, push, publication, or paid execution.
Agent owns implementation, regressions and documentation. The harness must
automate content verification before publication and PR-base validation.

- [x] D1 Verify staged and committed bytes against the Land projection, including resumed attempts and commit hooks.
- [x] D2 Verify the remote PR base includes the Land base; block unrelated branch history before publication.
- [x] D3 Stage gitlinks only for actual submodules; retain independent sibling delivery.
- [x] D4 Run regression-first checks, the full registered suite, and documentation checks; preserve unrelated workspace changes.

Delivery fix validation:

- New regressions reproduced six failures on the original implementation.
- Focused Deliver suite: 17 tests pass, including modified resumes, commit hooks,
  recovered commits, incompatible PR bases, binary/deleted/executable files,
  real submodule gitlinks, and independent sibling repositories.
- Full `.claude/tests/run-all.sh`: exit 0, all 208 registered suites pass,
  including documentation consistency, installer and architecture checks.
- Git operations use disposable fixtures; fetch reads local fixture repositories,
  while push and GitHub operations are mocked. No live-provider calls occurred.
- Updated the English/Thai guides and added release notes for the three fixes.
  No Change workflow, source commit, push, or publication was performed.
- Final `git diff --check`: pass. Release preflight's structural checks all pass;
  exit 2 now reflects only the uncommitted source tree. Paid portfolio readiness
  remains an advisory. Root and subsystem statuses preserve unrelated work.
