export default {
  mutate: [
    "dashboard/sanitize.js",
    "dashboard/migrations.js",
    "dashboard/usage-scan.mjs"
  ],
  testRunner: "command",
  commandRunner: {
    command: "node --test dashboard/test/migrations.test.js dashboard/test/sanitize.test.js dashboard/test/usage-scan.test.mjs"
  },
  coverageAnalysis: "off",
  ignorePatterns: [
    ".claude/**",
    ".foundation/**",
    ".github/**",
    ".hyperresearch/**",
    ".serena/**",
    ".tmp-profile-bin/**",
    ".workflow/**",
    "Formula/**",
    "clients/**",
    "crates/**",
    "docs/**",
    "examples/**",
    "openspec/**",
    "quality/**",
    "release-notes/**",
    "research/**",
    "scripts/**",
    "target/**",
    "website/**"
  ],
  reporters: ["clear-text", "progress", "json"],
  clearTextReporter: {
    reportMutants: false,
    reportScoreTable: true,
    reportTests: false
  },
  jsonReporter: {
    fileName: ".foundation/test-results/quality/mutation-automated.json"
  },
  thresholds: {
    high: 80,
    low: 60,
    break: null
  },
  concurrency: 4,
  timeoutMS: 10000,
  tempDirName: ".stryker-tmp-dashboard"
};
