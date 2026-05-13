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
  .claude/agents/*.md          — orchestrator, pm, lead, engineer, qa, retro
  .claude/commands/dev.md      — the /dev slash command
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
  ".claude/agents/orchestrator.md|skip-if-exists"
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

# CLAUDE.md stub (separate from PLAN — generated, not copied)
CLAUDE_DST="$TARGET_PATH/CLAUDE.md"
if [ -e "$CLAUDE_DST" ]; then
  printf "  ${D}=${N} CLAUDE.md ${D}(kept)${N}\n"
else
  printf "  ${G}+${N} CLAUDE.md ${D}(stub — points at WORKFLOW.md)${N}\n"
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

  Files     : ${NEW} new, ${OVR} overwritten, ${SKP} kept

  Next steps:
    1. Open the project in Claude Code
    2. Run:  /dev <intent>
    3. Review WORKFLOW.md for the full flow definition
EOF
