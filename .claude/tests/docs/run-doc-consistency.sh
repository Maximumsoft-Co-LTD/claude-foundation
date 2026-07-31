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
assert_file_contains "fast path keeps S review inline" "$FAST" "Review inline on the fast profile (XS/S)"
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
  assert_file_contains "fast path keeps the S docs+ship exception" "$FAST" "S docs+ship stays one spawn"
fi

# --- 7b. M/L execution is evidence-routed, never size-routed ----------------
STATE_TEMPLATE="$ROOT/.workflow/_templates/state.json"
if [ -f "$ORCH" ] && [ -f "$SIZEX" ] && [ -f "$STATE_TEMPLATE" ]; then
  assert_file_contains "orchestrator defaults phase execution inline" "$ORCH" "Default **inline**"
  assert_file_contains "orchestrator requires a spawn proof" "$ORCH" "If no proof can be named, spawning is forbidden"
  assert_file_contains "orchestrator recognizes implementation model economy" "$ORCH" "execution volume"
  assert_file_contains "size matrix routes volume to Sonnet engineer" "$SIZEX" "one bounded Sonnet"
  assert_file_contains "size matrix says size never proves a spawn" "$SIZEX" "size never proves a spawn"
  assert_file_contains "state records per-phase execution reasons" "$STATE_TEMPLATE" '"exec_reason": {}'
fi

# --- 7b-i. model routing keeps Opus on judgment, not routine generation -----
MODEL_TIERS="$ROOT/.claude/orchestrator/references/model-tiers.md"
if [ -f "$MODEL_TIERS" ] && [ -f "$AGENTS/INDEX.md" ]; then
  assert_file_contains "engineer defaults to sonnet" "$MODEL_TIERS" "sonnet default, explicit opus escalation"
  assert_file_contains "L alone cannot upgrade engineer" "$MODEL_TIERS" "L alone is not an escalation"
  assert_file_contains "opus engineer prompt carries a reason" "$MODEL_TIERS" 'model_reason:<trigger>'
  assert_file_contains "agent index mirrors lead sonnet pin" "$AGENTS/INDEX.md" "sonnet default; opus for Security/high-stakes review"
  assert_file_contains "dev-plan requests opus explicitly" "$ROOT/.claude/commands/dev-plan.md" 'pass `model="opus"` explicitly'
  if grep -qF "opus frontmatter" "$AGENTS/INDEX.md"; then
    fail "agent index still claims lead has opus frontmatter"
  else
    pass "agent index does not claim a stale lead opus pin"
  fi
  if grep -qF "keep opus (omit the override)" "$ROOT/.claude/commands/dev-plan.md"; then
    fail "dev-plan still assumes omitted model means opus"
  else
    pass "dev-plan does not rely on a stale implicit opus pin"
  fi
fi

# --- 7c. worker capabilities cannot override the resolver -----------------
# A correct orchestrator is insufficient if a spawned worker can re-walk the repo
# or recursively fan out from a size heuristic. Every process-owning /dev role
# carries the same scoped-input contract; every Agent-holder requires explicit
# parent authorization before creating another process.
for role in pm lead engineer qa retro; do
  f="$AGENTS/$role.md"
  [ -f "$f" ] || continue
  assert_file_contains "$role declares an execution contract" "$f" "## Execution contract"
  assert_file_contains "$role says size alone is not spawn proof" "$f" "Size alone"
done
for role in pm lead engineer qa; do
  f="$AGENTS/$role.md"
  [ -f "$f" ] || continue
  assert_file_contains "$role requires parent fanout authorization" "$f" 'fanout_authorized: true'
done
FANOUT_REF="$ROOT/.claude/orchestrator/references/fanout-dispatch.md"
if [ -f "$FANOUT_REF" ]; then
  assert_file_contains "fanout dispatcher passes explicit authorization" "$FANOUT_REF" 'fanout_authorized: true'
  assert_file_contains "review fanout defaults off at every size" "$FANOUT_REF" 'Review defaults to `no` at every size'
  if grep -qF 'Review defaults to `yes` at M/L' "$FANOUT_REF"; then
    fail "fanout dispatcher still size-routes review fanout"
  else
    pass "fanout dispatcher has no M/L review-fanout default"
  fi
fi

# --- 7d. interaction and command-discovery hot paths stay collapsed --------
GATE_REF="$ROOT/.claude/orchestrator/references/gate.md"
CONTEXT_TEMPLATE="$ROOT/.workflow/_templates/context.md"
if [ -f "$GATE_REF" ]; then
  assert_file_contains "gate uses one interaction batch at every size" "$GATE_REF" "One-batch gate (every size)"
  if grep -qF "M/L keep the sequential rounds" "$GATE_REF"; then
    fail "gate still adds size-routed approval round-trips"
  else
    pass "gate has no M/L sequential-round fallback"
  fi
fi
if [ -f "$CONTEXT_TEMPLATE" ] && [ -f "$AGENTS/qa.md" ] && [ -f "$AGENTS/retro.md" ]; then
  assert_file_contains "context template stores validated test commands" "$CONTEXT_TEMPLATE" "Validated commands"
  assert_file_contains "context template defines command invalidation" "$CONTEXT_TEMPLATE" "Command invalidation"
  assert_file_contains "qa consumes validated test commands" "$AGENTS/qa.md" "Validated commands"
  assert_file_contains "qa defers lint/static to the Ship Gate" "$AGENTS/qa.md" "Ship Gate executes them once with Full-suite"
  assert_file_contains "retro folds green commands into Test infra" "$AGENTS/retro.md" "Validated commands"
fi
LINT_HOOK="$ROOT/.claude/hooks/lint.sh"
if [ -f "$LINT_HOOK" ]; then
  assert_file_contains "edit hook exposes immediate-lint compatibility flag" "$LINT_HOOK" "CLAUDE_EDIT_LINT=1"
  assert_file_contains "edit hook defaults immediate lint off" "$LINT_HOOK" 'EDIT_LINT="${CLAUDE_EDIT_LINT:-0}"'
fi

# --- 8. the required/optional phase contract -----------------------------------
# Required checks are type/trigger aware: all runs keep Contract Gate + Implement;
# code runs also keep Test + Ship Gate, and fired independent/security reviews.
WF="$ROOT/WORKFLOW.md"
GATE="$ROOT/.claude/orchestrator/references/gate.md"
SIZEX2="$ROOT/.claude/orchestrator/references/size-execution.md"
if [ -f "$WF" ] && [ -f "$GATE" ] && [ -f "$ORCH" ] && [ -f "$SIZEX2" ]; then
  assert_file_contains "WORKFLOW.md declares the required/optional contract" "$WF" "Required vs optional"
  # The old protected set named Security and Retro as unskippable. If any file
  # still refuses them, the contract and the gate disagree.
  for f in "$GATE" "$ORCH" "$SIZEX2"; do
    if grep -qF 'refuse protected (Interview+Spec / Plan / Gate / Security / Retro)' "$f"; then
      fail "$(basename "$f") still refuses Security/Retro skips — contradicts Required vs optional"
    else
      pass "$(basename "$f") does not refuse an optional-phase skip"
    fi
  done
  assert_file_contains "gate.md keeps the security-trigger scan on" "$GATE" "security-trigger scan always runs"
  assert_file_contains "WORKFLOW.md names the always-on floor" "$WF" "security-trigger scan"
  assert_file_contains "orchestrator.md names code-type Test and Ship Gate" "$ORCH" "Test + Ship Gate for feat/fix/refactor"
  assert_file_contains "WORKFLOW.md requires the three quality gates" "$WF" "Three authoritative quality gates"
  assert_file_contains "gate refuses code-type Test skips" "$GATE" "refuse Test plan, Test, and Ship Gate"
fi

# --- 8b. quality-gate ownership ------------------------------------------------
ENGINEER="$AGENTS/engineer.md"
LEAD="$AGENTS/lead.md"
PHASE1="$ROOT/.claude/orchestrator/references/phase-1.md"
PHASE2="$ROOT/.claude/orchestrator/references/phase-2.md"
if [ -f "$ENGINEER" ] && [ -f "$LEAD" ] && [ -f "$PHASE1" ] && [ -f "$PHASE2" ]; then
  assert_file_contains "Phase 1 uses one deterministic Contract Gate" "$PHASE1" "artifact-lint.sh --contract"
  assert_file_contains "Engineer returns task verify results" "$ENGINEER" 'completed `T###` ids and verify results'
  assert_file_contains "Engineer leaves AC evidence to Test" "$ENGINEER" "Test owns executable AC evidence"
  assert_file_contains "Review consumes tests.md" "$LEAD" "consume Test's AC evidence instead of rebuilding it"
  assert_file_contains "Phase 2 names Change Gate" "$PHASE2" "Change Gate — Test"
  assert_file_contains "Phase 2 names Ship Gate" "$PHASE2" "Ship Gate"
fi

# --- 9. the fix input-domain rule ----------------------------------------------
# ADOPTED 2026-07-30 on measured evidence: without it, 6/6 /dev runs and 6/6
# plain-prompt runs on tests/bench/11-recent-window fixed the reported input
# (a window of 0) and shipped the identical bug one input over (a window of 0.4
# still returned the whole list), while the model judge graded all twelve 8-10/pass.
# With it, every run satisfies every AC at no measurable cost.
#
# It lives in the template rather than a resident file because template teaching
# notes are stripped on fill — it costs nothing per turn and is read exactly when
# the ACs are being written. That also makes it easy to delete by accident, hence
# this assertion. If it fails, acceptance coverage silently reverts to 5/6.
#
# Extended to spec.md (S/M) 2026-07-30: run.md only covers XS, and the defect the
# rule catches is a property of `fix` at any size. Measurement is owed — the rule
# was derived AND measured on the same task, so this extension is unvalidated on a
# holdout. See rationale.md > "Extended without measurement".
RUNTPL="$ROOT/.workflow/_templates/run.md"
SPECTPL="$ROOT/.workflow/_templates/spec.md"
for t in "$RUNTPL" "$SPECTPL"; do
  [ -f "$t" ] || continue
  assert_file_contains "$(basename "$t") template carries the fix input-domain rule" "$t" "cover the input domain"
  assert_file_contains "$(basename "$t") rule names the neighbours to walk" "$t" "fractional"
done

# --- 10. never end a turn with a spawn outstanding ------------------------------
# The liveness rule. Backgrounding a phase worker and then ending the message to
# "wait for the completion notification" kills the run: headless `claude -p` has no
# later turn for that notification to arrive in. Measured at M on 13-money-drift,
# 2 of 3 runs died this way with zero code delivered — one of them after its lead
# had already written 36 KB of correct spec/plan/tasks. Both files must carry it:
# the resident rule so it is always in context, the reference so the reason is.
SEC="$ROOT/.claude/orchestrator/references/state-edge-cases.md"
if [ -f "$ORCH" ] && [ -f "$SEC" ]; then
  assert_file_contains "orchestrator.md forbids ending a turn with a spawn outstanding" "$ORCH" "NEVER end a turn with a spawn outstanding"
  assert_file_contains "orchestrator.md names the headless no-next-turn reason" "$ORCH" "has no next turn"
  assert_file_contains "state-edge-cases.md explains the dead-run mechanism" "$SEC" "dead run"
  assert_file_contains "state-edge-cases.md keeps the phase worker foreground" "$SEC" "phase worker is always foreground"
fi

# --- 10. shipped files never point at files that don't ship ------------------
# install.sh copies a fixed manifest into a user's repo. `.claude/tests/` and
# `docs/` are NOT in it, so a shipped file citing one is a dangling link in every
# installed repo — and it costs resident bytes on every turn of every user's run
# to say nothing they can open. Pointers go one way: evidence names the rule it
# justifies, never the reverse. Rule: `CLAUDE.md > What ships vs what doesn't`.
SHIPPED="
$ROOT/.claude/orchestrator.md
$ROOT/.claude/orchestrator/references
$ROOT/.claude/agents
$ROOT/.claude/commands
$ROOT/.claude/skills
$ROOT/.claude/rules
$ROOT/.workflow/_templates
$ROOT/WORKFLOW.md
"
leaks=""
for p in $SHIPPED; do
  [ -e "$p" ] || continue
  hit="$(grep -rlE '\.claude/tests|tests/bench|docs/research' "$p" 2>/dev/null || true)"
  [ -n "$hit" ] && leaks="$leaks$hit
"
done
leaks="$(printf '%s' "$leaks" | grep -v '^$' || true)"
if [ -z "$leaks" ]; then
  pass "no shipped file points at a non-shipped path"
else
  fail "shipped file(s) point at non-shipped paths (dangling in every installed repo): $(printf '%s' "$leaks" | tr '\n' ' ')"
fi

# --- 11. every cited `references/<file>.md` actually exists -------------------
# Check 10 catches a pointer into a path that never ships; this catches one into
# a file that does not exist at all — a reference renamed, or moved out to the
# bench when its evidence was split from its rule. Following it costs a wasted
# read at runtime and returns nothing. Matched on basename against every
# `references/` dir under `.claude/`, deliberately loose: a skill-relative
# citation (`plan-writing > references/size-tiering.md`) then needs no path
# resolution, and the check still fails on a name that exists nowhere.
have_refs="$(find "$ROOT/.claude" -type d -name references -exec ls -1 '{}' \; 2>/dev/null | sort -u || true)"
dangling=""
for p in $SHIPPED; do
  [ -e "$p" ] || continue
  for r in $(grep -rhoE 'references/[A-Za-z0-9._-]+\.md' "$p" 2>/dev/null | sort -u || true); do
    b="${r#references/}"
    printf '%s\n' "$have_refs" | grep -qxF "$b" || dangling="$dangling$b "
  done
done
if [ -z "$dangling" ]; then
  pass "every references/*.md cited by a shipped file exists"
else
  fail "shipped file(s) cite non-existent references: $dangling"
fi

# --- 12. the repo context ledger is written AND read --------------------------
# `.workflow/CONTEXT.md` accrues at retro and is what lets a later run start
# from what this repo already established instead of re-walking for it. A write
# side with no reader is pure cost: every run pays to record facts nobody spends.
# Rule: `orchestrator.md > Size-aware execution` (read-before-walk, every size).
LEDGER=".workflow/CONTEXT.md"
[ -f "$AGENTS/retro.md" ] && \
  assert_file_contains "retro writes the repo context ledger" "$AGENTS/retro.md" "$LEDGER"
for f in "$ROOT/.claude/orchestrator.md" \
         "$ROOT/.claude/orchestrator/references/xs-s-fast-path.md" \
         "$ROOT/.claude/orchestrator/references/ml-design-chain.md" \
         "$ROOT/.claude/skills/plan-writing/references/current-state.md"; do
  [ -f "$f" ] || continue
  assert_file_contains "$(basename "$f") reads the repo context ledger" "$f" "$LEDGER"
done

# --- 13. the ledger's behaviour half: written, read, kept true ----------------
# `## Capabilities` records what the system GUARANTEES (5b records where the code
# is). Three ends have to hold together or it becomes a write nobody spends: retro
# writes it type-aware (a refactor changes no guarantee by definition), qa reads it
# for the regression contract, and the prune keeps the anchors honest — a ledger
# every run trusts before walking must be checkable, and prune is the only step
# that checks.
PRUNE="$ROOT/.claude/orchestrator/references/ledger-prune.sh"
if [ -f "$AGENTS/retro.md" ]; then
  assert_file_contains "retro writes the Capabilities group" "$AGENTS/retro.md" "## Capabilities"
  assert_file_contains "retro supersedes a guarantee in full" "$AGENTS/retro.md" "Supersede in full"
  assert_file_contains "refactor/chore may not rewrite a guarantee" "$AGENTS/retro.md" "may not touch this group"
  assert_file_contains "retro runs the prune" "$AGENTS/retro.md" "ledger-prune.sh"
fi
[ -f "$AGENTS/qa.md" ] && \
  assert_file_contains "qa reads Capabilities for the regression contract" "$AGENTS/qa.md" "## Capabilities"
assert_file_exists "ledger-prune.sh ships with the playbook" "$PRUNE"

# --- 14. resident and inline context stay bounded ---------------------------
# These files are paid on every /dev run, or every inline phase. Keep evidence,
# incident history, and worker-only procedures out of them. The ceilings leave
# modest editing room while catching a return to the pre-diet sizes.
assert_max_bytes() { # <label> <file> <max>
  label="$1"; file="$2"; max="$3"
  [ -f "$file" ] || return 0
  bytes="$(wc -c < "$file" | tr -d ' ')"
  if [ "$bytes" -le "$max" ]; then
    pass "$label ($bytes <= $max bytes)"
  else
    fail "$label is $bytes bytes (budget $max)"
  fi
}

PHASE1="$ROOT/.claude/orchestrator/references/phase-1.md"
PHASE2="$ROOT/.claude/orchestrator/references/phase-2.md"
assert_max_bytes "dev launcher context budget" "$DEVCMD" 2500
assert_max_bytes "resident orchestrator context budget" "$ORCH" 19000
assert_max_bytes "XS fast-path context budget" "$FAST" 4500
assert_max_bytes "always-on fundamentals context budget" "$FUND" 8000
assert_max_bytes "foundation CLAUDE.md resident budget" "$ROOT/CLAUDE.md" 4500

assert_file_contains "inline Design uses a compact local contract" "$PHASE1" "Inline author contract"
assert_file_contains "inline Design does not load role prompts" "$PHASE1" 'not `pm`/`lead`/`qa` agent prompts'
assert_file_contains "inline Implement does not load engineer prompt" "$PHASE2" 'does not load `engineer.md`'
assert_file_contains "inline Retro does not load retro prompt" "$PHASE2" 'without loading `retro.md`'
assert_file_contains "Phase 2 guard mechanics load by section" "$PHASE2" "do not load the entire guard file up front"
assert_file_contains "resident orchestrator loads Phase 2 guards by section" "$ORCH" "never preload the whole guard file"
if grep -qF "Read BOTH once on entering op 5" "$ORCH"; then
  fail "orchestrator still preloads all Phase 2 guard mechanics"
else
  pass "orchestrator does not preload all Phase 2 guards"
fi

STATE_MARK="$ROOT/.claude/hooks/dev-state-mark.sh"
assert_file_contains "state reminder uses the timestamp sentinel" "$STATE_MARK" '"__now__"'
if grep -qF "fresh ISO timestamp" "$STATE_MARK"; then
  fail "state reminder contradicts the __now__ timestamp contract"
else
  pass "state reminder does not request a typed ISO timestamp"
fi
reminder_bytes="$(awk '
  /^reminder=\$\(cat <<EOF$/ { in_reminder=1; next }
  in_reminder && /^EOF$/ { print n; exit }
  in_reminder { n += length($0) + 1 }
' "$STATE_MARK")"
if [ "${reminder_bytes:-9999}" -le 500 ]; then
  pass "state reminder payload budget ($reminder_bytes <= 500 bytes)"
else
  fail "state reminder payload is ${reminder_bytes:-unknown} bytes (budget 500)"
fi

assert_file_contains "repo ledger has a byte budget" "$AGENTS/retro.md" "12 KB"
if grep -qF "(Measured:" "$AGENTS/lead.md"; then
  fail "lead runtime prompt still carries benchmark incident narrative"
else
  pass "lead runtime prompt carries policy without incident narrative"
fi

for t in "$ROOT/.workflow/_templates/spec.md" \
         "$ROOT/.workflow/_templates/plan.md" \
         "$ROOT/.workflow/_templates/tasks.md" \
         "$ROOT/.workflow/_templates/test-plan.md"; do
  [ -f "$t" ] || continue
  if grep -qE '\.claude/agents/(pm|lead|qa)\.md' "$t"; then
    fail "$(basename "$t") sends inline author into a cold-worker prompt"
  else
    pass "$(basename "$t") carries no cold-worker prompt pointer"
  fi
done

finish "doc-consistency tests"
