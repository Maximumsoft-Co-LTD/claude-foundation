---
name: delivery-engineering
description: Apply delivery-engineering fundamentals — CI gate as the merge contract, build once and promote the same artifact, config and secrets outside the artifact, reproducible pinned builds, deploy safely and reversibly, pipeline as code. Use BEFORE designing or changing a CI/CD pipeline, build, deploy strategy, release process, containerization, environment config, or rollout/rollback plan. The trigger is real delivery work (pipeline YAML, Dockerfile, deploy script, release flow), even when no principle is named. Skip local-only scripts, a repo with no deploy target, and pure code changes that don't touch the pipeline.
---

# Delivery Engineering

## Why this exists

Most delivery pain traces to the same handful of missed fundamentals: a green build that runs no real tests; a 40-minute pipeline that gets routed around with `--no-verify`; a hand-assembled deploy that can't be reproduced at 2 AM; an artifact rebuilt per environment so the thing tested isn't the thing shipped; a secret baked into a Docker layer; a big-bang release with no safe way back. The pipeline is **production infrastructure** — design it. This skill is a **pre-flight**: read it before writing the workflow file, Dockerfile, deploy script, or release plan.

Sibling to [[git-workflow]] in the Delivery layer (`.claude/rules/fundamentals.md` owns the boundary): git-workflow owns the road to the merge, this skill owns what happens to the merged code (CI gate, build, artifact promotion, deploy, release, rollback) — they meet at the PR's green check. In `/dev` it backs the CI ship-gate; the ship-phase mechanics live in `WORKFLOW.md`.

## The 7 principles

---

### 1. The CI gate is the merge contract — and a green check must mean something

**Rule:** Every change runs build + test + lint + typecheck before it can merge, on the same commit that will merge. A passing gate is a *promise* that this commit is shippable. If the gate is slow or flaky, people route around it — so make it fast (parallelize, cache, fail fast) and make it real.

**Why:** The merge gate is the one moment where the team's discipline is enforced by a machine. A hollow gate (tests that assert nothing, lint that's `|| true`, a commented-out typecheck) makes "CI is green" meaningless. A *slow* gate is bypassed: a 40-minute pipeline trains people to merge before it finishes and skip hooks with `--no-verify`. Fast feedback keeps the gate honest — single-digit minutes by parallelizing independent jobs, caching deps, and ordering checks fail-fast.

**How to apply:**
- Run the gate on the *merge result*, not just the branch tip, where the platform supports it (GitHub merge queue, GitLab merged-results pipelines). "Green on my branch" can still break `main` if `main` moved.
- The required checks are non-negotiable and branch-protected: build, unit + integration tests, lint, typecheck. A human cannot click "merge" past a red required check.
- Parallelize independent jobs (lint ∥ typecheck ∥ test shards) and cache the expensive inputs (dependency installs, compiled layers). A 30-minute serial pipeline is often a 6-minute parallel one.
- Order checks fail-fast: cheap-and-likely-to-fail first (lint, typecheck, format), expensive-and-slow last (full e2e). Fail the run the moment the first stage fails.
- Quarantine flaky tests aggressively — a test that fails 1-in-20 for no reason teaches the team to hit "re-run," which is the same as having no gate. Fix it or skip it explicitly with a tracking issue, don't let it erode trust.

**Example:**
```yaml
# Bad — one serial job, no cache, the gate is the bottleneck
jobs:
  ci:
    steps:
      - run: npm install        # 4 min, uncached, every run
      - run: npm run build      # 3 min
      - run: npm test           # 12 min e2e, runs even if lint would fail
      - run: npm run lint        # never reached when tests are red
# → 19 min, lint feedback arrives last. People merge before it finishes.

# Better — parallel, cached, fail-fast
jobs:
  static:                       # seconds; runs first, in parallel
    steps:
      - uses: actions/setup-node
        with: { cache: npm }
      - run: npm ci
      - run: npm run lint && npm run typecheck
  test:
    strategy: { matrix: { shard: [1, 2, 3, 4] } }   # 4-way split
    steps:
      - uses: actions/setup-node
        with: { cache: npm }
      - run: npm ci
      - run: npm test -- --shard=${{ matrix.shard }}/4
# → ~5 min wall-clock, lint fails in 40s. Branch protection requires both jobs.
```

---

### 2. Build once, promote the same artifact

**Rule:** Build a single immutable, versioned artifact once, and promote *that exact artifact* through dev → staging → prod. Never rebuild per environment.

**Why:** If you rebuild per environment, you haven't tested what you shipped — a floated dep patch or re-pulled base image means prod runs a binary your suite never saw. Staging validated a different artifact; its confidence is worthless. Build-once-promote makes the artifact the unit of release. Rollback falls out for free: the previous good digest still exists, so rollback is re-pointing, not a frantic rebuild from a commit you hope still compiles.

**How to apply:**
- Build the artifact (container image, jar, wheel, zip, binary) exactly once, in CI, on the commit that's merging. Tag it immutably — a content digest or `<version>-<short-sha>`, never a moving tag like `latest` for anything you deploy.
- Push it to a registry/artifact store. Deploys *pull* the named artifact; they never `git clone && build` on the target or rebuild "the same thing" downstream.
- Promotion is a metadata move, not a rebuild: "image `app@sha256:abc…` passed staging → deploy `app@sha256:abc…` to prod." Same digest, byte-for-byte.
- Environment differences are injected at *run* time (config, secrets — see principle 3), never baked at build time per environment. One artifact, many configurations.
- Serverless note: the deploy package (the zip / image) is your artifact — build it once, promote the same package across stages/aliases; use stage config and aliases for environment differences, don't re-zip per stage.

**Example:**
```yaml
# Bad — three builds, three different artifacts, "staging passed" means nothing
deploy-staging:  { script: docker build -t app:staging . && deploy staging }
deploy-prod:     { script: docker build -t app:prod . && deploy prod }
# → prod image built minutes later from re-resolved deps. Not what staging validated.

# Good — build once, promote the digest
build:
  script:
    - docker build -t $REGISTRY/app:$CI_COMMIT_SHA .
    - docker push  $REGISTRY/app:$CI_COMMIT_SHA      # the one artifact
deploy-staging:
  script: deploy --image $REGISTRY/app:$CI_COMMIT_SHA --env staging
deploy-prod:
  needs: [deploy-staging]
  when: manual                                       # promote after staging is green
  script: deploy --image $REGISTRY/app:$CI_COMMIT_SHA --env prod   # SAME digest
```

---

### 3. Config and secrets live outside the artifact

**Rule:** The same binary runs in every environment; what differs is configuration injected from the environment, and secrets pulled from a secrets manager at deploy/run time — never baked into the image, committed to the repo, or printed in logs.

**Why:** Baking config into the image forces a different image per environment (breaks principle 2). Worse, a secret baked into a Docker layer is *permanent* — `docker history` exposes it forever even if you `rm` it in a later layer, because the adding layer remains. A secret committed to git is the same: history keeps it after deletion. Config-from-environment (12-factor) and secrets-from-a-manager keep the artifact clean, portable, and safe to share.

**How to apply:**
- Read all environment-varying config from the environment (env vars, mounted config, a config service) — endpoints, feature toggles, pool sizes, log levels. The 12-factor "config in the environment" rule. No `if (env === 'prod')` branches compiled into the binary.
- Secrets come from a manager (Vault, AWS/GCP Secrets Manager, SOPS-encrypted files, the platform's secret store), injected at deploy or fetched at startup. Never in the image, never in the repo, never in plaintext CI logs.
- The repo holds *templates*, not values: `.env.example`, `config.template.yaml`. This project's `protect-secrets.sh` hook already blocks reads of `.env` and credential files while allow-listing `*.example` / `*.template` / `*.pub` — that boundary is the same one this principle draws.
- Mask secrets in CI output and scope them to the jobs that need them. Rotate on exposure, and treat any secret that ever hit a log or a layer as compromised.
- Validate required config at startup and fail fast with a clear message ("`DATABASE_URL` is required") rather than booting half-configured and erroring on the first request.

**Example:**
```dockerfile
# Bad — secret baked into a layer, config hard-coded per environment
ENV DATABASE_URL=postgres://prod-user:hunter2@prod-db/app   # leaked forever
RUN curl -H "Authorization: Bearer sk_live_abc123" ...       # in docker history
# → one image per env, credentials permanently embedded in the image.

# Good — clean artifact, config + secrets injected at run time
ENV NODE_ENV=production
CMD ["node", "server.js"]   # reads DATABASE_URL, API_KEY from the environment
```
```yaml
# deploy: inject config from env, secrets from the manager — same image everywhere
env:
  - name: DATABASE_URL
    valueFrom: { secretKeyRef: { name: app-db, key: url } }   # from secret store
  - name: LOG_LEVEL
    value: "info"                                              # per-env config
```

---

### 4. Reproducible builds on a pinned toolchain

**Rule:** The same source must produce the same artifact on any machine. Pin everything that goes into the build — dependency versions (lockfiles), base images (by digest), and the toolchain (language/runtime version). "Works on my machine" is an unpinned-environment bug, not a mystery.

**Why:** A build depending on whatever was installed is untrustworthy. Classic incident: CI passes Tuesday, same commit fails Thursday — `node:18` got re-pulled to a newer patch. Pinning makes the build a pure function of the source: same inputs, same output, everywhere. It's also a supply-chain control — a pinned digest can't be swapped by a compromised upstream tag.

**How to apply:**
- Commit the lockfile (`package-lock.json`, `poetry.lock`, `Cargo.lock`, `go.sum`) and install from it exactly: `npm ci` not `npm install`, `pip install -r requirements.txt` with hashes, `poetry install --no-update`. CI must fail if the lockfile is out of date.
- Pin base images by digest, not a floating tag: `FROM node:20.11.1-slim@sha256:…`, not `FROM node:latest` or even `FROM node:20`. Digest-pinning is what makes the image immutable.
- Pin the toolchain version in-repo (`.nvmrc`, `.python-version`, `rust-toolchain.toml`, `mise.toml`) so local dev, CI, and the build image all agree. Read it; don't assume the runner's default.
- Keep builds hermetic — no fetching un-pinned things at build time, no reaching for network resources that can change. Vendor or lock anything the build touches.
- Update pins deliberately, via a PR (Renovate/Dependabot), so a version bump is a reviewable, revertible change with its own green gate — not a silent drift.

**Example:**
```dockerfile
# Bad — every layer is a moving target
FROM node:latest                  # which Node? whatever was pulled today
COPY . .
RUN npm install                   # re-resolves; lockfile ignored
# → reproducible by luck only. CI green today, red tomorrow, same commit.

# Good — pinned base, locked deps, hermetic install
FROM node:20.11.1-slim@sha256:4e1f...   # exact image, immutable
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci                              # installs the lockfile exactly, fails if stale
COPY . .
RUN npm run build
```

---

### 5. Deploy safely and reversibly — and decouple deploy from release

**Rule:** Roll new code out behind a health check, with a way back that's automatic and fast. Use a strategy that limits blast radius (blue-green, canary, or rolling) and an automated rollback trigger. Separate *deploying* code (it's running) from *releasing* a feature (users see it) with feature flags.

**Why:** The question isn't "will a deploy ever go bad" — it's "when one does, how much breaks and how fast can you undo it." An all-at-once replace answers: everything, only as fast as a rebuild. Health-checked progressive rollouts answer: a fraction of traffic, automatically. Decoupling deploy from release is the deepest lever: risky code ships dark behind a flag; release is a flag flip; rolling back a bad feature is seconds with no redeploy, and it unbraids "the deploy failed" from "the feature is wrong."

**How to apply:**
- Gate every rollout on a real **health/readiness check** — not "the process started" but "the process serves a real request and its dependencies are reachable." A rollout that can't pass health does not receive traffic.
- Pick a strategy by blast-radius need: **rolling** (replace instances a few at a time — simple, the default for most), **blue-green** (stand up the new version fully, switch traffic atomically, keep the old stack hot for instant rollback), **canary** (send 1–5% of traffic to the new version, watch error rate and latency, then ramp). See `references/pipeline-and-deploy.md` for when each fits.
- Wire **automated rollback**: define the abort condition (error rate, p99 latency, failed health checks over a window) and let the deploy system revert to the last good artifact without a human in the loop. Rollback is re-pointing at the previous digest (principle 2 makes this cheap).
- **Decouple deploy from release** with feature flags: merge and deploy dark code continuously; turn the feature on for internal → small % → all via the flag. A bad feature is a flag flip, not a rollback. Keep flags short-lived and clean them up — a stale flag is dead config that lies.
- Make deploys **idempotent and forward-rolling**: re-running a deploy is safe, and the fix for a bad deploy is usually rolling *forward* to a corrected artifact, the same way [[database-fundamentals]] migrations roll forward. Coordinate with the expand→contract migration sequence so the schema is always compatible with both the old and new running code.

**Example:**
```yaml
# Bad — replace everything at once, no health gate, no way back but a rebuild
deploy:
  script: kubectl set image deploy/app app=app:$SHA   # 100% instantly
# → if it crash-loops, 100% of traffic is down until someone rebuilds the old one.

# Good — canary with health gate and automated rollback
deploy:
  strategy:
    canary:
      steps:
        - setWeight: 5            # 5% of traffic to the new digest
        - analysis:               # watch real signals
            metrics: [error-rate, p99-latency]
            failureLimit: 1       # breach → auto-abort, revert to last good
        - setWeight: 50
        - pause: { duration: 5m }
        - setWeight: 100
```
```ts
// Decouple: deploy the code dark, release via flag — rollback is a flip, not a redeploy
if (flags.isEnabled("new-checkout", { userId })) {
  return newCheckout(cart)
}
return legacyCheckout(cart)
```

---

### 6. Automate the path to production — the pipeline is the only way code ships

**Rule:** Every step from merge to running-in-prod is automated and runs through the pipeline. No manual `scp`, no "SSH in and pull," no hand-assembled release. Prefer small, frequent releases over big-bang ones.

**Why:** Manual deploy steps are where outages live — a human forgets the migration, uses the wrong config, skips the smoke test "just this once." Every manual step is an undocumented dependency on one person's memory. Automating makes the deploy the same every time and runnable by anyone. Frequency matters too: a three-week big-bang release is one risky event with a 47-file diff to bisect; small frequent releases shrink blast radius and make regressions obvious. Deploying *more often* is how you deploy *more safely*.

**How to apply:**
- The pipeline is the single path to prod. If a step can only be done by a person typing commands on a server, it's a latent outage — script it and move it into the pipeline.
- Automate the *whole* path: build → test → artifact → deploy → migration → smoke test → (canary/rollout). Migrations run through the pipeline in their expand→backfill→contract order ([[database-fundamentals]]), not by hand.
- Choose your trigger deliberately: **continuous deployment** (every green merge to `main` auto-deploys to prod) for mature pipelines with strong gates and progressive rollout; **continuous delivery** (every green merge is *deployable*, prod deploy is a one-click promotion) when you want a human in the loop. Either is automated; the difference is who presses go.
- Keep batches small. Merge and deploy in small increments behind flags (principle 5) rather than accumulating a release. "Release" becomes a non-event because each one is tiny.
- A post-deploy **smoke test** is part of the automated path — hit a few critical endpoints after rollout and auto-rollback if they fail. "It deployed" is not "it works."

**Example:**
```
Bad (manual, big-bang, Friday):
  - merge 3 weeks of work
  - SSH to prod, git pull, npm install, pm2 restart
  - "did anyone run the migration?" — no
  - 47-file diff, app won't boot, the one person who knows the deploy steps is offline
  → multi-hour outage; nobody's sure what's even in this release.

Good (automated, small, continuous):
  - merge a 300-line PR (CI green) → pipeline auto-runs:
      build once → promote digest → run migration (expand) → canary 5% → smoke test → ramp 100%
  - any step fails → auto-rollback to last good digest, alert fires
  → deploy is a non-event, happens 8× today, each one trivially bisectable.
```

---

### 7. The pipeline is code, and delivery is observed

**Rule:** The pipeline definition lives in the repo, is reviewed like application code, and is versioned with it. And you measure delivery itself — lead time, deploy frequency, change-failure rate, mean-time-to-recovery — so you know whether the pipeline is healthy or quietly rotting.

**Why:** A pipeline configured by clicking in a CI web UI is undocumented, unreviewable, and un-revertible. Pipeline-as-code (workflow YAML, Dockerfile, deploy manifests, Terraform) puts delivery under the same discipline as the code it ships: PR-reviewed, green-gated, revertible. And you can't improve what you don't measure — the four DORA metrics are a delivery system's vital signs: **lead time** (commit → prod) and **deploy frequency** for throughput; **change-failure rate** and **MTTR** for stability. Watching them tells you whether a "speed" change traded away safety.

**How to apply:**
- Keep all delivery config in the repo: CI workflow files, `Dockerfile`, deploy manifests/Helm charts, infrastructure-as-code. Review changes to them in PRs ([[git-workflow]] principle 6) — a change to the deploy script is as load-bearing as a change to the app.
- Never configure the critical path by hand in a console. If the platform forces some UI config, capture it as code (Terraform, the platform's config-as-code) so it's reviewable and reproducible.
- Track the four DORA signals from data you already have (CI timestamps, deploy events, incident records). You don't need a fancy tool — a deploy log plus an incident log gets you all four. See `references/pipeline-and-deploy.md` for exact definitions and how to compute each.
- Watch change-failure rate and MTTR when you change the gate. If you speed up the pipeline and CFR climbs, the speed came from removing a real check — back it out.
- Treat a degrading pipeline as a bug with a ticket: flaky-test rate creeping up, lead time climbing, builds slowing — these are the early warnings of a delivery system rotting toward the failure modes at the top of this skill.

**Example:**
```yaml
# Bad — pipeline lives in the CI web UI; deploy steps typed into a console.
# No diff, no review, no revert. "Who changed the build cache key last week?" — unknowable.

# Good — pipeline-as-code, in the repo, reviewed and versioned
# .github/workflows/ci.yml, Dockerfile, deploy/values.yaml — all PR-reviewed.
```
```
# DORA vital signs, computed from CI + deploy + incident logs:
#   lead time (commit→prod):  median 2h        (elite: < 1 day)
#   deploy frequency:          14/day           (elite: on-demand, multiple/day)
#   change-failure rate:       4%               (elite: 0–15%)
#   MTTR:                       18 min           (elite: < 1 hour)
# → CFR jumped to 22% the week we dropped the integration suite from the gate. Put it back.
```

---

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

Deeper guidance for the principles above. Read the one that matches the work in front of you; you don't need it all upfront.

- `references/pipeline-and-deploy.md` — CI stage design with caching and parallelism recipes; the build-once-promote artifact pattern; environment and secret handling do/don't; deploy strategies (blue-green / canary / rolling) with rollback wiring; decoupling deploy from release with feature flags; and the four DORA metrics — exact definitions and how to compute each from logs you already have.
