# Verification

Observed on 2026-07-31 in the isolated change copy.

## Deterministic regression

Command: `sh .claude/tests/run-all.sh`

Result: all suites passed.

- context budgets: 23/23
- agent contracts: 7/7
- packet scaling: 7/7
- telemetry concurrency and rollup: 6/6
- upgrade compatibility: 10/10
- harness contracts: 162/162
- installer smoke: 54/54
- current hooks: 7/7

## Performance and context

- A 1,000-task plan remained below the 4 KiB plan-summary limit.
- A 1,000-task repository packet remained below 12 KiB.
- A 500-claim global packet remained below 16 KiB.
- The representative auth/backend build context was 9,881 bytes, below the
  32,768-byte fixture budget.
- Six hot-path skills totalled 1,459 words, below the 3,000-word combined
  budget and about 78% below their prior 6,554-word total.

## Compatibility

- The exact former numeric default migrated to task/repository/global limits of
  8,192/12,288/16,384 bytes.
- A custom numeric limit of 32,768 bytes survived install and produced a doctor
  warning.
- Partial scoped and model configuration deep-merged with defaults.
- Runtime API 7, packet schema 4, agent-plan schema 2, and context-event schema
  2 were reported as one compatible protocol bundle.

## Authority and review

- Unknown task claims, cross-repository claim authority, providerless task
  claims, active repository conflicts, and stale dependencies were reviewed at
  their dispatch boundaries.
- Compact output, exact byte accounting, completed-dependency resume,
  proof-ready routing, and deepest-tier session routing have dedicated contract
  assertions.
- Context telemetry was reviewed for write failure, malformed legacy input,
  20 concurrent writers, bounded rollup, stale-lock recovery, and non-blocking
  packet behavior.
- Installer migration preserves project-owned custom policy and rollback
  coverage remains in the installer regression suite.

Review source: Codex implementation session, followed by the complete
deterministic regression above.
