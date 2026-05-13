#!/usr/bin/env bash
# claude-foundation installer — drop the /dev workflow into a target project.
#
# Usage:
#   ./install.sh [target-path] [--source <path>] [--force] [--yes] [--dry-run]
#
# Default target is the current directory. Default source is the directory
# this script lives in.

set -euo pipefail

SCRIPT_NAME="$(basename "$0")"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── ANSI colors (off when not a TTY) ────────────────────────────────────────
if [ -t 1 ]; then
  R=$'\033[0;31m'; G=$'\033[0;32m'; Y=$'\033[1;33m'; B=$'\033[0;34m'; D=$'\033[2m'; N=$'\033[0m'
else
  R=''; G=''; Y=''; B=''; D=''; N=''
fi

info() { printf "%s\n" "${B}▸${N} $*"; }
ok()   { printf "%s\n" "${G}✓${N} $*"; }
warn() { printf "%s\n" "${Y}⚠${N} $*" >&2; }
fail() { printf "%s\n" "${R}✗${N} $*" >&2; exit 1; }

usage() {
  cat <<EOF
${SCRIPT_NAME} — install the /dev workflow into a project

Usage:
  ${SCRIPT_NAME} [target-path] [options]

Arguments:
  target-path        Where to install (default: current directory)

Options:
  --source <path>    Source repo (default: directory containing this script)
  --force, -f        Overwrite existing agent/command/workflow files
  --yes, -y          Skip the confirmation prompt
  --dry-run          Print the plan, write nothing
  -h, --help         Show this help

What gets installed:
  .claude/agents/*.md          — pm, lead, engineer, qa, retro (sub-agents)
  .claude/orchestrator.md      — orchestrator script run by the main agent on /dev
  .claude/commands/dev.md      — the /dev slash command (loads orchestrator.md)
  .claude/skills/**            — programming / database / debug / hexagonal / queue fundamentals
  .claude/rules/*.md           — always-on pointers to the skills above
  .claude/hooks/lint.sh        — PostToolUse lint dispatcher
  .claude/settings.json        — hook wiring (only if missing)
  .workflow/_templates/*       — spec/plan/review/security/tests/recommendations/retro/epic + state.json
  .workflow/INDEX.md           — fresh registry (only if missing)
  .workflow/FOLLOWUPS.md       — follow-up registry (only if missing)
  WORKFLOW.md                  — full flow reference at repo root
  CLAUDE.md                    — minimal stub (only if missing)

Behavior:
  - agents/commands/skills/rules/hooks/settings.json/templates/WORKFLOW.md:
      skipped if present, unless --force
  - .workflow/INDEX.md, .workflow/FOLLOWUPS.md & CLAUDE.md: never overwritten (user state)
  - .claude/settings.local.json is never touched (user-local config)
  - settings.json side-file: if the target already has .claude/settings.json
      and our PostToolUse lint hook isn't in it, we drop our config as
      .claude/settings.foundation.json (pure JSON) and print merge instructions.
      We never auto-merge — settings.json can hold permissions/model/env that
      a silent rewrite would surprise.
  - Upgrade cleanup: files removed by a newer foundation version (e.g. the
      legacy .claude/agents/orchestrator.md sub-agent) are deleted from the
      target on every run. The CLEANUP array in this script is the source of
      truth — extend it whenever a fix removes a previously-installed file.
EOF
}

# ── Parse args ──────────────────────────────────────────────────────────────
TARGET_PATH=""
SOURCE_PATH="$SCRIPT_DIR"
FORCE="no"
ASSUME_YES="no"
DRY_RUN="no"

while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --source)
      [ $# -ge 2 ] || fail "--source needs a path"
      SOURCE_PATH="$2"; shift ;;
    -f|--force)   FORCE="yes" ;;
    -y|--yes)     ASSUME_YES="yes" ;;
    --dry-run)    DRY_RUN="yes" ;;
    -*)           fail "Unknown option: $1" ;;
    *)
      [ -z "$TARGET_PATH" ] || fail "Unexpected positional argument: $1"
      TARGET_PATH="$1" ;;
  esac
  shift
done

expand_path() {
  local p="$1"
  case "$p" in "~"|"~/"*) p="${HOME}${p#\~}" ;; esac
  if [ -d "$p" ]; then
    ( cd "$p" && pwd )
  else
    local parent base
    parent="$(dirname "$p")"
    base="$(basename "$p")"
    if [ -d "$parent" ]; then
      printf "%s/%s\n" "$(cd "$parent" && pwd)" "$base"
    else
      printf "%s\n" "$p"
    fi
  fi
}

TARGET_PATH="${TARGET_PATH:-$PWD}"
TARGET_PATH="$(expand_path "$TARGET_PATH")"
SOURCE_PATH="$(expand_path "$SOURCE_PATH")"

# ── Validate source ─────────────────────────────────────────────────────────
[ -d "$SOURCE_PATH" ] || fail "source not found: $SOURCE_PATH"
for needed in \
  ".claude/agents" \
  ".claude/orchestrator.md" \
  ".claude/commands/dev.md" \
  ".claude/skills" \
  ".claude/rules" \
  ".claude/hooks/lint.sh" \
  ".claude/settings.json" \
  ".workflow/_templates" \
  ".workflow/_templates/state.json" \
  ".workflow/FOLLOWUPS.md" \
  "WORKFLOW.md"; do
  [ -e "$SOURCE_PATH/$needed" ] || fail "source is missing $needed — pass --source with the claude-foundation repo path"
done
ok "source: $SOURCE_PATH"

# ── Validate / create target ────────────────────────────────────────────────
if [ ! -d "$TARGET_PATH" ]; then
  if [ "$ASSUME_YES" = "yes" ] || [ "$DRY_RUN" = "yes" ]; then
    [ "$DRY_RUN" = "yes" ] || mkdir -p "$TARGET_PATH"
  else
    printf "Target %s doesn't exist. Create it? [y/N] " "$TARGET_PATH"
    read -r ans
    case "$ans" in y|Y|yes|YES) mkdir -p "$TARGET_PATH" ;; *) fail "aborted" ;; esac
  fi
fi
[ "$DRY_RUN" = "yes" ] || TARGET_PATH="$(expand_path "$TARGET_PATH")"

# Self-copy guard
case "$TARGET_PATH" in
  "$SOURCE_PATH"|"$SOURCE_PATH"/*) fail "target ($TARGET_PATH) is the same as or inside source ($SOURCE_PATH)" ;;
esac
ok "target: $TARGET_PATH"

# ── Plan ────────────────────────────────────────────────────────────────────
# Each row: "<src-relative-path>|<mode>"
# mode = skip-if-exists | force-overwrite | always-overwrite | never-overwrite
#
# A row whose path is a directory in the source is expanded into one row per
# file beneath it (recursive), each inheriting the same mode. That keeps the
# dry-run output file-accurate without a 30-line manual enumeration.
PLAN=(
  ".claude/orchestrator.md|skip-if-exists"
  ".claude/agents/pm.md|skip-if-exists"
  ".claude/agents/lead.md|skip-if-exists"
  ".claude/agents/engineer.md|skip-if-exists"
  ".claude/agents/qa.md|skip-if-exists"
  ".claude/agents/retro.md|skip-if-exists"
  ".claude/commands/dev.md|skip-if-exists"
  ".claude/skills|skip-if-exists"
  ".claude/rules|skip-if-exists"
  ".claude/hooks/lint.sh|skip-if-exists"
  ".claude/settings.json|skip-if-exists"
  ".workflow/_templates/spec.md|always-overwrite"
  ".workflow/_templates/plan.md|always-overwrite"
  ".workflow/_templates/review.md|always-overwrite"
  ".workflow/_templates/security.md|always-overwrite"
  ".workflow/_templates/tests.md|always-overwrite"
  ".workflow/_templates/recommendations.md|always-overwrite"
  ".workflow/_templates/retro.md|always-overwrite"
  ".workflow/_templates/epic.md|always-overwrite"
  ".workflow/_templates/state.json|always-overwrite"
  ".workflow/INDEX.md|never-overwrite"
  ".workflow/FOLLOWUPS.md|never-overwrite"
  "WORKFLOW.md|skip-if-exists"
)

# Files removed by a previous foundation version that must be deleted from
# upgraded targets (otherwise stale sub-agent / command files keep registering
# and the new flow breaks). Each row is "<target-relative-path>|<why>".
# Add a row whenever a fix removes a file the installer used to write.
CLEANUP=(
  ".claude/agents/orchestrator.md|moved to .claude/orchestrator.md — sub-agents can't spawn sub-agents or call AskUserQuestion"
)

# Expand directory rows into per-file rows.
EXPANDED_PLAN=()
for row in "${PLAN[@]}"; do
  rel="${row%|*}"; mode="${row#*|}"
  src="$SOURCE_PATH/$rel"
  if [ -d "$src" ]; then
    while IFS= read -r -d '' file; do
      sub_rel="${file#"$SOURCE_PATH"/}"
      EXPANDED_PLAN+=("$sub_rel|$mode")
    done < <(find "$src" -type f -print0 | LC_ALL=C sort -z)
  else
    EXPANDED_PLAN+=("$row")
  fi
done
PLAN=("${EXPANDED_PLAN[@]}")

resolve_action() {
  local mode="$1" dst="$2"
  case "$mode" in
    skip-if-exists)
      if [ ! -e "$dst" ]; then echo "copy"
      elif [ "$FORCE" = "yes" ]; then echo "overwrite"
      else echo "skip"; fi ;;
    always-overwrite)
      if [ ! -e "$dst" ]; then echo "copy"; else echo "overwrite"; fi ;;
    never-overwrite)
      if [ ! -e "$dst" ]; then echo "copy"; else echo "skip"; fi ;;
    *) echo "skip" ;;
  esac
}

info "Plan"
NEW=0; OVR=0; SKP=0
for row in "${PLAN[@]}"; do
  rel="${row%|*}"; mode="${row#*|}"
  src="$SOURCE_PATH/$rel"
  dst="$TARGET_PATH/$rel"
  if [ ! -e "$src" ]; then
    printf "  ${D}? %s — missing in source${N}\n" "$rel"
    continue
  fi
  action="$(resolve_action "$mode" "$dst")"
  case "$action" in
    copy)      printf "  ${G}+${N} %s\n" "$rel"; NEW=$((NEW+1)) ;;
    overwrite) printf "  ${Y}~${N} %s ${D}(overwrite)${N}\n" "$rel"; OVR=$((OVR+1)) ;;
    skip)      printf "  ${D}=${N} %s ${D}(kept)${N}\n" "$rel"; SKP=$((SKP+1)) ;;
  esac
done
printf "\n  Summary: ${G}%d new${N}, ${Y}%d overwrite${N}, ${D}%d kept${N}\n" "$NEW" "$OVR" "$SKP"

# Show cleanup plan — files that exist in the target and will be deleted on apply.
CLEANUP_HITS=0
for row in "${CLEANUP[@]}"; do
  rel="${row%%|*}"; why="${row#*|}"
  dst="$TARGET_PATH/$rel"
  if [ -e "$dst" ]; then
    printf "  ${R}-${N} %s ${D}(remove: %s)${N}\n" "$rel" "$why"
    CLEANUP_HITS=$((CLEANUP_HITS+1))
  fi
done
if [ "$CLEANUP_HITS" -gt 0 ]; then
  printf "  ${R}%d to remove${N}\n" "$CLEANUP_HITS"
fi

# CLAUDE.md stub (separate from PLAN — generated, not copied)
CLAUDE_DST="$TARGET_PATH/CLAUDE.md"
if [ -e "$CLAUDE_DST" ]; then
  printf "  ${D}=${N} CLAUDE.md ${D}(kept)${N}\n"
else
  printf "  ${G}+${N} CLAUDE.md ${D}(stub — points at WORKFLOW.md)${N}\n"
fi

# settings.json hook check. PLAN keeps the existing settings.json so we never
# clobber user permissions/model/env config — but that means a target that
# already has settings.json doesn't get our PostToolUse lint hook wired in.
# Detect that case and plan to drop the snippet at .claude/settings.foundation.json
# so the user can merge it by hand. Cheap substring check (no jq dependency).
SETTINGS_SRC="$SOURCE_PATH/.claude/settings.json"
SETTINGS_DST="$TARGET_PATH/.claude/settings.json"
SETTINGS_SNIPPET="$TARGET_PATH/.claude/settings.foundation.json"
SETTINGS_ACTION="none"
if [ -e "$SETTINGS_DST" ] && [ -e "$SETTINGS_SRC" ]; then
  if grep -q "hooks/lint.sh" "$SETTINGS_DST" 2>/dev/null; then
    SETTINGS_ACTION="hook-already-wired"
  else
    SETTINGS_ACTION="write-snippet"
    printf "  ${Y}!${N} .claude/settings.json ${D}(kept — our PostToolUse lint hook is not wired; will drop snippet at .claude/settings.foundation.json for you to merge)${N}\n"
  fi
fi

if [ "$DRY_RUN" = "yes" ]; then
  printf "\n${Y}✓ Dry run complete. Re-run without --dry-run to apply.${N}\n"
  exit 0
fi

if [ "$ASSUME_YES" != "yes" ]; then
  printf "\nProceed? [y/N] "
  read -r ans
  case "$ans" in y|Y|yes|YES) : ;; *) fail "aborted" ;; esac
fi

# ── Apply ───────────────────────────────────────────────────────────────────
info "Installing"
for row in "${PLAN[@]}"; do
  rel="${row%|*}"; mode="${row#*|}"
  src="$SOURCE_PATH/$rel"
  dst="$TARGET_PATH/$rel"
  [ -e "$src" ] || continue
  action="$(resolve_action "$mode" "$dst")"
  case "$action" in
    copy|overwrite)
      mkdir -p "$(dirname "$dst")"
      cp "$src" "$dst" ;;
    skip) : ;;
  esac
done

# Upgrade cleanup: walk the CLEANUP array and delete any legacy files that earlier
# foundation versions installed but newer versions removed (e.g., a sub-agent that
# became a main-agent script). Without this step, stale .claude/agents/*.md files
# would keep registering as sub-agents and break the new flow.
REMOVED=0
for row in "${CLEANUP[@]}"; do
  rel="${row%%|*}"; why="${row#*|}"
  dst="$TARGET_PATH/$rel"
  if [ -e "$dst" ]; then
    printf "  ${R}-${N} %s ${D}(%s)${N}\n" "$rel" "$why"
    rm -f "$dst"
    REMOVED=$((REMOVED+1))
  fi
done

# settings.json side-file when target already has its own settings.json.
# We don't merge automatically — settings.json can contain permissions, model,
# env, etc., and silently rewriting it would be surprising. Instead, drop our
# block as a pure-JSON side-file the user can copy from. Merge instructions
# go to stdout (the side-file stays valid JSON so it round-trips through tools).
if [ "$SETTINGS_ACTION" = "write-snippet" ]; then
  mkdir -p "$(dirname "$SETTINGS_SNIPPET")"
  cp "$SETTINGS_SRC" "$SETTINGS_SNIPPET"
  printf "  ${Y}!${N} wrote %s ${D}(see merge instructions below)${N}\n" ".claude/settings.foundation.json"
fi

# CLAUDE.md stub
if [ ! -e "$CLAUDE_DST" ]; then
  cat > "$CLAUDE_DST" <<'EOF'
# CLAUDE.md

Project uses the claude-foundation `/dev` workflow.

Entry point: `/dev <intent>` (or `/dev --resume <id>`) — spec → plan → gate → implement → review → (security) → test → docs → ship → retro.

The flow is type-aware: `feat` / `fix` / `refactor` / `chore` / `docs` / `spike` each skip or specialise some phases (e.g., `fix` writes its regression test before the fix; `chore` skips QA; `spike` produces `recommendations.md` instead of code).

Full flow: see `WORKFLOW.md`.
Agents live under `.claude/agents/`; run artifacts land in `.workflow/<id>/`; cross-run state lives in `.workflow/INDEX.md` and `.workflow/FOLLOWUPS.md`.
EOF
fi

ok "files written"

# ── Summary ─────────────────────────────────────────────────────────────────
printf "\n${G}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${N}\n"
printf "${G}✓ claude-foundation installed${N} at %s\n" "$TARGET_PATH"
printf "${G}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${N}\n"
cat <<EOF

  Files     : ${NEW} new, ${OVR} overwritten, ${SKP} kept, ${REMOVED:-0} removed

  Next steps:
    1. Open the project in Claude Code
    2. Run:  /dev <intent>
    3. Review WORKFLOW.md for the full flow definition
EOF

if [ "$SETTINGS_ACTION" = "write-snippet" ]; then
  cat <<EOF

  ${Y}⚠ settings.json already existed in your project — kept as-is.${N}
  Our PostToolUse lint hook is NOT wired in. To enable it:

    1. Open .claude/settings.foundation.json (we just wrote it).
    2. Copy the "hooks.PostToolUse" entry into your .claude/settings.json.
       If your settings.json already has a "PostToolUse" array, append our
       entry to the existing list — don't replace it.
    3. Delete .claude/settings.foundation.json.

  If you don't want the lint hook, just delete the snippet file.
EOF
fi
