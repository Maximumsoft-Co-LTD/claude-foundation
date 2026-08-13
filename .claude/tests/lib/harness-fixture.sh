#!/usr/bin/env sh
# harness-fixture.sh — install the runtime into a temp project atomically.
#
# `cp foundation.mjs` followed by `cp -R runtime` is two copies with a window
# between them. A write landing in that window produces a fixture holding
# foundation.mjs at one revision and runtime/** at another, and the resulting
# failure surfaces at whichever call site first touches the mismatched pair —
# typically deep in Land, which reads as a flake rather than as a torn copy.
#
# Copy from `git archive HEAD` when the tree is a clean checkout of a git
# repository, so the fixture is a committed revision rather than whatever the
# developer is editing. Otherwise stage into a sibling directory and rename it
# into place, which at least makes the pair atomic.
#
# Usage: install_harness_fixture <source-root> <target-project>

install_harness_fixture() {
  fixture_source="$1"
  fixture_target="$2"
  fixture_stage="$fixture_target/.claude/.harness-staging.$$"

  rm -rf "$fixture_stage"
  mkdir -p "$fixture_stage" "$fixture_target/.claude"

  if git -C "$fixture_source" rev-parse --git-dir >/dev/null 2>&1 &&
     [ -z "$(git -C "$fixture_source" status --porcelain -- .claude/harness 2>/dev/null)" ]; then
    # Committed revision: one consistent snapshot by construction.
    git -C "$fixture_source" archive HEAD -- .claude/harness |
      tar -x -C "$fixture_stage" 2>/dev/null || fixture_stage_failed=1
    # Only tar's status reaches that `||`, and bsdtar (macOS) exits 0 on empty
    # input — so a failed `git archive` reads as a successful extraction and
    # skips the working-tree fallback. Check that the payload actually landed.
    [ -d "$fixture_stage/.claude/harness" ] || fixture_stage_failed=1
  else
    fixture_stage_failed=1
  fi

  if [ "${fixture_stage_failed:-0}" = 1 ]; then
    # Working tree (the normal case while developing): stage both halves, then
    # publish them with a single rename.
    unset fixture_stage_failed
    mkdir -p "$fixture_stage/.claude/harness"
    cp -R "$fixture_source/.claude/harness/." "$fixture_stage/.claude/harness/"
  fi

  rm -rf "$fixture_target/.claude/harness"
  mv "$fixture_stage/.claude/harness" "$fixture_target/.claude/harness"
  rm -rf "$fixture_stage"
}
