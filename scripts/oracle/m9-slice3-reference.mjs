#!/usr/bin/env node

const command = process.argv[2];
const results = {
  "authority-denial": { allowed: false, reason: "explicit_external_authority_required" },
  "telemetry-unknowns": {
    inputTokens: { state: "unknown", value: { reason: "input omitted" } },
    outputTokens: { state: "known", value: 4 },
    requestCount: 1
  },
  "land-conflict": { content: "external", overwroteExternal: false, status: "rolled_back" },
  "land-rollback": { content: "old", status: "rolled_back" },
  "land-recovery": { content: "old", status: "rolled_back", wasInterrupted: true }
};
if (!Object.hasOwn(results, command)) {
  console.error("unknown parity case");
  process.exit(2);
}
console.log(JSON.stringify(results[command]));
