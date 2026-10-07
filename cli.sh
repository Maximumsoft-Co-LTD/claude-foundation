#!/usr/bin/env bash
# claude-foundation — top-level CLI router.
#
# Keeps each command single-purpose: this file only routes, install.sh only
# installs, dashboard/client.sh only does presence. New subcommands slot in
# here without piling into the installer.
#
# Public workflow commands resolve the current Foundation project and forward to
# its installed runtime. The runtime remains project-owned so its schemas,
# commands, and evidence protocol upgrade together.
#
# Siblings are located relative to this script, so it works the same from a
# source checkout and from the Homebrew libexec.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXPECTED_RUNTIME_API=41
PROJECT_START="${CLAUDE_FOUNDATION_PROJECT:-$PWD}"

fail() { printf 'claude-foundation: %s\n' "$*" >&2; exit 1; }
warn() { printf 'claude-foundation: warning: %s\n' "$*" >&2; }

installed_version() {
  if [ -f "$SCRIPT_DIR/VERSION" ]; then
    tr -d '[:space:]' < "$SCRIPT_DIR/VERSION"
  else
    printf 'unknown\n'
  fi
}

find_project_root() {
  local cursor="$PROJECT_START" skipped="" owner=""
  [ -d "$cursor" ] || cursor="$(dirname "$cursor")"
  cursor="$(cd "$cursor" 2>/dev/null && pwd)" ||
    fail "cannot access project path: $PROJECT_START"
  while :; do
    if [ -f "$cursor/openspec/config.yaml" ] &&
       [ -f "$cursor/.claude/harness/foundation.mjs" ]; then
      # A Build sandbox is a full copy of the project, marker files included.
      # Resolving to the copy would split runtime state between the sandbox's
      # .foundation/ and the project's, so resolution walks past a sandbox
      # unless CLAUDE_FOUNDATION_PROJECT deliberately pins one. Walking past
      # the copy to the project that owns it is the ordinary Build case and
      # stays silent; only a different resolved root is worth a warning.
      case "${CLAUDE_FOUNDATION_PROJECT:+pinned}:$cursor" in
        pinned:*)
          printf '%s\n' "$cursor"
          return
          ;;
        *:*/.foundation/sandboxes/*|*:*/.foundation/repository-sandboxes/*)
          if [ -z "$skipped" ]; then
            skipped="$cursor"
            owner="${cursor%%/.foundation/sandboxes/*}"
            owner="${owner%%/.foundation/repository-sandboxes/*}"
          fi
          ;;
        *)
          if [ -n "$skipped" ] && [ "$cursor" != "$owner" ]; then
            warn "ignoring sandbox copy at $skipped; resolved project root $cursor is not its owner $owner"
          fi
          printf '%s\n' "$cursor"
          return
          ;;
      esac
    fi
    [ "$cursor" != "/" ] || break
    cursor="$(dirname "$cursor")"
  done
  fail "not inside a Foundation project; run 'claude-foundation init <path>' first"
}

run_runtime() {
  local access="$1" phase="$2"; shift 2
  local root runtime actual_api telemetry
  root="$(find_project_root)"
  runtime="$root/.claude/harness/foundation.mjs"
  command -v node >/dev/null 2>&1 || fail "Node.js is required to run the project harness"
  cd "$root"
  actual_api="$(node "$runtime" api-version 2>/dev/null || true)"
  if [ "$actual_api" != "$EXPECTED_RUNTIME_API" ]; then
    if [ "$access" = "write" ]; then
      fail "project runtime API '${actual_api:-unknown}' is incompatible with CLI API '$EXPECTED_RUNTIME_API'; run 'claude-foundation init \"$root\"' to update it"
    fi
    printf "claude-foundation: warning: project runtime API '%s' differs from CLI API '%s'\n" \
      "${actual_api:-unknown}" "$EXPECTED_RUNTIME_API" >&2
  fi
  telemetry=1
  [ "$access" != "inspect" ] || telemetry=0
  FOUNDATION_TELEMETRY="$telemetry" FOUNDATION_PUBLIC_OPERATION="$phase" \
    FOUNDATION_INSTALLED_CLI_VERSION="$(installed_version)" exec node "$runtime" "$@"
}

deprecated_install() {
  printf "claude-foundation: warning: implicit installation is deprecated; use 'claude-foundation init ...'\n" >&2
  exec bash "$SCRIPT_DIR/install.sh" "$@" --source "$SCRIPT_DIR"
}

# VERSION file is the single machine-readable source of truth (bumped at release
# time — see RELEASING.md). Fall back to `git describe` for a source checkout
# whose file was deleted; "unknown" only if both are unavailable.
print_version() {
  local v="" describe="" git_root="" source_root=""
  if [ -f "$SCRIPT_DIR/VERSION" ]; then
    v="$(tr -d '[:space:]' < "$SCRIPT_DIR/VERSION")"
  fi
  if command -v git >/dev/null 2>&1; then
    git_root="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || true)"
    source_root="$(cd "$SCRIPT_DIR" 2>/dev/null && pwd -P || true)"
  fi
  if [ -n "$git_root" ] && [ "$(cd "$git_root" && pwd -P)" = "$source_root" ]; then
    describe="$(git -C "$SCRIPT_DIR" describe --tags --always --dirty 2>/dev/null || true)"
    describe="${describe#v}"
    if [ -z "$v" ]; then
      v="$describe"
    elif [ -n "$describe" ] && [ "$describe" != "$v" ]; then
      v="$v+source.$describe"
    fi
  fi
  printf 'claude-foundation %s\n' "${v:-unknown}"
}

DISPATCH="$SCRIPT_DIR/.claude/harness/runtime/core/cli-dispatch.mjs"

# Every runtime route — its runtime name, access class, argument check, and
# phase — is derived from commands.json by cli-dispatch.mjs.
route_runtime() {
  local route status=0
  command -v node >/dev/null 2>&1 || fail "Node.js is required to run the project harness"
  route="$(node "$DISPATCH" route "$@")" || status=$?
  if [ "$status" -eq 3 ]; then
    if [ -d "$1" ]; then deprecated_install "$@"
    else fail "unknown command '$1'; run 'claude-foundation help'"
    fi
  fi
  [ "$status" -eq 0 ] || exit "$status"
  eval "set -- $route"
  run_runtime "$@"
}

case "${1:-}" in
  --project|-C)
    [ "$#" -ge 2 ] || fail "$1 needs a path"
    PROJECT_START="$2"
    shift 2 ;;
esac

# commands.json promises "every command also answers --help". Route it to
# `describe` before the per-command argument checks below, which otherwise
# reject it as an unexpected argument for every zero-argument command.
case "${1:-}" in
  ""|help|--help|-h|version|--version|-v|describe|host|update) : ;;
  *)
    for arg in "$@"; do
      [ "$arg" = "--help" ] || continue
      help_target="$1"
      case "${2:-}" in ""|--*) ;; *) help_target="$1 $2" ;; esac
      run_runtime inspect "" describe "$help_target"
    done ;;
esac

case "${1:-}" in
  version|--version|-v)
    print_version; exit 0 ;;
  describe)
    shift
    [ "$#" -le 2 ] || fail "describe accepts [command] [--json]"
    run_runtime inspect "" describe "$@" ;;
  help|--help|-h)
    [ "$#" -le 2 ] || fail "help accepts only --all"
    [ "${2:-}" != "" ] && [ "${2:-}" != "--all" ] && \
      [ "${2:-}" != "--help" ] && fail "help accepts only --all"
    command -v node >/dev/null 2>&1 || fail "Node.js is required to print help"
    exec node "$DISPATCH" help "${2:-}" ;;
  host)
    shift
    sub="${1:-}"; [ "$#" -gt 0 ] && shift
    case "$sub" in
      agent-contract)
        command -v node >/dev/null 2>&1 || fail "Node.js is required to resolve the host agent contract"
        if [ "${1:-}" = "--help" ] && [ "$#" -eq 1 ]; then
          printf '%s\n' \
            'claude-foundation host agent-contract [--protocol 1] [--format json]' \
            'Return the package-owned Foundation agent contract as protocol-1 JSON.'
          exit 0
        fi
        exec node "$SCRIPT_DIR/.claude/harness/runtime/core/host-agent-contract.mjs" "$@" ;;
      instruction)
        command -v node >/dev/null 2>&1 || fail "Node.js is required to resolve host instructions"
        if [ "${1:-}" = "--help" ] && [ "$#" -eq 1 ]; then
          printf '%s\n' \
            'claude-foundation host instruction <command> [--protocol 1] [--format json] [--arguments <text>]' \
            'Return a package-owned Foundation workflow instruction as protocol-1 JSON.'
          exit 0
        fi
        exec node "$SCRIPT_DIR/.claude/harness/runtime/core/host-instruction.mjs" "$@" ;;
      *) fail "host requires 'agent-contract' or 'instruction'" ;;
    esac ;;
  init)
    # Explicit alias for the installer. `--host` picks the adapter (every
    # adapter layers over install.sh); the rest of the surface
    # (`[target-path] [options]`) is the installer's, unchanged.
    shift
    host=claude
    init_args=()
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --host)
          [ "$#" -ge 2 ] || fail "--host needs one of: claude, cursor, opencode, codex"
          host="$2"; shift 2 ;;
        --host=*)
          host="${1#--host=}"; shift ;;
        *) init_args+=("$1"); shift ;;
      esac
    done
    case "$host" in
      claude|claude-code) installer="install.sh" ;;
      cursor) installer="install-cursor.sh" ;;
      opencode) installer="install-opencode.sh" ;;
      codex) installer="install-codex.sh" ;;
      *) fail "unknown host '$host'; expected claude, cursor, opencode, or codex" ;;
    esac
    exec bash "$SCRIPT_DIR/$installer" ${init_args[@]+"${init_args[@]}"} --source "$SCRIPT_DIR" ;;
  update)
    shift
    [ "${1:-}" = "check" ] || fail "update requires 'check'"
    if [ "${2:-}" = "--help" ] && [ "$#" -eq 2 ]; then
      printf '%s\n' \
        'claude-foundation update check [--refresh] [--json]' \
        'Inspect the latest stable release advisory without applying an update.'
      exit 0
    fi
    command -v node >/dev/null 2>&1 || fail "Node.js is required to check for updates"
    exec node "$SCRIPT_DIR/.claude/harness/runtime/core/update-advisory.mjs" "$@" ;;
  migrate)
    shift
    access=read
    for arg in "$@"; do [ "$arg" != "--apply" ] || access=write; done
    run_runtime "$access" "" migrate "$@" ;;
  runtime)
    shift
    [ "$#" -gt 0 ] || fail "runtime requires an internal harness command"
    warn "'runtime' is an internal compatibility namespace; use canonical public commands"
    case "$1" in version|api-version|hash|doctor|packet|metrics|feedback) access=read ;; *) access=write ;; esac
    run_runtime "$access" "" "$@" ;;
  dashboard|dashboard-up|dashboard-down|dashboard-status)
    sub="$1"; shift
    client="$SCRIPT_DIR/dashboard/client.sh"
    [ -f "$client" ] || { printf 'dashboard client not found at %s\n' "$client" >&2; exit 1; }
    case "$sub" in
      dashboard)
        if [ "${1:-}" = "snapshot" ]; then
          shift
          [ "$#" -eq 1 ] && [ "$1" = "--json" ] || fail "dashboard snapshot requires --json"
          root="$(find_project_root)"
          command -v node >/dev/null 2>&1 || fail "Node.js is required to inspect the dashboard snapshot"
          exec node "$SCRIPT_DIR/dashboard/snapshot.mjs" --project "$root"
        fi
        exec bash "$client" run "$@" ;;
      dashboard-up)     exec bash "$client" up "$@" ;;
      dashboard-down)   exec bash "$client" down "$@" ;;
      dashboard-status) exec bash "$client" status "$@" ;;
    esac ;;
  "")
    deprecated_install ;;
  .|..|/*|./*|../*|~/*|--yes|-y|--dry-run|--force|-f)
    deprecated_install "$@" ;;
  *)
    route_runtime "$@" ;;
esac
