#!/usr/bin/env sh

set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
. "$ROOT/.claude/tests/lib/assert.sh"

assert_words_at_most() {
  label="$1"; limit="$2"; path="$3"
  words="$(wc -w < "$path" | tr -d ' ')"
  if [ "$words" -le "$limit" ]; then
    pass "$label ($words <= $limit words)"
  else
    fail "$label — $words words exceeds $limit"
  fi
}

assert_words_at_most "always-on fundamentals budget" 700 \
  "$ROOT/.claude/rules/fundamentals.md"
assert_words_at_most "orchestrator troubleshooting budget" 750 \
  "$ROOT/.claude/orchestrator.md"
assert_words_at_most "portable agent contract budget" 150 \
  "$ROOT/.claude/harness/AGENT.md"

for command in "$ROOT"/.claude/commands/*.md; do
  assert_words_at_most "command budget: $(basename "$command")" 120 "$command"
done

hot_skill_words="$(wc -w \
  "$ROOT/.claude/skills/programming-fundamentals/SKILL.md" \
  "$ROOT/.claude/skills/database-fundamentals/SKILL.md" \
  "$ROOT/.claude/skills/hexagonal-backend/SKILL.md" \
  "$ROOT/.claude/skills/api-design-fundamentals/SKILL.md" \
  "$ROOT/.claude/skills/security-fundamentals/SKILL.md" \
  "$ROOT/.claude/skills/observability-fundamentals/SKILL.md" |
  tail -1 | awk '{print $1}')"
if [ "$hot_skill_words" -le 3000 ]; then
  pass "combined auth/backend skill budget ($hot_skill_words <= 3000 words)"
else
  fail "combined auth/backend skill budget — $hot_skill_words words exceeds 3000"
fi
for skill in programming-fundamentals database-fundamentals hexagonal-backend \
  api-design-fundamentals security-fundamentals observability-fundamentals; do
  assert_words_at_most "hot skill budget: $skill" 600 \
    "$ROOT/.claude/skills/$skill/SKILL.md"
done

combined_bytes="$(wc -c \
  "$ROOT/.claude/rules/fundamentals.md" \
  "$ROOT/.claude/commands/build.md" \
  "$ROOT/.claude/skills/hexagonal-backend/SKILL.md" \
  "$ROOT/.claude/skills/security-fundamentals/SKILL.md" \
  "$ROOT/.claude/skills/observability-fundamentals/SKILL.md" |
  tail -1 | awk '{print $1}')"
if [ "$combined_bytes" -le 32768 ]; then
  pass "representative auth build context ($combined_bytes <= 32768 bytes)"
else
  fail "representative auth build context — $combined_bytes bytes exceeds 32768"
fi

assert_cmd_zero "task packet budget is 8 KiB" \
  jq -e '.execution.packetBytes.task == 8192' "$ROOT/foundation.json"
assert_cmd_zero "repository packet budget is 12 KiB" \
  jq -e '.execution.packetBytes.repository == 12288' "$ROOT/foundation.json"
assert_cmd_zero "global packet budget is 16 KiB" \
  jq -e '.execution.packetBytes.global == 16384' "$ROOT/foundation.json"
assert_cmd_zero "plan summary budget is 4 KiB" \
  jq -e '.execution.planSummaryBytes == 4096' "$ROOT/foundation.json"

finish "context budgets"
