export default {
  mutate: [
    ".claude/harness/runtime/reliability/bounded-retry.mjs",
    ".claude/harness/runtime/core/measured-number.mjs",
    ".claude/harness/runtime/core/cli-flags.mjs"
  ],
  testRunner: "command",
  commandRunner: {
    command: "node --test .claude/tests/harness/run-bounded-retry-tests.mjs .claude/tests/harness/run-telemetry-truth-tests.mjs .claude/tests/harness/run-guard-fix-cli-tests.mjs"
  },
  coverageAnalysis: "off",
  ignorePatterns: [
    ".foundation/**", ".github/**", "dashboard/**", "docs/**", "examples/**", "Formula/**",
    "node_modules/**", "openspec/**", "quality/**", "scripts/**", "target/**", "website/**"
  ],
  reporters: ["clear-text", "progress", "json"],
  clearTextReporter: { reportMutants: false, reportScoreTable: true, reportTests: false },
  jsonReporter: { fileName: ".foundation/test-results/quality/mutation-runtime.json" },
  thresholds: { high: 80, low: 60, break: null },
  concurrency: 4,
  timeoutMS: 10000,
  tempDirName: ".stryker-tmp-runtime"
};
