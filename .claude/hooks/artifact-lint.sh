#!/usr/bin/env sh
# artifact-lint.sh — optional artifact gate for /dev runs.
#
# Validates a `.workflow/<id>/` run directory against the artifact templates:
#   1. Required sections per artifact:
#        spec.md       — a `**Type**:` declaration, a `## Goal` section, AND a
#                        `## User Stories` section.
#        plan.md       — a fenced `mermaid` block.
#        tasks.md      — at least one `T###` task, an inline AC tag (`[AC<n>]` or
#                        `[DoD]`), and a runnable verify section (a `verify:` clause).
#        test-plan.md  — a `## Coverage plan` section AND at least one AC reference
#                        (`AC<n>`), so the test strategy maps to the spec's criteria.
#   2. No leftover placeholder markers anywhere in any linted artifact:
#        TODO, TBD, FIXME, lorem  (word markers, case-insensitive)
#        <...>                    (an angle-bracket placeholder, e.g. <title>, <id>)
#      A marker inside an inline code span (backticks) or a fenced code block is
#      treated as documentation/example syntax, NOT a leftover, and is skipped —
#      only bare-prose markers are findings. (This is what lets an artifact that
#      *documents* the markers pass against its own run directory.)
#   3. FOLLOWUPS.md governance (the shared backlog, found at the run dir or one
#      level up at .workflow/FOLLOWUPS.md): no duplicate follow-up IDs (the
#      parallel-run "highest+1" allocation race) and no row marked `consumed-by:`
#      still sitting in the `## Open` section (it belongs in `## Closed`). Skipped
#      when no FOLLOWUPS.md is present.
#
# Prints a report (one line per check) and exits non-zero on any failure, zero
# when clean. Dependency-light: POSIX sh + the standard `awk`/`grep` toolchain;
# no new packages, no JSON, does not read `.workflow/_templates/` at runtime.
#
# Two modes, neither ever blocks a tool call:
#   CLI  — invoke by hand or in CI against a run dir (jq-free, POSIX sh).
#   HOOK — `artifact-lint.sh --hook` as PostToolUse on Write|Edit (wired in
#          settings.json): lints just the artifact that was written and surfaces
#          findings as a warn-only additionalContext note. Requires jq (fails
#          open without it); skips .workflow/_templates/.
#
# Usage:  sh artifact-lint.sh <path-to-.workflow/<id>/-dir>
#         sh artifact-lint.sh --hook   (PostToolUse JSON on stdin)
# Exit:   0 = clean (>=1 artifact found, every check passed)
#         1 = any failed check, no recognised artifact, or a usage/argument error

set -eu

# Recognised artifacts. spec.md / plan.md / test-plan.md also get required-section
# checks; every file here gets the placeholder scan.
ARTIFACTS='spec.md plan.md tasks.md test-plan.md review.md security.md tests.md retro.md recommendations.md epic.md'

PROG="$(basename "$0")"

usage() {
  echo "usage: $PROG <.workflow/<id>/-directory>" >&2
  echo "  validates the run's artifacts: required sections + no placeholder markers" >&2
}

# fail_count is the single source of truth for the exit code.
fail_count=0
note_fail() { fail_count=$((fail_count + 1)); }

# report a single check line. $1 = status (OK|FAIL), $2.. = message.
report() {
  status="$1"; shift
  echo "[$status] $*"
}

# require_section <file> <human-name> <grep-mode> <pattern>
#   grep-mode: F (fixed string) or E (extended regex).
# Prints OK/FAIL and bumps fail_count on a miss.
require_section() {
  file="$1"; name="$2"; mode="$3"; pattern="$4"
  if grep -q -"$mode" -- "$pattern" "$file" 2>/dev/null; then
    report OK "$(basename "$file"): has $name"
  else
    report FAIL "$(basename "$file"): MISSING required section: $name"
    note_fail
  fi
}

check_spec() {
  file="$1"
  require_section "$file" "Type declaration"     F '**Type**:'
  # Anchor the heading at line start so a mention of the section name in prose
  # or an HTML comment does not satisfy the check.
  require_section "$file" "Goal"                 E '^#+[[:space:]]+Goal'
  require_section "$file" "User Stories"         E '^#+[[:space:]]+User Stories'
}

check_plan() {
  file="$1"
  require_section "$file" "mermaid diagram"      E '^[[:space:]]*```mermaid'
}

check_tasks() {
  file="$1"
  require_section "$file" "T### task"            E '\bT[0-9]+\b'
  require_section "$file" "inline AC tag"        E '\[(AC[0-9]+|DoD|SC-[0-9]+)\]'
  require_section "$file" "runnable verify section" F 'verify:'
}

check_test_plan() {
  file="$1"
  # Anchor the heading at line start so a mention in prose/comment doesn't satisfy it.
  require_section "$file" "Coverage plan"        E '^#+[[:space:]]+Coverage plan'
  require_section "$file" "AC reference"         E '\bAC[0-9]+'
}

# scan_placeholders <file>
# Reports every bare-prose placeholder marker as `<file>:<line>: placeholder
# marker: <marker>`. Skips fenced code blocks and inline backtick spans so a
# documented marker is not a false positive. Bumps fail_count per hit.
scan_placeholders() {
  file="$1"
  hits="$(
    awk -v fname="$file" '
      # Toggle fenced-code state on a ``` fence line (any indent). The fence
      # line itself is code, so skip it too.
      /^[[:space:]]*```/ { infence = !infence; next }
      infence { next }
      {
        line = $0
        # Strip inline code spans: remove every `...` pair. Repeat until none
        # remain so adjacent spans on one line are all cleared.
        while (match(line, /`[^`]*`/)) {
          line = substr(line, 1, RSTART - 1) substr(line, RSTART + RLENGTH)
        }
        low = tolower(line)
        if (index(low, "todo"))  print fname ":" NR ": placeholder marker: TODO"
        if (index(low, "tbd"))   print fname ":" NR ": placeholder marker: TBD"
        if (index(low, "fixme")) print fname ":" NR ": placeholder marker: FIXME"
        if (index(low, "lorem")) print fname ":" NR ": placeholder marker: lorem"
        # Angle-bracket placeholder: < then a letter then up to a > with no
        # intervening > or whitespace-only emptiness. Catches <title>, <id>,
        # <what users do today>.
        if (line ~ /<[A-Za-z][^>]*>/) print fname ":" NR ": placeholder marker: <...>"
      }
    ' "$file"
  )"
  if [ -n "$hits" ]; then
    echo "$hits" | while IFS= read -r h; do
      report FAIL "$h"
    done
    # Count hits (one fail per line) without a subshell losing the count.
    n="$(printf '%s\n' "$hits" | grep -c '')"
    fail_count=$((fail_count + n))
  else
    report OK "$(basename "$file"): no placeholder markers"
  fi
}

# check_followups <file>
# Governance scan of the shared FOLLOWUPS.md backlog. Two findings:
#   - a follow-up ID used as the leading ID of >1 table row (the parallel-run
#     "next number after the highest existing ID" race — run-namespaced
#     `F-<run-id>-NN` IDs avoid it, but a legacy/regressed file can still collide);
#   - a row carrying `consumed-by:` left in the `## Open` section instead of moved
#     to `## Closed` (the leak that lets "done" items re-trigger and accumulate).
# Section is tracked by `## Open` / `## Closed` headings; only `|`-delimited table
# rows whose first F-token is the row ID are considered. Tolerant of both the
# legacy `F0001` and the namespaced `F-<run-id>-NN` ID forms.
check_followups() {
  file="$1"
  hits="$(
    awk '
      /^#+[[:space:]]*[Oo]pen/   { section = "open";   next }
      /^#+[[:space:]]*[Cc]losed/ { section = "closed"; next }
      /^#+[[:space:]]/           { section = "other";  next }
      {
        if ($0 !~ /^[[:space:]]*\|/) next
        if (!match($0, /F-[A-Za-z0-9][A-Za-z0-9_-]*|F[0-9]+/)) next
        id = substr($0, RSTART, RLENGTH)
        seen[id]++
        low = tolower($0)
        if (section == "open" && index(low, "consumed-by"))
          print "consumed-by: row left in ## Open (move to ## Closed): " id
      }
      END {
        for (k in seen) if (seen[k] > 1)
          print "duplicate follow-up ID across rows: " k " (" seen[k] " rows)"
      }
    ' "$file"
  )"
  if [ -n "$hits" ]; then
    echo "$hits" | while IFS= read -r h; do
      report FAIL "$(basename "$file"): $h"
    done
    n="$(printf '%s\n' "$hits" | grep -c '')"
    fail_count=$((fail_count + n))
  else
    report OK "$(basename "$file"): follow-up IDs unique, no consumed rows left open"
  fi
}

# AC-text locality: the bold `**Given**/**When**/**Then**` scenario syntax is
# spec.md's alone — every other artifact references ACs by `AC<n>` id. Flag a copy
# elsewhere (drift). Lines with a backtick are skipped (example syntax).
check_ac_text_locality() {
  file="$1"
  hits="$(grep -nE '\*\*Given\*\*' "$file" | grep -v '`' || true)"
  if [ -n "$hits" ]; then
    report FAIL "$(basename "$file"): acceptance-scenario prose (**Given**/**When**/**Then**) belongs only in spec.md — reference by \`AC<n>\` id here"
    n="$(printf '%s\n' "$hits" | grep -c '')"
    fail_count=$((fail_count + n))
  else
    report OK "$(basename "$file"): no AC prose outside spec (id-only)"
  fi
}

# All per-file checks for one artifact. Shared by the CLI dir walk (main) and
# the PostToolUse adapter (hook_main).
lint_file() {
  file="$1"
  case "$(basename "$file")" in
    spec.md)      check_spec "$file" ;;
    plan.md)      check_plan "$file" ;;
    tasks.md)     check_tasks "$file" ;;
    test-plan.md) check_test_plan "$file" ;;
  esac
  # NB: check_* helpers clobber the global $name (see require, line ~64), so key
  # this skip off the file's own basename, not the caller's loop var.
  [ "$(basename "$file")" = "spec.md" ] || check_ac_text_locality "$file"
  scan_placeholders "$file"
}

# PostToolUse adapter (`artifact-lint.sh --hook`): lint ONLY the artifact the
# tool call just wrote, and WARN via additionalContext — never block, always
# exit 0. Wired in settings.json under PostToolUse/Write|Edit so the model gets
# placeholder/section findings as immediate feedback while drafting. jq is
# required here (hook payloads are JSON); absent jq we fail open like the
# other hooks. The CLI mode below stays jq-free.
hook_main() {
  command -v jq >/dev/null 2>&1 || exit 0
  input="$(cat)"
  fp="$(printf '%s' "$input" | jq -r '.tool_input.file_path // ""' 2>/dev/null || true)"
  case "$fp" in
    */.workflow/_templates/*) exit 0 ;;  # templates carry placeholders by design
    */.workflow/*) ;;
    *) exit 0 ;;
  esac
  [ -f "$fp" ] || exit 0
  base="$(basename "$fp")"
  tmp="$(mktemp)"
  if [ "$base" = "FOLLOWUPS.md" ]; then
    check_followups "$fp" >"$tmp" 2>&1
  else
    case " $ARTIFACTS " in
      *" $base "*) lint_file "$fp" >"$tmp" 2>&1 ;;
      *) rm -f "$tmp"; exit 0 ;;
    esac
  fi
  if [ "$fail_count" -gt 0 ]; then
    findings="$(grep '^\[FAIL\]' "$tmp" || true)"
    jq -n --arg m "artifact-lint (warn-only) — $fail_count finding(s) in $base; fix before the phase hands off:
$findings" '{hookSpecificOutput:{hookEventName:"PostToolUse",additionalContext:$m}}'
  fi
  rm -f "$tmp"
  exit 0
}

main() {
  if [ "$#" -ne 1 ]; then
    usage
    return 1
  fi
  dir="$1"

  if [ ! -d "$dir" ]; then
    echo "error: not a directory: $dir" >&2
    return 1
  fi
  # Empty directory (no entries at all) is a usage error, not a clean pass.
  if [ -z "$(ls -A -- "$dir" 2>/dev/null)" ]; then
    echo "error: directory is empty: $dir" >&2
    return 1
  fi

  echo "Linting artifacts in: $dir"
  echo

  found=0
  for name in $ARTIFACTS; do
    file="$dir/$name"
    [ -f "$file" ] || continue
    found=$((found + 1))
    lint_file "$file"
  done

  # FOLLOWUPS.md governance. The shared backlog lives at .workflow/FOLLOWUPS.md
  # (one level above a run dir), so check the run dir itself first, then its
  # parent. Counts as a linted artifact so pointing the linter at .workflow/
  # to check the backlog alone is a valid invocation.
  for fu in "$dir/FOLLOWUPS.md" "$dir/../FOLLOWUPS.md"; do
    if [ -f "$fu" ]; then
      found=$((found + 1))
      check_followups "$fu"
      break
    fi
  done

  echo
  if [ "$found" -eq 0 ]; then
    echo "no lintable artifacts found in $dir (expected spec.md / plan.md / ...)" >&2
    return 1
  fi

  if [ "$fail_count" -eq 0 ]; then
    echo "artifact-lint: PASS — $found artifact(s) checked, 0 findings"
    return 0
  else
    echo "artifact-lint: FAIL — $found artifact(s) checked, $fail_count finding(s)" >&2
    return 1
  fi
}

if [ "${1:-}" = "--hook" ]; then
  hook_main
else
  main "$@"
fi
