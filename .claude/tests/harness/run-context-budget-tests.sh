#!/usr/bin/env sh

set -eu
# Word counts depend on the locale (UTF-8 punctuation counts as words in
# C.UTF-8); pin CI's locale so local and CI budgets agree.
LC_ALL=C.UTF-8
export LC_ALL
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
assert_words_at_most "orchestrator troubleshooting budget" 585 \
  "$ROOT/.claude/orchestrator.md"
assert_words_at_most "portable agent contract budget" 300 \
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
assert_file_contains "brainstorming models a private dependency tree" \
  "$ROOT/.claude/skills/brainstorming/SKILL.md" 'private dependency tree'
assert_file_contains "brainstorming does not persist a parallel tree" \
  "$ROOT/.claude/skills/brainstorming/SKILL.md" \
  'artifact or lifecycle state'
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
assert_file_contains "[frontier-prerequisite-order] brainstorming asks only prerequisite-ready decisions" \
  "$ROOT/.claude/skills/brainstorming/SKILL.md" \
  'prerequisites are already settled'
assert_file_contains "brainstorming hands settled answers forward without re-asking" \
  "$ROOT/.claude/skills/brainstorming/SKILL.md" \
  'without asking them again'
assert_cmd_zero "[source-checked-domain-term] discovery checks project terms against source and keeps semantic choices" \
  sh -c 'grep -F '\''fuzzy or conflicting'\'' "$1" >/dev/null &&
    grep -F '\''specifications and code'\'' "$1" >/dev/null &&
    grep -F '\''only a remaining semantic'\'' "$2" >/dev/null &&
    grep -F '\''specifications'\'' "$2" >/dev/null' sh \
  "$ROOT/.claude/skills/brainstorming/SKILL.md" \
  "$ROOT/.claude/skills/grill-task-gu/SKILL.md"
assert_file_contains "feature intake delegates discovery to grill-task-gu" \
  "$ROOT/.claude/skills/feature/references/workflow.md" \
  'Invoke `grill-task-gu`'
assert_file_contains "[frontier-source-owned-fact] grill-task-gu resolves discoverable facts from sources" \
  "$ROOT/.claude/skills/grill-task-gu/SKILL.md" \
  'Discoverable facts come from sources'
assert_file_contains "grill-task-gu models unresolved choices privately" \
  "$ROOT/.claude/skills/grill-task-gu/SKILL.md" \
  'private dependency tree'
assert_file_contains "grill-task-gu keeps conditional effects in the same sheet" \
  "$ROOT/.claude/skills/grill-task-gu/SKILL.md" \
  'show the prerequisite and every conditional effect in this same'
assert_file_contains "grill-task-gu includes known choices in the PRD sheet" \
  "$ROOT/.claude/skills/grill-task-gu/SKILL.md" \
  'do not defer known choices to a later question round'
assert_cmd_zero "[feature-single-finalized-sheet] feature reuses PRD choices without substituting them for compiled-spec approval" \
  sh -c 'grep -F '\''Invoke `grill-task-gu`'\'' "$1" >/dev/null &&
    grep -F '\''choices again. This approves intake choices, not a compiled OpenSpec packet.'\'' "$2" >/dev/null &&
    grep -F '\''Change still requires explicit compiled-spec approval before Build.'\'' "$2" >/dev/null' \
  sh "$ROOT/.claude/skills/feature/references/workflow.md" \
  "$ROOT/.claude/skills/grill-task-gu/SKILL.md"
assert_file_contains "[change-reuses-agreement] change intake reuses settled answers" \
  "$ROOT/.claude/skills/change/references/workflow.md" \
  'Reuse settled answers without asking them again'
assert_file_contains "change intake always hashes grounding reads in the draft field" \
  "$ROOT/.claude/skills/change/references/workflow.md" \
  'Always hash grounding reads in the draft `grounding` field'
assert_file_contains "change intake creates no parallel interview ledger" \
  "$ROOT/.claude/skills/change/references/workflow.md" \
  'Create no decision-tree or interview ledger'
assert_file_contains "change workflow delegates semantic intake to one canonical reference" \
  "$ROOT/.claude/skills/change/references/workflow.md" \
  '[semantic-intake.md](semantic-intake.md)'
# Structure B (N1, user decision 2026-10-01): `/dev` is exactly `/change` →
# `/build` → `/prove` → `/land`. Shared rules live only in AGENT.md; each phase
# command is the single source for its phase. The full Change workflow,
# semantic intake, and Build policy stay selectively loaded on named triggers.
assert_words_at_most "build policy reference budget" 875 \
  "$ROOT/.claude/commands/references/build-policy.md"
assert_file_absent "rapid path reference is retired" \
  "$ROOT/.claude/commands/references/rapid-path.md"
if grep -rlF --exclude-dir=tests 'rapid-path.md' "$ROOT/.claude" "$ROOT/openspec/schemas" >/dev/null 2>&1; then
  fail "no shipped file references rapid-path.md: $(grep -rlF --exclude-dir=tests 'rapid-path.md' "$ROOT/.claude" "$ROOT/openspec/schemas" | tr '\n' ' ')"
else
  pass "no shipped file references rapid-path.md"
fi
assert_cmd_zero "dev references all four phase commands in order" \
  node -e '
    const s = require("fs").readFileSync(process.argv[1], "utf8");
    const at = ["change", "build", "prove", "land"]
      .map((p) => s.indexOf(".claude/commands/" + p + ".md"));
    if (at.some((i) => i < 0) || at.some((i, n) => n && i <= at[n - 1])) process.exit(1);
  ' "$ROOT/.claude/commands/dev.md"
assert_file_contains "dev reaches land only with Land authority" \
  "$ROOT/.claude/commands/dev.md" '`.claude/commands/land.md`, only with Land authority'
dev_bundle_words="$(cat "$ROOT/.claude/harness/AGENT.md" \
  "$ROOT/.claude/commands/dev.md" "$ROOT/.claude/commands/change.md" \
  "$ROOT/.claude/commands/build.md" "$ROOT/.claude/commands/prove.md" \
  "$ROOT/.claude/commands/land.md" | wc -w | tr -d ' ')"
if [ "$dev_bundle_words" -le 1150 ]; then
  pass "/dev context bundle (AGENT + dev + four phases) ($dev_bundle_words <= 1150 words)"
else
  fail_context_budget "/dev context bundle" "$dev_bundle_words" 1150 words \
    "AGENT.md + dev.md + change/build/prove/land.md"
fi
# Shared rules have one home. Spot-check distinctive phrases.
for phrase in 'No preflight' 'agent-only control data' 'cd <workspace>` once' \
  'hand-edit' 'Recover from the envelope first' 'in any wording' \
  'Silence grants neither' 'contextScope.specs'; do
  assert_file_contains "shared rule lives in AGENT.md: $phrase" \
    "$ROOT/.claude/harness/AGENT.md" "$phrase"
  for doc in commands/dev commands/change commands/build commands/prove \
    commands/land orchestrator; do
    assert_file_not_contains "shared rule not duplicated in $doc.md: $phrase" \
      "$ROOT/.claude/$doc.md" "$phrase"
  done
done
for doc in change build prove land; do
  assert_file_contains "$doc points to the shared rules" \
    "$ROOT/.claude/commands/$doc.md" 'Shared rules: `.claude/harness/AGENT.md`'
done
assert_file_contains "agent contract names the lifecycle CLI surface" \
  "$ROOT/.claude/harness/AGENT.md" '`change start <draft>` and `advance <change> --through'
assert_file_contains "agent contract routes every repair through its returned fix" \
  "$ROOT/.claude/harness/AGENT.md" 'carries its fix'
assert_file_contains "agent contract grants Land on any explicit instruction" \
  "$ROOT/.claude/harness/AGENT.md" 'Any explicit user instruction to land grants Land'
assert_file_contains "agent contract accepts spec approval given in the request" \
  "$ROOT/.claude/harness/AGENT.md" 'Spec approval given in the request, in any wording'
assert_file_contains "agent contract rejects success without lifecycle state" \
  "$ROOT/.claude/harness/AGENT.md" \
  'Code/test success without the matching lifecycle state is incomplete'
assert_file_contains "change loads its full workflow only on triggers" \
  "$ROOT/.claude/commands/change.md" 'completely only for'
assert_file_contains "change leaves the rapid lane only on declared risk" \
  "$ROOT/.claude/commands/change.md" 'draft declaring `impact` medium/high'
assert_file_contains "change keeps keyword-only security on the rapid lane" \
  "$ROOT/.claude/commands/change.md" 'a keyword like billing only adds review'
assert_file_contains "change describes the minimal draft" \
  "$ROOT/.claude/commands/change.md" '`tasks[{outcome, verify, paths}]`'
assert_file_contains "change saves the draft without a shell heredoc" \
  "$ROOT/.claude/commands/change.md" '(no `version`, no heredoc)'
assert_file_contains "change trusts the printed packet" \
  "$ROOT/.claude/commands/change.md" 'do not reopen them'
assert_file_contains "change records spec approval through advance" \
  "$ROOT/.claude/commands/change.md" 'advance <id> --approve-spec --decision-ref'
assert_file_contains "change uses atomic start" \
  "$ROOT/.claude/commands/change.md" 'claude-foundation change start'
assert_file_contains "build loads its policy only on triggers" \
  "$ROOT/.claude/commands/build.md" 'Read `references/build-policy.md` for a new user request'
assert_file_contains "build implements a whole single-session batch" \
  "$ROOT/.claude/commands/build.md" 'One `EDIT` may carry several tasks'
assert_file_contains "prove keeps review in-session" \
  "$ROOT/.claude/commands/prove.md" 'Stay in-session while a review runs'
assert_file_contains "prove owns the no-progress gate" \
  "$ROOT/.claude/commands/prove.md" 'Gate: no progress'
assert_file_contains "land uses the same advance route as /dev" \
  "$ROOT/.claude/commands/land.md" 'Run `claude-foundation advance <change> --through archived`'
assert_file_not_contains "land never teaches the internal land advance route" \
  "$ROOT/.claude/commands/land.md" 'Run `claude-foundation land'
assert_file_contains "agent contract forbids preflight" \
  "$ROOT/.claude/harness/AGENT.md" 'No preflight (`doctor`'
assert_cmd_zero "phase commands use only change start, advance, and exec" \
  sh -c '! cat "$@" | grep -oE "claude-foundation [a-z-]+( [a-z-]+)?" |
    grep -vE "^claude-foundation (change start|advance|exec)( |$)"' \
  sh "$ROOT/.claude/commands/dev.md" "$ROOT/.claude/commands/change.md" \
  "$ROOT/.claude/commands/build.md" "$ROOT/.claude/commands/prove.md" \
  "$ROOT/.claude/commands/land.md"
if grep -En 'change resolve [^ ]* ?--approve-spec|--consume-draft|mark it complete|claude-foundation (evidence init|evidence upgrade|sandbox sync|authority run)' \
    "$ROOT/.claude/commands/dev.md" "$ROOT/.claude/commands/change.md" \
    "$ROOT/.claude/commands/build.md" "$ROOT/.claude/commands/prove.md" \
    "$ROOT/.claude/commands/land.md" >/dev/null; then
  fail "phase instructions omit harness-owned manual steps"
else
  pass "phase instructions omit harness-owned manual steps"
fi
assert_words_at_most "change workflow reference budget" 1150 \
  "$ROOT/.claude/skills/change/references/workflow.md"
assert_words_at_most "prove workflow reference budget" 435 \
  "$ROOT/.claude/skills/prove/references/workflow.md"
assert_words_at_most "semantic intake reference budget" 400 \
  "$ROOT/.claude/skills/change/references/semantic-intake.md"
assert_words_at_most "semantic intelligence reference budget" 220 \
  "$ROOT/.claude/skills/change/references/semantic-intelligence.md"
assert_words_at_most "investigate workflow reference budget" 220 \
  "$ROOT/.claude/skills/investigate/references/workflow.md"
change_reference_words="$(wc -w "$ROOT"/.claude/skills/change/references/*.md | tail -1 | awk '{print $1}')"
if [ "$change_reference_words" -le 2050 ]; then
  pass "change reference collection stays bounded ($change_reference_words/2050 words)"
else
  fail "change reference collection exceeds 2050 words ($change_reference_words)"
fi
assert_cmd_zero "change references are reachable, acyclic, and free of duplicated long blocks" \
  node --input-type=module -e '
    import { readFileSync, readdirSync } from "node:fs";
    import { basename, dirname, join, resolve } from "node:path";
    const skill = resolve(process.argv[1]);
    const references = resolve(process.argv[2]);
    const files = [skill, ...readdirSync(references)
      .filter((name) => name.endsWith(".md")).sort()
      .map((name) => join(references, name))];
    const known = new Set(files);
    const edges = new Map(files.map((file) => [file, []]));
    for (const file of files) {
      const markdown = readFileSync(file, "utf8");
      const links = [
        ...[...markdown.matchAll(/\[[^\]]+\]\(([^)#]+\.md)(?:#[^)]+)?\)/g)].map((match) => match[1]),
        ...[...markdown.matchAll(/`(references\/[A-Za-z0-9._/-]+\.md)`/g)].map((match) => match[1])
      ];
      for (const link of new Set(links)) {
        const target = resolve(dirname(file), link);
        if (!known.has(target)) throw new Error(`${basename(file)} has unresolved reference ${link}`);
        edges.get(file).push(target);
      }
    }
    const reachable = new Set();
    const active = new Set();
    function visit(file) {
      if (active.has(file)) throw new Error(`reference cycle at ${basename(file)}`);
      if (reachable.has(file)) return;
      active.add(file);
      reachable.add(file);
      for (const target of edges.get(file) || []) visit(target);
      active.delete(file);
    }
    visit(skill);
    const orphaned = files.filter((file) => file !== skill && !reachable.has(file));
    if (orphaned.length) throw new Error(`orphaned references: ${orphaned.map(basename).join(", ")}`);
    const owners = new Map();
    for (const file of files) {
      const blocks = readFileSync(file, "utf8").split(/\n\s*\n/)
        .map((block) => block.replace(/\s+/g, " ").trim())
        .filter((block) => block.split(" ").length >= 24 && !block.startsWith("```"));
      for (const block of blocks) {
        const prior = owners.get(block);
        if (prior && prior !== file)
          throw new Error(`duplicated long block in ${basename(prior)} and ${basename(file)}`);
        owners.set(block, file);
      }
    }
  ' "$ROOT/.claude/skills/change/SKILL.md" \
  "$ROOT/.claude/skills/change/references"
assert_cmd_zero "all shipped skill references resolve and governed lifecycle bundles stay bounded" \
  node "$ROOT/.claude/tests/harness/reference-governance.mjs" \
  "$ROOT/.claude/skills"
assert_cmd_zero "[qualified-durable-decision] template and change intake share the three-part durability threshold" \
  sh -c 'for path do
    grep -F '\''hard to reverse, surprising without context'\'' "$path" >/dev/null || exit 1
    grep -F '\''meaningful alternatives'\'' "$path" >/dev/null || exit 1
  done' sh \
  "$ROOT/openspec/schemas/foundation-standard/templates/design.md" \
  "$ROOT/.claude/skills/change/references/workflow.md"
assert_file_contains "change intake forbids parallel domain and ADR artifacts" \
  "$ROOT/.claude/skills/change/references/workflow.md" \
  'Never create `CONTEXT.md`, a glossary artifact, or an ADR store'
assert_cmd_zero "atomic draft template stays semantic and minimal" \
  sh -c 'node "$1" start --template | jq -e '\''
    .version == 4 and (.requirements | length) == 1 and
    (.tasks[0].covers | length) == 1 and (.evidence | type) == "object" and
    (.discovery.coverage | length) == 4 and
    (has("domainLanguage") | not) and (has("execution") | not)'\'' >/dev/null' \
  sh "$ROOT/.claude/harness/foundation.mjs"
assert_file_contains "fundamentals records decision answers in the change packet" \
  "$ROOT/.claude/rules/fundamentals.md" \
  'record the answers in the change packet'

# 120 words is the standing budget for a slash command. Structure B (N1, user
# decision 2026-10-01) makes each phase command the single source for its phase,
# absorbing the retired rapid-path reference: change, build, prove, and land
# may use 250 words each, and `dev.md` only composes them in 120. The combined
# /dev bundle budget above still binds all of them together.
#
# Raise a limit here only to admit a rule that removes a failure the command
# cannot otherwise avoid; never to make room by deleting an existing one.
for command in "$ROOT"/.claude/commands/*.md; do
  case "$(basename "$command")" in
    change.md|build.md|prove.md|land.md) limit=250 ;;
    *) limit=120 ;;
  esac
  assert_words_at_most "command budget: $(basename "$command")" "$limit" "$command"
done
assert_eq "normal slash command surface is bounded" "9" \
  "$(find "$ROOT/.claude/commands" -maxdepth 1 -name '*.md' | wc -l | tr -d ' ')"
if grep -R -Eq 'runtime (new|start|resolve)|proof (plan|finish|preflight|execute|finalize|audit)' \
  "$ROOT/.claude/commands"; then
  fail "slash commands use canonical public vocabulary"
else
  pass "slash commands use canonical public vocabulary"
fi
assert_file_contains "investigate command selectively loads its workflow" \
  "$ROOT/.claude/commands/investigate.md" 'references/workflow.md'
assert_file_contains "normal investigate bounds agent writes and preserves notes" \
  "$ROOT/.claude/skills/investigate/references/workflow.md" 'agent writes are the record and an optional authored note'
assert_file_contains "investigate assigns readable reports to the harness" \
  "$ROOT/.claude/skills/investigate/references/workflow.md" 'the harness owns the generated report'
assert_file_contains "compare mode scopes writes to prototypes" \
  "$ROOT/.claude/skills/investigate/references/workflow.md" 'only under'
assert_file_contains "prove owns fresh independent review" \
  "$ROOT/.claude/skills/prove/references/workflow.md" 'fresh independent'
assert_file_contains "dev command forbids redundant framework exploration" \
  "$ROOT/.claude/commands/dev.md" \
  "Do not reread framework files"
assert_file_contains "dev resume skips completed lifecycle work" \
  "$ROOT/.claude/commands/dev.md" 'completed Build work and reuses fresh evidence'
assert_file_contains "change forbids runtime archaeology" \
  "$ROOT/.claude/skills/change/references/workflow.md" \
  'Never inspect managed `.claude/harness/**`'
assert_file_contains "change compiler owns classification" \
  "$ROOT/.claude/skills/change/references/workflow.md" \
  "compiler owns classification"
assert_file_contains "change compiler owns conditional artifacts" \
  "$ROOT/.claude/skills/change/references/workflow.md" \
  'conditional artifacts'
assert_file_contains "change repairs only reported draft fields" \
  "$ROOT/.claude/skills/change/references/workflow.md" \
  'Repair only the draft fields it reports'
assert_file_contains "change audit warnings do not reopen grounding" \
  "$ROOT/.claude/skills/change/references/workflow.md" \
  'Optional audit warnings are advisory'
assert_file_contains "build command names unified transition" \
  "$ROOT/.claude/commands/build.md" \
  'advance <change> --through proven'
if grep -qF 'proof execute' "$ROOT/website/index.html"; then
  fail "public website uses canonical proof command"
else
  pass "public website uses canonical proof command"
fi
assert_file_contains "public website advertises unified lifecycle advance" \
  "$ROOT/website/index.html" 'advance &lt;id&gt; --through build|proven|archived'

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
# Foundation lifecycle bridges and the one-batch intake skill are discovered
# lazily by Codex; they are not loaded together. Keep every individual skill at
# 700 words and every representative hot context bounded, while allowing the
# installed catalog to contain the eight portable lifecycle entry points.
if [ "$all_skill_words" -le 9500 ]; then
  pass "complete shipped lazy skill inventory ($all_skill_words <= 9500 words)"
else
  fail_context_budget "complete shipped lazy skill inventory" \
    "$all_skill_words" 9500 words "all shipped SKILL.md bodies"
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
assert_cmd_zero "budget watchdog is opt-in (default off)" \
  jq -e '.execution.budgetWatchdog == false' "$ROOT/foundation.json"
assert_cmd_zero "model tier routing is opt-in (default off)" \
  jq -e '.models.routing == false' "$ROOT/foundation.json"
assert_cmd_zero "quality change gate defaults off" \
  jq -e '.quality.changeGate == "off"' "$ROOT/foundation.json"

if [ "$budget_failures" -gt 0 ]; then
  budget_decision_guidance >&2
fi
finish "context budgets"
