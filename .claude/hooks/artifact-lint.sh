#!/usr/bin/env sh
# artifact-lint.sh — optional artifact gate for /dev runs.
#
# Validates a `.workflow/<id>/` run directory against the artifact templates:
#   1. Required sections per artifact (spec.md / plan.md are TYPE-AWARE — the
#      `**Type**:` value picks the required shape; unknown/unset falls back to
#      the strict feat shape):
#        spec.md       — a `**Type**:` declaration, a `## Goal` section, AND the
#                        type's contract block: feat → `## User Stories`;
#                        fix → `Reproduction & Expected`; refactor → `Equivalence
#                        contract`; chore → `Checklist`; docs → `Docs scope`;
#                        spike → `Questions & Timebox`. Non-feat blocks must
#                        also carry >=1 `AC<n>` scenario id.
#        plan.md       — a fenced `mermaid` block (feat/fix/refactor/spike;
#                        chore/docs are exempt).
#        run.md        — the XS micro-lane single artifact: `**Type**:` +
#                        `## Goal` + >=1 `AC<n>` + >=1 `T###` + a `verify:`.
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
# Three modes; hook mode never blocks a tool call:
#   CLI  — invoke by hand or in CI against a run dir (jq-free, POSIX sh).
#   CONTRACT — CLI lint plus required-artifact and exact cross-artifact AC-set
#              checks. This is the single deterministic pre-approval gate.
#   HOOK — `artifact-lint.sh --hook` as PostToolUse on Write|Edit (wired in
#          settings.json): lints just the artifact that was written and surfaces
#          findings as a warn-only additionalContext note. Requires jq (fails
#          open without it); skips .workflow/_templates/.
#
# Usage:  sh artifact-lint.sh <path-to-.workflow/<id>/-dir>
#         sh artifact-lint.sh --contract <path-to-.workflow/<id>/-dir>
#         sh artifact-lint.sh --hook   (PostToolUse JSON on stdin)
# Exit:   0 = clean (>=1 artifact found, every check passed)
#         1 = any failed check, no recognised artifact, or a usage/argument error

set -eu

# Recognised artifacts. spec.md / plan.md / test-plan.md also get required-section
# checks; every file here gets the placeholder scan.
ARTIFACTS='spec.md plan.md tasks.md test-plan.md uxui-plan.md run.md review.md security.md tests.md retro.md recommendations.md epic.md'

PROG="$(basename "$0")"

usage() {
  echo "usage: $PROG <.workflow/<id>/-directory>" >&2
  echo "       $PROG --contract <.workflow/<id>/-directory>" >&2
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

# spec_type <file> — the declared `**Type**:` value (first token only). A
# template line still listing every option ("feat | fix | ...") yields "feat",
# which is also the fallback for a missing/unknown type — the strictest shape.
spec_type() {
  grep -m1 -F '**Type**:' "$1" 2>/dev/null \
    | sed -e 's/.*\*\*Type\*\*:[[:space:]]*//' -e 's/[[:space:]|].*//'
}

check_spec() {
  file="$1"
  require_section "$file" "Type declaration"     F '**Type**:'
  # Anchor the heading at line start so a mention of the section name in prose
  # or an HTML comment does not satisfy the check.
  require_section "$file" "Goal"                 E '^#+[[:space:]]+Goal'
  # Type-aware contract block: each type carries its ACs in its own shape.
  t="$(spec_type "$file")"
  case "$t" in
    fix)      require_section "$file" "Reproduction & Expected (fix)"   E '^#+[[:space:]]+Reproduction' ;;
    refactor) require_section "$file" "Equivalence contract (refactor)" E '^#+[[:space:]]+Equivalence' ;;
    chore)    require_section "$file" "Checklist (chore)"               E '^#+[[:space:]]+Checklist' ;;
    docs)     require_section "$file" "Docs scope (docs)"               E '^#+[[:space:]]+Docs scope' ;;
    spike)    require_section "$file" "Questions & Timebox (spike)"     E '^#+[[:space:]]+Questions' ;;
    *)        require_section "$file" "User Stories"                    E '^#+[[:space:]]+User Stories' ;;
  esac
  case "$t" in
    fix|refactor|chore|docs|spike)
      require_section "$file" "acceptance scenario id (AC#)" E '\bAC[0-9]+\b' ;;
  esac
}

check_plan() {
  file="$1"
  t="$(spec_type "$file")"
  case "$t" in
    chore|docs) report OK "$(basename "$file"): mermaid not required (type=$t)" ;;
    *) require_section "$file" "mermaid diagram" E '^[[:space:]]*```mermaid' ;;
  esac
  # `## Current state` is the *understand* half of brownfield's understand → lock
  # → change discipline (`plan-writing > SKILL.md` principle 3, gated by `field`,
  # not Type/Size). Its invariants are what `tasks.md > ## Guardrails` digests, so
  # a run missing this is missing the source of the other. The exemptions are
  # `lead.md` step 2's own: chore/docs may not touch live code, and a spike
  # explores rather than changes — every other brownfield type maps first.
  case "$t" in
    chore|docs|spike) ;;
    *) if [ "$(run_field "$file")" = "brownfield" ]; then
         require_section "$file" "## Current state (brownfield understand step)" E '^##[[:space:]]+Current state'
       fi ;;
  esac
}

check_tasks() {
  file="$1"
  require_section "$file" "T### task"            E '\bT[0-9]+\b'
  require_section "$file" "inline AC tag"        E '\[(AC[0-9]+|DoD|SC-[0-9]+)\]'
  require_section "$file" "runnable verify section" F 'verify:'
  check_guardrails "$file"
}

# run_state_value <file> <key> — a top-level scalar from the sibling state.json,
# jq-free (CLI mode is deliberately jq-free). Empty for legacy/missing state.
run_state_value() {
  _st="$(dirname "$1")/state.json"
  _key="$2"
  [ -f "$_st" ] || { printf ''; return 0; }
  # Strip braces as well as quotes/spaces: a one-line state.json leaves the last
  # key glued to `}`, so `field:brownfield}` never matched and the check silently
  # never fired — the exact failure mode this whole section exists to end.
  tr -d ' "{}' < "$_st" | tr ',' '\n' \
    | sed -n "s/^${_key}:\\([^]}]*\\)$/\\1/p" | head -1
}

run_field() {
  run_state_value "$1" field
}

run_profile() {
  run_state_value "$1" work_profile
}

# Guardrails — the brownfield contract, and the one artifact section unique to
# brownfield work. `tasks.md > ## Guardrails` is the engineer's ONLY up-front
# invariant read (`agents/lead.md` step 4; a miss is a `BLOCKER:` per
# `plan-writing > SKILL.md`), with the full map staying in `plan.md > ## Current
# state` and pulled per-task via `[ref:]`. It was mandatory in prose and checked
# NOWHERE — not here, not in the scenario suite — and all three golden brownfield
# fixtures shipped without it, which is what an exemplar then teaches. Keyed off
# `state.json > field`: greenfield legitimately has nothing to guard, and a run
# with no state.json is skipped rather than failed.
check_guardrails() {
  file="$1"
  [ "$(run_field "$file")" = "brownfield" ] || return 0
  if ! grep -qE '^##[[:space:]]+Guardrails' "$file" 2>/dev/null; then
    report FAIL "$(basename "$file"): MISSING required section: ## Guardrails (brownfield must-not-break invariants — the engineer's only up-front invariant read)"
    note_fail
    return 0
  fi
  # A header with no cited invariant is the same miss wearing a hat: the point is
  # the `path#anchor` the engineer must not break, not the heading.
  if awk '/^##[[:space:]]+Guardrails/{f=1;next} /^##[[:space:]]/{f=0} f' "$file" \
     | grep -qE '`[^`]+#'; then
    report OK "$(basename "$file"): brownfield Guardrails cite a \`path#anchor\`"
  else
    report FAIL "$(basename "$file"): ## Guardrails cites no backticked \`path#anchor\` invariant (brownfield)"
    note_fail
  fi
}

# run.md — the XS micro-lane single artifact (replaces spec/plan/tasks/test-plan
# at size=XS). Carries the whole contract core in one file.
check_run() {
  file="$1"
  require_section "$file" "Type declaration"                F '**Type**:'
  require_section "$file" "Goal"                            E '^#+[[:space:]]+Goal'
  require_section "$file" "acceptance scenario id (AC#)"    E '\bAC[0-9]+\b'
  require_section "$file" "T### task"                       E '\bT[0-9]+\b'
  require_section "$file" "runnable verify section"         F 'verify:'
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
        # Marker-aware word boundaries: `todolist` is product language, not an
        # unfinished TODO. POSIX awk has no portable \b, so spell the boundary.
        if (low ~ /(^|[^[:alnum:]_])todo([^[:alnum:]_]|$)/)  print fname ":" NR ": placeholder marker: TODO"
        if (low ~ /(^|[^[:alnum:]_])tbd([^[:alnum:]_]|$)/)   print fname ":" NR ": placeholder marker: TBD"
        if (low ~ /(^|[^[:alnum:]_])fixme([^[:alnum:]_]|$)/) print fname ":" NR ": placeholder marker: FIXME"
        if (low ~ /(^|[^[:alnum:]_])lorem([^[:alnum:]_]|$)/) print fname ":" NR ": placeholder marker: lorem"
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

# scan_scaffold_leftover <file>
# Template teaching scaffolding the author must strip on fill (rules/fundamentals.md
# > Output discipline): the guidance footer / section notes that say "delete the
# rest" (spec.md / plan.md carry it). A filled artifact is re-read 4-6x downstream,
# so leftover scaffolding is dead weight. Backtick lines are skipped (a documented
# example, not a live leftover). Bumps fail_count per hit.
scan_scaffold_leftover() {
  file="$1"
  hits="$(grep -niE 'delete the rest' "$file" | grep -v '`' || true)"
  if [ -n "$hits" ]; then
    echo "$hits" | while IFS= read -r h; do
      report FAIL "$(basename "$file"): scaffold leftover (strip on fill): line ${h%%:*}"
    done
    n="$(printf '%s\n' "$hits" | grep -c '')"
    fail_count=$((fail_count + n))
  else
    report OK "$(basename "$file"): no template scaffold leftover"
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
    run.md)       check_run "$file" ;;
  esac
  # NB: check_* helpers clobber the global $name (see require, line ~64), so key
  # this skip off the file's own basename, not the caller's loop var.
  # run.md is the XS spec surrogate, so like spec.md it owns its AC prose.
  case "$(basename "$file")" in
    spec.md|run.md) ;;
    *) check_ac_text_locality "$file" ;;
  esac
  scan_placeholders "$file"
  scan_scaffold_leftover "$file"
}

# Unique AC IDs from a whole file, task tags, or one markdown section.
ac_set_all() {
  grep -oE 'AC[0-9]+' "$1" 2>/dev/null | sort -u || true
}

ac_set_tasks() {
  grep -oE '\[AC[0-9]+\]' "$1" 2>/dev/null | tr -d '[]' | sort -u || true
}

ac_set_section() {
  file="$1"; heading="$2"
  awk -v heading="$heading" '
    $0 ~ heading { in_section = 1; next }
    in_section && /^##[[:space:]]+/ { exit }
    in_section { print }
  ' "$file" | grep -oE 'AC[0-9]+' | sort -u || true
}

display_ac_set() {
  if [ -z "$1" ]; then
    printf '(none)'
  else
    printf '%s\n' "$1" | tr '\n' ' ' | sed 's/[[:space:]]*$//'
  fi
}

evidence_class_for_ac() {
  file="$1"; ac="$2"
  grep -E "${ac}([^0-9]|$).*\[evidence:(structural|behavioral|rendered|integration|measured|security|manual)\]" "$file" 2>/dev/null \
    | head -1 \
    | sed -n 's/.*\[evidence:\([^]]*\)\].*/\1/p'
}

check_evidence_contract() {
  source_file="$1"
  test_plan="$2"
  expected="$(ac_set_all "$source_file")"
  [ -n "$expected" ] || return 0

  printf '%s\n' "$expected" | while IFS= read -r ac; do
    [ -n "$ac" ] || continue
    cls="$(evidence_class_for_ac "$source_file" "$ac")"
    if [ -z "$cls" ]; then
      report FAIL "contract: $ac has no valid [evidence:<class>] in $(basename "$source_file")"
      # This loop is a subshell in POSIX sh, so emit a sentinel consumed below.
      printf '%s\n' "$ac"
      continue
    fi
    if [ -n "$test_plan" ] && [ -f "$test_plan" ]; then
      if grep -Ei "^[|][[:space:]]*${ac}([^0-9]|[[:space:]])[^|]*[|][[:space:]]*${cls}[[:space:]]*[|]" "$test_plan" >/dev/null 2>&1; then
        report OK "contract: $ac evidence=$cls matches test-plan"
      else
        report FAIL "contract: $ac evidence=$cls missing/mismatched in test-plan.md"
        printf '%s\n' "$ac"
      fi
    else
      report OK "contract: $ac evidence=$cls declared"
    fi
  done >"${TMPDIR:-/tmp}/artifact-lint-evidence.$$"

  # Replay reports captured inside the subshell and count only sentinel AC lines.
  while IFS= read -r line; do
    case "$line" in
      "[OK]"*|"[FAIL]"*) echo "$line" ;;
      AC[0-9]*) note_fail ;;
    esac
  done <"${TMPDIR:-/tmp}/artifact-lint-evidence.$$"
  rm -f "${TMPDIR:-/tmp}/artifact-lint-evidence.$$"

  if grep -q '\[evidence:rendered\]' "$source_file" 2>/dev/null && [ -n "$test_plan" ] && [ -f "$test_plan" ]; then
    require_section "$test_plan" "Rendered smoke command" F '**Rendered smoke**'
  fi
  if grep -q '\[evidence:measured\]' "$source_file" 2>/dev/null && [ -n "$test_plan" ] && [ -f "$test_plan" ]; then
    require_section "$test_plan" "measured region" F 'measured region:'
    require_section "$test_plan" "excluded harness cost" F 'excludes:'
  fi
}

check_ac_density() {
  source_file="$1"
  size="$(run_state_value "$source_file" size)"
  count="$(ac_set_all "$source_file" | grep -c . || true)"
  threshold=0
  case "$size" in XS) threshold=3 ;; S) threshold=8 ;; M) threshold=15 ;; esac
  [ "$threshold" -gt 0 ] || return 0
  if [ "$count" -gt "$threshold" ]; then
    if grep -qF 'AC_DENSITY_JUSTIFICATION:' "$source_file" 2>/dev/null; then
      report OK "contract: AC density $count>$threshold justified for size=$size"
    else
      report FAIL "contract: AC density $count exceeds size=$size threshold $threshold; split capability or add AC_DENSITY_JUSTIFICATION:"
      note_fail
    fi
  fi
}

check_execution_contract() {
  file="$1"
  require_section "$file" "Execution contract" E '^#+[[:space:]]+Execution contract'
  require_section "$file" "Impacted command contract" F '**Impacted**'
  require_section "$file" "Full-suite command contract" F '**Full-suite**'
  require_section "$file" "command cwd" F 'cwd:'
  require_section "$file" "test discovery expectation" E 'expected (groups|min tests|groups/min tests)'
}

check_exact_ac_set() {
  file_name="$1"; expected="$2"; actual="$3"
  if [ "$expected" = "$actual" ]; then
    report OK "contract: $file_name AC set matches source ($(display_ac_set "$expected"))"
  else
    report FAIL "contract: $file_name AC set mismatch; expected {$(display_ac_set "$expected")}, actual {$(display_ac_set "$actual")}"
    note_fail
  fi
}

# The Contract Gate adds only checks that must agree across artifacts. Semantic
# judgment remains with Design and the human approval gate.
check_contract() {
  dir="$1"

  if [ -f "$dir/run.md" ]; then
    expected="$(ac_set_all "$dir/run.md")"
    actual="$(ac_set_tasks "$dir/run.md")"
    check_exact_ac_set "run.md task tags" "$expected" "$actual"
    profile="$(run_profile "$dir/run.md")"
    if [ -n "$profile" ] && [ "$profile" != "null" ]; then
      check_evidence_contract "$dir/run.md" ""
      check_ac_density "$dir/run.md"
      t="$(spec_type "$dir/run.md")"
      case "$t" in feat|fix|refactor) check_execution_contract "$dir/run.md" ;; esac
    fi
  else
    for required in spec.md plan.md tasks.md; do
      if [ ! -f "$dir/$required" ]; then
        report FAIL "contract: MISSING required artifact: $required"
        note_fail
      fi
    done

    if [ -f "$dir/spec.md" ]; then
      expected="$(ac_set_all "$dir/spec.md")"
      if [ -f "$dir/tasks.md" ]; then
        check_exact_ac_set "tasks.md" "$expected" "$(ac_set_tasks "$dir/tasks.md")"
      fi

      t="$(spec_type "$dir/spec.md")"
      case "$t" in
        feat|fix|refactor)
          if [ ! -f "$dir/test-plan.md" ]; then
            report FAIL "contract: MISSING required artifact for type=$t: test-plan.md"
            note_fail
          else
            check_exact_ac_set "test-plan.md" "$expected" \
              "$(ac_set_section "$dir/test-plan.md" '^##[[:space:]]+Coverage plan')"
          fi
          ;;
      esac

      profile="$(run_profile "$dir/spec.md")"
      if [ -n "$profile" ] && [ "$profile" != "null" ]; then
        check_evidence_contract "$dir/spec.md" "$dir/test-plan.md"
        check_ac_density "$dir/spec.md"
        case "$t" in feat|fix|refactor)
          [ -f "$dir/test-plan.md" ] && check_execution_contract "$dir/test-plan.md"
          ;;
        esac
      fi

      if [ -f "$dir/uxui-plan.md" ]; then
        check_exact_ac_set "uxui-plan.md" "$expected" \
          "$(ac_set_section "$dir/uxui-plan.md" '^##[[:space:]]+AC .* scene mapping')"
      fi
    fi
    if [ -f "$dir/plan.md" ]; then
      if grep -qE '^##[[:space:]]+Phases for this task' "$dir/plan.md" 2>/dev/null; then
        report OK "contract: plan.md has phase disposition"
      else
        report FAIL "contract: plan.md MISSING required section: ## Phases for this task"
        note_fail
      fi
    fi
  fi

  unresolved=0
  for name in $ARTIFACTS; do
    file="$dir/$name"
    [ -f "$file" ] || continue
    if grep -qE '\[NEEDS CLARIFICATION\]|\[pending plan\]' "$file" 2>/dev/null; then
      report FAIL "contract: $name has unresolved contract marker"
      note_fail
      unresolved=$((unresolved + 1))
    fi
  done
  [ "$unresolved" -gt 0 ] || report OK "contract: no unresolved contract markers"
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
elif [ "${1:-}" = "--contract" ]; then
  if [ "$#" -ne 2 ]; then
    usage
    exit 1
  fi
  # Keep ordinary lint and contract checks in one invocation. `main` may fail,
  # but the contract report still runs so the author gets all findings at once.
  main_failed=0
  main "$2" || main_failed=1
  [ -d "$2" ] || exit 1
  echo
  echo "Checking Contract Gate..."
  check_contract "$2"
  echo
  if [ "$main_failed" -eq 0 ] && [ "$fail_count" -eq 0 ]; then
    echo "contract-gate: PASS"
    exit 0
  fi
  echo "contract-gate: FAIL — $fail_count finding(s)" >&2
  exit 1
else
  main "$@"
fi
