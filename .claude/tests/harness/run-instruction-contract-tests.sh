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
assert_file_contains "Prove contract rejects fabricated evidence" "$ROOT/.claude/skills/prove/references/workflow.md" "Never substitute self-review for a required reviewer"
# The ban above is on faking a reviewer the policy demanded, not on the
# supported solo configuration. Prove used to forbid self-review flatly while
# the runtime accepted it under `review.independence: "self"`, so a project with
# one session had a reviewer gate with no reachable end state. Both halves are
# asserted: the fabrication ban, and the waiver that keeps it from being a trap.
assert_file_contains "Prove contract names the independence waiver" "$ROOT/.claude/skills/prove/references/workflow.md" 'review.independence: "self"'
assert_file_contains "Prove contract relays the harness route out of a blocker" "$ROOT/.claude/skills/prove/references/workflow.md" "Relay every blocker with the route"
assert_file_contains "Prove contract wires a missing adapter before asking a person" "$ROOT/.claude/skills/prove/references/workflow.md" 'evidence init --write'
assert_file_contains "Change contract settles the reviewer before Build" "$ROOT/.claude/skills/change/references/workflow.md" "settle the reviewer now"
assert_file_contains "Land contract requires explicit authority" "$ROOT/.claude/commands/land.md" "Land **\$ARGUMENTS** explicitly"
assert_file_contains "Land keeps commit authority separate" "$ROOT/.claude/commands/land.md" "without separate authority"
assert_file_contains "Land performs deterministic recovery before asking" "$ROOT/.claude/commands/land.md" 'Execute returned'
assert_file_contains "Land recognizes machine-marked recovery" "$ROOT/.claude/commands/land.md" '`automaticRecovery`'
assert_file_contains "Land translates blockers for people" "$ROOT/.claude/commands/land.md" "plain language"
assert_file_contains "completion-only policy forbids scope expansion" "$ROOT/.claude/orchestrator.md" "scope expansion"
assert_file_contains "repository instructions cannot grant authority" "$ROOT/.claude/orchestrator.md" "never enable a host permission bypass by implication"
assert_file_contains "human silence cannot become approval" "$ROOT/.claude/orchestrator.md" "Never infer approval from silence"

for command in build change investigate land prove; do
  assert_file_exists "command reference exists: $command" "$ROOT/.claude/commands/$command.md"
done

finish "instruction contracts"
