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
EXPECTED_RUNTIME_API=1
PROJECT_START="${CLAUDE_FOUNDATION_PROJECT:-$PWD}"

fail() { printf 'claude-foundation: %s\n' "$*" >&2; exit 1; }

find_project_root() {
  local cursor="$PROJECT_START"
  [ -d "$cursor" ] || cursor="$(dirname "$cursor")"
  cursor="$(cd "$cursor" 2>/dev/null && pwd)" ||
    fail "cannot access project path: $PROJECT_START"
  while :; do
    if [ -f "$cursor/openspec/config.yaml" ] &&
       [ -f "$cursor/.claude/harness/foundation.mjs" ]; then
      printf '%s\n' "$cursor"
      return
    fi
    [ "$cursor" != "/" ] || break
    cursor="$(dirname "$cursor")"
  done
  fail "not inside a Foundation project; run 'claude-foundation init <path>' first"
}

run_runtime() {
  local access="$1"; shift
  local root runtime actual_api
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
  exec node "$runtime" "$@"
}

need_arg() {
  [ -n "${2:-}" ] || fail "$1 requires an argument"
}

deprecated_install() {
  printf "claude-foundation: warning: implicit installation is deprecated; use 'claude-foundation init ...'\n" >&2
  exec bash "$SCRIPT_DIR/install.sh" "$@" --source "$SCRIPT_DIR"
}

# VERSION file is the single machine-readable source of truth (bumped at release
# time — see RELEASING.md). Fall back to `git describe` for a source checkout
# whose file was deleted; "unknown" only if both are unavailable.
print_version() {
  local v=""
  if [ -f "$SCRIPT_DIR/VERSION" ]; then
    v="$(tr -d '[:space:]' < "$SCRIPT_DIR/VERSION")"
  fi
  if [ -z "$v" ] && command -v git >/dev/null 2>&1; then
    v="$(git -C "$SCRIPT_DIR" describe --tags --always 2>/dev/null || true)"
    v="${v#v}"
  fi
  printf 'claude-foundation %s\n' "${v:-unknown}"
}

usage() {
  cat <<'EOF'
claude-foundation — OpenSpec-native software-change harness

Usage:
  claude-foundation init [target-path] [options]   Install the change loop (default target: current dir)
  claude-foundation providers                     List evidence provider contracts
  claude-foundation changes                       List active changes
  claude-foundation validate <change>              Validate a change packet
  claude-foundation proof plan <change>            Show missing or stale evidence
  claude-foundation proof finalize <change>        Create a proof from valid receipts
  claude-foundation evidence run <change> <provider> -- <command>
                                                  Run a provider and record its receipt
  claude-foundation evidence record <change> <provider> <status> [options]
                                                  Record external provider evidence
  claude-foundation sandbox create|sync|apply <change>
                                                  Manage the isolated workspace
  claude-foundation land check|archive <change>    Check or complete landing
  claude-foundation migrate [legacy-id] [--apply]  Migrate legacy workflow evidence
  claude-foundation version                        Print the installed version
  claude-foundation help                           Show this help
  claude-foundation dashboard-up --key <key>       Start the team-presence client (background)
  claude-foundation dashboard-status               Is the presence client running?
  claude-foundation dashboard-down                 Stop the presence client

Global options:
  --project <path>, -C <path>   Resolve a Foundation project from this path

Run `claude-foundation init --help` for the full installer options
(--source, --force, --yes, --dry-run).

Installed workflow:
  /investigate → /change → /build → /prove → /land
  /dev remains a compatibility alias through proof.

The low-level `runtime` namespace is reserved for installed slash commands and
diagnostics. Use the public namespaces above for operator work.
EOF
}

case "${1:-}" in
  --project|-C)
    [ "$#" -ge 2 ] || fail "$1 needs a path"
    PROJECT_START="$2"
    shift 2 ;;
esac

case "${1:-}" in
  version|--version|-v)
    print_version; exit 0 ;;
  help|--help|-h)
    usage; exit 0 ;;
  init)
    # Explicit alias for the installer. Strip `init`; the rest of the surface
    # (`[target-path] [options]`) is install.sh's, unchanged.
    shift
    exec bash "$SCRIPT_DIR/install.sh" "$@" --source "$SCRIPT_DIR" ;;
  providers)
    shift; [ "$#" -eq 0 ] || fail "providers takes no arguments"
    run_runtime read providers ;;
  changes)
    shift; [ "$#" -eq 0 ] || fail "changes takes no arguments"
    run_runtime read changes ;;
  validate)
    shift; need_arg "validate" "${1:-}"
    run_runtime write validate "$@" ;;
  proof)
    shift
    sub="${1:-}"; [ "$#" -gt 0 ] && shift
    need_arg "proof ${sub:-<plan|finalize>}" "${1:-}"
    case "$sub" in
      plan) run_runtime write proof-plan "$@" ;;
      finalize) run_runtime write prove "$@" ;;
      *) fail "proof requires 'plan' or 'finalize'" ;;
    esac ;;
  evidence)
    shift
    sub="${1:-}"; [ "$#" -gt 0 ] && shift
    case "$sub" in
      run)
        [ "$#" -ge 4 ] || fail "evidence run requires <change> <provider> -- <command>"
        run_runtime write run-provider "$@" ;;
      record)
        [ "$#" -ge 3 ] || fail "evidence record requires <change> <provider> <status>"
        run_runtime write receipt "$@" ;;
      *) fail "evidence requires 'run' or 'record'" ;;
    esac ;;
  sandbox)
    shift
    sub="${1:-}"; [ "$#" -gt 0 ] && shift
    case "$sub" in create|sync|apply) : ;; *) fail "sandbox requires create, sync, or apply" ;; esac
    need_arg "sandbox $sub" "${1:-}"
    run_runtime write sandbox "$sub" "$@" ;;
  land)
    shift
    sub="${1:-}"; [ "$#" -gt 0 ] && shift
    need_arg "land ${sub:-<check|archive>}" "${1:-}"
    case "$sub" in
      check) run_runtime read land-check "$@" ;;
      archive) run_runtime write archive "$@" ;;
      *) fail "land requires 'check' or 'archive'" ;;
    esac ;;
  migrate)
    shift
    access=read
    for arg in "$@"; do [ "$arg" != "--apply" ] || access=write; done
    run_runtime "$access" migrate "$@" ;;
  runtime)
    shift
    [ "$#" -gt 0 ] || fail "runtime requires an internal harness command"
    case "$1" in version|api-version|hash) access=read ;; *) access=write ;; esac
    run_runtime "$access" "$@" ;;
  dashboard|dashboard-up|dashboard-down|dashboard-status)
    sub="$1"; shift
    client="$SCRIPT_DIR/dashboard/client.sh"
    [ -f "$client" ] || { printf 'dashboard client not found at %s\n' "$client" >&2; exit 1; }
    case "$sub" in
      dashboard)        exec bash "$client" run "$@" ;;
      dashboard-up)     exec bash "$client" up "$@" ;;
      dashboard-down)   exec bash "$client" down "$@" ;;
      dashboard-status) exec bash "$client" status "$@" ;;
    esac ;;
  "")
    deprecated_install ;;
  .|..|/*|./*|../*|~/*|--yes|-y|--dry-run|--force|-f)
    deprecated_install "$@" ;;
  *)
    if [ -d "$1" ]; then deprecated_install "$@"
    else fail "unknown command '$1'; run 'claude-foundation help'"
    fi ;;
esac
