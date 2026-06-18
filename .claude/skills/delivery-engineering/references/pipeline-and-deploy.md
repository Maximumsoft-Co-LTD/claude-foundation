# Pipeline & Deploy

Concrete layer under `SKILL.md`: stage design, caching and parallelism, build-once-promote, config/secret handling, deploy strategies with rollback, deploy-vs-release decoupling, and the four DORA metrics. Examples lean on GitHub Actions / Kubernetes; shapes translate to CircleCI, Buildkite, ECS, Nomad, PaaS, or serverless.

## CI stage design

Pipeline skeleton, in dependency order:

```
              ┌─ lint ──────┐
checkout ─────┼─ typecheck ─┼─ build ─ test ─ artifact ─ deploy-staging ─ deploy-prod
   │          └─ format ────┘    │      │        │             │              │
 (fast)        (seconds, ∥)   (1 art.) (sharded) (push)    (auto, canary)  (promote)
```

Two rules:
1. **Fail fast** — cheap, likely-to-fail checks first (lint, typecheck, format, secret-scan). A missing semicolon should cost 40s, not the full 12-min e2e run.
2. **Parallelize the independent** — lint/typecheck/format in parallel; test shards fanned out.

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

Branch protection marks `static` and `test` as **required** — principle 1 made physical.

## Caching & parallelism recipes

- **Dependency cache** — key on the lockfile hash (`deps-${{ hashFiles('**/package-lock.json') }}`), restore before install. Never key on a branch name (stale across branches).
- **Build-layer cache** — Docker layer caching (`type=gha`, `type=registry`, BuildKit `--mount=type=cache`). Order layers cheapest-changing first: `package.json` + lockfile + `npm ci` before copying source — source changes reuse the dep layer.
- **Compiler / tool cache** — `ccache`, Gradle/Bazel remote cache, `tsc --incremental`, Turborepo/Nx remote cache.
- **Test sharding** — split N ways across N runners (`--shard`, `pytest-xdist`). 12 min serial → ~3 min on 4 shards.
- **Test selection** — affected-only on PRs (`nx affected`, Bazel target graph); full suite on `main`.

Don't cache the artifact you deploy (principle 4 wants it built fresh); bust the cache key on any input change.

## Build once, promote the artifact

The artifact is the unit of release. Build once; everything downstream references it by immutable id.

```
   build ──▶ app@sha256:abc123 ──▶ [registry]
                    │
        ┌───────────┼───────────┐
        ▼           ▼           ▼
   deploy dev   deploy stg   deploy prod      ← all the SAME digest
```

**Do:**
- Tag immutably: content digest (`sha256:…`) or `<semver>-<short-sha>`.
- Push once in the build stage; deploys pull by reference.
- Promote by *reference*: "digest `abc123` passed staging → deploy `abc123` to prod." No rebuild.
- Inject env differences at run time. One artifact, many configs.
- Record artifact ↔ commit ↔ environment in a deploy log.

**Don't:**
- `docker build` per environment — you've shipped an untested sibling.
- Deploy a moving tag (`latest`, `staging`) — can't pin or roll back to it.
- `git clone && build` on the target host — host toolchain becomes an unpinned input.

**Rollback is free:** previous good digest still in the registry → rollback is re-pointing, not rebuilding.

## Environment config & secrets — do / don't

Same binary everywhere; differences injected from outside (principle 3, 12-factor).

**Config (non-secret):** endpoints, feature toggles, pool sizes, log levels, timeouts.

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

A secret in a layer is **permanent** — removing it in a later layer doesn't erase the adding layer. Use multi-stage builds and BuildKit `--mount=type=secret` for build-time credentials:

```dockerfile
RUN --mount=type=secret,id=npm_token \
    NPM_TOKEN=$(cat /run/secrets/npm_token) npm ci
```

This project's `protect-secrets.sh` hook enforces the same boundary at edit time (`.env` unreadable; `*.example`/`*.template`/`*.pub` allow-listed).

## Deploy strategies

Pick by blast-radius need and cost of running two versions at once.

### Rolling (the sensible default)

Replace instances a few at a time; new and old run side-by-side during the roll. No extra fleet, but old and new serve traffic simultaneously — schema and APIs must be backward-compatible for the overlap window (DB migrations follow expand→contract; see [[database-fundamentals]]).

```yaml
strategy:
  rollingUpdate: { maxSurge: 1, maxUnavailable: 0 }   # add one new before dropping one old
readinessProbe:                                       # no traffic until truly ready
  httpGet: { path: /healthz, port: 8080 }
  initialDelaySeconds: 5
```

Rollback: roll the previous digest back through the same mechanism (`kubectl rollout undo`).

### Blue-green (instant switch, instant rollback)

Stand up the new version (green) beside the live one (blue). Smoke-test green, then switch the router atomically. Keep blue hot for instant rollback.

```
[router] ──100%──▶ blue (v1)        # before
[router] ──100%──▶ green (v2)       # after atomic switch; blue stays hot
rollback: point router back at blue # seconds, no redeploy
```

Best for clean all-at-once cutovers; costs double fleet briefly.

### Canary (smallest blast radius, data-driven)

Route 1–5% to the new version, watch error rate and latency, ramp to 100 if healthy or auto-abort on breach. Best for high-traffic services where you want production to prove the release.

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

Define the abort condition as *data*, not a human judgment call:
- **Trigger:** error rate > X%, p99 > Y ms, or failed health/smoke checks.
- **Action:** revert to the last-good digest automatically.
- **Post-deploy smoke test** is part of the path — "it deployed" ≠ "it works."

| Strategy | Extra cost | Rollback speed | Mixed versions live? | Best for |
|---|---|---|---|---|
| Rolling | none | medium (re-roll) | yes (during roll) | most services, default |
| Blue-green | 2× fleet briefly | instant (flip) | no | clean cutovers, stateful-ish |
| Canary | small (the slice) | instant (abort) | yes (the slice) | high-traffic, prove-in-prod |

## Decouple deploy from release (feature flags)

**Deploy** = code is running. **Release** = users can reach it. Keeping these separate is the deepest safety lever.

- Deploy new code *dark* behind a flag — the binary ships safely because the path is off.
- **Release** by flipping: internal → 1% → 10% → 100%. A bad feature is a flag flip *off* — seconds, no artifact rollback.
- Enables trunk-based development: incomplete work merges behind an off flag ([[git-workflow]] principle 5).

```ts
if (flags.isEnabled("new-pricing", { userId, percentage: 10 })) {
  return newPricing(cart)      // flip to 0 to "roll back" instantly
}
return legacyPricing(cart)
```

**Flag hygiene** — a stale flag is dead config that lies about the system. Track each with an owner and removal date; delete the dead branch once the feature is fully on or abandoned.

## DORA metrics — the vital signs of delivery

Four metrics capturing throughput and stability. Computed from data you already have: CI timestamps, a deploy log, and an incident log.

| Metric | Measures | Definition | How to compute | Elite band |
|---|---|---|---|---|
| **Lead time for changes** | speed | commit → running in prod | median of (prod-deploy time − commit time) per change | < 1 day |
| **Deployment frequency** | speed | how often you ship to prod | count of prod deploys / time window | on-demand, multiple per day |
| **Change-failure rate** (CFR) | stability | % of deploys that cause a failure | (deploys needing rollback or hotfix) / (total deploys) | 0–15% |
| **Time to recovery (track the median; the DORA name says "mean")** (MTTR) | stability | how fast you recover from a failed deploy/incident | median of (recovery time − failure-detected time) | < 1 hour |

**Read them together:** throughput without stability means shipping fast *and* breaking things; stability without throughput means buying safety with slowness.

- **CFR climbing after speeding up the gate** → speed came from removing a real check; back it out.
- **CFR creeping up with stable throughput** → tests getting hollower or rollouts not catching bad versions.
- **MTTR climbing** → rollback isn't fast or automatic enough.
- **Lead time climbing** → integration debt, slow pipeline, or batch sizes growing.

**Computation source:** CI run → SHA + timestamp; deploy → SHA + environment + timestamp; incident → start + resolved + SHA. Join those three logs and all four metrics fall out — a spreadsheet is enough. The goal is an early-warning system that tells you the pipeline is rotting before it becomes the Friday outage.
