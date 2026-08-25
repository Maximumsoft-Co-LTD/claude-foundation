export default {
  mutate: ["website/demo/src/deck.js"],
  testRunner: "command",
  commandRunner: { command: "node --test website/demo/test/*.test.mjs" },
  coverageAnalysis: "off",
  ignorePatterns: [
    ".claude/**", ".foundation/**", ".github/**", "dashboard/**", "docs/**", "examples/**",
    "Formula/**", "node_modules/**", "openspec/**", "quality/**", "scripts/**", "target/**"
  ],
  reporters: ["clear-text", "progress", "json"],
  clearTextReporter: { reportMutants: false, reportScoreTable: true, reportTests: false },
  jsonReporter: { fileName: ".foundation/test-results/quality/mutation-website.json" },
  thresholds: { high: 80, low: 60, break: null },
  concurrency: 4,
  timeoutMS: 10000,
  tempDirName: ".stryker-tmp-website"
};
