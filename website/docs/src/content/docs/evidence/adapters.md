---
title: Adapters and wiring
description: The five executable adapters, derived and custom wiring, and how resources keep providers from colliding.
---

Change Loop separates the stable behavioral contract from replaceable execution wiring. It does not install test frameworks, browsers, or project dependencies — **your project owns and locks every executable an adapter names.**

## Derived wiring and execution.yaml

Where [`evidence.yaml`](/docs/evidence/claims/) says *what must be true*, semantic
draft v3 also derives the ordinary commands needed to prove it. `execution.yaml`
is optional and overrides that wiring when a provider needs a structured report,
service, timeout, readiness check, or other project-specific configuration. A
wiring change invalidates only the affected provider fingerprints.

```json
{
  "version": 1,
  "providers": {
    "test": {
      "adapter": "test-discovery",
      "command": ["npm", "test", "--", "--reporter=json"],
      "report": "test-results/unit.json",
      "minimum": 1
    }
  },
  "services": {}
}
```

## The five adapters

| Adapter | Purpose |
|---|---|
| `command` | Run one deterministic project command for one provider |
| `test-discovery` | Run a test command once and emit both test and discovery receipts |
| `playwright` | Run project-owned Playwright tests and map structured claim annotations |
| `contract-digest` | Hash one declared artifact in two or more repositories; pass only when the bytes agree |
| `external` | Require a receipt from a system Change Loop does not execute |

### command

```json
"static-analysis": {
  "adapter": "command",
  "command": ["npm", "run", "check"],
  "timeoutMs": 120000
}
```

### test-discovery

One process, two receipts. Requires capability `test`.

```json
"test": {
  "adapter": "test-discovery",
  "command": ["npm", "test", "--", "--json"],
  "report": "test-results/unit.json",
  "minimum": 1
}
```

`minimum` is the floor the discovered test count must clear. It is what
separates "the suite passed" from "the suite ran at all" — a runner that
silently matched zero files exits zero, and without a floor that reads as
success.

When one repository has more than one test provider, only the instance named
`test` gets its discovery receipt implicitly. Any other instance must name the
discovery provider that speaks for it:

```json
"test-api": {
  "adapter": "test-discovery",
  "command": ["npm", "--prefix", "api", "test", "--", "--json"],
  "report": "api/test-results/unit.json",
  "discoveryProvider": "discovery-api",
  "minimum": 1
}
```

Without that link, a second suite's discovery would be attributed to the first,
and a repository could pass discovery it never actually ran.

### playwright

```json
"browser": {
  "adapter": "playwright",
  "command": ["npx", "playwright", "test"],
  "project": "chromium",
  "outputs": ["accessibility"],
  "inputMode": "browser-automation"
}
```

For a direct Playwright command the adapter adds `--reporter=json` and the configured `--project` unless already supplied. Wrapper commands such as `npm run e2e` must forward those themselves or write the configured `report` file.

Every browser test that proves a claim must carry a claim annotation:

```ts
test("owner updates profile", {
  annotation: { type: "claim", description: "profile-update" }
}, async ({ page }) => {
  // interaction and assertions
});
```

A successful exit **without** all required annotations is `inconclusive`, never `pass`. Claims are not credited to skipped tests.

`outputs` lets one execution emit separate capability receipts — one Playwright run can satisfy both `browser` and `accessibility`.

:::tip[Input modes]
Browser automation is not physical operating-system input. Use `browser-automation` for Playwright; reserve `os-input` or `both` for evidence that genuinely requires a focused native window.
:::

Change Loop cannot infer a console-error policy from a successful browser exit, so install a Playwright fixture that fails on unexpected `console.error` and uncaught page errors.

### contract-digest

Executes no command. It hashes the same declared contract artifact in every participating repository and passes only when the bytes agree — which is what makes `cross-repo-contract` a check rather than an assertion.

```json
"cross-repo-contract": {
  "adapter": "contract-digest",
  "contract": {
    "profile-api": "contracts/profile.v1.json",
    "web": "src/contracts/profile.v1.json"
  }
}
```

At least two repositories are required: a "shared" contract with one participant proves nothing about agreement. A `contract-digest` provider spans repositories and therefore cannot declare a single `repository`.

### external

For CI, a reviewer, or another system Change Loop must not execute locally.

```json
"review": {
  "adapter": "external",
  "claims": ["auth-boundary"],
  "ci": {
    "issuer": "github-actions",
    "publicKey": "-----BEGIN PUBLIC KEY-----\n…"
  }
}
```

`publicKey` is a PEM-encoded Ed25519 key. See [`/prove`](/docs/loop/prove/) for the signed-CI and human-authority flows.

## Bootstrapping wiring

When a change declares claims but derived or custom wiring is unresolved:

```bash
claude-foundation evidence detect <change>    # read manifests, execute nothing
claude-foundation evidence init <change>      # preview
claude-foundation evidence init <change> --write
claude-foundation evidence doctor <change>    # explain what is still unresolved
```

`detect` reads repository-owned manifests and configuration **without executing scripts**. `init` is preview-only unless `--write`, and even then adds only high-confidence wiring while preserving existing providers. Ambiguous, external-authority, missing-count, and operator-review cases stay unresolved with an explicit next action.

Bootstrap never installs a dependency, creates a receipt, weakens a claim, or treats detection as proof.

If `quality/foundation-quality.json` is committed and the Change requires
`static-analysis`, bootstrap recommends the built-in consumer-quality command
as one orchestration provider. That command routes all affected repositories,
emits a non-averaged assurance summary, and stores its detailed lanes in the
command log. Configure and pilot it first; discovery never invents a passing
quality result. See [Consumer quality gates](/docs/consumer-quality/).

## Resources and parallelism

Default resources are repository-qualified, so two repositories' suites do not serialize against each other:

- command / test — `workspace-read`
- Playwright — `workspace-read`, `dev-server:<repo>`, `browser:<repo>`
- mutation — `workspace-write:<repo>`
- `contract-digest` — `workspace-read`

Read-only providers run together. `workspace-write` conflicts with all workspace readers, and named exclusive resources such as `browser`, `dev-server`, or `database` cannot overlap.

Override with `resources` and order with `dependsOn`. Use parameterized names such as `port:4173`, `database:test`, or `browser:chromium` when independent instances may run concurrently. Provider dependency cycles and structured-report collisions are rejected by `proof preflight`.

Two providers in different repositories that genuinely share one resource — a single database, one browser profile — must declare it explicitly. The defaults cannot infer it.

## Services and secrets

A service's readiness URL names a literal port. **Every explicit readiness probe requires an expected body or header identity** — a status-only probe is rejected, because a different process could be occupying that port.

A declared readiness probe that was not observed fails on every adapter, not just Playwright.

Literal non-sensitive environment values may use `env`. Secrets, credentials, tokens, passwords, and API keys must use `envFrom`, which names variables to inherit **without storing their values in OpenSpec**.

:::caution[The leftover-server trap]
This is why identity matters rather than liveness. Build runs in a sandbox, but
a service listens on a port belonging to the whole machine. If a development
server from your working tree is already on that port, a status-only readiness
probe succeeds instantly — against the wrong code — and hands you a green suite
that proved nothing about the change.

An expected body or header is what distinguishes *this* build's server from
whatever else answered. Parameterize the resource (`port:4173`) when independent
instances may run at once, and prefer a port the sandbox owns.
:::

A sandbox in `worktree` mode contains only tracked files, so a provider that
depends on an untracked fixture or an ignored build directory will not find it
there. A `copy` sandbox carries the working tree but skips regenerable output.
Either way, generate what a provider needs inside the sandbox rather than
assuming it was inherited.
