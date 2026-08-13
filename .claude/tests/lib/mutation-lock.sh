#!/usr/bin/env sh
# mutation-lock.sh — serialize the suites that edit this repository in place.
#
# A mutation suite injects a fault into a file under `.claude/harness/`, runs a
# suite against it, and restores the file from a copy taken at its own start.
# Two of them overlapping is not a slowdown, it is corruption: the second run's
# "clean" copy is the first run's injected fault, and restoring it writes that
# fault into the working tree permanently. `run-all.sh` keeps its own mutation
# suites in a serial lane, which does nothing about a second `run-all.sh` — or a
# developer running one script directly — in the same checkout.
#
# This happened. Two sessions tested the same tree at once and left
# `state-runtime.mjs` with its packet-omission guard replaced by a comment and
# `undeclaredDeletions` with its filter replaced by `true`. Both suites then
# failed for reasons that had nothing to do with either session's work.
#
# The lock is a directory, because `mkdir` is atomic on every filesystem that
# matters. It lives under `.foundation/`, which is machine state and ignored.
#
# Usage:
#   . "$ROOT/.claude/tests/lib/mutation-lock.sh"
#   acquire_mutation_lock "$ROOT" || exit 1
#   trap 'restore; release_mutation_lock' EXIT INT TERM

MUTATION_LOCK=""

acquire_mutation_lock() {
  mutation_lock_root="$1"
  mutation_lock_wait="${FOUNDATION_MUTATION_LOCK_WAIT:-900}"
  mutation_lock_dir="$mutation_lock_root/.foundation/mutation.lock"
  mkdir -p "$mutation_lock_root/.foundation"
  mutation_lock_waited=0
  mutation_lock_nameless=0
  while ! mkdir "$mutation_lock_dir" 2>/dev/null; do
    # A crashed holder must not block the repository forever, and its pid is the
    # only evidence available.
    mutation_lock_owner="$(cat "$mutation_lock_dir/pid" 2>/dev/null || true)"
    if [ -n "$mutation_lock_owner" ]; then
      mutation_lock_nameless=0
      if ! kill -0 "$mutation_lock_owner" 2>/dev/null; then
        rm -rf "$mutation_lock_dir"
        continue
      fi
    else
      # `mkdir` and the pid write are two steps, so a lock taken microseconds
      # ago legitimately has no pid yet. Treating that as stale is how both
      # racers break each other's lock and inject faults at the same time —
      # which is the exact corruption this file exists to prevent. Only an
      # unnamed lock that stays unnamed is a crash between the two steps.
      mutation_lock_nameless=$((mutation_lock_nameless + 1))
      if [ "$mutation_lock_nameless" -ge 5 ]; then
        rm -rf "$mutation_lock_dir"
        mutation_lock_nameless=0
        continue
      fi
      sleep 1
      continue
    fi
    if [ "$mutation_lock_waited" -ge "$mutation_lock_wait" ]; then
      echo "FAIL: pid $mutation_lock_owner has held $mutation_lock_dir for ${mutation_lock_wait}s; another test run is mutating this checkout" >&2
      return 1
    fi
    [ "$mutation_lock_waited" -eq 0 ] &&
      echo "waiting for pid $mutation_lock_owner to finish mutating this checkout"
    mutation_lock_waited=$((mutation_lock_waited + 1))
    sleep 1
  done
  echo "$$" > "$mutation_lock_dir/pid"
  MUTATION_LOCK="$mutation_lock_dir"
}

release_mutation_lock() {
  [ -n "${MUTATION_LOCK:-}" ] && rm -rf "$MUTATION_LOCK"
  MUTATION_LOCK=""
}

# A fault that outlived its script is indistinguishable from a real defect, and
# the suite it breaks is rarely the one that injected it. Refuse to start on a
# tree that still carries one rather than adding a second layer of damage.
assert_no_injected_fault() {
  if grep -rl "FOUNDATION-INJECTED-FAULT" "$1/.claude/harness" 2>/dev/null | grep -q .; then
    echo "FAIL: the working tree still carries an injected fault from an earlier mutation run:" >&2
    grep -rln "FOUNDATION-INJECTED-FAULT" "$1/.claude/harness" 2>/dev/null >&2
    echo "  restore those files before running any mutation suite" >&2
    return 1
  fi
  return 0
}
