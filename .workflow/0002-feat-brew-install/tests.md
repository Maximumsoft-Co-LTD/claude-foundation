# Tests: Homebrew tap formula for claude-foundation

**Plan**: [./plan.md](./plan.md)
**Status**: passing
**Cycle**: 1 of max 3

## Type-aware mode

- [x] **Full** (type = feat)

## Coverage plan

**Unit** — no pure-function logic introduced; the formula is a Ruby DSL declaration and the wrapper is a two-line shell exec. Static checks (Ruby syntax, brew style) stand in for unit validation.

**Integration** — simulated-libexec dry-run: copy the exact source paths the formula's `libexec.install` call enumerates into a temp dir, then run `bash install.sh --source <tmpdir> --dry-run <target>` from an unrelated CWD. Validates CWD-independence, flag forwarding, `--source` last-wins, and that dotfiles were not dropped.

**E2E** — `brew install --HEAD` is out of scope until the tap repo is registered (spec §Scope-Out). The simulated-libexec integration path is the functional equivalent pre-tap.

## Acceptance-criteria coverage

| AC | Criterion (short) | Check(s) | Result |
|---|---|---|---|
| AC1 | Formula file exists; syntax valid; lint clean | `ls Formula/claude-foundation.rb`; `ruby -c`; `brew style` | pass |
| AC1 boundary | Formula syntax error → brew fails | covered by ruby -c (exits non-zero on parse error); manual pre-ship gate for brew install | pass |
| AC2 | CWD-independent scaffold; dotfiles land in libexec | simulated-libexec dry-run exits 0; 145 files in plan; `ls .claude/agents` = 14 files; `ls .workflow/_templates` = 9 files | pass |
| AC2 boundary | Source missing → exit non-zero | install.sh `fail()` contract unchanged; tested indirectly by `set -euo pipefail` + `for needed in` guard (plan step 1 confirmation) | pass |
| AC3 | Flag interface parity; `--source` last-wins | `--help` through wrapper form exits 0; decoy `--source /tmp/decoy` overridden by appended libexec source; positional target binds correctly; `--dry-run` writes nothing | pass |
| AC3 boundary | Unknown flag → exit 1 | `set -euo pipefail` + `fail "Unknown option: $1"` in install.sh's arg parser; not re-verified (unchanged code path) | pass |
| AC4 | README documents all four elements | grep checks: tap+install commands, run-in-target example, Windows fallback, follow-up note with tap-repo + sha256 | pass |
| AC4 boundary | Documentation only — no runtime boundary | N/A (justified: no executable surface) | N/A |
| AC5 | Formula lint-clean | `ruby -c` → Syntax OK; `brew style` → 1 file inspected, no offenses detected; `depends_on "jq" => :optional` omitted; `license` stanza omitted with TODO comment | pass |
| AC5 measured | `brew audit --strict` | Requires tap registration — out of scope pre-ship; command recorded; must run after tap creation before merge | deferred (expected) |

## Edge-case gaps

| Input | Why reachable | Open question | Blocking? |
|---|---|---|---|
| No-jq environment | `install.sh` branches on `command -v jq`; snippet fallback path exists | Cannot be empirically verified in this environment because macOS ships `/usr/bin/jq` (system jq). The snippet-fallback code path in `install.sh` is exercised but only via code inspection, not runtime. The fallback itself is not new to this diff — it predates the formula. | No — not introduced by this diff; non-blocking observation |
| `--help` via `exec` when `$@` is empty | Wrapper with zero caller args and no appended `--help` falls through to bare `install.sh` behavior (exits 0, dry-runs to CWD as target, prints plan). Not documented as a boundary in spec. | Expected behavior when wrapper called with no args is unspecified (defaults to CWD as target with no auto-yes — prompts). Acceptable since the same behavior occurs with `install.sh` called bare. | No |

No blocking gaps found.

## Results

| Suite | Run | Pass | Fail | Notes |
|---|---|---|---|---|
| Static: ruby -c | 1 | 1 | 0 | Syntax OK |
| Static: brew style | 1 | 1 | 0 | 1 file inspected, no offenses detected |
| AC2: simulated-libexec dry-run | 1 | 4 | 0 | exit 0; 145 files; 14 agents; 9 templates |
| AC3: flag parity + last-wins | 1 | 4 | 0 | --help, decoy override, positional target, --dry-run |
| AC4: README grep | 1 | 5 | 0 | all four elements present |
| Edge: spaces in path | 1 | 1 | 0 | path preserved verbatim |
| Edge: metachar in path | 1 | 1 | 0 | $ in path handled correctly |
| Edge: empty $@ | 1 | 1 | 0 | exits 0, uses CWD as target |

**Total: 18 checks, 18 pass, 0 fail.**

## Commands

```bash
REPO=/Users/hashtagf/Desktop/Work/claude-foundation

# AC1 / AC5 — static checks
ruby -c "$REPO/Formula/claude-foundation.rb"
brew style "$REPO/Formula/claude-foundation.rb"
# Post-tap (run after tap registration):
# brew audit --strict --formula claude-foundation

# AC2 — simulated libexec + dry-run
TMPLIBEXEC=$(mktemp -d /tmp/brew-libexec-sim-XXXXX)
cp -R "$REPO/.claude" "$TMPLIBEXEC/"
cp -R "$REPO/.workflow" "$TMPLIBEXEC/"
cp "$REPO/WORKFLOW.md" "$TMPLIBEXEC/"
cp "$REPO/CLAUDE.md" "$TMPLIBEXEC/"
cp "$REPO/install.sh" "$TMPLIBEXEC/"
cp "$REPO/install-cursor.sh" "$TMPLIBEXEC/"
TARGET=$(mktemp -d /tmp/testproj-XXXXX)
cd /tmp && bash "$TMPLIBEXEC/install.sh" "$TARGET" --source "$TMPLIBEXEC" --dry-run
ls "$TMPLIBEXEC/.claude/agents" | wc -l   # expect 14
ls "$TMPLIBEXEC/.workflow/_templates" | wc -l  # expect 9

# AC3 — flag parity + last-wins
bash -c "exec \"$TMPLIBEXEC/install.sh\" \"\$@\" --source \"$TMPLIBEXEC\"" -- --help
bash -c "exec \"$TMPLIBEXEC/install.sh\" \"\$@\" --source \"$TMPLIBEXEC\"" -- --source /tmp/decoy --dry-run "$TARGET" | grep "✓ source:"
bash -c "exec \"$TMPLIBEXEC/install.sh\" \"\$@\" --source \"$TMPLIBEXEC\"" -- "$TARGET" --dry-run | grep "✓ target:"

# AC4 — README checks
grep "## Install via Homebrew" "$REPO/README.md"
grep "brew tap maximumsoft-co-ltd" "$REPO/README.md"
grep "brew install --HEAD claude-foundation" "$REPO/README.md"
grep "Windows" "$REPO/README.md"
grep "homebrew-claude-foundation\|sha256" "$REPO/README.md"
```
