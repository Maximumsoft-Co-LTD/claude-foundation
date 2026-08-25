export default {
  mutate: ["examples/todolist/src/store.js"],
  testRunner: "command",
  commandRunner: { command: "node --test examples/todolist/test/*.test.mjs" },
  coverageAnalysis: "off",
  ignorePatterns: [
    ".claude/**", ".foundation/**", ".github/**", "dashboard/**", "docs/**", "Formula/**",
    "node_modules/**", "openspec/**", "quality/**", "scripts/**", "target/**", "website/**"
  ],
  reporters: ["clear-text", "progress", "json"],
  clearTextReporter: { reportMutants: false, reportScoreTable: true, reportTests: false },
  jsonReporter: { fileName: ".foundation/test-results/quality/mutation-examples.json" },
  thresholds: { high: 80, low: 60, break: null },
  concurrency: 4,
  timeoutMS: 10000,
  tempDirName: ".stryker-tmp-examples"
};
