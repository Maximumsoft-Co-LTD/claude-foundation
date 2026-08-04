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
assert_eq "normal slash command surface is bounded" "7" \
  "$(find "$ROOT/.claude/commands" -maxdepth 1 -name '*.md' | wc -l | tr -d ' ')"
if grep -R -Eq 'runtime (new|start|resolve)|proof (plan|finish|preflight|execute|finalize|audit)' \
  "$ROOT/.claude/commands"; then
  fail "slash commands use canonical public vocabulary"
else
  pass "slash commands use canonical public vocabulary"
fi
assert_file_contains "investigate owns bounded comparison" \
  "$ROOT/.claude/commands/investigate.md" '--compare'
assert_file_contains "normal investigate limits writes to its note" \
  "$ROOT/.claude/commands/investigate.md" 'Without comparison'
assert_file_contains "compare mode scopes writes to prototypes" \
  "$ROOT/.claude/commands/investigate.md" 'write only inside the prototype directory'
assert_file_contains "prove owns fresh independent review" \
  "$ROOT/.claude/commands/prove.md" 'fresh independent'
assert_file_contains "dev command forbids direct implementation bypass" \
  "$ROOT/.claude/commands/dev.md" \
  "Foundation runtime state is a failed"
assert_file_contains "dev command forbids redundant framework exploration" \
  "$ROOT/.claude/commands/dev.md" \
  "Do not reread framework files"
assert_file_contains "dev command uses atomic rapid start" \
  "$ROOT/.claude/commands/dev.md" \
  'change start --template'
assert_file_contains "change command selects rapid before creation" \
  "$ROOT/.claude/commands/change.md" \
  "classify before creating it"
assert_file_contains "change command omits empty security flag" \
  "$ROOT/.claude/commands/change.md" \
  'Omit `--security` when there are no triggers'
assert_file_contains "build command names sandbox transition" \
  "$ROOT/.claude/commands/build.md" \
  'sandbox create <change>'
if grep -qF 'proof execute' "$ROOT/website/index.html"; then
  fail "public website uses canonical proof command"
else
  pass "public website uses canonical proof command"
fi
assert_file_contains "public website advertises proof run" \
  "$ROOT/website/index.html" 'proof run &lt;id&gt;'

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

for skill in "$ROOT"/.claude/skills/*/SKILL.md; do
  assert_words_at_most "lazy skill budget: $(basename "$(dirname "$skill")")" 1200 "$skill"
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
assert_cmd_zero "review packet budget is 8 KiB" \
  jq -e '.execution.packetBytes.review == 8192' "$ROOT/foundation.json"
assert_cmd_zero "repository packet budget is 12 KiB" \
  jq -e '.execution.packetBytes.repository == 12288' "$ROOT/foundation.json"
assert_cmd_zero "global packet budget is 16 KiB" \
  jq -e '.execution.packetBytes.global == 16384' "$ROOT/foundation.json"
assert_cmd_zero "plan summary budget is 4 KiB" \
  jq -e '.execution.planSummaryBytes == 4096' "$ROOT/foundation.json"
assert_cmd_zero "rapid token budget is explicit" \
  jq -e '.execution.tokenBudgets.rapid == 800000' "$ROOT/foundation.json"
assert_cmd_zero "standard token budget is explicit" \
  jq -e '.execution.tokenBudgets.standard == 1600000' "$ROOT/foundation.json"

finish "context budgets"
