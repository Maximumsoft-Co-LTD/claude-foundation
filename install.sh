#!/usr/bin/env bash
# Install the OpenSpec-native Foundation harness into an existing project.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_PATH=""
SOURCE_PATH="$SCRIPT_DIR"
ASSUME_YES=no
DRY_RUN=no

fail() { printf '✗ %s\n' "$*" >&2; exit 1; }
info() { printf '▸ %s\n' "$*"; }
ok() { printf '✓ %s\n' "$*"; }

usage() {
  cat <<'EOF'
claude-foundation init [target-path] [options]

Options:
  --source <path>  Foundation source checkout
  --yes, -y        Do not ask for confirmation
  --dry-run        Show files without writing
  --force, -f      Accepted for backward compatibility; managed files refresh
  --help, -h       Show this help

Installs the OpenSpec-native change loop:
  /investigate → /change → /build → /prove → /land

`/dev` remains a compatibility composition of change → build → prove.
Existing `.workflow/` records are preserved as read-only migration sources.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --source) [ "$#" -ge 2 ] || fail "--source needs a path"; SOURCE_PATH="$2"; shift ;;
    --yes|-y) ASSUME_YES=yes ;;
    --dry-run) DRY_RUN=yes ;;
    --force|-f) : ;;
    --help|-h) usage; exit 0 ;;
    -*) fail "unknown option: $1" ;;
    *) [ -z "$TARGET_PATH" ] || fail "unexpected argument: $1"; TARGET_PATH="$1" ;;
  esac
  shift
done

TARGET_PATH="${TARGET_PATH:-$PWD}"
mkdir -p "$TARGET_PATH"
TARGET_PATH="$(cd "$TARGET_PATH" && pwd)"
SOURCE_PATH="$(cd "$SOURCE_PATH" && pwd)"
[ "$TARGET_PATH" != "$SOURCE_PATH" ] || fail "target cannot be the Foundation source"

for required in \
  .claude/orchestrator.md .claude/commands .claude/harness/foundation.mjs \
  .claude/skills .claude/rules .claude/hooks .claude/settings.json \
  openspec/config.yaml openspec/schemas .foundation/.gitignore WORKFLOW.md; do
  [ -e "$SOURCE_PATH/$required" ] || fail "source is missing $required"
done

# Managed product files. Project-owned specs, changes, runtime, and local settings
# are intentionally absent.
MANAGED=(
  ".claude/orchestrator.md"
  ".claude/commands"
  ".claude/harness"
  ".claude/skills"
  ".claude/rules"
  ".claude/hooks"
  "openspec/schemas"
  ".foundation/.gitignore"
  ".foundation/README.md"
  "WORKFLOW.md"
)

# Files written by the phase orchestrator in earlier releases. Exact paths only:
# custom user agents/hooks are never removed.
LEGACY=(
  ".claude/commands/spec.md" ".claude/commands/dev-plan.md"
  ".claude/commands/test-plan.md" ".claude/commands/implement.md"
  ".claude/commands/uxui-plan.md"
  ".claude/agents/pm.md" ".claude/agents/lead.md" ".claude/agents/engineer.md"
  ".claude/agents/qa.md" ".claude/agents/retro.md" ".claude/agents/uxui.md"
  ".claude/agents/team-best-practice-researcher.md"
  ".claude/agents/team-code-reviewer.md"
  ".claude/agents/team-silent-failure-hunter.md"
  ".claude/agents/team-pr-test-analyzer.md"
  ".claude/agents/team-codebase-explorer.md"
  ".claude/agents/team-type-design-analyzer.md"
  ".claude/agents/INDEX.md" ".claude/agents/TEAM.md"
  ".claude/agents/references/pm.md" ".claude/agents/references/lead.md"
  ".claude/agents/references/engineer.md" ".claude/agents/references/qa.md"
  ".claude/hooks/dev-agent-guard.sh" ".claude/hooks/dev-state-mark.sh"
  ".claude/hooks/dev-state-validate.sh" ".claude/hooks/artifact-lint.sh"
  ".claude/hooks/tests"
  ".claude/orchestrator/references"
  ".claude/skills/fanout-team-agents" ".claude/skills/qa-handoff-note"
  ".claude/skills/brainstorming/references" ".claude/skills/plan-writing/references"
  ".workflow/_templates"
)

info "Install plan"
for rel in "${MANAGED[@]}"; do printf '  ~ %s\n' "$rel"; done
[ -e "$TARGET_PATH/openspec/config.yaml" ] || printf '  + openspec/config.yaml\n'
printf '  ~ .claude/settings.json (merge hooks, preserve user settings)\n'
printf '  ~ CLAUDE.md (managed pointer only)\n'
for rel in "${LEGACY[@]}"; do
  [ -e "$TARGET_PATH/$rel" ] && printf '  - %s (legacy phase control plane)\n' "$rel"
done

if [ "$DRY_RUN" = yes ]; then ok "dry run complete"; exit 0; fi
if [ "$ASSUME_YES" != yes ]; then
  printf 'Proceed? [y/N] '
  read -r answer
  case "$answer" in y|Y|yes|YES) : ;; *) fail "aborted" ;; esac
fi

for rel in "${MANAGED[@]}"; do
  src="$SOURCE_PATH/$rel"; dst="$TARGET_PATH/$rel"
  mkdir -p "$(dirname "$dst")"
  if [ -d "$src" ]; then
    mkdir -p "$dst"
    cp -R "$src/." "$dst/"
  else
    cp "$src" "$dst"
  fi
done

if [ ! -e "$TARGET_PATH/openspec/config.yaml" ]; then
  mkdir -p "$TARGET_PATH/openspec"
  cp "$SOURCE_PATH/openspec/config.yaml" "$TARGET_PATH/openspec/config.yaml"
fi

for rel in "${LEGACY[@]}"; do
  [ ! -e "$TARGET_PATH/$rel" ] || rm -rf "$TARGET_PATH/$rel"
done

SETTINGS_SRC="$SOURCE_PATH/.claude/settings.json"
SETTINGS_DST="$TARGET_PATH/.claude/settings.json"
if [ ! -e "$SETTINGS_DST" ]; then
  mkdir -p "$(dirname "$SETTINGS_DST")"
  cp "$SETTINGS_SRC" "$SETTINGS_DST"
elif command -v jq >/dev/null 2>&1; then
  backup="$SETTINGS_DST.backup-$(date +%Y%m%d-%H%M%S)"
  cp "$SETTINGS_DST" "$backup"
  merged="$(jq --slurpfile src "$SETTINGS_SRC" '
    def remove_legacy:
      .hooks //= {} |
      .hooks |= with_entries(
        .value |= map(
          .hooks |= map(select(
            (.command | test("hooks/(dev-agent-guard|dev-state-mark|dev-state-validate|artifact-lint)\\.sh")) | not
          ))
        ) | .value |= map(select((.hooks | length) > 0))
      );
    def upsert($event; $matcher; $hook):
      .hooks //= {} |
      .hooks[$event] //= [] |
      if (.hooks[$event] | any(.matcher == $matcher)) then
        .hooks[$event] |= map(if .matcher == $matcher then
          .hooks = ((.hooks // []) +
            (if (.hooks | any(.command == $hook.command)) then [] else [$hook] end))
          else . end)
      else .hooks[$event] += [{matcher:$matcher,hooks:[$hook]}] end;
    remove_legacy |
    reduce ($src[0].hooks | to_entries[]) as $event (.;
      reduce ($event.value[]) as $entry (.;
        reduce ($entry.hooks[]) as $hook (.;
          upsert($event.key; $entry.matcher; $hook))))' "$SETTINGS_DST")"
  printf '%s\n' "$merged" > "$SETTINGS_DST"
else
  cp "$SETTINGS_SRC" "$TARGET_PATH/.claude/settings.foundation.json"
  printf '⚠ jq unavailable; merge .claude/settings.foundation.json manually\n' >&2
fi

CLAUDE_DST="$TARGET_PATH/CLAUDE.md"
START="<!-- claude-foundation:change-loop:start -->"
END="<!-- claude-foundation:change-loop:end -->"
BLOCK="$(cat <<'EOF'
<!-- claude-foundation:change-loop:start -->
## Foundation change loop

Use `/investigate` when the problem is unclear, otherwise use `/change`.
The delivery loop is `/change → /build → /prove → /land`; `/dev` is a
compatibility composition that stops after proof.

@.claude/orchestrator.md
@.claude/rules/fundamentals.md
<!-- claude-foundation:change-loop:end -->
EOF
)"
if [ ! -e "$CLAUDE_DST" ]; then
  printf '# CLAUDE.md\n\n%s\n' "$BLOCK" > "$CLAUDE_DST"
elif grep -qF "$START" "$CLAUDE_DST"; then
  tmp="$(mktemp)"
  block_tmp="$(mktemp)"
  printf '%s\n' "$BLOCK" > "$block_tmp"
  awk -v start="$START" -v end="$END" '
    FNR==NR { replacement=replacement $0 ORS; next }
    index($0,start) { printf "%s", replacement; skip=1; next }
    index($0,end) { skip=0; next }
    !skip { print }
  ' "$block_tmp" "$CLAUDE_DST" > "$tmp"
  rm -f "$block_tmp"
  mv "$tmp" "$CLAUDE_DST"
else
  printf '\n%s\n' "$BLOCK" >> "$CLAUDE_DST"
fi

if ! command -v node >/dev/null 2>&1; then
  printf '⚠ Node.js >=20.19 is required by OpenSpec and the Foundation harness\n' >&2
elif ! command -v openspec >/dev/null 2>&1; then
  printf '⚠ Install pinned OpenSpec: npm install -g @fission-ai/openspec@1.7.0\n' >&2
fi

ok "OpenSpec-native Foundation installed at $TARGET_PATH"
printf 'Next: /change <intent>\n'
