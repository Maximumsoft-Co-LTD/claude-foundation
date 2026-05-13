#!/usr/bin/env bash
# Lint dispatcher hook for Claude Code PostToolUse.
#
# Reads the tool-event JSON from stdin, looks at tool_input.file_path,
# picks a linter from the extension, and runs it. On a real lint failure
# this exits 2 — Claude Code feeds the captured stderr back to the model
# so it can self-correct on the next turn.
#
# Linters are optional. If none is installed for a language, the hook
# exits 0 silently (it should never block an edit on a machine that
# simply doesn't have the toolchain).
#
# Auto-fix is intentionally OFF. We want Claude to see the diagnostics
# and fix them in-conversation, not have files mutate behind its back.

set -uo pipefail

# jq is the only hard dependency. Fail open if it's not installed.
command -v jq >/dev/null 2>&1 || exit 0

EVENT_JSON="$(cat)"
FILE_PATH="$(printf '%s' "$EVENT_JSON" | jq -r '.tool_input.file_path // empty')"

[ -n "$FILE_PATH" ] || exit 0
[ -f "$FILE_PATH" ] || exit 0

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$PWD}"

# Only lint files inside the project tree.
case "$FILE_PATH" in
  "$PROJECT_DIR"/*) ;;
  *) exit 0 ;;
esac

have() { command -v "$1" >/dev/null 2>&1; }

# Run a linter. On non-zero exit, emit a labeled report to stderr and
# exit 2 so Claude Code surfaces it back to the model.
run_linter() {
  local label="$1"; shift
  local out rc=0
  out="$("$@" 2>&1)" || rc=$?
  if [ "$rc" -ne 0 ]; then
    printf '── %s: %s ──\n%s\n' "$label" "$FILE_PATH" "$out" >&2
    exit 2
  fi
}

# Prefer a project-local node binary over the global one — most JS/TS
# repos pin their linter version in node_modules.
node_bin() {
  local name="$1"
  if [ -x "$PROJECT_DIR/node_modules/.bin/$name" ]; then
    printf '%s\n' "$PROJECT_DIR/node_modules/.bin/$name"
  elif have "$name"; then
    printf '%s\n' "$name"
  fi
}

case "$FILE_PATH" in
  *.go)
    # gofmt has no module dependency — always run it first.
    if have gofmt; then
      diff="$(gofmt -d "$FILE_PATH" 2>&1)" || true
      if [ -n "$diff" ]; then
        printf '── gofmt: %s not formatted ──\n%s\n' "$FILE_PATH" "$diff" >&2
        exit 2
      fi
    fi

    # golangci-lint needs a go.mod somewhere above the file — outside a
    # module it errors with "no go files to analyze" and is unhelpful.
    # Walk up looking for go.mod; skip the linter if there's no module.
    has_go_mod=0
    dir="$(dirname "$FILE_PATH")"
    while [ "$dir" != "/" ] && [ "$dir" != "." ]; do
      if [ -f "$dir/go.mod" ]; then has_go_mod=1; break; fi
      dir="$(dirname "$dir")"
    done

    if [ "$has_go_mod" -eq 1 ] && have golangci-lint; then
      rc=0
      out="$(golangci-lint run "$FILE_PATH" 2>&1)" || rc=$?
      # "no go files to analyze" means the loader couldn't resolve the
      # package context — treat as a soft skip, not a lint failure.
      if [ "$rc" -ne 0 ] && ! printf '%s' "$out" | grep -q 'no go files to analyze'; then
        printf '── golangci-lint: %s ──\n%s\n' "$FILE_PATH" "$out" >&2
        exit 2
      fi
    fi
    ;;

  *.py)
    if have ruff; then
      run_linter "ruff" ruff check "$FILE_PATH"
    elif have flake8; then
      run_linter "flake8" flake8 "$FILE_PATH"
    elif have pylint; then
      run_linter "pylint" pylint --score=n "$FILE_PATH"
    fi
    ;;

  *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs)
    bin="$(node_bin eslint)"
    if [ -n "$bin" ]; then
      run_linter "eslint" "$bin" "$FILE_PATH"
    else
      bin="$(node_bin biome)"
      if [ -n "$bin" ]; then
        run_linter "biome" "$bin" lint "$FILE_PATH"
      fi
    fi
    ;;

  *.html|*.htm)
    bin="$(node_bin htmlhint)"
    if [ -n "$bin" ]; then
      run_linter "htmlhint" "$bin" "$FILE_PATH"
    else
      bin="$(node_bin prettier)"
      if [ -n "$bin" ]; then
        run_linter "prettier" "$bin" --check "$FILE_PATH"
      fi
    fi
    ;;

  *.css|*.scss|*.sass|*.less)
    bin="$(node_bin stylelint)"
    if [ -n "$bin" ]; then
      run_linter "stylelint" "$bin" "$FILE_PATH"
    else
      bin="$(node_bin prettier)"
      if [ -n "$bin" ]; then
        run_linter "prettier" "$bin" --check "$FILE_PATH"
      fi
    fi
    ;;
esac

exit 0
