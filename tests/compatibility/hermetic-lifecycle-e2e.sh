#!/bin/sh
set -eu

root=$(mktemp -d "${TMPDIR:-/tmp}/cloop-e2e.XXXXXX")
cleanup() { rm -rf "$root"; }
trap cleanup EXIT HUP INT TERM

repo="$root/repo"
config="$root/config"
mkdir -p "$repo/.changeloop" "$config"
: >"$repo/.changeloop/test-fixture-provider.enabled"
git -C "$repo" init -q
printf '%s\n' initial >"$repo/tracked.txt"
git -C "$repo" add tracked.txt
git -C "$repo" -c user.name=Fixture -c user.email=fixture@example.test commit -qm initial

printf '%s\n' '[{"id":"diff","command":"git","args":["diff","--check"],"claims":["diff-valid"]}]' \
  >"$repo/.changeloop/proof-providers.json"
printf '%s\n' '{"command":"sh","args":["-c","cat >/dev/null; printf '\''%s'\'' '\''{\"reviewerModelFamily\":\"fixture-reviewer\",\"findings\":[],\"completedAtMs\":1}'\''"]}' \
  >"$repo/.changeloop/reviewer.json"

binary=${1:-target/debug/cloop}
case "$binary" in /*) ;; *) binary=$(cd "$(dirname "$binary")" && pwd)/$(basename "$binary") ;; esac

export CHANGELOOP_CONFIG_HOME="$config"
export CHANGELOOP_TEST_FIXTURE_PROVIDER=1
export CHANGELOOP_PROVIDER=openai
export CHANGELOOP_MODEL=fixture-model
export OPENAI_API_KEY=fixture-key-not-a-secret

run() {
  expected=$1
  label=$2
  shift 2
  set +e
  stdout=$(cd "$repo" && "$binary" "$@" 2>"$root/stderr")
  code=$?
  set -e
  if [ "$code" -ne "$expected" ]; then
    echo "$label: expected exit $expected, got $code" >&2
    cat "$root/stderr" >&2
    exit 1
  fi
  printf '%s' "$stdout"
}

json_field() {
  field=$1
  python3 -c 'import json,sys; print(json.load(sys.stdin)[sys.argv[1]])' "$field"
}

conversation=$(run 0 conversation ask "explain the current code")
printf '%s' "$conversation" | python3 -c 'import json,sys; assert json.load(sys.stdin)["sessionKind"] == "conversation"'
test ! -e "$repo/fixture-change.txt"

draft=$(run 0 draft "fix a small typo")
draft_id=$(printf '%s' "$draft" | json_field sessionId)
printf '%s' "$draft" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["confirmationRequired"] is True'
test ! -e "$repo/fixture-change.txt"
confirmed=$(run 0 confirm change confirm "$draft_id")
printf '%s' "$confirmed" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["changeState"] == "confirmed" and d["proofResult"]["proof"] == "passed"'

low=$(run 0 low-run run "update documentation typo")
printf '%s' "$low" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["riskTier"] == "low" and d["proofResult"]["proof"] == "passed"'

medium=$(run 3 medium-gate run "fix authentication security boundary")
medium_id=$(printf '%s' "$medium" | json_field sessionId)
printf '%s' "$medium" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["riskTier"] in ("medium","high") and d["approvalRequired"] is True'
run 0 contract contract approve "$medium_id" >/dev/null
run 0 medium-confirm change confirm "$medium_id" >/dev/null
run 0 prove prove "$medium_id" >/dev/null
run 0 review review "$medium_id" >/dev/null

run 0 undo undo "$medium_id" >/dev/null
run 8 stale-land land "$medium_id" >/dev/null
run 0 redo redo "$medium_id" >/dev/null
run 0 reprove prove "$medium_id" >/dev/null
run 0 rereview review "$medium_id" >/dev/null
landed=$(run 0 land land "$medium_id")
printf '%s' "$landed" | python3 -c 'import json,sys; assert json.load(sys.stdin)["landed"] is True'

python3 - "$repo/.changeloop/operational.json" "$config" <<'PY'
import json, pathlib, sys
state = json.loads(pathlib.Path(sys.argv[1]).read_text())
changes = state["changes"]
assert any(change["risk_tier"] == "low" and change["proof"] for change in changes.values())
assert any(change["risk_tier"] in ("medium", "high") and change["landed"] for change in changes.values())
assert pathlib.Path(sys.argv[2]).is_dir()
print(json.dumps({
    "passed": True,
    "conversationExit": 0,
    "draftExit": 0,
    "approvalRequiredExit": 3,
    "staleLandExit": 8,
    "landExit": 0,
    "changes": len(changes),
    "temporaryRoot": True,
    "transitions": [
        "conversation:read_only",
        "implementation:draft_confirmation_required",
        "draft:confirmed_and_auto_proved_low",
        "run:low_auto_proved",
        "run:medium_or_high_contract_required",
        "contract:approved",
        "change:confirmed",
        "proof:passed",
        "review:passed_clean_session",
        "undo:proof_invalidated",
        "land:rejected_stale",
        "redo:restored_and_proof_invalidated",
        "proof:repassed",
        "review:repassed",
        "land:explicit_transaction_complete",
    ],
}))
PY
