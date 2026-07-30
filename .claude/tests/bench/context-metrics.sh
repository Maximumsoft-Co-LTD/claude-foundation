#!/usr/bin/env sh
# context-metrics.sh — the CONTEXT axis: how much context a run actually carried.
#
#   sh context-metrics.sh <sandbox-dir> [--table]
#   sh context-metrics.sh --transcript <session.jsonl> [--table]
#
# stdout: one strict-JSON object. stderr: nothing on success.
# exit:   0 measured · 2 bad usage · 3 no transcript found (JSON still emitted
#         with found=false, so a caller records the miss instead of crashing)
#
# WHY THIS EXISTS. The scorecard had four axes' worth of ambition and three
# axes' worth of data: quality, speed and cost were recorded; context was not
# measured at all. That gap is not cosmetic — README's own conclusion is that
# "cost tracks turns × average context, not instruction bytes", which names
# context as the CAUSE of the cost column and then never records it. Every
# "we cut 26 KB and cost went up 16%" result in rationale.md was reasoned about
# a quantity nobody was measuring.
#
# It is also the axis the envelope actively lies about. `--output-format json`
# reports `usage.input_tokens` for the TOP SESSION ONLY: a real /dev run on
# 09-api-compat recorded `in_tokens: 186` while its transcript shows 14,465,096
# input tokens across 84 requests, plus 4 sub-agents. Five orders of magnitude.
#
# WHERE THE DATA COMES FROM. Every `claude` session — including a headless
# `claude -p` in a bench sandbox — writes a transcript under
# `~/.claude/projects/<slug>/<session>.jsonl`, where <slug> is the session cwd
# with every non-alphanumeric character replaced by `-`. Sub-agent sessions land
# in `<session>/subagents/agent-*.jsonl` beside it, each with a `.meta.json`
# naming its agentType. So the whole tree of a run is on disk already: this
# script costs NO tokens, needs no live run, and can be applied RETROACTIVELY to
# any sandbox that is still around.
#
# THE ONE TRAP: DEDUPE BY requestId. The transcript writes one entry per content
# BLOCK, not per API request — thinking, text and each tool_use become separate
# `assistant` lines that all carry the SAME `usage` object. On a real run that is
# 163 entries for 84 requests, so a naive sum reports 26.6M input tokens where
# the truth is 14.5M. (`profile-turns.sh` documents the same trap for turn
# counting: "the count reads ~65% high".) Grouping by `requestId` is what makes
# every number below a per-request quantity.
#
# THE THREE NUMBERS, AND WHY ALL THREE SHIP:
#
#   ctx_boot   — context on the FIRST request of the main session. The resident
#                floor: system prompt + CLAUDE.md + rules + tool schemas, before
#                the run has read one line of the task. This is the ONLY number
#                that answers "did trimming the playbook actually shrink what
#                every turn pays?" — the question two ~26 KB cuts in rationale.md
#                tried to answer off the cost column and could not.
#   ctx_peak    — the high-water mark across every session. Answers "how close to
#                the window did this get", i.e. how much headroom a bigger task
#                would have had.
#   ctx_in_total— Σ over every request of (input + cache_read + cache_creation).
#                This IS "turns × average context" — the integral, the quantity
#                the cost column is a linear function of. When cost moves and you
#                want to know WHY, this is the number that answers it: either the
#                run made more requests or each one carried more.
#
# Reading only one of them misleads. A change can cut `ctx_boot` and still raise
# `ctx_in_total` by causing more turns — which is exactly the shape of the
# "lean design refs" result that read −26 KB resident and +16.4% cost.
#
# `ctx_cache_hit` is reported because a cached input token is billed at a
# fraction of a fresh one: two runs with equal `ctx_in_total` can differ in cost
# when one re-reads a stable prefix and the other keeps invalidating it.

set -u

SB=""; TRANSCRIPT=""; TABLE=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --transcript) TRANSCRIPT="${2:-}"; shift ;;
    --table) TABLE=1 ;;
    -*) echo "context-metrics: unknown flag $1" >&2; exit 2 ;;
    *) [ -z "$SB" ] && SB="$1" || true ;;
  esac
  shift
done

command -v jq >/dev/null 2>&1 || { echo "context-metrics: jq required" >&2; exit 2; }

PROJECTS="${CLAUDE_PROJECTS_DIR:-$HOME/.claude/projects}"

# Emit a well-formed "nothing measured" object. A missing transcript is a normal
# outcome (a sandbox deleted without --keep, a CLI that wrote nowhere), and the
# caller must be able to record it as null rather than treat it as zero context.
emit_empty() {
  jq -cn --arg why "$1" '{found:false, why:$why,
    ctx_boot:null, ctx_peak:null, ctx_mean:null, ctx_in_total:null,
    ctx_out_total:null, ctx_cache_read:null, ctx_cache_hit:null,
    ctx_reqs:null, ctx_agents:null, ctx_agent_in_total:null, agents:[]}'
}

if [ -z "$TRANSCRIPT" ]; then
  [ -n "$SB" ] || { echo "usage: context-metrics.sh <sandbox-dir> | --transcript <file>" >&2; exit 2; }
  [ -d "$SB" ] || { emit_empty "no such sandbox: $SB"; exit 3; }
  # The slug is built from the REAL path: on macOS /var is a symlink to
  # /private/var, and `mktemp -d` hands back the /var form while the CLI records
  # the /private/var one. Slugging the unresolved path silently finds nothing.
  real="$(cd "$SB" 2>/dev/null && pwd -P)" || real="$SB"
  slug="$(printf '%s' "$real" | sed 's/[^a-zA-Z0-9]/-/g')"
  dir="$PROJECTS/$slug"
  [ -d "$dir" ] || { emit_empty "no transcript dir for $real (slug $slug)"; exit 3; }
  # Largest, not newest: a sandbox can carry a stray short session (a judge call,
  # an aborted retry) whose mtime is later than the real run's. The run that did
  # the work is the big one.
  TRANSCRIPT="$(ls -S "$dir"/*.jsonl 2>/dev/null | head -n1 || true)"
  [ -n "$TRANSCRIPT" ] && [ -f "$TRANSCRIPT" ] || { emit_empty "no .jsonl in $dir"; exit 3; }
fi

[ -f "$TRANSCRIPT" ] || { emit_empty "no such transcript: $TRANSCRIPT"; exit 3; }

# Sub-agent sessions live in <transcript-without-.jsonl>/subagents/agent-*.jsonl,
# each paired with a .meta.json naming its agentType. A /dev run spends a real
# share of its context there — 4 sub-agents on the run above carried 5.1M input
# tokens between them — so a main-session-only number understates the workflow
# arm and flatters it against the baseline arm, which spawns nothing.
SUBDIR="${TRANSCRIPT%.jsonl}/subagents"

# One session's per-request roll-up. Everything downstream is built from this.
session_json() {  # $1 = transcript file, $2 = label, $3 = agent type
  jq -s --arg label "$2" --arg atype "$3" '
    def tot: (.input_tokens // 0) + (.cache_read_input_tokens // 0) + (.cache_creation_input_tokens // 0);
    # One entry per content block, all sharing a requestId and a usage object —
    # group first or every number is inflated by the block count (~2x observed).
    [ .[] | select(.type == "assistant" and .message.usage != null)
          | {r: (.requestId // .uuid // "?"), u: .message.usage} ]
    | group_by(.r) | map(.[0].u) as $u
    | if ($u | length) == 0 then
        {label:$label, agent_type:$atype, reqs:0, boot:null, peak:null, mean:null,
         in_total:null, out_total:null, cache_read:null}
      else
        [ $u[] | tot ] as $t
        | {label:$label, agent_type:$atype,
           reqs:   ($u | length),
           boot:   ($t[0]),
           peak:   ($t | max),
           mean:   (($t | add) / ($t | length) | floor),
           in_total:   ($t | add),
           out_total:  ([ $u[] | .output_tokens // 0 ] | add),
           cache_read: ([ $u[] | .cache_read_input_tokens // 0 ] | add)}
      end
  ' "$1" 2>/dev/null || printf '{"label":"%s","agent_type":"%s","reqs":0,"boot":null,"peak":null,"mean":null,"in_total":null,"out_total":null,"cache_read":null}' "$2" "$3"
}

MAIN="$(session_json "$TRANSCRIPT" main "")"

# Collect sub-agent sessions into a JSON array, labelled from their meta files.
AGENTS="[]"
if [ -d "$SUBDIR" ]; then
  _tmp="$(mktemp)"
  printf '[]' > "$_tmp"
  for f in "$SUBDIR"/agent-*.jsonl; do
    [ -f "$f" ] || continue
    meta="${f%.jsonl}.meta.json"
    aname="$(basename "$f" .jsonl)"; atype=""
    if [ -f "$meta" ]; then
      aname="$(jq -r '.name // .agentType // "agent"' "$meta" 2>/dev/null || echo agent)"
      atype="$(jq -r '.agentType // ""' "$meta" 2>/dev/null || echo "")"
    fi
    one="$(session_json "$f" "$aname" "$atype")"
    jq -c --argjson one "$one" '. + [$one]' "$_tmp" > "$_tmp.n" 2>/dev/null && mv "$_tmp.n" "$_tmp"
  done
  AGENTS="$(cat "$_tmp")"; rm -f "$_tmp" "$_tmp.n"
fi

OUT="$(jq -cn --argjson main "$MAIN" --argjson agents "$AGENTS" --arg t "$TRANSCRIPT" '
  ([$main] + $agents) as $all
  | ($all | map(select(.reqs > 0))) as $live
  | ($live | map(.in_total // 0) | add // 0) as $in
  | ($live | map(.cache_read // 0) | add // 0) as $cr
  | {found: (($live | length) > 0),
     transcript: $t,
     # ctx_boot is the MAIN session floor on purpose: sub-agents boot with their
     # own (smaller) prompts, and averaging them in would hide the number the
     # resident playbook actually controls.
     ctx_boot:        $main.boot,
     ctx_peak:        (if ($live|length) == 0 then null else ($live | map(.peak // 0) | max) end),
     ctx_mean:        $main.mean,
     ctx_in_total:    (if ($live|length) == 0 then null else $in end),
     ctx_out_total:   (if ($live|length) == 0 then null else ($live | map(.out_total // 0) | add) end),
     ctx_cache_read:  (if ($live|length) == 0 then null else $cr end),
     # Share of input served from cache. Two runs with the same ctx_in_total can
     # cost differently when one keeps its prefix stable and the other does not.
     ctx_cache_hit:   (if $in > 0 then (($cr / $in * 1000) | round / 1000) else null end),
     ctx_reqs:        (if ($live|length) == 0 then null else ($live | map(.reqs) | add) end),
     ctx_agents:      ($agents | map(select(.reqs > 0)) | length),
     # Split out so a workflow-vs-baseline read is honest: the baseline arm
     # spawns nothing, so all of its context is main-session context.
     ctx_main_in_total:  $main.in_total,
     ctx_agent_in_total: ($agents | map(select(.reqs > 0) | .in_total // 0) | add // 0),
     main: $main,
     agents: $agents}
')"

if [ "$TABLE" = "1" ]; then
  printf '%s' "$OUT" | jq -r '
    def k($n): if $n == null then "-" else (($n/1000*10|round)/10|tostring) + "k" end;
    if .found | not then "context: NOT MEASURED — \(.why // "no transcript")" else
    "context — \(.transcript)",
    "  boot (resident floor) : \(k(.ctx_boot))",
    "  peak (high-water)     : \(k(.ctx_peak))",
    "  mean per request      : \(k(.ctx_mean))",
    "  in_total (turns×ctx)  : \(k(.ctx_in_total))   <- the cost column is a linear function of this",
    "  out_total             : \(k(.ctx_out_total))",
    "  cache hit             : \(if .ctx_cache_hit == null then "-" else ((.ctx_cache_hit*100|round)|tostring) + "%" end)",
    "  requests              : \(.ctx_reqs // "-")   (main \(.main.reqs // 0) + \(.ctx_agents) sub-agent session(s))",
    "  main / agents split   : \(k(.ctx_main_in_total)) / \(k(.ctx_agent_in_total))",
    (if (.agents | length) > 0 then "  per sub-agent:" else empty end),
    (.agents[] | select(.reqs > 0) |
      "    \(.label) [\(.agent_type)]  reqs=\(.reqs) boot=\(k(.boot)) peak=\(k(.peak)) in_total=\(k(.in_total))")
    end'
else
  printf '%s\n' "$OUT"
fi

printf '%s' "$OUT" | jq -e '.found' >/dev/null 2>&1 || exit 3
exit 0
