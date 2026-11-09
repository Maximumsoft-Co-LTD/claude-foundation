# Review rules

**Audience:** reviewers of changes to `claude-foundation` itself, human or AI.
These rules are **advisory**: they guide what a reviewer looks for and how it
reports findings. They do not change whether a review passes; the harness's
review contract in [EVIDENCE.md](.claude/harness/EVIDENCE.md) remains the only
pass/fail authority. The harness does not read this file yet.

Owner: tech lead (see [.github/CODEOWNERS](.github/CODEOWNERS)). Change this
file through a normal reviewed change.

## Passes

Review in this order. Each pass reads the diff against the change's OpenSpec
agreement, not against the reviewer's preferences.

1. **Correctness.** Every claim's behavior holds, including its negative path.
   Error, data-loss, and recovery paths are handled, not only the happy path.
2. **Evidence.** Each behavioral change has a deterministic regression at the
   lowest boundary that would have caught the defect. No guard, budget, or
   assurance was relaxed to make proof pass. Proof is never produced by the
   runtime under change.
3. **Shipping boundary.** No shipped file (`install.sh` `MANAGED`) references a
   repository-only path such as `.claude/tests/`, `docs/`, or `dashboard/`.
   Project-owned files stay project-owned.
4. **Security and authority.** Secrets stay redacted, workspace isolation stays
   fail-closed, and no path commits, pushes, publishes, or spends without the
   matching user authority.
5. **Compatibility.** A wire-visible change moves its `protocol.json` pin and
   keeps an upgrade test for the old shape. The four runtime-API pins agree.
6. **Documentation.** The canonical contract changed first; summaries follow.
   English and Thai pages stay aligned in behavior.

## Severity

| Severity | Meaning | Examples |
|---|---|---|
| blocker | The change would ship wrong behavior or weaker assurance | claim not met, stale proof can land, shipped file points at a repo-only path, secret exposure |
| major | A realistic scenario fails or a contract drifts | missing negative path, protocol pin moved without a compatibility test, EN/TH mismatch in behavior |
| minor | Correct but harder to maintain or read | misplaced test level, unclear error message |
| nit | Style or wording only | naming, phrasing |

Report at most **3 nits** per review. Name the file, line, and the concrete
failure scenario for every blocker and major finding.

## Exclusions

Do not review or request changes to:

- generated receipts, proof, Land journal, or `.foundation/` state;
- historical entries in `CHANGELOG.md` and dated reports in `docs/reports/`;
- vendored skill `LICENSE.txt` files;
- formatting that the repository's lint already enforces.

## Stop signals

The stop signals in
[harness-development-playbook.md § 8](docs/reports/harness-development-playbook.md#8-stop-signals)
are always at least **major**.
