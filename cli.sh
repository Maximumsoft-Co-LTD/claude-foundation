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
EXPECTED_RUNTIME_API=8
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
  local phase=""
  case "${1:-}" in
    new|start|resolve|validate|evidence-upgrade) phase="change" ;;
    sandbox|agent-plan|agent-acquire|agent-release) phase="build" ;;
    proof-plan|proof-readiness|proof-run|proof-preflight|proof-execute|proof-audit|prove|receipt|run-provider) phase="prove" ;;
    land-check|land-plan|land-record|land-pointers|land-resume|archive) phase="land" ;;
  esac
  telemetry=1
  [ "$access" != "inspect" ] || telemetry=0
  FOUNDATION_TELEMETRY="$telemetry" FOUNDATION_PUBLIC_OPERATION="$phase" exec node "$runtime" "$@"
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
  claude-foundation repos [change]                Inspect repository topology and selection
  claude-foundation models                        Show model-tier routing policy
  claude-foundation agents plan <change> [--group <n>] [--pretty]
                                                  Summarize or inspect one execution group
  claude-foundation agents task <change> <task> [--pretty]
                                                  Print one task-scoped packet
  claude-foundation agents acquire|release <change> <task> --owner <agent-id>
                                                  Hold or release task resource leases
  claude-foundation doctor [--stage change|build|prove] [--require-archive] [--change <id>] [--unattended] [--json]
                                                  Check runtime, providers, and archive readiness
  claude-foundation changes                       List active changes
  claude-foundation packet <change> [--phase change|build|prove|review|land] [--repo <id>] [--task <id>] [--pretty]
                                                  Print a compact scoped handoff
  claude-foundation metrics <change>              Summarize measured phase/provider cost
  claude-foundation telemetry sync <change> [transcript.jsonl]
                                                  Incrementally ingest native Claude request usage
  claude-foundation telemetry import <change> <file> [--format generic|codex|claude]
                                                  Import authoritative host usage without prompts
  claude-foundation runtime new <intent> [--rapid]
                                                  Create a change through the project runtime
  claude-foundation runtime start --template | <draft.json>
                                                  Atomically start an isolated Build from a risk-resolved draft
  claude-foundation runtime resolve <change> [options]
                                                  Persist change risk and coupling decisions
  claude-foundation validate <change>              Validate a change packet
  claude-foundation proof plan <change>            Show missing or stale evidence
  claude-foundation proof preflight <change>       Validate execution topology without running it
  claude-foundation proof audit <change>           Verify durable proof and artifact digests
  claude-foundation proof execute <change>         Run configured evidence and finalize proof
  claude-foundation proof finalize <change>        Create a proof from valid receipts
  claude-foundation proof finish <change>          Readiness, execute, and audit atomically
  claude-foundation evidence run <change> <provider> --claims <scope> -- <command>
                                                  Run a provider and record its receipt
  claude-foundation evidence record <change> <provider> <status> [options]
                                                  Record external provider evidence
  claude-foundation evidence upgrade <change>      Separate legacy claims and execution wiring
  claude-foundation sandbox inspect <change> [--json] [--unattended]
                                                  Inspect workspace isolation and boundary evidence
  claude-foundation sandbox create <change> [--all] [--unattended]
                                                  One bare flag; fails closed without trusted host attestation
  claude-foundation sandbox sync|apply <change>
                                                  Manage the isolated workspace
  claude-foundation land check|plan|pointers|resume|archive <change>
                                                  Check or advance resumable landing
  claude-foundation land record <change> --repo <id> --commit <sha> [--ci pass]
                                                  Bind an explicitly created child commit
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
  repos)
    shift
    [ "$#" -le 1 ] || fail "repos accepts at most one change"
    run_runtime read repos "$@" ;;
  models)
    shift; [ "$#" -eq 0 ] || fail "models takes no arguments"
    run_runtime read models ;;
  agents)
    shift
    sub="${1:-}"; [ "$#" -gt 0 ] && shift
    case "$sub" in
      plan)
        need_arg "agents plan" "${1:-}"
        run_runtime write agent-plan "$@" ;;
      task)
        [ "$#" -ge 2 ] || fail "agents task requires <change> <task>"
        run_runtime read agent-task "$@" ;;
      acquire)
        [ "$#" -ge 3 ] || fail "agents acquire requires <change> <task> --owner <agent-id>"
        run_runtime write agent-acquire "$@" ;;
      release)
        [ "$#" -ge 3 ] || fail "agents release requires <change> <task> --owner <agent-id>"
        run_runtime write agent-release "$@" ;;
      *) fail "agents requires 'plan', 'task', 'acquire', or 'release'" ;;
    esac ;;
  doctor)
    shift
    run_runtime read doctor "$@" ;;
  changes)
    shift; [ "$#" -eq 0 ] || fail "changes takes no arguments"
    run_runtime read changes ;;
  packet)
    shift; need_arg "packet" "${1:-}"
    run_runtime read packet "$@" ;;
  metrics)
    shift; need_arg "metrics" "${1:-}"
    run_runtime read metrics "$@" ;;
  telemetry)
    shift
    sub="${1:-}"; [ "$#" -gt 0 ] && shift
    case "$sub" in
      sync)
        [ "$#" -ge 1 ] || fail "telemetry sync requires <change> [transcript.jsonl]"
        run_runtime write telemetry-sync "$@" ;;
      import)
        [ "$#" -ge 2 ] || fail "telemetry import requires <change> <file>"
        run_runtime write telemetry-import "$@" ;;
      *) fail "telemetry requires 'sync' or 'import'" ;;
    esac ;;
  validate)
    shift; need_arg "validate" "${1:-}"
    run_runtime write validate "$@" ;;
  proof)
    shift
    sub="${1:-}"; [ "$#" -gt 0 ] && shift
    need_arg "proof ${sub:-<plan|readiness|run|finish|preflight|execute|finalize|audit>}" "${1:-}"
    case "$sub" in
      plan) run_runtime write proof-plan "$@" ;;
      readiness) run_runtime read proof-readiness "$@" ;;
      run) run_runtime write proof-run "$@" ;;
      finish) run_runtime write proof-run "$@" ;;
      preflight) run_runtime write proof-preflight "$@" ;;
      execute) run_runtime write proof-execute "$@" ;;
      finalize) run_runtime write prove "$@" ;;
      audit) run_runtime read proof-audit "$@" ;;
      *) fail "proof requires 'plan', 'readiness', 'run', 'finish', 'preflight', 'execute', 'finalize', or 'audit'" ;;
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
      upgrade)
        need_arg "evidence upgrade" "${1:-}"
        run_runtime write evidence-upgrade "$@" ;;
      *) fail "evidence requires 'run', 'record', or 'upgrade'" ;;
    esac ;;
  sandbox)
    shift
    sub="${1:-}"; [ "$#" -gt 0 ] && shift
    case "$sub" in create|sync|apply|inspect) : ;; *) fail "sandbox requires inspect, create, sync, or apply" ;; esac
    need_arg "sandbox $sub" "${1:-}"
    if [ "$sub" = "inspect" ]; then
      run_runtime inspect sandbox "$sub" "$@"
    else
      run_runtime write sandbox "$sub" "$@"
    fi ;;
  land)
    shift
    sub="${1:-}"; [ "$#" -gt 0 ] && shift
    need_arg "land ${sub:-<check|plan|record|pointers|resume|archive>}" "${1:-}"
    case "$sub" in
      check) run_runtime read land-check "$@" ;;
      plan) run_runtime write land-plan "$@" ;;
      record) run_runtime write land-record "$@" ;;
      pointers) run_runtime write land-pointers "$@" ;;
      resume) run_runtime write land-resume "$@" ;;
      archive) run_runtime write archive "$@" ;;
      *) fail "land requires 'check', 'plan', 'record', 'pointers', 'resume', or 'archive'" ;;
    esac ;;
  migrate)
    shift
    access=read
    for arg in "$@"; do [ "$arg" != "--apply" ] || access=write; done
    run_runtime "$access" migrate "$@" ;;
  runtime)
    shift
    [ "$#" -gt 0 ] || fail "runtime requires an internal harness command"
    case "$1" in version|api-version|hash|doctor|packet|metrics) access=read ;; *) access=write ;; esac
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
