---
name: delivery-engineering
description: "Use when building or fixing CI/CD, builds, containers, deploys, rollouts, or rollbacks. Skip application code and Git operations (use git-workflow)."
---

# Delivery engineering

Green must mean the exact artifact is eligible to ship; never weaken checks or
expectations to get there.

## Steps

1. Define what the merge gate guarantees. Run build, tests, lint, typecheck, and
   security checks on the actual merge candidate.
2. Build one immutable, identifiable artifact and promote that digest through
   environments; never rebuild per environment.
3. Inject configuration at runtime and read secrets from a managed boundary.
   Keep both out of source, images, logs, and receipts.
4. Pin lockfiles, toolchains, actions, and base images so a fresh machine
   reproduces the build.
5. Limit rollout blast radius (rolling, blue-green, canary, flags). Name health
   gates, abort thresholds, the rollback trigger, and data compatibility so
   old/new versions can overlap.
6. For failing CI or review findings, aggregate every independent finding first,
   then repair in dependency order.

## Harness

Record delivery, rollout, rollback, and required providers in the active
OpenSpec design/evidence contract. Project tools produce evidence; Change Loop
owns proof and Land; production effects need explicit authority.

## References

- `references/pipeline-and-deploy.md` — pipeline stages, caching, artifact
  promotion, configuration, deploy strategies, flags, delivery metrics.
- `references/ci-and-review-repair.md` — repairing failed CI or review findings.
- Use `git-workflow` for branch/commit/PR operations.
