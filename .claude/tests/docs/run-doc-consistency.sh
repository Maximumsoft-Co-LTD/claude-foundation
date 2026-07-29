#!/usr/bin/env sh
# run-doc-consistency.sh — deterministic guards on the workflow's own docs.
#
# These catch the drift that silently rots a prose-driven workflow: a version
# string that no longer matches VERSION, an agent pinned to a bogus model tier,
# a skill chain that fell out of the README, and — the load-bearing one — the
# executable phase-matrix.tsv diverging from WORKFLOW.md's human matrix. No
# Claude session, no network; POSIX sh + grep/awk. A check whose source file is
# absent is skipped with a note, never a false failure.
#
# Invocation: sh run-doc-consistency.sh

set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
WF="$ROOT/WORKFLOW.md"
README="$ROOT/README.md"
FUND="$ROOT/.claude/rules/fundamentals.md"
AGENTS="$ROOT/.claude/agents"
MATRIX="$HERE/../phase-matrix.tsv"

. "$HERE/../lib/assert.sh"

echo "Running doc-consistency suite..."
echo

# --- 1. VERSION string is single-sourced -----------------------------------
if [ -f "$ROOT/VERSION" ] && [ -f "$WF" ]; then
  ver="$(tr -d ' \t\n\r' < "$ROOT/VERSION")"
  if grep -qF "Version $ver" "$WF"; then
    pass "VERSION $ver matches WORKFLOW.md"
  else
    fail "VERSION $ver not reflected in WORKFLOW.md 'Version …' line"
  fi
else
  echo "skip: VERSION and/or WORKFLOW.md absent"
fi

# --- 2. fundamentals chain head is mirrored in README ----------------------
if [ -f "$FUND" ]; then
  assert_file_contains "fundamentals chain head present" "$FUND" "ddd-strategic"
  assert_file_contains "fundamentals chain tail present" "$FUND" "observability-fundamentals"
fi
if [ -f "$README" ]; then
  assert_file_contains "README mirrors chain head (ddd-strategic)" "$README" "ddd-strategic"
fi

# --- 3. every agent model pin is a known tier ------------------------------
if [ -d "$AGENTS" ]; then
  known="sonnet opus haiku fable opusplan inherit"
  for a in "$AGENTS"/*.md; do
    [ -f "$a" ] || continue
    m="$(grep -m1 '^model:' "$a" 2>/dev/null | sed -e 's/^model:[[:space:]]*//' -e 's/[[:space:]].*$//' || true)"
    [ -n "$m" ] || continue     # files without a model pin (INDEX.md, TEAM.md) are fine
    assert_in "$(basename "$a") model pin" "$m" "$known"
  done
fi

# --- 4. phase-matrix.tsv is complete ---------------------------------------
if [ -f "$MATRIX" ]; then
  for ph in interview plan test-plan gate implement test review security docs ship retro; do
    if awk -v p="$ph" '/^#/||NF==0{next} !seen{seen=1;next} $1==p{found=1} END{exit !found}' "$MATRIX"; then
      pass "matrix row: $ph"
    else
      fail "matrix missing phase row: $ph"
    fi
  done
fi

# --- 5. executable matrix stays in sync with WORKFLOW.md --------------------
# Only the machine-checked skip cells are asserted (the ones the scenario suite
# trusts). If WORKFLOW.md changes a skip, this fails until phase-matrix.tsv and
# WORKFLOW.md agree again.
wf_row_has() {  # <label> <row-substring> <needle-substring>
  if [ ! -f "$WF" ]; then echo "skip: WORKFLOW.md absent ($1)"; return 0; fi
  row="$(grep -F -- "$2" "$WF" | grep -F '|' | head -n1 || true)"
  if [ -z "$row" ]; then fail "$1 — no matrix row matching '$2' in WORKFLOW.md"; return 0; fi
  if printf '%s' "$row" | grep -qF -- "$3"; then pass "$1"; else fail "$1 — row lacks '$3': $row"; fi
}
# Test-plan and Test both skip for chore/docs/spike (the last three columns).
wf_row_has "WORKFLOW Test-plan row skips chore/docs/spike" "Test plan" "skip | skip | skip |"
wf_row_has "WORKFLOW Test row skips chore/docs/spike"      "5. Test"   "skip | skip | skip |"
# Security skips for spike (last column).
wf_row_has "WORKFLOW Security row skips spike"             "Security review" "skip |"

# Cross-check the TSV agrees with the assertion above.
if [ -f "$MATRIX" ]; then
  for pair in "test-plan chore" "test-plan docs" "test-plan spike" \
              "test chore" "test docs" "test spike" "security spike"; do
    ph="${pair%% *}"; ty="${pair##* }"
    cell="$(awk -v p="$ph" -v t="$ty" '/^#/||NF==0{next} !seen{for(i=1;i<=NF;i++)c[$i]=i;seen=1;next} $1==p{print $(c[t]);exit}' "$MATRIX")"
    assert_eq "matrix $ph/$ty = skip" "skip" "$cell"
  done
fi

# --- 6. the `--yes` gate rule is stated ONCE --------------------------------
# `dev.md` and `orchestrator.md` are BOTH read at the start of every run, so two
# contradicting copies of the headless gate rule are a coin flip. They drifted:
# orchestrator.md was corrected to auto-approve a verification-NEUTRAL deviation
# (Docs/Retro only) while dev.md kept the older "block on ANY deviation" form —
# the reading that stalls a healthy run at the gate on a lead's own `Docs: light`
# proposal, after it has produced every artifact and before it writes any code.
# orchestrator.md owns the rule; dev.md must point at it, never restate it.
DEVCMD="$ROOT/.claude/commands/dev.md"
ORCH="$ROOT/.claude/orchestrator.md"
if [ -f "$DEVCMD" ] && [ -f "$ORCH" ]; then
  assert_file_contains "orchestrator.md owns the --yes gate rule" "$ORCH" "verification-neutral"
  if grep -qF 'no `(deviates from matrix)` row' "$DEVCMD"; then
    fail "dev.md restates a stricter --yes gate rule than orchestrator.md (blocks on ANY deviation)"
  else
    pass "dev.md does not restate a stricter --yes gate rule"
  fi
  assert_file_contains "dev.md points at the canonical --yes rule" "$DEVCMD" "orchestrator.md > Non-interactive"
fi

# --- 7. the spawn budget matches the execution matrix ------------------------
# The budget is the ratchet's mechanism check in prose form: if the fast path
# says Design runs inline at S but the matrix still shows a `lead` spawn there,
# one of them is wrong and a run will follow whichever it read first.
FAST="$ROOT/.claude/orchestrator/references/xs-s-fast-path.md"
SIZEX="$ROOT/.claude/orchestrator/references/size-execution.md"
if [ -f "$FAST" ] && [ -f "$SIZEX" ]; then
  assert_file_contains "fast path states the S spawn budget" "$FAST" "S spawn budget: 2"
  assert_file_contains "fast path routes S Design inline"     "$FAST" "S designs inline"
  if grep -qE '^\| Spec \+ plan \|.*inline — main writes the four artifacts' "$SIZEX"; then
    pass "size matrix agrees: S spec+plan is inline"
  else
    fail "size matrix still shows a spawn for S spec+plan while the fast path inlines it"
  fi
  # Inlining docs+ship at S is measured-and-rejected TWICE (8/fail x2 at n=1, then
  # a 32% cost regression at n=3). Pin both sides so a future pass cannot quietly
  # re-adopt it without re-running the benchmark that rejected it.
  if grep -qE '^\| Docs \+ ship \|[^|]*\|[^|]*merged `engineer` spawn' "$SIZEX"; then
    pass "size matrix keeps the S docs+ship spawn"
  else
    fail "size matrix inlines S docs+ship — measured and rejected twice"
  fi
  assert_file_contains "fast path records the docs+ship rejection" "$FAST" "measured and REJECTED, twice"
fi

finish "doc-consistency tests"
