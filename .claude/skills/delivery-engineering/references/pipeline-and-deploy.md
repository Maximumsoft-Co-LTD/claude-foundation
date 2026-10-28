# Pipeline & Deploy

Concrete layer under `SKILL.md`. Examples lean on GitHub Actions and
Kubernetes; the shapes translate to CircleCI, Buildkite, ECS, Nomad, PaaS, or
serverless.

## The 7 principles

1. **The CI gate is the merge contract.** Build, test, lint, and typecheck run
   on the commit that will land, ideally on the merge result (merge queue).
   Keep the gate fast or it gets routed around: parallelize, cache, order
   cheap-and-likely-to-fail first. Branch protection makes required checks
   non-negotiable. Quarantine a flaky test with a tracking issue instead of
   training the team to hit re-run.
2. **Build once, promote the same artifact.** One immutable, digest-tagged
   artifact moves dev → staging → prod. Promotion is a metadata move, never a
   rebuild; rollback is re-pointing at the previous digest.
3. **Config and secrets live outside the artifact.** Endpoints, toggles, pool
   sizes, and log levels come from the environment; secrets from a manager at
   deploy or startup. A secret baked into an image layer is permanent —
   `docker history` still shows it. Validate required config at startup.
4. **Reproducible builds on a pinned toolchain.** Commit lockfiles and install
   from them exactly (`npm ci`, hashed requirements); pin base images by digest
   and the language version in-repo (`.nvmrc`, `rust-toolchain.toml`). Version
   bumps arrive as reviewable PRs.
5. **Deploy safely and reversibly.** Gate every rollout on a real readiness
   check, pick rolling / blue-green / canary by acceptable blast radius, define
   the abort condition as data (error rate, p99, failed health checks over a
   window), and let the system revert to the last good artifact. Coordinate
   with expand→backfill→contract migrations so both versions stay compatible.
6. **Automate the path to production.** Build → test → artifact → deploy →
   migration → smoke test → rollout runs through the pipeline every time; a
   step only one person can type on a server is a latent outage. "It deployed"
   is not "it works" — the smoke test is part of the path.
7. **The pipeline is code, and delivery is observed.** Workflow files,
   Dockerfile, manifests, and IaC are reviewed like application code. Measure
   the four DORA metrics so a speed change cannot silently trade away safety.

## CI stage design

```
              ┌─ lint ──────┐
checkout ─────┼─ typecheck ─┼─ build ─ test ─ artifact ─ deploy-staging ─ deploy-prod
              └─ format ────┘  (1 art.) (sharded) (push)   (auto, canary)   (promote)
```

| Stage | Owns | Fails the build when |
|---|---|---|
| **static** | lint, typecheck, format, secret scan | style violation, type error, committed secret |
| **build** | compile / bundle, produce the artifact | compile error, lockfile out of date |
| **test** | unit + integration (+ e2e), sharded | any test fails, coverage gate breached |
| **artifact** | tag + push the immutable artifact | registry push fails |
| **deploy** | promote, migrate, health-check, smoke-test | health/smoke fails → auto-rollback |

```yaml
on: { pull_request: , merge_group: }      # merge_group runs on the MERGE RESULT
jobs:
  static:
    steps:
      - uses: actions/setup-node@v4
        with: { node-version-file: .nvmrc, cache: npm }   # pin + cache
      - run: npm ci && npm run lint && npm run typecheck
      - run: npx gitleaks detect --no-banner
  test:
    strategy: { fail-fast: false, matrix: { shard: [1, 2, 3, 4] } }
    steps:
      - run: npm test -- --shard=${{ matrix.shard }}/4
  build:
    needs: [static, test]
    steps:
      - uses: docker/build-push-action@v6
        with: { push: true, tags: "${{ vars.REGISTRY }}/app:${{ github.sha }}",
                cache-from: type=gha, cache-to: "type=gha,mode=max" }
```

Branch protection marks `static` and `test` required — principle 1 made physical.

## Caching & parallelism

- **Dependencies** — key on the lockfile hash, never on a branch name.
- **Build layers** — `type=gha`/`type=registry` or BuildKit `--mount=type=cache`; copy manifests and install before copying source.
- **Tools** — `ccache`, Gradle/Bazel remote cache, `tsc --incremental`, Turborepo/Nx remote cache.
- **Tests** — shard across runners; affected-only on PRs, full suite on the integration branch.

Never cache the artifact you deploy; bust the key on any input change.

## Build once, promote the artifact

```yaml
build:
  script: [docker build -t $REGISTRY/app:$CI_COMMIT_SHA ., docker push $REGISTRY/app:$CI_COMMIT_SHA]
deploy-staging:
  script: deploy --image $REGISTRY/app:$CI_COMMIT_SHA --env staging
deploy-prod:
  needs: [deploy-staging]
  when: manual                      # promote after staging is green
  script: deploy --image $REGISTRY/app:$CI_COMMIT_SHA --env prod   # SAME digest
```

Tag by digest or `<semver>-<short-sha>`; push once; promote by reference;
record artifact ↔ commit ↔ environment in a deploy log. Never build per
environment, deploy a moving tag, or build on the target host. For serverless
the deploy package is the artifact.

## Config & secrets

| Do | Don't |
|---|---|
| Read config from env vars, mounted files, or a config service; validate at startup | Compile `if (env === 'prod')` branches into the binary; boot half-configured |
| Check in `config.template.yaml` / `.env.example` with blank values | Commit real per-environment values |
| Pull secrets from a manager (Vault, cloud secrets, SOPS, sealed-secrets); inject at deploy (`secretKeyRef`) or fetch at startup | Bake into an image layer or commit to the repo — history keeps it |
| Mask in CI output; scope each secret to the jobs that need it; rotate on any exposure | `echo $SECRET`, pass on a command line, reuse one secret across environments |

```dockerfile
FROM node:20.11.1-slim@sha256:4e1f...
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=npm_token NPM_TOKEN=$(cat /run/secrets/npm_token) npm ci
COPY . .
CMD ["node", "server.js"]   # reads DATABASE_URL, API_KEY from the environment
```

This project's `protect-secrets.sh` hook draws the same boundary at edit time.

## Deploy strategies

| Strategy | Shape | Rollback | Mixed versions live? | Best for |
|---|---|---|---|---|
| Rolling | replace a few instances at a time (`maxSurge: 1, maxUnavailable: 0` + readiness probe) | medium (re-roll) | yes — schemas and APIs must stay compatible | most services, default |
| Blue-green | stand up the new stack, smoke-test, flip the router, keep old hot | instant (flip) | no | clean cutovers |
| Canary | bounded slice, watch real signals, ramp or auto-abort | instant (abort) | yes (the slice) | high-traffic, prove-in-prod |

```yaml
canary:
  steps:
    - setWeight: 5
    - analysis: { metrics: [error-rate, p99-latency], interval: 2m, failureLimit: 1 }
    - setWeight: 25
    - pause: { duration: 5m }
    - setWeight: 100
```

## Decouple deploy from release

**Deploy** = the code is running. **Release** = users can reach it. Ship dark
behind a flag, release internal → small % → all; withdrawing a bad feature is a
flag flip, not an artifact rollback. Give every flag an owner and a removal
date — a stale flag is dead config that lies about the system.

## DORA metrics

| Metric | Definition | Elite band |
|---|---|---|
| **Lead time for changes** | median of (prod-deploy time − commit time) | < 1 day |
| **Deployment frequency** | prod deploys per time window | on-demand, multiple per day |
| **Change-failure rate** | deploys needing rollback or hotfix ÷ total deploys | 0–15% |
| **Time to recovery** (track the median) | median of (recovery − failure detected) | < 1 hour |

Join the CI run, deploy, and incident logs and all four fall out. Change-failure
rate climbing right after the gate got faster means a real check was removed —
put it back; rising time-to-recovery means rollback is not fast or automatic
enough. Unavailable measurements remain unknown.
