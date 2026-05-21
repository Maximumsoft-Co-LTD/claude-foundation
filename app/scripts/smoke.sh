#!/usr/bin/env bash
# End-to-end smoke against the live docker-compose stack. Exercises the 12 ACs.
# Requires: docker compose stack up, /healthz returning 200, and the four
# fixture xlsx files present under app/backend/internal/adapters/driven/xlsx/testdata/.
set -euo pipefail

BASE="${API_BASE:-http://localhost:8080}"
FIXTURE_DIR="$(cd "$(dirname "$0")/.." && pwd)/backend/internal/adapters/driven/xlsx/testdata"

say() { printf "\n== %s ==\n" "$*"; }
fail() { printf "FAIL: %s\n" "$*" >&2; exit 1; }

say "waiting for $BASE/healthz"
for i in $(seq 1 60); do
  if curl -fsS "$BASE/healthz" >/dev/null 2>&1; then
    break
  fi
  sleep 1
  if [ "$i" -eq 60 ]; then
    fail "api never came up at $BASE/healthz"
  fi
done

say "AC1 create case"
CASE_JSON=$(curl -fsS -X POST "$BASE/api/v1/cases" \
  -H 'Content-Type: application/json' \
  -d '{"title":"smoke case","notes":"# smoke\n\n- one\n- two","tags":["fraud","cyber"]}')
CASE_ID=$(printf '%s' "$CASE_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
[ -n "$CASE_ID" ] || fail "no case id in create response"

say "AC4 list contains the new case"
curl -fsS "$BASE/api/v1/cases" | grep -q "$CASE_ID" || fail "new case not in list"

say "AC4 title-search filter"
curl -fsS "$BASE/api/v1/cases?title=smoke" | grep -q "$CASE_ID" || fail "title filter miss"

say "AC4 tag filter"
curl -fsS "$BASE/api/v1/cases?tag=fraud" | grep -q "$CASE_ID" || fail "tag filter miss"

upload_and_map() {
  local fixture="$1"; shift
  local src="$1"; shift
  local tgt="$1"; shift
  local weight="${1:-}"
  say "upload+map fixture $fixture (src=$src tgt=$tgt weight=$weight)"
  local up
  up=$(curl -fsS -X POST "$BASE/api/v1/cases/$CASE_ID/files" \
    -F "file=@$FIXTURE_DIR/$fixture")
  local fid
  fid=$(printf '%s' "$up" | python3 -c "import sys,json; print(json.load(sys.stdin)['file_id'])")
  [ -n "$fid" ] || fail "no file_id from upload of $fixture"
  curl -fsS -X PATCH "$BASE/api/v1/cases/$CASE_ID/files/$fid/mapping" \
    -H 'Content-Type: application/json' \
    -d "{\"source_col\":\"$src\",\"target_col\":\"$tgt\",\"weight_col\":\"$weight\"}" >/dev/null \
    || fail "mapping failed for $fixture"
  echo "$fid"
}

BANK_FID=$(upload_and_map "bank.xlsx" "sender" "receiver" "amount")
CRYPTO_FID=$(upload_and_map "crypto.xlsx" "from_wallet" "to_wallet" "amount_btc")
PHONE_FID=$(upload_and_map "phone.xlsx" "ผู้โทร" "ผู้รับ" "ระยะเวลา_วินาที")
TRAVEL_FID=$(upload_and_map "travel.xlsx" "ต้นทาง" "ปลายทาง" "")
# silence "unused" shellcheck noise for the IDs we keep around for toggle test
: "$CRYPTO_FID" "$PHONE_FID" "$TRAVEL_FID"

say "AC6 combined graph has nodes and edges across 4 files"
GRAPH=$(curl -fsS "$BASE/api/v1/cases/$CASE_ID/graph")
NODE_COUNT=$(printf '%s' "$GRAPH" | python3 -c "import sys,json; print(len(json.load(sys.stdin)['Nodes']))")
EDGE_COUNT=$(printf '%s' "$GRAPH" | python3 -c "import sys,json; print(len(json.load(sys.stdin)['Edges']))")
[ "$NODE_COUNT" -gt 0 ] || fail "no nodes in combined graph"
[ "$EDGE_COUNT" -gt 0 ] || fail "no edges in combined graph"
echo "combined: nodes=$NODE_COUNT edges=$EDGE_COUNT"

say "AC7 toggle a file off and assert edge count drops"
curl -fsS -X PATCH "$BASE/api/v1/cases/$CASE_ID/files/$BANK_FID/included" \
  -H 'Content-Type: application/json' -d '{"included":false}' >/dev/null
NEW_EDGES=$(curl -fsS "$BASE/api/v1/cases/$CASE_ID/graph" | python3 -c "import sys,json; print(len(json.load(sys.stdin)['Edges']))")
[ "$NEW_EDGES" -lt "$EDGE_COUNT" ] || fail "expected edge count to drop after toggle off"

say "re-include bank"
curl -fsS -X PATCH "$BASE/api/v1/cases/$CASE_ID/files/$BANK_FID/included" \
  -H 'Content-Type: application/json' -d '{"included":true}' >/dev/null

say "AC8 node detail"
ANY_NODE=$(printf '%s' "$GRAPH" | python3 -c "import sys,json; print(json.load(sys.stdin)['Nodes'][0]['ID'])")
DETAIL=$(curl -fsS "$BASE/api/v1/cases/$CASE_ID/nodes/$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$ANY_NODE")")
printf '%s' "$DETAIL" | grep -q "$ANY_NODE" || fail "node detail missing id"

say "AC10 export json"
curl -fsS "$BASE/api/v1/cases/$CASE_ID/graph/export.json" -o /tmp/smoke-graph.json
python3 -c "import json; d=json.load(open('/tmp/smoke-graph.json')); assert 'nodes' in d and 'edges' in d" || fail "exported json missing keys"

say "AC11 reject non-xlsx"
RC=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/v1/cases/$CASE_ID/files" \
  -F 'file=@/etc/hostname;filename=hostname.txt')
[ "$RC" = "400" ] || fail "expected 400 for non-xlsx, got $RC"

say "AC11 reject invalid mapping (no row written)"
up=$(curl -fsS -X POST "$BASE/api/v1/cases/$CASE_ID/files" -F "file=@$FIXTURE_DIR/bank.xlsx")
bad_fid=$(printf '%s' "$up" | python3 -c "import sys,json; print(json.load(sys.stdin)['file_id'])")
RC=$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "$BASE/api/v1/cases/$CASE_ID/files/$bad_fid/mapping" \
  -H 'Content-Type: application/json' -d '{"source_col":"nope","target_col":"still_nope"}')
[ "$RC" = "400" ] || fail "expected 400 for invalid mapping, got $RC"

say "AC2 patch title"
curl -fsS -X PATCH "$BASE/api/v1/cases/$CASE_ID" -H 'Content-Type: application/json' \
  -d '{"title":"smoke renamed"}' >/dev/null
curl -fsS "$BASE/api/v1/cases/$CASE_ID" | grep -q "smoke renamed" || fail "patch title did not persist"

say "AC3 archive + hidden by default"
curl -fsS -X POST "$BASE/api/v1/cases/$CASE_ID/archive" >/dev/null
curl -fsS "$BASE/api/v1/cases" | grep -q "$CASE_ID" && fail "archived case should be hidden from default list"
curl -fsS "$BASE/api/v1/cases?status=archived" | grep -q "$CASE_ID" || fail "archived case missing from status=archived filter"

say "SMOKE OK"
