# Design

## Current state

foundation.json seeds review.independence as self, review.diversity as single-model, and fallbackReviewer as main-session. Review packets record these waivers truthfully. Current change validation explains the independent-review route only when independence is not waived, so the seeded waiver path emits no equivalent assurance consequence before Prove. `models` correctly remains a model-tier command and is not a review-policy inspection surface.

## Decisions

- **Decision:** Expose the current waiver posture without changing defaults
  - **Why:** Changing defaults would be a separate compatibility and product-policy decision; visibility resolves the misleading assurance interpretation without breaking single-model teams.
  - **Rejected:** Silently switch every installed project to required independence and diversity
- **Decision:** Report assurance at doctor and change-validation decision points
  - **Why:** Those are the points where users assess readiness and settle evidence; adding review semantics to the model-tier-only `models` command would blur its contract.
  - **Rejected:** Expand `models` output with unrelated review-policy fields

## Compatibility and migration

Do not change review validity, fingerprints, reviewer selection, or seeded defaults. Add only truthful diagnostics and documentation so existing projects retain their current policy and evidence.

## Build precondition

The active sandbox predates the landed native-dispatch and discovery commits. Refresh it to the current root before implementation; the present `sandbox sync` validation-before-refresh deadlock is tracked by the separate `copy-root-read-refresh` draft and must be resolved without rewriting this change's audit history.

## Risks

| Risk | Mitigation | Evidence owner |
|---|---|---|
| A new diagnostic is interpreted as a failing policy gate | Label the result as a committed assurance posture and keep existing readiness and exit status unchanged. | diagnostic contract tests |
| Output wording drifts from actual receipt policy | Derive diagnostics from the same normalized review policy object and pin JSON fields. | review policy tests |
