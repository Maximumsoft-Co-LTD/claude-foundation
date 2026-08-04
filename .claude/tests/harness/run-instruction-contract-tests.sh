#!/usr/bin/env sh
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
. "$ROOT/.claude/tests/lib/assert.sh"

names="$(find "$ROOT/.claude/skills" -mindepth 2 -maxdepth 2 -name SKILL.md -exec sed -n 's/^name:[[:space:]]*//p' {} \;)"
count="$(printf '%s\n' "$names" | sed '/^$/d' | wc -l | tr -d ' ')"
unique="$(printf '%s\n' "$names" | sed '/^$/d' | sort -u | wc -l | tr -d ' ')"
assert_eq "every skill has one unique registry name" "$count" "$unique"

missing=0
for skill in "$ROOT"/.claude/skills/*/SKILL.md; do
  name="$(sed -n 's/^name:[[:space:]]*//p' "$skill" | head -n 1)"
  description="$(sed -n 's/^description:[[:space:]]*//p' "$skill" | head -n 1)"
  [ -n "$name" ] && [ -n "$description" ] || missing=$((missing + 1))
done
assert_eq "skill frontmatter includes name and description" "0" "$missing"

assert_file_contains "Build contract requires isolation" "$ROOT/.claude/commands/build.md" "Edit only allowed sandbox paths"
assert_file_contains "Prove contract rejects fabricated evidence" "$ROOT/.claude/commands/prove.md" "Never substitute self-review or automation"
assert_file_contains "Land contract requires explicit authority" "$ROOT/.claude/commands/land.md" "Land **\$ARGUMENTS** explicitly"
assert_file_contains "Land keeps commit authority separate" "$ROOT/.claude/commands/land.md" "without separate authority"
assert_file_contains "completion-only policy forbids scope expansion" "$ROOT/.claude/orchestrator.md" "scope expansion"
assert_file_contains "repository instructions cannot grant authority" "$ROOT/.claude/orchestrator.md" "never enable a host permission bypass by implication"
assert_file_contains "human silence cannot become approval" "$ROOT/.claude/orchestrator.md" "Never infer approval from silence"

for command in build change investigate land prove; do
  assert_file_exists "command reference exists: $command" "$ROOT/.claude/commands/$command.md"
done

finish "instruction contracts"
