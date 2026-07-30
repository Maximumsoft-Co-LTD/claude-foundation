#!/usr/bin/env sh
# backfill-context.sh — add the CONTEXT axis to scorecards that were recorded
# before it existed. Reads transcripts already on disk: no live runs, no tokens.
#
#   sh backfill-context.sh <scorecards.jsonl>              # report only (default)
#   sh backfill-context.sh <scorecards.jsonl> --write      # fill unambiguous rows
#   sh backfill-context.sh <scorecards.jsonl> --write --nearest   # also resolve by mtime
#
# WHY. Every baseline in `baselines/` predates the ctx_* fields, so the whole
# recorded history of this suite has three axes and the fourth is blank. Those
# runs are not lost, though: each one left a transcript under
# `~/.claude/projects/<slug>/`, and the numbers are still there to be read. This
# recovers them, which means a context ratchet has a *before* without anyone
# spending a run to create one.
#
# HOW A ROW FINDS ITS TRANSCRIPT. Three routes, in descending trustworthiness,
# and the route taken is written into the row as `ctx_source` — a number whose
# provenance is a guess must say so:
#
#   sandbox              — the row records its own resolved sandbox path
#                          (run-bench.sh writes this now). Exact.
#   unique-dirname-match — the row has no sandbox, but exactly ONE transcript
#                          directory ends in `-<task>-<arm>-<repeat>`, which is
#                          how run-bench.sh names sandboxes. Unambiguous.
#   mtime-heuristic      — several directories match, and --nearest picked the one
#                          whose mtime sits closest to the scorecard file's.
#                          A GUESS. Opt-in, tagged, and never the default.
#
# Ambiguity is the normal case for old rows, not an edge case: this repo has 352
# transcript directories and a dozen of them are `…-11-recent-window-workflow-1`,
# because that task/arm/repeat was run over and over. Filling those by guessing
# would put one session's context numbers next to another session's cost — the
# same class of error as README > "Re-baseline before crediting yourself with
# someone else's numbers", which cost a real verdict its meaning. So the default
# reports and refuses; --nearest exists for when you know the file's provenance
# and want the estimate anyway, and it labels every row it touches.

set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
PROJECTS="${CLAUDE_PROJECTS_DIR:-$HOME/.claude/projects}"

FILE=""; WRITE=0; NEAREST=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --write) WRITE=1 ;;
    --nearest) NEAREST=1 ;;
    --projects) PROJECTS="${2:-}"; shift ;;
    -*) echo "backfill-context: unknown flag $1" >&2; exit 2 ;;
    *) FILE="$1" ;;
  esac
  shift
done

[ -n "$FILE" ] && [ -f "$FILE" ] || { echo "usage: backfill-context.sh <scorecards.jsonl> [--write] [--nearest]" >&2; exit 2; }
command -v jq >/dev/null 2>&1 || { echo "backfill-context: jq required" >&2; exit 2; }
[ -d "$PROJECTS" ] || { echo "backfill-context: no projects dir at $PROJECTS" >&2; exit 2; }

# mtime in epoch seconds, portable across BSD (macOS) and GNU stat.
mtime() { stat -f %m "$1" 2>/dev/null || stat -c %Y "$1" 2>/dev/null || echo 0; }
ANCHOR="$(mtime "$FILE")"

TMP="$(mktemp)"; trap 'rm -f "$TMP" "$TMP.n"' EXIT INT TERM
: > "$TMP"

filled=0; ambiguous=0; missing=0; already=0; total=0

while IFS= read -r line; do
  [ -n "$line" ] || continue
  printf '%s' "$line" | jq -e 'type == "object"' >/dev/null 2>&1 || { printf '%s\n' "$line" >> "$TMP"; continue; }
  total=$((total + 1))

  # A row that already carries a measured context is left byte-alone. Re-deriving
  # it could only replace a recorded measurement with a re-guess.
  if printf '%s' "$line" | jq -e '.ctx_in_total != null' >/dev/null 2>&1; then
    already=$((already + 1)); printf '%s\n' "$line" >> "$TMP"; continue
  fi

  task="$(printf '%s' "$line" | jq -r '.task // ""')"
  arm="$(printf '%s' "$line" | jq -r '.arm // ""')"
  rep="$(printf '%s' "$line" | jq -r '.repeat // ""')"
  sbx="$(printf '%s' "$line" | jq -r '.sandbox // ""')"

  # ncand must exist before the branches: it is read again in the final else,
  # and `set -u` turns an unset variable there into an abort mid-file.
  ctx="null"; src=""; ncand=0
  if [ -n "$sbx" ]; then
    c="$(sh "$HERE/context-metrics.sh" "$sbx" 2>/dev/null || true)"
    if printf '%s' "$c" | jq -e '.found' >/dev/null 2>&1; then ctx="$c"; src="sandbox"; fi
  fi

  if [ "$ctx" = "null" ] && [ -n "$task" ] && [ -n "$arm" ] && [ -n "$rep" ]; then
    # run-bench.sh names each sandbox "$SANDROOT/<task>-<arm>-<repeat>", so the
    # slugged transcript directory ends with exactly that. Anchor on the END of
    # the name: a suffix test keeps repeat 1 from also matching repeat 11.
    suffix="-$task-$arm-$rep"
    cands=""
    for d in "$PROJECTS"/*; do
      [ -d "$d" ] || continue
      case "$(basename "$d")" in
        *"$suffix") cands="$cands$d
"; ncand=$((ncand + 1)) ;;
      esac
    done
    if [ "$ncand" = "1" ]; then
      c="$(sh "$HERE/context-metrics.sh" --transcript "$(ls -S "$(printf '%s' "$cands" | head -n1)"/*.jsonl 2>/dev/null | head -n1)" 2>/dev/null || true)"
      if printf '%s' "$c" | jq -e '.found' >/dev/null 2>&1; then ctx="$c"; src="unique-dirname-match"; fi
    elif [ "$ncand" -gt 1 ] && [ "$NEAREST" = "1" ]; then
      best=""; bestd=""
      for d in $cands; do
        dm="$(mtime "$d")"
        if [ "$dm" -gt "$ANCHOR" ]; then delta=$((dm - ANCHOR)); else delta=$((ANCHOR - dm)); fi
        if [ -z "$bestd" ] || [ "$delta" -lt "$bestd" ]; then bestd="$delta"; best="$d"; fi
      done
      if [ -n "$best" ]; then
        c="$(sh "$HERE/context-metrics.sh" --transcript "$(ls -S "$best"/*.jsonl 2>/dev/null | head -n1)" 2>/dev/null || true)"
        if printf '%s' "$c" | jq -e '.found' >/dev/null 2>&1; then ctx="$c"; src="mtime-heuristic"; fi
      fi
    elif [ "$ncand" -gt 1 ]; then
      ambiguous=$((ambiguous + 1))
      echo "  ? $task/$arm/$rep — $ncand candidate transcripts; not filled (use --nearest to estimate, tagged)"
    fi
  fi

  if [ "$ctx" != "null" ]; then
    filled=$((filled + 1))
    echo "  + $task/$arm/$rep — $src  boot=$(printf '%s' "$ctx" | jq -r '(.ctx_boot/1000*10|round)/10')k peak=$(printf '%s' "$ctx" | jq -r '(.ctx_peak/1000*10|round)/10')k in_total=$(printf '%s' "$ctx" | jq -r '(.ctx_in_total/1000000*100|round)/100')M"
    printf '%s' "$line" | jq -c --argjson ctx "$ctx" --arg src "$src" '
      . + {ctx_boot:$ctx.ctx_boot, ctx_peak:$ctx.ctx_peak, ctx_mean:$ctx.ctx_mean,
           ctx_in_total:$ctx.ctx_in_total, ctx_out_total:$ctx.ctx_out_total,
           ctx_cache_hit:$ctx.ctx_cache_hit, ctx_reqs:$ctx.ctx_reqs,
           ctx_agents:$ctx.ctx_agents, ctx_agent_in_total:$ctx.ctx_agent_in_total,
           ctx_source:$src}' >> "$TMP"
  else
    [ "$ncand" = "0" ] 2>/dev/null && missing=$((missing + 1)) || true
    printf '%s\n' "$line" >> "$TMP"
  fi
done < "$FILE"

echo
echo "backfill: $total row(s) — $filled filled, $already already had context, $ambiguous ambiguous, $((total - filled - already - ambiguous)) no transcript"

if [ "$WRITE" = "1" ]; then
  if [ "$filled" = "0" ]; then
    echo "backfill: nothing to write."
  else
    # Keep the original. A scorecard is a measurement record; overwriting one
    # in place with no way back is how a baseline stops being a baseline.
    cp "$FILE" "$FILE.pre-context.bak"
    cp "$TMP" "$FILE"
    echo "backfill: wrote $FILE (original kept at $FILE.pre-context.bak)"
  fi
else
  echo "backfill: report only — re-run with --write to apply."
fi
exit 0
