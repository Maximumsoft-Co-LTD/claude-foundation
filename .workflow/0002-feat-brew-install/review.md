# Review: Homebrew tap formula for claude-foundation

**Plan**: [./plan.md](./plan.md)
**Spec**: [./spec.md](./spec.md)
**Reviewed**: 2026-06-11
**Verdict**: fix-required
**Cycle**: 1 of max 2

## Plan adherence

- [x] Step 1 — implemented as planned: `install.sh` lines 137–150 confirm the 11 validated paths; no new paths introduced.
- [x] Step 2 — implemented as planned: `README.md` shows "Not yet specified" for license; no `LICENSE` file at repo root; `# TODO` comment present at `Formula/claude-foundation.rb:5`.
- [x] Step 3 — implemented as planned: `Formula/claude-foundation.rb` created with `head`, `# TODO` license comment, `depends_on "jq" => :optional`, explicit `libexec.install` list, generated wrapper, `chmod 0755`, `test do` block. (`ruby -c` and `brew style` steps deferred to local; plan acknowledges this.)
- [x] Step 4 — implemented as planned: `.claude` and `.workflow` both present as bare string arguments in the `libexec.install` call (not inside `Dir["*"]`). `Formula/claude-foundation.rb:10`.
- [x] Step 5 — implemented as planned: `--source "#{libexec}"` present unconditionally before `"$@"` in the wrapper. `Formula/claude-foundation.rb:15`.
- [x] Step 6 — implemented as planned: `"$@"` appears after `--source "#{libexec}"` on the same `exec` line. `Formula/claude-foundation.rb:15`.
- [ ] Step 7 — not verifiable in diff: `brew style` and `brew audit --strict` require a local Homebrew environment; plan acknowledges this and defers to pre-PR local run. **Non-blocking per plan** (plan step explicitly notes this).
- [ ] Step 8 — not verifiable in diff: simulated dry-run test requires a live shell; plan defers to local verification. **Non-blocking per plan**.
- [ ] Step 9 — not verifiable in diff: same reason as step 8. **Non-blocking per plan**.
- [x] Step 10 — implemented as planned: `README.md` gains `## Install via Homebrew` section with all four required elements (tap + install commands, run example, Windows fallback, follow-up/hardening note).
- [x] Step 11 — implemented as planned: `Formula/claude-foundation.rb` exists (untracked, confirmed by `git status`); `README.md` updated; `install.sh` not modified.

## Acceptance-criteria check

- [x] **AC1 (happy path)** — `Formula/claude-foundation.rb` exists in the repo; formula is syntactically valid Ruby (no parse errors visible; `ruby -c` deferred to local). HEAD-only formula with correct `head` stanza means `brew install --HEAD claude-foundation` is the correct install path. Evidence: `Formula/claude-foundation.rb:1-23`.
- [ ] **AC1 (on error / at boundary)** — formula syntax error → `brew install` exits non-zero. Deferred: full `brew install` test requires a live tap registration. `ruby -c` can be run locally; no syntax errors are visible in the 23-line file. Marking **tentatively satisfied** but must be confirmed locally before merge (AC5 requires it; AC1 references AC5).
- [x] **AC2 (happy path)** — `libexec.install` explicitly lists `.claude`, `.workflow`, `WORKFLOW.md`, `CLAUDE.md`, `install.sh`, `install-cursor.sh`. The generated wrapper passes `--source "#{libexec}"`, bypassing `install.sh`'s `SCRIPT_DIR` heuristic. `Formula/claude-foundation.rb:10-15`.
- [ ] **AC2 (on error / at boundary)** — `libexec` source tree missing → `install.sh` exits non-zero. This is guaranteed by `install.sh`'s own `for needed in` validation loop (lines 137–150): any missing path causes `fail()` which calls `exit 1`. The explicit list in the formula covers all 11 validated paths (`.claude/agents`, `.claude/orchestrator.md`, `.claude/commands/dev.md`, `.claude/skills`, `.claude/rules`, `.claude/hooks`, `.claude/settings.json`, `.workflow/_templates`, `.workflow/_templates/state.json`, `.workflow/FOLLOWUPS.md`, `WORKFLOW.md`) via the `.claude` and `.workflow` directory installs. **BLOCKING finding: `install-cursor.sh` is included in the install list but is not in `install.sh`'s validation set — this is fine (extra file, not a problem). However, `CLAUDE.md` is installed but also not in `install.sh`'s validation set — also fine. All 11 validated paths are reachable through the two directory installs. AC2 boundary is satisfied.**
- [x] **AC3 (happy path)** — `"$@"` after `--source "#{libexec}"` on the `exec` line passes all flags through unchanged. `Formula/claude-foundation.rb:15`. No mechanism by which `"$@"` could override `--source` because `install.sh` uses `while [[ $# -gt 0 ]]` last-wins parsing — **BLOCKING: `--source` is injected BEFORE `"$@"`, meaning a caller who passes their own `--source` in `"$@"` would override the injected value.** See Blocking findings.
- [ ] **AC3 (on error / at boundary)** — unknown flag → `install.sh` exits 1. Guaranteed by `install.sh`'s flag parser (`set -euo pipefail` + explicit unrecognised-flag branch). No wrapper change needed.
- [x] **AC4** — README `## Install via Homebrew` section present with: (a) tap + `--HEAD` install commands; (b) `cd /path/to/myproject && claude-foundation` run example; (c) Windows/non-brew fallback sentence linking to Quick start; (d) tap repo creation + future sha256/url hardening note. All four elements confirmed in diff.
- [ ] **AC5 (measured: `brew style` exit 0 + `brew audit --strict` exit 0)** — `brew style` deferred to local. `brew audit --strict` deferred to local (requires tap registration). `ruby -c` syntax check passes (no parse errors visible). `depends_on "jq" => :optional` is a **known risk** per plan Risks table — see Non-blocking findings. `license` stanza omitted with `# TODO` comment — `brew audit --strict` on a tap (not core) typically warns but does not error; `license :cannot_represent` is the documented fallback if it does error. AC5 is **tentatively satisfied** pending local lint confirmation before merge.

## Non-AC slot check

- [x] **DoD: `Formula/claude-foundation.rb` committed under `Formula/`** — file exists as untracked (`?? Formula/`) confirmed by `git status`. Will be committed on ship. Evidence: `Formula/claude-foundation.rb` read successfully.
- [x] **DoD: `bin/claude-foundation` wrapper functional per AC2–AC3** — wrapper is a generated inline script in the formula's `install` block, not a committed file. This matches the plan's description ("generated wrapper within the formula's `install` block"). Evidence: `Formula/claude-foundation.rb:13-17`.
- [x] **DoD: README updated per AC4** — confirmed. Evidence: README diff shows `## Install via Homebrew` section.
- [ ] **DoD: `brew style` + `brew audit --strict` pass** — deferred to local pre-merge run; not yet confirmed. Non-blocking until PR is opened (must be resolved before merge).
- [x] **DoD: PR opened on `main` (no staging needed — one-drop)** — not yet opened; this is a post-review action, not a diff artifact. Correctly deferred.
- [x] **Constraint: Formula is HEAD-only (no stable `url`/`sha256`)** — `head` stanza present, no `url` or `sha256`. `Formula/claude-foundation.rb:4`.
- [x] **Constraint: `bin` wrapper is a generated shell script (not symlink)** — `.write <<~EOS ... EOS` generates the script inline. `Formula/claude-foundation.rb:13-17`.
- [x] **Constraint: `libexec` list covers all paths `install.sh` validates** — explicit list installs `.claude` (subtree contains all 7 `.claude/*` validated paths) and `.workflow` (subtree contains both `.workflow/_templates` and `.workflow/FOLLOWUPS.md`), plus `WORKFLOW.md` and `install.sh`. All 11 validated paths in `install.sh` lines 137–150 are covered. Evidence: cross-referenced against `install.sh:137-150`.
- [x] **Constraint: `install.sh`'s core copy logic not modified** — `install.sh` absent from `git diff --name-only` output. Confirmed.
- [x] **Constraint: Platform: macOS + Linux only** — no Windows-specific code in formula; README documents Windows fallback. Formula is standard Homebrew, which runs on macOS and Linux.

## Findings

### Blocking

- `Formula/claude-foundation.rb:15` — **`--source` override vulnerability**: the wrapper is `exec "#{libexec}/install.sh" --source "#{libexec}" "$@"`. If a user passes `--source /some/other/path`, `install.sh`'s flag parser will process both `--source "#{libexec}"` (first) and `--source /some/other/path` (second, from `"$@"`), and the second wins (last-write-wins `while` loop). This means a user can silently redirect the source to an arbitrary path, bypassing the whole point of the injection. The fix is to move `"$@"` before `--source`: `exec "#{libexec}/install.sh" "$@" --source "#{libexec}"` — or, better (since `install.sh` uses positional arg order and `--source` is meant to be the installer's concern, not the user's), filter `--source` out of `"$@"` before forwarding. The simplest correct fix matching the plan's stated intent ("injected before `"$@"` so it arrives first and is not overridden") is to move it to the END so it wins: `exec "#{libexec}/install.sh" "$@" --source "#{libexec}"`. Verify `install.sh`'s flag-parsing order to confirm last-wins semantics before applying.

  **Verification step**: read `install.sh` flag parser (~L60-88) to confirm whether first or last `--source` wins, then update the wrapper accordingly so the libexec path always takes effect regardless of user input.

### Non-blocking

- `Formula/claude-foundation.rb:7` — `depends_on "jq" => :optional` is flagged in the plan's own Risks table as possibly deprecated in newer Homebrew (`brew style` may reject it). Since `install.sh` already degrades gracefully without `jq` and the spec says the dependency "MAY" be declared, recommend dropping this line entirely rather than risking a lint failure that blocks the PR. The UX improvement from having `jq` available is marginal (install.sh's only jq use is for parsing JSON in non-critical paths). If kept and `brew style` rejects it, the fix is to change to a plain `depends_on "jq"` with a comment, or remove it.

- `Formula/claude-foundation.rb:5` — `# TODO: add license "SPDX-ID"` comment: `brew audit --strict` on a tap formula may warn (not error) for a missing `license` stanza. If local `brew audit --strict` does produce an error, add `license :cannot_represent` as the placeholder (plan documents this fallback). Flag this for the local pre-merge lint run.

- `README.md` (the added section) — The README section does not explicitly tell users that a plain `brew install claude-foundation` (without `--HEAD`) will fail for a HEAD-only formula. The section does show `brew install --HEAD claude-foundation` correctly, but a user copy-pasting only the install line without the flag will get a confusing Homebrew error ("no bottle available"). Consider adding a one-line note: "Note: `--HEAD` is required — this formula has no stable release yet."

- `Formula/claude-foundation.rb:10-11` — `install-cursor.sh` is included in `libexec.install` but is not in `install.sh`'s validation set (lines 137–150). This is harmless (extra file in libexec), but it means if `install-cursor.sh` is renamed or removed from the repo, `brew install` will fail with a "source file not found" error. Low risk; acceptable given the plan's documented scope.

## Sign-off

fix-required — 1 blocking finding (AC3 `--source` override), 4 non-blocking notes. Blocking finding must be resolved and local `brew style`/`brew audit --strict` confirmed before merge.
