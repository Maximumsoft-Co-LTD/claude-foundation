# Change: Preserve valid review evidence across concurrent-change sandbox sync

## Why

Avoid repeated full reviews and no-op proof invalidation when concurrent changes move the target without changing the reviewed contribution or agreement; expose precise conservative invalidation reasons.

## What changes

- The review receipt can rebind through the existing proof route without another reviewer dispatch; identity covers every writable selected repository and fails closed when unavailable.
- Valid proof and lifecycle progress are preserved; changed inputs or unresolved conflicts still invalidate proof without discarding reusable receipts.
- The existing invalidation projection distinguishes missing identity, changed contribution, and changed review packet while retaining stale validity and conservative behavior.

## Impact

- **Impact:** high
- **Coupling:** coupled
- **Affected surfaces:** code
- **Security triggers:** 

## Non-goals

- none
