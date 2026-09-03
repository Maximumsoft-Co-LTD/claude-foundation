#!/usr/bin/env sh

set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
report="${FOUNDATION_RESULT_REPORT:-}"

run_named_case() {
  pattern="$1"
  file="$2"
  output="$(node --test --test-reporter=tap --test-name-pattern "$pattern" "$file" 2>&1)"
  command_status=$?
  tests="$(printf '%s\n' "$output" | awk '$1 == "#" && $2 == "tests" { value = $3 } END { print value + 0 }')"
  passes="$(printf '%s\n' "$output" | awk '$1 == "#" && $2 == "pass" { value = $3 } END { print value + 0 }')"
  if [ "$command_status" -eq 0 ] && [ "$tests" -eq 1 ] && [ "$passes" -eq 1 ]; then
    printf 'passed:%s' "$tests"
  else
    printf 'failed:%s' "$tests"
  fi
}

source_result="$(run_named_case "metrics identify the exact runtime source cohort" "$HERE/run-telemetry-truth-tests.mjs")"
upgrade_result="$(run_named_case "upgrade diagnostics preserve historical defaults" "$HERE/upgrade-matrix.test.mjs")"
blocker_result="$(run_named_case "blocked command telemetry carries bounded cause" "$HERE/../../harness/tests/telemetry-append.test.mjs")"
adapter_result="$(run_named_case "critical case preflight rejects adapters" "$HERE/run-evidence-contract-tests.mjs")"
budget_result="$(run_named_case "budget targets scale both request and token lanes" "$HERE/../../harness/tests/budget-runtime.test.mjs")"
continuation_result="$(run_named_case "stored compiled execution surface refreshes normal targets" "$HERE/../../harness/tests/budget-runtime.test.mjs")"
delivery_result="$(run_named_case "doctor excludes journaled apply and authorized Land records" "$HERE/run-land-surface-tests.mjs")"
delivery_proof_result="$(run_named_case "external target move remains non-authoritative" "$HERE/run-land-surface-tests.mjs")"

overall=0
observed_tests=0
for result in "$source_result" "$upgrade_result" "$blocker_result" "$adapter_result" "$budget_result" "$continuation_result" "$delivery_result" "$delivery_proof_result"; do
  status="${result%%:*}"
  count="${result#*:}"
  [ "$status" = passed ] || overall=1
  observed_tests=$((observed_tests + count))
done

source_status="${source_result%%:*}"
upgrade_status="${upgrade_result%%:*}"
blocker_status="${blocker_result%%:*}"
adapter_status="${adapter_result%%:*}"
budget_status="${budget_result%%:*}"
continuation_status="${continuation_result%%:*}"
delivery_status="${delivery_result%%:*}"
delivery_proof_status="${delivery_proof_result%%:*}"

if [ -n "$report" ]; then
  mkdir -p "$(dirname "$report")"
  cat > "$report" <<EOF
{"numTotalTests":$observed_tests,"criticalCases":[
  {"id":"source-cohort-differs","status":"$source_status"},
  {"id":"legacy-default-advisory","status":"$upgrade_status"},
  {"id":"blocker-redaction","status":"$blocker_status"},
  {"id":"adapter-preflight","status":"$adapter_status"},
  {"id":"token-target-scales","status":"$budget_status"},
  {"id":"continuation-preserved","status":"$continuation_status"},
  {"id":"delivery-drift-visible","status":"$delivery_status"},
  {"id":"delivery-not-proof","status":"$delivery_proof_status"}
]}
EOF
fi

exit "$overall"
