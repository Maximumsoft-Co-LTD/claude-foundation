# Orchestrator reference — XS fast path

> XS-only delta. After `orchestrator.md`, this is the only Phase-1 reference an XS run reads. Do not open `interview.md`, `phase-1.md`, `gate.md`, or `size-execution.md` unless the run upgrades to S.

## Setup And Interview

- Batch `INDEX.md`, `FOLLOWUPS.md`, optional `.workflow/CONTEXT.md`, and repo detection in one message.
- Fold setup + interview into one `AskUserQuestion` batch (≤4; catch-all last). Digest prior conversation, classify type/field, and run NFR, e2e/visual, and error-boundary detections.
- Under `--yes`, fill from intent then `(Recommended)` defaults in the same turn. A load-bearing slot with no safe default stops `NON_INTERACTIVE_BLOCKER:` after writing state.
- Read the repo ledger before any code/test walk; verify only load-bearing anchors missing from it.

## Combined Artifact

Write `_templates/run.md` instead of separate spec/plan/tasks/test-plan. Keep ≤40 lines and include:

- `## Goal`, `**Type**`, and at least one acceptance scenario with stable `AC#`
- one `T### [AC#] ... verify:` row per delivering/verifying task
- for feat/fix/refactor, one Coverage row per `AC#` plus Full/Impacted commands
- fix reproduction/regression or refactor baseline when applicable

Before Gate run `sh .claude/hooks/artifact-lint.sh --contract .workflow/<id>/`; it owns unique/exact AC sets, task verifies, coverage, and clarification markers. Correct the named row once; an unresolved semantic contract or non-hermetic scope upgrades to S.

## Gate

Print goal/type/ship disposition, every AC, assumptions, phase deviations, coverage, and e2e status. Ask one batch: approve/revise; commit-on-ship; deviations when present. Revision edits only affected `run.md` rows. On approval set INDEX `approved` and `next_step=implement`. `--yes` follows `orchestrator.md > Non-interactive`.

## Phase 2

- XS implements inline from `run.md`. S applies the normal execution-volume resolver; below threshold it stays inline, otherwise one bounded Sonnet `engineer` implements from task/AC pointers.
- Change Gate Test runs inline with Impacted and writes authoritative AC evidence; Ship Gate runs Full + lint/type/static once per converged final diff.
- **Review inline on the fast profile (XS/S)** unless Security fires. Consume Test evidence, walk tasks, and inspect only semantic/contract risks. After a Sonnet Implement spawn, main's inline review is the independent author boundary. Fixes re-enter targeted Test and delta re-review.
- Always run the security-trigger scan. A trigger creates one isolated Review+Security `lead`.
- Docs and deterministic Ship inline. Anything requiring a new doc surface or isolated tooling upgrades to S or records a spawn proof.
- Close inline: stamp state, update INDEX/FOLLOWUPS, fold context/capabilities. Do not write `retro.md` at XS; surface memory/skill candidates only when one genuinely arose.
- No skill body or nested fanout. Friction requiring either is `SIZE_UPGRADE: S`.

## Upgrade

Raise to S immediately for a caller/contract that must remain compatible, multiple coupled files, persisted data, schema/public API, dependency, trust boundary, browser/new harness, cross-repo coupling, or more than three consequential ACs. Existing `run.md` becomes digest input for the normal artifact set, then is deleted after the fold.

**Budgets:** XS has zero workflow spawns unless Security fires. **S designs inline** and has **S spawn budget: 2**: at most one volume-routed Sonnet Implement plus its measured Docs+Ship exception. S docs+ship stays one spawn.
