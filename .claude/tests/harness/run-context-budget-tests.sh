#!/usr/bin/env sh

set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
. "$ROOT/.claude/tests/lib/assert.sh"

budget_failures=0

budget_decision_guidance() {
  printf '%s\n' \
    'CONTEXT_BUDGET_USER_DECISION_REQUIRED' \
    'Do not shorten policy/prompt content, move it, or increase this limit automatically.' \
    'Report every failing file or scope with its actual size and limit. Ask the user to choose: (1) keep the content and raise the budget; (2) move details to selectively loaded documentation; or (3) deliberately shorten the content.' \
    "Stop and wait for the user's choice before editing."
}

fail_context_budget() {
  label="$1"; actual="$2"; limit="$3"; unit="$4"; scope="$5"
  budget_failures=$((budget_failures + 1))
  fail "$label — $scope uses $actual $unit; limit is $limit $unit"
}

assert_words_at_most() {
  label="$1"; limit="$2"; path="$3"
  words="$(wc -w < "$path" | tr -d ' ')"
  if [ "$words" -le "$limit" ]; then
    pass "$label ($words <= $limit words)"
  else
    fail_context_budget "$label" "$words" "$limit" words "$path"
  fi
}

guidance="$(budget_decision_guidance)"
assert_contains "budget guidance forbids automatic content compression" \
  "$guidance" 'Do not shorten policy/prompt content'
assert_contains "budget guidance requires the user to choose" \
  "$guidance" "Stop and wait for the user's choice before editing."

assert_words_at_most "always-on fundamentals budget" 700 \
  "$ROOT/.claude/rules/fundamentals.md"
assert_file_contains "fundamentals separates skill judgment from harness control" \
  "$ROOT/.claude/rules/fundamentals.md" \
  'Skills supply judgment and procedures; the harness owns lifecycle'
assert_words_at_most "orchestrator troubleshooting budget" 750 \
  "$ROOT/.claude/orchestrator.md"
# 175, raised from 150 for this file alone. The installer's pointer block cites
# AGENT.md and nothing else, so it is the only Foundation instruction a consumer
# project is guaranteed to load — and it was describing the decision protocol
# without naming the channel, which is how a host that offers selectable options
# ended up handed a paragraph. Naming the tool could not be absorbed by
# rewording: the tightest phrasing that still named it measured 159, and the
# words left to cut were each another rule the contract carries. Raised
# deliberately and for this file, like `change.md` and `build.md` below, so
# every other limit still binds.
assert_words_at_most "portable agent contract budget" 175 \
  "$ROOT/.claude/harness/AGENT.md"
assert_file_contains "fundamentals routes abstraction depth" \
  "$ROOT/.claude/rules/fundamentals.md" 'module boundary, abstraction depth'
assert_file_contains "programming fundamentals require deep modules" \
  "$ROOT/.claude/skills/programming-fundamentals/SKILL.md" \
  'Design deep, cohesive modules'
assert_file_contains "programming fundamentals route module design detail" \
  "$ROOT/.claude/skills/programming-fundamentals/SKILL.md" \
  'references/module-design.md'
assert_file_exists "module design reference ships" \
  "$ROOT/.claude/skills/programming-fundamentals/references/module-design.md"
assert_file_contains "brainstorming resolves facts instead of asking them" \
  "$ROOT/.claude/skills/brainstorming/SKILL.md" 'Never ask what you can find'
assert_file_contains "brainstorming batches settled decisions into rounds" \
  "$ROOT/.claude/skills/brainstorming/SKILL.md" 'Ask in rounds, not one at a time'
assert_file_contains "brainstorming keeps the material-change question filter" \
  "$ROOT/.claude/skills/brainstorming/SKILL.md" \
  'Ask only what materially changes'
assert_file_contains "fundamentals routes decisions through the structured question tool" \
  "$ROOT/.claude/rules/fundamentals.md" \
  'structured question tool'
assert_file_contains "brainstorming presents rounds through the structured question tool" \
  "$ROOT/.claude/skills/brainstorming/SKILL.md" \
  'structured question tool'
assert_file_contains "brainstorming closes only when every decision is asked and answered" \
  "$ROOT/.claude/skills/brainstorming/SKILL.md" \
  'every material decision has been asked and answered'
assert_file_contains "brainstorming records each answer in the agreement" \
  "$ROOT/.claude/skills/brainstorming/SKILL.md" \
  'each asked question with its chosen answer'
assert_file_contains "fundamentals records decision answers in the change packet" \
  "$ROOT/.claude/rules/fundamentals.md" \
  'record the answers in the change packet'

# 120 words is the standing budget for a slash command. `change.md` carries 15
# more because it is the only command that must also tell the author to declare
# `--surface`: without that instruction the capability forecast never runs, and
# the cost it exists to remove is paid on every change. `build.md` carries 25
# more because it must also route long external commands through `exec`:
# without that instruction the largest block of wall time never reaches
# metrics. Raised deliberately and per command, so the standing budget still
# binds everywhere else.
for command in "$ROOT"/.claude/commands/*.md; do
  case "$(basename "$command")" in
    change.md) limit=135 ;;
    build.md) limit=145 ;;
    *) limit=120 ;;
  esac
  assert_words_at_most "command budget: $(basename "$command")" "$limit" "$command"
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
  fail_context_budget "combined auth/backend skill budget" \
    "$hot_skill_words" 3000 words "combined auth/backend skills"
fi
for skill in programming-fundamentals database-fundamentals hexagonal-backend \
  api-design-fundamentals security-fundamentals observability-fundamentals; do
  assert_words_at_most "hot skill budget: $skill" 600 \
    "$ROOT/.claude/skills/$skill/SKILL.md"
done

all_skill_words="$(wc -w "$ROOT"/.claude/skills/*/SKILL.md | tail -1 | awk '{print $1}')"
if [ "$all_skill_words" -le 8000 ]; then
  pass "complete shipped skill budget ($all_skill_words <= 8000 words)"
else
  fail_context_budget "complete shipped skill budget" \
    "$all_skill_words" 8000 words "all shipped SKILL.md bodies"
fi
for skill in "$ROOT"/.claude/skills/*/SKILL.md; do
  assert_words_at_most "lazy skill budget: $(basename "$(dirname "$skill")")" 700 "$skill"
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
  fail_context_budget "representative auth build context" \
    "$combined_bytes" 32768 bytes "representative auth build context"
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
assert_cmd_zero "rapid request budget is explicit" \
  jq -e '.execution.requestBudgets.rapid == 100' "$ROOT/foundation.json"
assert_cmd_zero "standard request budget is explicit" \
  jq -e '.execution.requestBudgets.standard == 200' "$ROOT/foundation.json"

if [ "$budget_failures" -gt 0 ]; then
  budget_decision_guidance >&2
fi
finish "context budgets"
