# Executable evidence adapters

Foundation separates the stable behavioral contract from replaceable execution
wiring. Foundation does not install test frameworks, browsers, or project
dependencies; the project owns and locks every executable named by an adapter.

## Behavioral contract

`evidence.yaml` changes only when observable claims or obligations change:

```json
{
  "version": 2,
  "claims": [
    {
      "id": "profile-update",
      "scenario": "The owner can update their profile",
      "impact": "medium",
      "capabilities": ["test", "browser", "accessibility"]
    }
  ]
}
```

Discovery is an implicit suite-level obligation whenever `test` is selected; do
not repeat `discovery` on every claim.

## Execution wiring

`execution.yaml` may change as Build discovers the actual commands, ports, and
reports. Wiring changes invalidate only affected provider fingerprints.

```json
{
  "version": 1,
  "providers": {
    "test": {
      "adapter": "test-discovery",
      "command": ["npm", "test", "--", "--reporter=json"],
      "report": "test-results/unit.json",
      "minimum": 1,
      "timeoutMs": 120000
    },
    "browser": {
      "adapter": "playwright",
      "command": ["npx", "playwright", "test"],
      "outputs": ["accessibility"],
      "project": "chromium",
      "inputMode": "browser-automation",
      "service": "web",
      "readiness": {
        "url": "http://127.0.0.1:4173",
        "expectHeader": {"x-foundation-app": "profile"}
      },
      "timeoutMs": 120000
    }
  },
  "services": {
    "web": {
      "command": ["npm", "run", "start", "--", "--port", "4173"],
      "readiness": {
        "url": "http://127.0.0.1:4173",
        "expectHeader": {"x-foundation-app": "profile"}
      }
    }
  }
}
```

Evidence v1 and evidence v2 with embedded `providers` remain readable. Separate
them explicitly:

```bash
claude-foundation evidence upgrade <change>
```

The upgrade moves known wiring into `execution.yaml`; it never guesses commands.

## Adapters

| Adapter | Purpose |
|---|---|
| `command` | Run one deterministic project command for one provider |
| `test-discovery` | Run a test command once and emit both test and discovery receipts |
| `playwright` | Run project-owned Playwright tests and map structured claim annotations |
| `external` | Require a receipt from a system Foundation does not execute |

Configured commands run from the active workspace. The normal path is:

```bash
claude-foundation proof readiness <change>
claude-foundation proof run <change>
```

Prototype files under `.foundation/prototypes/` are non-authoritative. The
runtime rejects them, including local-path references and symlinked origins,
before copying any artifact or writing a receipt.

Valid receipts are reused. Commands with identical executable arguments,
environment, working directory, and timeout are deduplicated within one proof
execution. Providers with non-conflicting resources run concurrently. A
provider may declare workspace-relative `inputs`; its receipt can be rebound
when those inputs are unchanged even if unrelated workspace files changed.

An external passing receipt must include `--observed`, `--source` or
`--reviewer`, and at least one `--artifact` or `--reference`. Empty reviewer or
supply-chain assertions cannot become passing evidence.

Review receipts additionally identify reviewer type/identity, request and model
provenance for AI reviewers, one or more structured implementation-subject tuples,
finding counts, and changed-path scope after the first round. The review packet
unions committed base-to-HEAD and dirty paths per repository. Critical policy
requires a different provider/model family or a human. A change-level hash chain
binds the complete receipt payload and limits AI to two recorded attempts even if
the current receipt is deleted or its provider is renamed; corrupt history fails
closed. Legacy review receipts remain readable but cannot satisfy protocol v2.

Acceptance is external and human-only. A passing receipt requires explicit claim
scope, `--acceptor`, `--decision accept`, unique nonblank `--criterion` values,
`--observed`, provenance, and a durable artifact or reference. Every read
revalidates those fields, the contract reason, and final workspace identity.
Acceptance is required only when the Change declares it.

## Test and discovery

The configured structured JSON report must expose a non-negative integer such as
`numTotalTests`, `totalTests`, `testCount`, or `expected`. If the command passes
but no deterministic count is available, test evidence may pass while discovery
is `inconclusive`; landing remains blocked. Arrays, numeric strings, arbitrary
nested keys, and mixed stdout are not coerced into a count.

## Playwright

Install and lock Playwright in the application repository. A typical command is:

```json
["npx", "playwright", "test"]
```

For a direct Playwright command, the adapter adds `--reporter=json` and the
configured `--project` unless they are already supplied. Wrapper commands such
as `npm run e2e` must forward those options themselves or write the configured
`report` file. Use Playwright `webServer` configuration or a named Foundation
service for server startup. Every explicit readiness probe requires an expected
body or header identity. A status-only probe is rejected because a different
process could occupy the port.

Every browser test that proves a claim must carry a claim annotation:

```ts
test("owner updates profile", {
  annotation: { type: "claim", description: "profile-update" }
}, async ({ page }) => {
  // interaction and assertions
});
```

A successful exit without all required annotations is `inconclusive`, never
`pass`. Playwright attachments present in the JSON report are referenced from
the receipt. One Playwright adapter may declare `outputs`, for example
`["accessibility"]`; it emits separate capability receipts from one command
execution. Configure traces, screenshots, and videos in the project.

Browser automation is not physical operating-system input. Use
`browser-automation` for Playwright and reserve `os-input` or `both` for
evidence that genuinely requires a focused native window.

Projects should also install an automatic Playwright fixture that fails on
unexpected `console.error` and uncaught page errors. Foundation cannot infer
that policy from a successful browser exit.

## Resources and dependencies

Default resources are:

- command/test: `workspace-read`;
- Playwright: `workspace-read`, `dev-server`, `browser`;
- mutation: `workspace-write`.

Override with `resources` and order providers with `dependsOn`. Read-only
providers may run together. `workspace-write` conflicts with all workspace
readers, and named exclusive resources such as `browser`, `dev-server`, or
`database` cannot overlap.

Use parameterized names such as `port:4173`, `database:test`, or
`browser:chromium` when independent instances may run concurrently. Provider
dependency cycles and structured-report collisions are rejected by
`proof preflight`.

Literal non-sensitive environment values may use `env`. Secrets, credentials,
tokens, passwords, and API keys must use `envFrom`, which names variables to
inherit without storing their values in OpenSpec.

## Receipt reuse

Reuse is bound to:

- workspace hash and change revision;
- provider and adapter protocol versions;
- adapter and command configuration;
- claim scope;
- declared environment names and project lockfile digests;
- Node/platform architecture;
- required artifact SHA-256 and byte size.

Reports, logs, and attachments are copied immediately into
`.foundation/evidence/<change>/<proof-run>/`. `proof audit` verifies copied
receipt and artifact digests even after sandbox cleanup or archival.
