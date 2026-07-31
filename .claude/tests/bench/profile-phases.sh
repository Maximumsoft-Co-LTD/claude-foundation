#!/usr/bin/env sh
# profile-phases.sh — where a /dev run's wall clock actually goes, per phase.
#
# The scorecard says a run cost $6.50 and took 845s; it does not say which phase
# spent it. `state.json > phase_times` does, and this turns those stamps into
# durations and shares. It is the tool that found Design eating 39–49% of a
# brownfield-S run — the measurement that moved Design inline.
#
#   sh profile-phases.sh <.workflow/<id>/-dir> [more dirs…]
#   sh profile-phases.sh --find [<root>]     # auto-discover kept sandboxes
#
# Reads only `--keep` sandboxes (or any live .workflow dir). No tokens, no model.
#
# Reading it:
#   * `phase_times` stamps are step COMPLETION times, so a phase's duration is
#     the gap from the previous stamp (the first is measured from `created_at`).
#   * Phases written in ONE state write share a stamp — the combined Design write
#     stamps spec/plan/test-plan identically. Those collapse into a single
#     `spec+plan+test-plan` row rather than three 0s, because three zeros and one
#     real number is a lie about which phase did the work.
#   * A run still in progress has no `done_at`; its trailing phase is excluded
#     rather than measured against "now".
set -eu

command -v jq >/dev/null 2>&1 || { echo "jq required" >&2; exit 1; }

DIRS=""; FIND=0; ROOT="${TMPDIR:-/tmp}"; TASK=""; NEWER=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --find)  FIND=1 ;;
    --root)  ROOT="$2"; shift ;;
    --task)  TASK="$2"; shift ;;     # sandbox dir is <task>-<arm>-<n>
    --newer) NEWER="$2"; shift ;;    # only runs whose state.json changed in the last N seconds
    -*)      echo "profile-phases: unknown flag $1" >&2; exit 2 ;;
    *)       DIRS="$DIRS $1" ;;
  esac
  shift
done

if [ "$FIND" = 1 ]; then
  # Mixing configurations in one profile averages away the thing you are looking
  # for — a change's before and after land in the same column. Filter to one
  # task and one recent window so the rows being compared are comparable.
  DIRS="$(find "$ROOT" -maxdepth 6 -type d -name '.workflow' 2>/dev/null \
          | { [ -n "$TASK" ] && grep -F "/$TASK-" || cat; } \
          | while read -r w; do
              find "$w" -maxdepth 1 -mindepth 1 -type d ! -name '_templates' 2>/dev/null
            done)"
  if [ -n "$NEWER" ]; then
    now="$(date +%s)"; keep=""
    for d in $DIRS; do
      [ -f "$d/state.json" ] || continue
      mt="$(stat -f %m "$d/state.json" 2>/dev/null || stat -c %Y "$d/state.json" 2>/dev/null)"
      [ -n "$mt" ] && [ "$((now - mt))" -le "$NEWER" ] && keep="$keep $d"
    done
    DIRS="$keep"
  fi
  [ -n "$DIRS" ] || { echo "no .workflow run dirs found under $ROOT (task='$TASK' newer='$NEWER')" >&2; exit 1; }
elif [ -z "$DIRS" ]; then
  echo "usage: profile-phases.sh <.workflow/<id>/-dir>… | --find [--root R] [--task T] [--newer S]" >&2
  exit 2
fi

TMP="$(mktemp)"; trap 'rm -f "$TMP"' EXIT INT TERM

n=0
for d in $DIRS; do
  sf="$d/state.json"
  [ -f "$sf" ] || continue
  jq -r '
    # Canonical order; only the keys this run actually stamped survive.
    ["interview","spec","plan","test-plan","gate","implement","test",
     "review","security","docs","ship","retro"] as $order
    | (.phase_times // {}) as $pt
    | ($order | map(select($pt[.] != null))) as $keys
    | if ($keys | length) == 0 then empty else
        (.created_at | fromdateiso8601) as $t0
        # Bind done_at BEFORE the reduce: after it `.` is the row array, and
        # `.done_at` on an array is an error, not a null — which silently
        # emptied this whole profiler until it was caught.
        | (if (.done_at // null) != null then (.done_at | fromdateiso8601) else null end) as $done
        # Collapse runs of identical stamps into one labelled row: phases written
        # in a single state write did the work together and cannot be separated.
        | reduce $keys[] as $k ([];
            if (length > 0) and (.[-1].at == ($pt[$k] | fromdateiso8601))
            then (.[0:-1] + [{name: (.[-1].name + "+" + $k), at: .[-1].at}])
            else . + [{name: $k, at: ($pt[$k] | fromdateiso8601)}] end)
        | (if $done != null and $done > (.[-1].at)
             then (. + [{name:"(post-retro close)", at: $done}])
             else . end) as $rows
        | reduce range(0; ($rows|length)) as $i
            ({prev: $t0, out: []};
             {prev: $rows[$i].at,
              out: (.out + [{name: $rows[$i].name, dur: ($rows[$i].at - .prev)}])})
        | .out as $ph
        | ($ph | map(.dur) | add) as $total
        | if $total <= 0 then empty else
            $ph[] | "\(.name)\t\(.dur)\t\($total)"
          end
      end
  ' "$sf" >> "$TMP" || continue
  n=$((n + 1))
  echo "  · $d"
done

[ "$n" -gt 0 ] || { echo "no run with usable phase_times found" >&2; exit 1; }

echo
echo "phase profile — $n run(s)"
echo

# Stage roll-up. A combined state write ties its phases together, so per-phase
# rows fragment into one bucket per write pattern and two configurations never
# line up. Stages are coarse enough that every observed write pattern falls
# inside exactly one of them — a block spanning two is reported as `MIXED:` and
# never silently split, because dividing an unseparable block across buckets
# invents a number the stamps do not contain.
awk -F'\t' '
  function stage(p,   parts, i, s, seen, out) {
    seen = ""
    n = split(p, parts, "+")
    for (i = 1; i <= n; i++) {
      s = bucket[parts[i]]
      if (s == "") s = "other"
      if (index(seen, "|" s "|") == 0) seen = seen "|" s "|"
    }
    gsub(/\|\|/, "|", seen)
    split(seen, out, "|")
    c = 0; last = ""
    for (i in out) if (out[i] != "") { c++; last = out[i] }
    return (c == 1) ? last : "MIXED: " p
  }
  BEGIN {
    bucket["interview"]="design"; bucket["spec"]="design"; bucket["plan"]="design"
    bucket["test-plan"]="design"; bucket["gate"]="design"
    bucket["implement"]="build";  bucket["test"]="build"
    bucket["review"]="review";    bucket["security"]="review"
    bucket["docs"]="ship";        bucket["ship"]="ship"
    bucket["retro"]="close";      bucket["(post-retro close)"]="close"
    ord["design"]=1; ord["build"]=2; ord["review"]=3; ord["ship"]=4; ord["close"]=5
  }
  { s = stage($1); sum[s] += $2; tot += $2; if (!(s in seenS)) { seenS[s]=1 } }
  END {
    printf "  %-24s %8s %7s\n", "stage", "total s", "share"
    printf "  %-24s %8s %7s\n", "------------------------", "--------", "-------"
    for (i = 1; i <= 5; i++) for (s in seenS) if (ord[s] == i)
      printf "  %-24s %8.1f %6.1f%%\n", s, sum[s], 100*sum[s]/tot
    for (s in seenS) if (ord[s] == 0)
      printf "  %-24s %8.1f %6.1f%%\n", s, sum[s], 100*sum[s]/tot
    printf "  %-24s %8.1f\n", "TOTAL", tot
  }
' "$TMP"
echo
awk -F'\t' '
  { sum[$1] += $2; cnt[$1]++; if (!($1 in ord)) { ord[$1] = ++k; name[k] = $1 } tot += $2 }
  END {
    printf "  %-28s %8s %8s %7s\n", "phase", "mean s", "total s", "share"
    printf "  %-28s %8s %8s %7s\n", "----------------------------", "--------", "--------", "-------"
    for (i = 1; i <= k; i++) {
      p = name[i]
      printf "  %-28s %8.1f %8.1f %6.1f%%\n", p, sum[p]/cnt[p], sum[p], 100*sum[p]/tot
    }
    printf "  %-28s %8s %8.1f %7s\n", "TOTAL", "", tot, ""
  }
' "$TMP"
echo
echo "  (stamps are step-completion times; equal stamps = one combined state write)"
