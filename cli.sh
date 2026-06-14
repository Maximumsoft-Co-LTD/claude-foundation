#!/usr/bin/env bash
# claude-foundation — top-level CLI router.
#
# Keeps each command single-purpose: this file only routes, install.sh only
# installs, dashboard/client.sh only does presence. New subcommands slot in
# here without piling into the installer.
#
# Subcommands:
#   init [target-path] [options]
#                      → the installer    (install.sh), e.g.
#                        `claude-foundation init [target-path] [options]`
#   version | --version | -v
#                      → print the version (from the VERSION file beside this
#                        script; falls back to `git describe`)
#   help | --help | -h → top-level command map (this file). Per-command flags
#                        live behind `claude-foundation init --help`.
#   dashboard-up | dashboard-down | dashboard-status | dashboard
#                      → presence client  (dashboard/client.sh)
#   <anything else>    → the installer    (install.sh), so bare
#                        `claude-foundation [target-path] [options]` still
#                        installs (the `init` alias just makes intent explicit)
#
# Siblings are located relative to this script, so it works the same from a
# source checkout and from the Homebrew libexec.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

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
claude-foundation — drop the /dev workflow into any project

Usage:
  claude-foundation init [target-path] [options]   Install the /dev workflow (default target: current dir)
  claude-foundation version                        Print the installed version
  claude-foundation help                           Show this help
  claude-foundation dashboard-up --key <key>       Start the team-presence client (background)
  claude-foundation dashboard-status               Is the presence client running?
  claude-foundation dashboard-down                 Stop the presence client

Run `claude-foundation init --help` for the full installer options
(--source, --force, --yes, --dry-run).

With no subcommand, claude-foundation installs into the current directory —
equivalent to `claude-foundation init`.
EOF
}

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
  *)
    # Default: the installer (keeps bare `claude-foundation [target-path]
    # [options]` working). Top-level help/version are handled above; the
    # installer still owns its own `--help` when reached via `init --help`.
    # --source points it back at this checkout / libexec.
    exec bash "$SCRIPT_DIR/install.sh" "$@" --source "$SCRIPT_DIR" ;;
esac
