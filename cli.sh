#!/usr/bin/env bash
# claude-foundation — top-level CLI router.
#
# Keeps each command single-purpose: this file only routes, install.sh only
# installs, dashboard/client.sh only does presence. New subcommands slot in
# here without piling into the installer.
#
# Subcommands:
#   dashboard-up | dashboard-down | dashboard-status | dashboard
#                      → presence client  (dashboard/client.sh)
#   <anything else>    → the installer    (install.sh), e.g.
#                        `claude-foundation [target-path] [options]`
#
# Siblings are located relative to this script, so it works the same from a
# source checkout and from the Homebrew libexec.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

case "${1:-}" in
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
    # Default: the installer. It owns --help and the [target-path] [options]
    # surface; --source points it back at this checkout / libexec.
    exec bash "$SCRIPT_DIR/install.sh" "$@" --source "$SCRIPT_DIR" ;;
esac
