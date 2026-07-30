# Executable evidence adapters

Foundation evidence v2 keeps claims and their execution contract together.
Foundation does not install test frameworks, browsers, or project dependencies;
the project owns and locks every executable named by an adapter.

## Evidence v2

```json
{
  "version": 2,
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
      "project": "chromium",
      "inputMode": "browser-automation",
      "readiness": {
        "url": "http://127.0.0.1:4173"
      },
      "timeoutMs": 120000
    }
  },
  "claims": [
    {
      "id": "profile-update",
      "scenario": "The owner can update their profile",
      "impact": "medium",
      "capabilities": ["test", "browser"]
    }
  ]
}
```

Evidence v1 remains valid for manual receipts. Upgrade it explicitly:

```bash
claude-foundation evidence upgrade <change>
```

The upgrade creates an empty `providers` object; it never guesses commands.

## Adapters

| Adapter | Purpose |
|---|---|
| `command` | Run one deterministic project command for one provider |
| `test-discovery` | Run a test command once and emit both test and discovery receipts |
| `playwright` | Run project-owned Playwright tests and map structured claim annotations |
| `external` | Require a receipt from a system Foundation does not execute |

Configured commands run from the active workspace. Missing or stale receipts
are executed by:

```bash
claude-foundation proof execute <change>
```

Valid receipts are reused. Commands with identical executable arguments,
environment, working directory, and timeout are deduplicated within one proof
execution. Providers with non-conflicting resources run concurrently.

## Test and discovery

The structured report must expose a recognized total such as
`numTotalTests`, `totalTests`, `testCount`, or `expected`. If the command passes
but no deterministic count is available, test evidence may pass while discovery
is `inconclusive`; landing remains blocked.

## Playwright

Install and lock Playwright in the application repository. A typical command is:

```json
["npx", "playwright", "test"]
```

For a direct Playwright command, the adapter adds `--reporter=json` and the
configured `--project` unless they are already supplied. Wrapper commands such
as `npm run e2e` must forward those options themselves or write the configured
`report` file. Use Playwright `webServer` configuration for server startup and
readiness. Foundation starts the command once and does not poll the application
independently.

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
the receipt. Configure traces, screenshots, and videos in the project.

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

## Receipt reuse

Reuse is bound to:

- workspace hash and change revision;
- provider and adapter protocol versions;
- adapter and command configuration;
- claim scope;
- declared environment and adapter environment variables;
- Node/platform architecture;
- required artifact existence.

Changing any bound input makes the receipt stale.
