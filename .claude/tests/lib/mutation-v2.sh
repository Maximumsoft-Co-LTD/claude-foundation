#!/bin/sh

mutation_v2_begin() {
  MUTATION_V2_ROWS="$1/mutation-v2.rows"
  : > "$MUTATION_V2_ROWS"
}

mutation_v2_record() {
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$1" "$2" "$3" "$4" "$5" "$6" "$7" "$8" >> "$MUTATION_V2_ROWS"
}

mutation_v2_finish() {
  report="${FOUNDATION_RESULT_REPORT:-$1/mutation-v2.json}"
  node - "$MUTATION_V2_ROWS" "$report" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const [rowsPath, reportPath] = process.argv.slice(2);
const rows = fs.readFileSync(rowsPath, "utf8").trim().split("\n").filter(Boolean).map((line) => {
  const [id, sourcePath, applied, compiled, result, expectedKiller, killedBy, restored] = line.split("\t");
  return { id, sourcePath, applied: applied === "true", compiled: compiled === "true", result,
    expectedKiller, killedBy, restored: restored === "true" };
});
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify({
  protocol: "foundation-mutation-v2",
  criticalCases: [...new Set(rows.map((row) => row.expectedKiller))].map((id) => ({ id, status: "passed" })),
  mutants: rows
}, null, 2)}\n`);
NODE
}

mutation_applied_once() {
  [ "$(grep -o 'FOUNDATION-INJECTED-FAULT' "$1" | wc -l | tr -d '[:space:]')" = "1" ]
}

mutation_compiles() {
  node --check "$1" >/dev/null 2>&1
}
