#!/usr/bin/env sh
# artifact-lint.sh — optional artifact gate for /dev runs.
#
# Validates a `.workflow/<id>/` run directory against the artifact templates:
#   1. Required sections per artifact:
#        spec.md  — a `**Type**:` declaration AND a `## Acceptance criteria` section.
#        plan.md  — a fenced `mermaid` block, at least one inline AC tag (`[AC<n>]`
#                   or `[DoD]`), and a runnable verify section (a `verify:` clause).
#   2. No leftover placeholder markers anywhere in any linted artifact:
#        TODO, TBD, FIXME, lorem  (word markers, case-insensitive)
#        <...>                    (an angle-bracket placeholder, e.g. <title>, <id>)
#      A marker inside an inline code span (backticks) or a fenced code block is
#      treated as documentation/example syntax, NOT a leftover, and is skipped —
#      only bare-prose markers are findings. (This is what lets an artifact that
#      *documents* the markers pass against its own run directory.)
#
# Prints a report (one line per check) and exits non-zero on any failure, zero
# when clean. Dependency-light: POSIX sh + the standard `awk`/`grep` toolchain;
# no new packages, no JSON, does not read `.workflow/_templates/` at runtime.
#
# This is an OPTIONAL gate — invoke it by hand or in CI. It is NOT wired into the
# /dev state machine and never blocks a tool call.
#
# Usage:  sh artifact-lint.sh <path-to-.workflow/<id>/-dir>
# Exit:   0 = clean (>=1 artifact found, every check passed)
#         1 = any failed check, no recognised artifact, or a usage/argument error

set -eu

# Recognised artifacts. spec.md / plan.md also get required-section checks;
# every file here gets the placeholder scan.
ARTIFACTS='spec.md plan.md review.md security.md tests.md retro.md recommendations.md epic.md'

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
  require_section "$file" "Acceptance criteria"  E '^#+[[:space:]]+Acceptance criteria'
}

check_plan() {
  file="$1"
  require_section "$file" "mermaid diagram"      E '^[[:space:]]*```mermaid'
  require_section "$file" "inline AC tag"        E '\[(AC[0-9]+|DoD)\]'
  require_section "$file" "runnable verify section" F 'verify:'
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
    case "$name" in
      spec.md) check_spec "$file" ;;
      plan.md) check_plan "$file" ;;
    esac
    scan_placeholders "$file"
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

main "$@"
