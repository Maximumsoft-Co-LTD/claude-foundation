# Pipeline & Deploy

The pipeline is the path your code takes from a merge to a running production system. This reference is the concrete layer under the principles in `SKILL.md`: stage design, caching and parallelism, the build-once-promote pattern, config/secret handling, deploy strategies with rollback, decoupling deploy from release, and the four DORA metrics. Recipes, not theory.

The examples lean on GitHub Actions / GitLab CI and Kubernetes-ish deploys because they're the common case; the shapes translate to CircleCI, Buildkite, ECS, Nomad, a PaaS, or serverless.

## CI stage design

A pipeline is a DAG of stages. The skeleton, in dependency order:

```
              ┌─ lint ──────┐
checkout ─────┼─ typecheck ─┼─ build ─ test ─ artifact ─ deploy-staging ─ deploy-prod
   │          └─ format ────┘    │      │        │             │              │
 (fast)        (seconds, ∥)   (1 art.) (sharded) (push)    (auto, canary)  (promote)
```

Two rules govern the ordering:

1. **Fail fast.** Put cheap, likely-to-fail checks first (lint, typecheck, format, secret-scan). A missing semicolon should cost 40 seconds, not the full 12-minute e2e run. The first failing stage stops the pipeline.
2. **Parallelize the independent.** Lint, typecheck, and format don't depend on each other — run them concurrently. Test shards don't depend on each other — fan them out.

### Stage responsibilities

| Stage | Owns | Fails the build when |
|---|---|---|
| **static** | lint, typecheck, format check, secret scan | style violation, type error, committed secret |
| **build** | compile / bundle, produce the artifact | compile error, lockfile out of date |
| **test** | unit + integration (+ e2e), sharded | any test fails, coverage gate breached |
| **artifact** | tag + push the immutable artifact | registry push fails |
| **deploy** | promote artifact, run migration, health-check, smoke-test | health/smoke fails → auto-rollback |

### A realistic GitHub Actions skeleton

```yaml
name: ci
on:
  pull_request:
  merge_group:            # run on the MERGE RESULT, not just the branch tip
jobs:
  static:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version-file: .nvmrc, cache: npm }   # pin + cache
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npx gitleaks detect --no-banner               # secret scan

  test:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix: { shard: [1, 2, 3, 4] }                      # 4-way fan-out
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version-file: .nvmrc, cache: npm }
      - run: npm ci
      - run: npm test -- --shard=${{ matrix.shard }}/4

  build:
    needs: [static, test]                                  # only after gates pass
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/build-push-action@v6
        with:
          push: true
          tags: ${{ vars.REGISTRY }}/app:${{ github.sha }} # immutable tag
          cache-from: type=gha                             # layer cache
          cache-to: type=gha,mode=max
```

Branch protection then marks `static` and `test` as **required** — a human cannot merge past a red one. That's principle 1 made physical.

## Caching & parallelism recipes

Caching turns a cold pipeline into a warm one. Parallelism turns a serial wall-clock into a fan-out.

- **Dependency cache** — key on the lockfile hash, restore before install. `npm ci`, `pip`, `cargo`, `go mod` all benefit. Cache key example: `deps-${{ hashFiles('**/package-lock.json') }}`. Invalidate automatically when the lockfile changes; never key on a branch name (stale across branches).
- **Build-layer cache** — Docker layer caching (`type=gha`, `type=registry`, or BuildKit `--mount=type=cache`). Order Dockerfile layers cheapest-changing first: copy `package.json` + lockfile and `npm ci` *before* copying source, so a source-only change reuses the dependency layer.
- **Compiler / tool cache** — `ccache`, Gradle/Bazel remote cache, `tsc --incremental`, Turborepo/Nx remote cache for monorepos. Persist the cache dir across runs.
- **Test sharding** — split the suite N ways across N runners (`--shard`, `pytest-xdist`, `knapsack`/timing-based balancing). 12 minutes serial → ~3 minutes on 4 shards.
- **Test selection** — for large monorepos, run only the tests affected by the diff (`nx affected`, `turbo --filter`, Bazel target graph). Full suite on `main`; affected-only on PRs.

Caches are a *correctness* hazard if misused: never cache the artifact you deploy (principle 4 wants it built fresh from pinned inputs), and bust the cache key on any input change. A cache that serves stale dependencies is an env-drift bug wearing a performance costume.

## Build once, promote the artifact

The artifact is the unit of release. Build it once; everything downstream references it by immutable id.

```
   build ──▶ app@sha256:abc123 ──▶ [registry]
                    │
        ┌───────────┼───────────┐
        ▼           ▼           ▼
   deploy dev   deploy stg   deploy prod      ← all the SAME digest
```

**Do**
- Tag immutably: a content digest (`sha256:…`) or `<semver>-<short-sha>`. The digest is the contract.
- Push to a registry/artifact store once, in the build stage.
- Promote by *reference*: "digest `abc123` passed staging → deploy `abc123` to prod." No rebuild.
- Inject all environment differences at run time (config + secrets). One artifact, many configs.
- Record the artifact ↔ commit ↔ environment mapping (a deploy log) so you can answer "what's in prod right now?" with a digest.

**Don't**
- `docker build` separately per environment — you've shipped an untested sibling.
- Deploy a moving tag (`latest`, `staging`) — it's not immutable; you can't pin or roll back to it.
- `git clone && build` on the target host — the host's toolchain becomes an unpinned input.
- Bake environment config into the image — that forces one image per environment.

**Rollback falls out for free.** Because the previous good digest still exists in the registry, rolling back is `deploy --image app@<previous-digest>` — re-pointing, not rebuilding. No "does this old commit still build?" panic at 2 AM.

## Environment config & secrets — do / don't

The same binary in every environment; differences injected from outside (principle 3, the 12-factor rule).

**Config (non-secret, environment-varying):** endpoints, feature toggles, pool sizes, log levels, timeouts.

| Do | Don't |
|---|---|
| Read from env vars / mounted config / a config service | Compile `if (env === 'prod')` branches into the binary |
| Validate required config at startup, fail fast with a clear message | Boot half-configured and error on the first request |
| Keep a checked-in `config.template.yaml` / `.env.example` (values blank) | Commit real per-environment values |

**Secrets (credentials, keys, tokens):**

| Do | Don't |
|---|---|
| Pull from a manager (Vault, AWS/GCP Secrets Manager, SOPS, sealed-secrets) | Bake into a Docker layer — `docker history` exposes it forever |
| Inject at deploy (k8s `secretKeyRef`) or fetch at startup | Commit to the repo — git history keeps it after deletion |
| Mask in CI logs; scope each secret to the jobs that need it | `echo $SECRET` or pass on a command line (shows in `ps`/logs) |
| Rotate on any exposure; treat logged/layered secrets as compromised | Reuse one secret across all environments |

A secret in a layer is **permanent**: removing it in a later layer doesn't erase the layer that added it. Use multi-stage builds (the final stage copies only artifacts, not build secrets) and BuildKit `--mount=type=secret` for build-time credentials that must not persist.

```dockerfile
# Build-time secret that does NOT end up in the image
RUN --mount=type=secret,id=npm_token \
    NPM_TOKEN=$(cat /run/secrets/npm_token) npm ci
```

This project's `protect-secrets.sh` hook enforces the same boundary at edit time — `.env` and credential files are unreadable; `*.example` / `*.template` / `*.pub` are allow-listed.

## Deploy strategies

Pick by blast-radius need and the cost of running two versions at once.

### Rolling (the sensible default)

Replace instances a few at a time; new and old run side-by-side during the roll. Cheap (no extra fleet), but old and new serve traffic simultaneously — your schema and APIs must be backward-compatible for the overlap window (this is why DB migrations follow expand→contract; see [[database-fundamentals]]).

```yaml
strategy:
  rollingUpdate: { maxSurge: 1, maxUnavailable: 0 }   # add one new before dropping one old
readinessProbe:                                       # no traffic until truly ready
  httpGet: { path: /healthz, port: 8080 }
  initialDelaySeconds: 5
```

Rollback: roll the previous digest back through the same mechanism (`kubectl rollout undo`).

### Blue-green (instant switch, instant rollback)

Stand up the new version (green) as a full parallel fleet beside the live one (blue). Smoke-test green out-of-band, then switch the router atomically. Keep blue hot for a window so rollback is a one-line traffic flip. Costs double the fleet during the cutover; gives the fastest, cleanest rollback.

```
[router] ──100%──▶ blue (v1)        # before
[router] ──100%──▶ green (v2)       # after atomic switch; blue stays hot
rollback: point router back at blue # seconds, no redeploy
```

Best when you need a clean, all-at-once cutover and can afford two fleets briefly (and a single version serving all traffic — no mixed-version window).

### Canary (smallest blast radius, data-driven)

Route a small slice (1–5%) to the new version, watch real signals (error rate, p99 latency, saturation), then ramp 5 → 25 → 50 → 100 if healthy, or auto-abort on breach. Best for high-traffic services where you want production to *prove* the release before it owns all traffic.

```yaml
canary:
  steps:
    - setWeight: 5
    - analysis:
        metrics: [error-rate, p99-latency]
        interval: 2m
        failureLimit: 1          # one breach → abort + revert to last good digest
    - setWeight: 25
    - pause: { duration: 5m }
    - setWeight: 50
    - setWeight: 100
```

### Automated rollback wiring

Whatever the strategy, define the abort condition as *data*, not a human judgment call:

- **Trigger:** error rate > X%, p99 latency > Y ms, or failed health/smoke checks over a window.
- **Action:** revert to the last-good artifact digest automatically (no human in the loop).
- **Post-deploy smoke test** is part of the path: after rollout, hit a handful of critical endpoints; failure auto-rolls-back. "It deployed" is not "it works."

| Strategy | Extra cost | Rollback speed | Mixed versions live? | Best for |
|---|---|---|---|---|
| Rolling | none | medium (re-roll) | yes (during roll) | most services, default |
| Blue-green | 2× fleet briefly | instant (flip) | no | clean cutovers, stateful-ish |
| Canary | small (the slice) | instant (abort) | yes (the slice) | high-traffic, prove-in-prod |

## Decouple deploy from release (feature flags)

**Deploy** = the code is running. **Release** = users can reach the feature. Keeping these separate is the deepest safety lever in delivery.

- Merge and deploy the new code path *dark* behind a flag — continuously, in small increments. The binary ships safely because the new path is off.
- **Release** by flipping the flag: internal users → 1% → 10% → 100%. A bad feature is a flag flip *off* — seconds, no redeploy, no rollback of the artifact.
- Flags also enable trunk-based development: incomplete work merges behind an off flag instead of rotting on a long-lived branch ([[git-workflow]] principle 5).

```ts
if (flags.isEnabled("new-pricing", { userId, percentage: 10 })) {
  return newPricing(cart)      // released to 10% — flip to 0 to "roll back" instantly
}
return legacyPricing(cart)
```

**Flag hygiene** — flags are debt the moment the rollout finishes. A stale flag is dead config that lies about what the system does, and an `if` that two code paths must both keep working forever. Track each flag with an owner and a removal date; delete the dead branch once the feature is fully on (or fully abandoned). Treat a flag living past its rollout as a cleanup ticket.

## DORA metrics — the vital signs of delivery

Four metrics, from the DORA research program, that together capture throughput and stability. You compute all four from data you already have: CI timestamps, a deploy log, and an incident log. No special tooling required.

| Metric | Measures | Definition | How to compute | Elite band |
|---|---|---|---|---|
| **Lead time for changes** | speed | commit → running in prod | median of (prod-deploy time − commit time) per change | < 1 day |
| **Deployment frequency** | speed | how often you ship to prod | count of prod deploys / time window | on-demand, multiple per day |
| **Change-failure rate** (CFR) | stability | % of deploys that cause a failure | (deploys needing rollback or hotfix) / (total deploys) | 0–15% |
| **Mean time to recovery** (MTTR) | stability | how fast you recover from a failed deploy/incident | median of (recovery time − failure-detected time) | < 1 hour |

**Reading them together** is the point. Throughput (lead time, frequency) without stability (CFR, MTTR) means you're shipping fast *and* breaking things. Stability without throughput means you've bought safety with slowness. Watch them as a pair:

- **Speeding up the gate?** Watch CFR. If it climbs after you drop a check or shrink the suite, the speed came from removing real safety — back it out.
- **CFR creeping up** with stable throughput → tests are getting hollower, or rollouts aren't catching bad versions. Audit the gate and the canary analysis.
- **MTTR climbing** → rollback isn't fast or automatic enough. Revisit build-once-promote (is the old digest still pullable?) and the auto-rollback trigger.
- **Lead time climbing** → integration debt, slow pipeline, or batches getting bigger. Smaller PRs, faster gate, more frequent deploys.

A simple computation source: every CI run emits a commit SHA + timestamp; every deploy emits SHA + environment + timestamp; every incident emits start + resolved + the SHA it was traced to. Join those three logs and all four metrics fall out — a spreadsheet is enough to start. The goal isn't a dashboard for its own sake; it's an early-warning system that tells you the pipeline is rotting *before* it becomes the Friday outage at the top of `SKILL.md`.
