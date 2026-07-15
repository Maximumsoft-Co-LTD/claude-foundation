---
name: delivery-engineering
description: Apply delivery-engineering fundamentals — CI gate as the merge contract, build once and promote the same artifact, config and secrets outside the artifact, reproducible pinned builds, deploy safely and reversibly, pipeline as code. Use BEFORE designing or changing a CI/CD pipeline, build, deploy strategy, release process, containerization, environment config, or rollout/rollback plan. The trigger is real delivery work (pipeline YAML, Dockerfile, deploy script, release flow), even when no principle is named. Skip local-only scripts, a repo with no deploy target, and pure code changes that don't touch the pipeline.
---

# Delivery Engineering

## Why this exists

Most delivery pain traces to the same handful of missed fundamentals: a green build that runs no real tests; a 40-minute pipeline that gets routed around with `--no-verify`; a hand-assembled deploy that can't be reproduced at 2 AM; an artifact rebuilt per environment so the thing tested isn't the thing shipped; a secret baked into a Docker layer; a big-bang release with no safe way back. The pipeline is **production infrastructure** — design it. This skill is a **pre-flight**: read it before writing the workflow file, Dockerfile, deploy script, or release plan.

Sibling to [[git-workflow]] in the Delivery layer (`.claude/rules/fundamentals.md` owns the boundary): git-workflow owns the road to the merge, this skill owns what happens to the merged code (CI gate, build, artifact promotion, deploy, release, rollback) — they meet at the PR's green check. In `/dev` it backs the CI ship-gate; the ship-phase mechanics live in `WORKFLOW.md`.

## The 7 principles

Full rule/why/how-to-apply/example for each lives in `references/pipeline-and-deploy.md`.

| # | Principle | Compressed rule |
|---|---|---|
| 1 | The CI gate is the merge contract | Every change runs build+test+lint+typecheck on the merging commit; a green check must mean shippable. Keep it fast (parallelize, cache, fail-fast) so nobody routes around it. |
| 2 | Build once, promote the same artifact | One immutable, versioned artifact built once, promoted dev→staging→prod. Never rebuild per environment — that breaks what staging validated. |
| 3 | Config and secrets live outside the artifact | Environment-varying config injected at run time; secrets pulled from a manager. Never baked into the image, committed to the repo, or printed in logs. |
| 4 | Reproducible builds on a pinned toolchain | Lockfiles installed exactly, base images pinned by digest, toolchain version pinned in-repo. Same source → same artifact, on any machine. |
| 5 | Deploy safely and reversibly; decouple deploy from release | Health-gated rollout (rolling / blue-green / canary) with automated rollback. Feature flags separate "code is running" from "users see it." |
| 6 | Automate the path to production | Every step from merge to running-in-prod goes through the pipeline — no manual server steps. Small, frequent releases beat big-bang ones. |
| 7 | The pipeline is code, and delivery is observed | Pipeline definition lives in the repo, reviewed like app code. Track the four DORA metrics — lead time, deploy frequency, change-failure rate, MTTR. |

## Pre-flight checklist

Before designing or changing a pipeline, build, deploy, or release, run through these in your head:

1. **Gate:** does the merge gate run build + test + lint + typecheck on the merging commit, and does a green check actually mean shippable? Is it fast enough (single-digit minutes) that nobody routes around it?
2. **Artifact:** is there exactly one immutable, versioned artifact built once and promoted dev→staging→prod — or am I rebuilding per environment and shipping something I never tested?
3. **Config & secrets:** is all environment-varying config injected from the environment, and are secrets pulled from a manager (never in the image, the repo, or a log)? Is the same binary running everywhere?
4. **Reproducibility:** is the build a pure function of the source — lockfile committed and installed exactly, base image digest-pinned, toolchain version pinned in-repo? Would this commit build identically on a fresh machine?
5. **Deploy safety:** is the rollout health-checked, blast-radius-limited (rolling/blue-green/canary), and automatically reversible? Is the risky path behind a feature flag so deploy and release are decoupled?
6. **Automation:** is the entire path from merge to prod automated through the pipeline, with no manual server steps? Are releases small and frequent rather than big-bang?
7. **Pipeline-as-code & observed:** is the pipeline definition in the repo and reviewed? Am I tracking lead time, deploy frequency, change-failure rate, and MTTR to know if delivery is healthy?

If any answer is "I don't know," stop and find out before writing.

## When to skip this skill

- Local-only scripts and one-off tooling that never deploy anywhere (a data-munging script, a local dev helper).
- A repo with no deploy target — a library published only as source, a docs site with no build, a scratch prototype.
- Pure code changes that don't touch the pipeline, build, config, or deploy path (the [[git-workflow]] and construction skills cover those).
- A tiny personal project where "deploy" is `git push` to a PaaS that builds for you — though principle 3 (don't commit secrets) and principle 4 (commit your lockfile) still earn their keep.

For anything else — designing or reworking a CI/CD pipeline, writing a Dockerfile or deploy manifest, choosing a rollout strategy, setting up environment config or secrets, planning a release process — these fundamentals apply.

## How to use this skill in a conversation

Always-on for delivery work (per `.claude/rules/fundamentals.md`). Don't ask the user to opt in. If the task matches "When to skip", say so in one sentence and proceed.

When the skill applies:
- **Designing a pipeline** — name the stages and what each gate guarantees before writing YAML. Decide what's parallel, what's cached, and what the merge contract requires.
- **Writing a build** — pin toolchain and base image, install from the lockfile, build the one artifact you'll promote. Call out anything that fetches at build time.
- **Choosing a deploy strategy** — name the blast radius, health check, rollback trigger, and whether the change rides behind a flag. Say which strategy and why.
- **Handling config or secrets** — state what's injected at run time and what comes from the secrets manager. Never put a secret in an artifact, a repo, or a log.

Non-obvious calls (canary over blue-green, manual promotion, flag over branch): say *why* in one sentence and name the trade-off.

## Reference files

- `references/pipeline-and-deploy.md` — all 7 principles' full rule/why/how-to-apply/example; CI stage design with caching and parallelism recipes; the build-once-promote artifact pattern; environment and secret handling do/don't; deploy strategies (blue-green / canary / rolling) with rollback wiring; decoupling deploy from release with feature flags; and the four DORA metrics — exact definitions and how to compute each from logs you already have.
