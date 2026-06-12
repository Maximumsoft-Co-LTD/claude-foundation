#!/usr/bin/env bash
# claude-foundation dashboard — presence client.
#
# Modes (the installer maps subcommands to these):
#   run     foreground heartbeat loop   ← `claude-foundation dashboard`
#   up      start heartbeat in background ← `claude-foundation dashboard-up`
#   down    stop the background heartbeat ← `claude-foundation dashboard-down`
#   status  is the background heartbeat running? ← `claude-foundation dashboard-status`
#
# The background daemon binds NO port — it only sends outbound heartbeats and is
# controlled via a PID file — so it never collides with your other dev servers.
# Only `curl` is required on the client.

set -euo pipefail

CLIENT_VERSION="1.5.0"
DEFAULT_SERVER="https://claude-foundation-dashboard-production.up.railway.app"

SCRIPT_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"

# ── Colors (off when not a TTY) ─────────────────────────────────────────────
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
claude-foundation dashboard — report this machine's presence to the team dashboard

Usage:
  claude-foundation dashboard-up --key <key> [options]   start in the background
  claude-foundation dashboard-down                       stop the background client
  claude-foundation dashboard-status                     show whether it's running
  claude-foundation dashboard --key <key> [options]      run in the foreground

Options:
  --key <key>          Shared dashboard key (or env CLAUDE_FOUNDATION_DASHBOARD_KEY)
  --server <url>       Dashboard server URL (or env CLAUDE_FOUNDATION_DASHBOARD_URL)
  --name <name>        Display name (default: git user.name, else \$USER)
  --interval <secs>    Heartbeat interval (default: 15)
  --scan <dir>         Dir to scan for /dev runs + git repos (repeatable; default: \$HOME)
  --no-activity        Don't report what /dev runs are active (presence only)
  --no-conflicts       Don't report changed files/lines for conflict early-warning
  --once               Send a single heartbeat and exit (run mode only)
  -h, --help           Show this help

The background daemon uses no port — it sends outbound heartbeats and is tracked
by a PID file at \$CLAUDE_FOUNDATION_STATE/dashboard.pid (default ~/.claude-foundation).
EOF
}

# ── Mode + args ─────────────────────────────────────────────────────────────
MODE="${1:-run}"
case "$MODE" in
  run|up|down|status) shift ;;
  -h|--help) usage; exit 0 ;;
  *) MODE="run" ;;
esac
ARGS=("$@") # forwarded verbatim to the background child in `up`

KEY="${CLAUDE_FOUNDATION_DASHBOARD_KEY:-}"
SERVER="${CLAUDE_FOUNDATION_DASHBOARD_URL:-$DEFAULT_SERVER}"
NAME=""
INTERVAL=15
ONCE="no"
ACTIVITY="yes"                                             # report active /dev runs (repo+branch); --no-activity to opt out
CONFLICTS="yes"                                            # report changed files+line-ranges per repo for conflict warning; --no-conflicts to opt out
SCAN_ROOTS=()                                              # dirs to scan for .workflow runs + git repos (default: $HOME)
SCAN_DEPTH="${CLAUDE_FOUNDATION_SCAN_DEPTH:-6}"        # .workflow repos sit ~4 levels under a work root; 6 covers nesting without walking deep trees
ACTIVE_WINDOW="${CLAUDE_FOUNDATION_ACTIVE_WINDOW:-900}"    # secs since last state.json write to still count as "working"
SCAN_INTERVAL="${CLAUDE_FOUNDATION_SCAN_INTERVAL:-60}"     # rescan cadence (decoupled from heartbeat)

while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help)    usage; exit 0 ;;
    --key)        [ $# -ge 2 ] || fail "--key needs a value"; KEY="$2"; shift ;;
    --key=*)      KEY="${1#*=}" ;;
    --server)     [ $# -ge 2 ] || fail "--server needs a value"; SERVER="$2"; shift ;;
    --server=*)   SERVER="${1#*=}" ;;
    --name)       [ $# -ge 2 ] || fail "--name needs a value"; NAME="$2"; shift ;;
    --name=*)     NAME="${1#*=}" ;;
    --interval)   [ $# -ge 2 ] || fail "--interval needs a value"; INTERVAL="$2"; shift ;;
    --interval=*) INTERVAL="${1#*=}" ;;
    --scan)       [ $# -ge 2 ] || fail "--scan needs a path"; SCAN_ROOTS+=("$2"); shift ;;
    --scan=*)     SCAN_ROOTS+=("${1#*=}") ;;
    --no-activity) ACTIVITY="no" ;;
    --no-conflicts) CONFLICTS="no" ;;
    --once)       ONCE="yes" ;;
    --source)     shift ;;          # injected by the brew wrapper — ignore
    --source=*)   ;;                # ignore
    *)            warn "ignoring unknown argument: $1" ;;
  esac
  shift
done

# Default scan roots: env CLAUDE_FOUNDATION_SCAN_ROOTS (colon-separated) else $HOME.
if [ "${#SCAN_ROOTS[@]}" -eq 0 ]; then
  if [ -n "${CLAUDE_FOUNDATION_SCAN_ROOTS:-}" ]; then
    IFS=':' read -r -a SCAN_ROOTS <<< "$CLAUDE_FOUNDATION_SCAN_ROOTS"
  else
    SCAN_ROOTS=("$HOME")
  fi
fi

# ── Daemon bookkeeping (PID file, no port) ──────────────────────────────────
STATE_DIR="${CLAUDE_FOUNDATION_STATE:-$HOME/.claude-foundation}"
PIDFILE="$STATE_DIR/dashboard.pid"
LOGFILE="$STATE_DIR/dashboard.log"

daemon_pid() { [ -f "$PIDFILE" ] && cat "$PIDFILE" 2>/dev/null || true; }
is_running() { local p; p="$(daemon_pid)"; [ -n "$p" ] && kill -0 "$p" 2>/dev/null; }

validate() {
  command -v curl >/dev/null 2>&1 || fail "curl is required but not found"
  [ -n "$KEY" ] || fail "missing --key (or set CLAUDE_FOUNDATION_DASHBOARD_KEY)"
  case "$SERVER" in
    *YOUR-APP.up.railway.app*) fail "set --server <url> (or CLAUDE_FOUNDATION_DASHBOARD_URL) to your deployed dashboard" ;;
  esac
  SERVER="${SERVER%/}"
}

# ── Identity ────────────────────────────────────────────────────────────────
gen_id() {
  if command -v uuidgen >/dev/null 2>&1; then uuidgen | tr 'A-Z' 'a-z'
  elif [ -r /proc/sys/kernel/random/uuid ]; then cat /proc/sys/kernel/random/uuid
  elif command -v openssl >/dev/null 2>&1; then openssl rand -hex 16
  else printf '%s-%s%s' "$(hostname 2>/dev/null || echo host)" "${RANDOM}" "${RANDOM}"; fi
}

derive_identity() {
  local id_file="$STATE_DIR/agent-id"
  if [ -f "$id_file" ]; then
    AGENT_ID="$(cat "$id_file")"
  else
    mkdir -p "$STATE_DIR"
    AGENT_ID="$(gen_id)"
    printf '%s\n' "$AGENT_ID" > "$id_file"
  fi
  GIT_USER="$NAME"
  [ -n "$GIT_USER" ] || GIT_USER="$(git config --get user.name 2>/dev/null || true)"
  [ -n "$GIT_USER" ] || GIT_USER="$(git config --get user.email 2>/dev/null || true)"
  [ -n "$GIT_USER" ] || GIT_USER="${USER:-unknown}"
  HOST="$(hostname -s 2>/dev/null || hostname 2>/dev/null || echo unknown)"
}

json_escape() { local s=$1; s=${s//\\/\\\\}; s=${s//\"/\\\"}; printf '%s' "$s"; }

# ── Run + change scans: /dev run history and per-repo edits on this machine ──
RUNS_JSON="[]"
CHANGES_JSON="[]"
LAST_SCAN=0
RUNS_CACHE="$STATE_DIR/runs.json"      # background scan publishes results here
CHG_CACHE="$STATE_DIR/changes.json"
SCAN_LOCK="$STATE_DIR/scan.lock"

# Join args with commas (bash-3.2 safe — never touches an empty array's [*]).
join_csv() {
  local out= first=1 x
  for x in "$@"; do
    if [ -n "$first" ]; then out="$x"; first=; else out="$out,$x"; fi
  done
  printf '%s' "$out"
}

# Normalize a git remote URL to a stable cross-machine id: host/org/repo.
normalize_remote() {
  local u=$1
  u=${u%.git}
  u=${u#ssh://}; u=${u#git+ssh://}; u=${u#https://}; u=${u#http://}; u=${u#git://}
  u=${u#*@}          # strip user@ (git@github.com:… or user@host)
  u=${u/:/\/}        # git@github.com:org/repo → github.com/org/repo
  printf '%s' "$u"
}

file_mtime() { stat -f %m "$1" 2>/dev/null || stat -c %Y "$1" 2>/dev/null || echo 0; }
# Pull a string field out of a state.json (null/number fields → empty).
json_get() { sed -n "s/.*\"$2\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" "$1" 2>/dev/null | head -1; }
# Best-effort "started" epoch for a run dir (state.json has no created_at): the
# dir's birth time, falling back to the state.json mtime.
dir_started() {
  local d=$1 b
  b="$(stat -f %B "$d" 2>/dev/null || stat -c %W "$d" 2>/dev/null || true)"
  [ -n "$b" ] && [ "$b" != "0" ] || b="$(file_mtime "$d/state.json")"
  printf '%s' "$b"
}

# Find ALL /dev runs under SCAN_ROOTS (active AND completed) and report one
# compact record each, so the server can derive live activity AND aggregate
# completion stats (counts, durations, throughput). Fields come straight from
# state.json; newest-first, capped at RUNS_CAP.
scan_runs() {
  [ "$ACTIVITY" = "yes" ] || { RUNS_JSON="[]"; return; }
  local tab; tab="$(printf '\t')"
  local ranked=() sj rundir id rtype repo branch phase step repo_root started finished doneflag
  while IFS= read -r sj; do
    [ -n "$sj" ] || continue
    case "$sj" in */_templates/*) continue ;; esac      # skip the blueprint state.json
    rundir="$(dirname "$sj")"
    id="$(json_get "$sj" id)"
    [ -n "$id" ] && [ "$id" != "NNNN-type-slug" ] || continue
    rtype="$(json_get "$sj" type)"
    branch="$(json_get "$sj" branch)"
    phase="$(json_get "$sj" phase)"
    step="$(json_get "$sj" step)"
    repo_root="$(json_get "$sj" repo_root)"
    if [ -n "$repo_root" ]; then repo="$(basename "$repo_root")"
    else repo="$(basename "$(dirname "$(dirname "$rundir")")")"; fi
    started="$(dir_started "$rundir")"                  # run-dir birth ≈ created
    finished="$(file_mtime "$sj")"                      # state.json mtime ≈ last_updated
    doneflag=false; { [ "$phase" = "done" ] || [ "$step" = "done" ]; } && doneflag=true
    ranked+=("${finished}${tab}{\"id\":\"$(json_escape "$id")\",\"type\":\"$(json_escape "$rtype")\",\"repo\":\"$(json_escape "$repo")\",\"branch\":\"$(json_escape "$branch")\",\"phase\":\"$(json_escape "$phase")\",\"started\":${started:-0},\"finished\":${finished:-0},\"done\":${doneflag}}")
  done < <(find "${SCAN_ROOTS[@]}" -maxdepth "$SCAN_DEPTH" \
             \( -name node_modules -o -name .git -o -name Library -o -name .Trash -o -name .cache \) -prune \
             -o -path '*/.workflow/*/state.json' ! -path '*/_templates/*' -print 2>/dev/null)
  if [ "${#ranked[@]}" -gt 0 ]; then
    RUNS_JSON="[$(printf '%s\n' "${ranked[@]}" | sort -t"$tab" -k1,1 -rn | awk -v n="${RUNS_CAP:-200}" 'NR<=n' | cut -f2- | paste -sd, -)]"
  else
    RUNS_JSON="[]"
  fi
}

# Report which git repos under SCAN_ROOTS have UNCOMMITTED changes (working-tree
# edits — exactly what a teammate's git server can't see yet) plus the changed
# line ranges, so nested sub-repos show too, not just ones that have run /dev.
# Two passes keep it affordable on a machine with dozens of dirty repos:
#   1. cheap — one `git diff --name-only HEAD` per repo to find dirty ones + when
#      they were last edited;
#   2. expensive — only the most-recently-edited CHANGES_REPO_CAP repos get the
#      full `--unified=0` line-range diff + JSON.
# Sets CHANGES_JSON to [{repoId, branch, path, label, files:[{path,ranges}]}].
# Heavy enough to run in the background (see maybe_scan).
scan_changes() {
  [ "$CONFLICTS" = "yes" ] || { CHANGES_JSON="[]"; return; }
  command -v git >/dev/null 2>&1 || { CHANGES_JSON="[]"; return; }
  local tab; tab="$(printf '\t')"

  # ── Pass 1: discover dirty repos + recency (one git call each) ──
  local cand=() gitdir root first mt count=0
  while IFS= read -r gitdir; do
    [ -n "$gitdir" ] || continue
    root=${gitdir%/.git}
    [ -d "$root/.git" ] || continue
    count=$((count + 1)); [ "$count" -le "${CONFLICT_REPO_SCAN_CAP:-600}" ] || break
    first="$(git -C "$root" diff --name-only HEAD 2>/dev/null | head -1 || true)"
    [ -n "$first" ] || continue                     # clean working tree → skip
    mt="$(file_mtime "$root/$first")"
    cand+=("${mt}${tab}${root}")
  done < <(find "${SCAN_ROOTS[@]}" -maxdepth "$SCAN_DEPTH" \
             \( -name node_modules -o -name Library -o -name .Trash -o -name .cache \) -prune \
             -o -name .git -type d -prune -print 2>/dev/null)
  [ "${#cand[@]}" -gt 0 ] || { CHANGES_JSON="[]"; return; }

  # ── Pass 2: full line-range diff for the top-N most-recently-edited repos ──
  local repo_items=() rmt root2 url branch rel label
  while IFS="$tab" read -r rmt root2; do
    [ -n "$root2" ] || continue
    url="$(git -C "$root2" config --get remote.origin.url 2>/dev/null || true)"
    [ -n "$url" ] || continue                       # need a remote to match across machines
    url="$(normalize_remote "$url")"
    branch="$(git -C "$root2" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
    [ -n "$branch" ] || branch="HEAD"
    # Disambiguators: home-relative folder path + optional `git config dashboard.label`.
    rel="$root2"; case "$root2" in "$HOME"/*) rel="~${root2#$HOME}" ;; esac
    label="$(git -C "$root2" config --get dashboard.label 2>/dev/null || true)"
    local file_items=() path ranges r_items r s e
    while IFS="$tab" read -r path ranges; do
      [ -n "$path" ] && [ "$path" != "/dev/null" ] || continue
      r_items=()
      for r in ${ranges//,/ }; do s=${r%-*}; e=${r#*-}; [ -n "$s" ] && r_items+=("[$s,$e]"); done
      [ "${#r_items[@]}" -gt 0 ] || continue
      file_items+=("{\"path\":\"$(json_escape "$path")\",\"ranges\":[$(join_csv "${r_items[@]}")]}")
    done < <(git -C "$root2" diff --unified=0 HEAD -- 2>/dev/null | awk '
        /^\+\+\+ /{ f=$0; sub(/^\+\+\+ [ab]\//,"",f); sub(/^\+\+\+ /,"",f); next }
        /^@@ /{ p=$3; sub(/^\+/,"",p); n=split(p,a,","); s=a[1]+0; L=(n>1?a[2]+0:1); if(L<1)L=1;
                if(f!="" && f!="/dev/null"){ rng[f]=rng[f] (rng[f]?",":"") s"-" (s+L-1); seen[f]=1 } }
        END{ for(f in seen) print f"\t"rng[f] }' | awk -v n="${CONFLICT_FILE_CAP:-80}" 'NR<=n')
    [ "${#file_items[@]}" -gt 0 ] || continue
    repo_items+=("{\"repoId\":\"$(json_escape "$url")\",\"branch\":\"$(json_escape "$branch")\",\"path\":\"$(json_escape "$rel")\",\"label\":\"$(json_escape "$label")\",\"files\":[$(join_csv "${file_items[@]}")]}")
  done < <(printf '%s\n' "${cand[@]}" | sort -t"$tab" -k1,1 -rn | awk -v n="${CHANGES_REPO_CAP:-20}" 'NR<=n')

  CHANGES_JSON="[$(join_csv ${repo_items[@]+"${repo_items[@]}"})]"
}

# Run both scans and atomically publish their results to the cache files.
run_scans_to_cache() {
  scan_runs
  scan_changes
  printf '%s' "$RUNS_JSON" > "$RUNS_CACHE.tmp" 2>/dev/null && mv "$RUNS_CACHE.tmp" "$RUNS_CACHE" 2>/dev/null
  printf '%s' "$CHANGES_JSON" > "$CHG_CACHE.tmp" 2>/dev/null && mv "$CHG_CACHE.tmp" "$CHG_CACHE" 2>/dev/null
  rm -f "$SCAN_LOCK"
}

# Kick a *background* scan at most once per SCAN_INTERVAL (skipping if one is
# still running) so the heavy repo walk never delays a heartbeat.
maybe_scan() {
  local now; now="$(date +%s)"
  [ "$(( now - LAST_SCAN ))" -ge "$SCAN_INTERVAL" ] || return 0
  if [ -f "$SCAN_LOCK" ]; then
    local lt; lt="$(file_mtime "$SCAN_LOCK")"
    [ "$(( now - lt ))" -lt 300 ] && return 0       # a scan is still in flight
    rm -f "$SCAN_LOCK"                              # stale lock — reclaim
  fi
  LAST_SCAN="$now"
  : > "$SCAN_LOCK"
  ( run_scans_to_cache ) &
  disown 2>/dev/null || true
}

# Load the latest published scan results into the payload vars.
load_cache() {
  [ -s "$RUNS_CACHE" ] && RUNS_JSON="$(cat "$RUNS_CACHE" 2>/dev/null)"
  [ -s "$CHG_CACHE" ] && CHANGES_JSON="$(cat "$CHG_CACHE" 2>/dev/null)"
  [ -n "$RUNS_JSON" ] || RUNS_JSON="[]"
  [ -n "$CHANGES_JSON" ] || CHANGES_JSON="[]"
}

build_payload() {
  printf '{"agentId":"%s","gitUser":"%s","host":"%s","version":"%s","status":"%s","runs":%s,"changes":%s}' \
    "$(json_escape "$AGENT_ID")" "$(json_escape "$GIT_USER")" \
    "$(json_escape "$HOST")" "$(json_escape "$CLIENT_VERSION")" "$1" "$RUNS_JSON" "$CHANGES_JSON"
}

beat() {
  local status="$1" resp code body
  resp="$(curl -sS -m 10 -w $'\n%{http_code}' \
    -X POST "$SERVER/api/heartbeat" \
    -H 'content-type: application/json' \
    -H "x-cf-key: $KEY" \
    -d "$(build_payload "$status")" 2>/dev/null)" || { warn "network error — will retry"; return 1; }
  code="${resp##*$'\n'}"
  body="${resp%$'\n'*}"
  case "$code" in
    200) local n; n="$(printf '%s' "$body" | sed -n 's/.*"onlineCount":\([0-9]*\).*/\1/p')"
         ok "online as ${G}${GIT_USER}${N}  ${D}· ${n:-?} online · $(date +%H:%M:%S)${N}"; return 0 ;;
    401) fail "key rejected by server (401) — check --key" ;;
    *)   warn "server returned HTTP ${code:-?} — will retry"; return 1 ;;
  esac
}

on_term() { printf '\n'; info "signing off…"; beat offline >/dev/null 2>&1 || true; exit 0; }

run_loop() {
  validate
  derive_identity
  trap on_term INT TERM
  info "dashboard: ${SERVER}"
  info "agent:     ${GIT_USER} ${D}(${AGENT_ID:0:8} @ ${HOST})${N}"
  if [ "$ACTIVITY" = "yes" ]; then
    info "runs:      scanning ${#SCAN_ROOTS[@]} root(s) for /dev runs (activity + stats) every ${SCAN_INTERVAL}s ${D}(--no-activity to disable)${N}"
  fi
  if [ "$CONFLICTS" = "yes" ]; then
    info "conflicts: scanning git repos in the background for changed files/lines ${D}(top ${CHANGES_REPO_CAP:-20} by recency · --no-conflicts to disable)${N}"
  fi
  # --once: run the scans synchronously so the single beat carries fresh data.
  if [ "$ONCE" = "yes" ]; then scan_runs; scan_changes; beat online; exit 0; fi
  info "heartbeat every ${INTERVAL}s — press Ctrl-C to stop"
  # Presence is never blocked by scanning: the first beat fires immediately, the
  # heavy repo scan runs detached (writes a cache), and beats load whatever the
  # cache has. `sleep & wait` keeps the sleep interruptible so a TERM/INT runs
  # on_term immediately (offline beat fires).
  rm -f "$SCAN_LOCK"          # clear any stale lock left by a previous run
  beat online || true        # instant presence
  maybe_scan                 # kick the first background scan
  while true; do
    sleep "$INTERVAL" &
    wait $! 2>/dev/null || true
    load_cache               # pick up the latest finished scan
    beat online || true
    maybe_scan               # kick the next one if due
  done
}

# ── Dispatch ────────────────────────────────────────────────────────────────
case "$MODE" in
  status)
    if is_running; then
      ok "dashboard client running ${D}(pid $(daemon_pid))${N}"
      info "log: $LOGFILE"
    else
      warn "dashboard client is not running"
      [ -f "$PIDFILE" ] && rm -f "$PIDFILE"
      exit 1
    fi
    ;;

  down)
    if is_running; then
      pid="$(daemon_pid)"
      info "stopping dashboard client ${D}(pid $pid)${N}…"
      kill "$pid" 2>/dev/null || true
      # Give the client time to send its offline beat before forcing the issue.
      n=0; while is_running && [ "$n" -lt 12 ]; do sleep 0.5; n=$((n + 1)); done
      if is_running; then kill -9 "$pid" 2>/dev/null || true; fi
      rm -f "$PIDFILE"
      ok "stopped"
    else
      warn "dashboard client is not running"
      [ -f "$PIDFILE" ] && rm -f "$PIDFILE"
    fi
    ;;

  up)
    validate
    if is_running; then
      warn "already running ${D}(pid $(daemon_pid))${N} — use 'dashboard-down' first"
      exit 0
    fi
    mkdir -p "$STATE_DIR"
    : > "$LOGFILE"
    nohup bash "$SCRIPT_PATH" run ${ARGS[@]+"${ARGS[@]}"} >>"$LOGFILE" 2>&1 &
    child=$!
    printf '%s\n' "$child" > "$PIDFILE"
    disown "$child" 2>/dev/null || true
    sleep 1
    if is_running; then
      ok "dashboard client started in background ${D}(pid $child)${N}"
      info "server: ${SERVER}"
      info "stop with: ${B}claude-foundation dashboard-down${N}   ·   log: $LOGFILE"
    else
      warn "client exited immediately — last log lines:"
      tail -n 3 "$LOGFILE" >&2 || true
      rm -f "$PIDFILE"
      exit 1
    fi
    ;;

  run|*)
    run_loop
    ;;
esac
