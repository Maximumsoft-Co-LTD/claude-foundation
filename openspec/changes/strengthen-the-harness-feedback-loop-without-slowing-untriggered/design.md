# Design

## Current state

- `sandbox create` creates a detached Git worktree or isolated copy and protects
  application back to the target; it does not establish an OS security boundary.
- The runtime does not invoke models. Hosts receive bounded packets and record
  external evidence receipts.
- Review is already risk-triggered and workspace-bound, but a review receipt
  records a reviewer label rather than independently checkable model/request
  provenance.
- `/investigate` is product-code read-only and there is no disposable prototype
  surface.
- A strict review walk was previously measured and rejected after raising cost
  50% while lowering quality; additional review must therefore be scoped and
  trigger-based.

## Decisions

- **Decision:** Keep the canonical lifecycle unchanged; `/prototype` is an
  optional companion whose files live only in machine-owned state.
  - **Why:** Non-triggered rapid and standard changes must add zero requests,
    spawns, and lifecycle state.
  - **Rejected:** A mandatory Prototype phase before every Change.
- **Decision:** The deterministic runtime reports boundary evidence but never
  converts virtualization detection or workspace-controlled input into unattended
  authorization; v1 fails closed pending trusted host-owned attestation.
  - **Why:** Workspace integrity and execution security have different owners;
    conflating them creates a false safety claim.
  - **Rejected:** Treating a worktree, hooks, or secret filtering as an
    adversarial sandbox.
- **Decision:** The host performs review from a compact packet and records
  request/model provenance; the runtime evaluates policy.
  - **Why:** This preserves host portability, bounded context, and deterministic
    proof while making independence auditable.
  - **Rejected:** Embedding model orchestration or a rubber-duck loop in the
    runtime.
- **Decision:** Review diversity is risk-scaled: fresh context for ordinary
  required review; different model/provider family or a human for critical
  semantic triggers.
  - **Why:** Diverse review targets correlated blind spots without imposing a
    second model on routine work.
  - **Rejected:** Requiring cross-family review for every change.
- **Decision:** Human acceptance is a separate external capability activated by
  an explicit semantic resolution, not inferred from file extensions.
  - **Why:** Subjective product approval differs from risk review and browser or
    accessibility proof.
  - **Rejected:** Requiring approval for every frontend edit.
- **Decision:** One canonical changed-surface primitive unions base-to-HEAD
  commits with staged, unstaged, untracked, renamed, and deleted paths for every
  selected repository.
  - **Why:** Review and path policy must not become blind after an implementation
    commit makes a worktree clean.
  - **Rejected:** Treating `git status` as the complete change surface.
- **Decision:** AI review attempts are counted in a change-level hash-chained
  journal; the replaceable current receipt is only the latest projection.
  - **Why:** Deleting or renaming a provider receipt must not reset convergence
    policy.
  - **Rejected:** Deriving the round solely from `review.json`.
- **Decision:** Prototype-origin rejection and structured receipt validation run
  both before recording and before proof finalization.
  - **Why:** Workspace-hash exclusion alone does not prevent disposable material
    or edited receipts from satisfying evidence.
  - **Rejected:** Trusting only record-time command grammar.

## Compatibility and migration

Review provenance, acceptance validity, and review packet semantics use scoped
protocol revisions without changing the provider protocol for unrelated
evidence. Old receipts remain diagnosable but cannot satisfy the revised policy.
Existing acceptance with an implicit all-claim scope is migrated once to an
explicit list; existing review rounds seed the monotonic attempt journal. Missing
or corrupt baselines and history fail closed with an actionable diagnostic.
Defaults preserve the ordinary interactive path.

## Risks

| Risk | Mitigation | Evidence owner |
|---|---|---|
| Routine tasks become slower | Make every new behavior opt-in or semantic-risk gated; assert zero structural work on untriggered lanes | performance |
| Worktree or virtualization is mistaken for security authorization | Separate diagnostic fields and fail explicit unattended mode closed pending trusted host attestation | test, security-static |
| Provenance is self-asserted or unavailable | Require request/model identity when policy needs it; allow a human alternative for critical review | review, compatibility |
| Review loops consume unbounded tokens | Reuse stale-receipt invalidation, verified findings, watchdog, and failed-attempt escalation | test, performance |
| Protocol upgrade invalidates valid legacy work unexpectedly | Additive parsing and targeted upgrade compatibility tests | compatibility |
| A committed implementation disappears from review | Union base-to-HEAD and dirty paths through one repository-aware surface | test, review |
| A disposable prototype satisfies proof | Reject canonical and symlink-resolved prototype origins atomically | test, security-static |
| Current receipt deletion resets review policy | Persist a change-level chained attempt counter and fail closed on corruption | test, review |
