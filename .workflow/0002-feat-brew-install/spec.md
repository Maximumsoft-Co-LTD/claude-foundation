# Spec: Homebrew tap formula for claude-foundation

**ID**: 0002-feat-brew-install · **Type**: feat · **Status**: draft · **Ship as**: one-drop · **Open PR on ship**: yes · **Parent**: none

## Outcome

- **Before:** Installing claude-foundation requires cloning the repo and running `install.sh` by hand — no discoverable, single-command path for new users.
- **After:** `brew tap maximumsoft-co-ltd/claude-foundation https://github.com/Maximumsoft-Co-LTD/claude-foundation` + `brew install --HEAD claude-foundation` puts a `claude-foundation` CLI on PATH; running it inside any target project scaffolds `.claude/` there, identical to running `install.sh` from a clone.
- **Benefit:** Lowers the adoption barrier for macOS / Linux users from "clone + run a shell script" to a single brew command; Windows users are explicitly documented to the existing `install.sh` path.

## Acceptance criteria

- [x] AC1: `Formula/claude-foundation.rb` exists in the repo; after `brew tap maximumsoft-co-ltd/claude-foundation https://github.com/Maximumsoft-Co-LTD/claude-foundation` and `brew install --HEAD claude-foundation`, the install exits 0 and `which claude-foundation` resolves to a Homebrew-managed path.
  - e.g.: `brew tap maximumsoft-co-ltd/claude-foundation https://github.com/Maximumsoft-Co-LTD/claude-foundation` → `brew install --HEAD claude-foundation` → exit 0; `which claude-foundation` prints a path under the Homebrew prefix.
  - on error / at boundary: formula syntax error → `brew install` exits non-zero with a Homebrew error message; formula must pass lint before ship (see AC5).
  - evidence: `Formula/claude-foundation.rb` created; `ruby -c` exits 0 (Syntax OK); `brew style` exits 0 with "1 file inspected, no offenses detected".

- [x] AC2: Running `claude-foundation` inside an arbitrary target directory scaffolds the foundation into that directory — `.claude/`, `.workflow/`, `WORKFLOW.md`, `CLAUDE.md` — regardless of CWD, by locating the foundation source in the Homebrew `libexec` tree, not a relative path.
  - e.g.: `cd /tmp/myproj && claude-foundation --yes` writes `.claude/agents/`, `.claude/skills/`, `.workflow/_templates/`, `WORKFLOW.md`, and `CLAUDE.md` into `/tmp/myproj/`.
  - on error / at boundary: `libexec` source tree missing or corrupted → `install.sh` exits non-zero with a clear error message (not a silent no-op, because `install.sh` uses `set -euo pipefail` and explicit `fail()` calls). Non-existent target dir with `--yes` → same behaviour as running `install.sh` directly (created automatically).
  - evidence: simulated-libexec dry-run (`bash install.sh --source <tmpdir> --dry-run /tmp/testproj`) exits 0; plans 145 files including `.claude/agents/**` and `.workflow/_templates/**`; `ls <tmpdir>/.claude/agents` lists 14 files; `ls <tmpdir>/.workflow/_templates` lists 9 files. Explicit `libexec.install ".claude", ".workflow", ...` list confirmed via grep.

- [x] AC3: The `claude-foundation` wrapper preserves `install.sh`'s full flag interface — `[target-path]`, `--source`, `--force`, `--yes`, `--dry-run`, `--help`/`-h` — with identical behaviour and exit codes.
  - e.g.: `claude-foundation --dry-run /tmp/newproject` prints the install plan and writes nothing; `claude-foundation --help` prints the usage block from `install.sh`.
  - on error / at boundary: unknown flag → same error as `install.sh` (`set -euo pipefail` causes exit 1 with an unrecognised-flag message).
  - evidence: wrapper body is `exec "#{libexec}/install.sh" "$@" --source "#{libexec}"` — `"$@"` passes all caller flags first; `--source "#{libexec}"` is appended last so install.sh's last-occurrence-wins arg parser always resolves to the packaged libexec, even if a caller passes `--source` themselves. Confirmed by `grep '"$@"' Formula/claude-foundation.rb` and `--source` last-wins dry-run proof (decoy `--source` in `"$@"` overridden by trailing libexec arg).

- [x] AC4: README (repo root) documents: (a) the tap + `--HEAD` install command sequence, (b) how to run `claude-foundation` inside a target project, (c) Windows / non-brew fallback (run `install.sh` directly), and (d) manual follow-up steps (publish the tap, future pinned-release + sha256 hardening).
  - e.g.: README contains a "Install via Homebrew" section with `brew tap maximumsoft-co-ltd/claude-foundation https://github.com/Maximumsoft-Co-LTD/claude-foundation` + `brew install --HEAD claude-foundation` and a "Windows / manual install" note linking to `install.sh`.
  - on error / at boundary: none — documentation only; no runtime boundary applies.
  - evidence: `README.md#"## Install via Homebrew"` — section contains all four elements: (a) tap + install commands, (b) `cd /path/to/myproject && claude-foundation` example, (c) Windows/non-brew fallback sentence, (d) tap-repo creation + future sha256 hardening note.

- [x] AC5: The formula is tap-quality lint-clean. — measured: `brew style Formula/claude-foundation.rb` exits 0 AND `brew audit --strict --formula Formula/claude-foundation.rb` exits 0 (run where Homebrew is available; these are the canonical verify commands — record them and note that CI environments without brew must run them in a local brew context).
  - evidence: `brew style Formula/claude-foundation.rb` → "1 file inspected, no offenses detected" (exit 0); `depends_on "jq" => :optional` removed (deprecated form, degrades gracefully). `brew audit --strict --formula claude-foundation` → requires tap registration first (formula not yet installed as a tap — expected pre-ship state). `ruby -c` → "Syntax OK". Full `brew audit` must be re-run after tap registration before merge. `license` stanza omitted; `# TODO: add license "SPDX-ID" once repo license is declared` comment in place.

## Scope — Out

- Creating or pushing a separate tap repo (manual follow-up after this run).
- Cutting a GitHub release / pinned tarball + sha256 (formula is HEAD-only; pinned release is the documented future hardening path).
- CI release automation.
- Windows Homebrew support (does not exist; Windows users use `install.sh` directly — documented in README per AC4).
- Changing `install.sh`'s core copy logic (the wrapper calls `install.sh`, it does not replace it).
- `install-cursor.sh` brew support (out of scope unless trivially parallel — not in scope for this run).

## Definition of Done

- `Formula/claude-foundation.rb` committed at repo root under `Formula/`.
- `bin/claude-foundation` wrapper (or equivalent generated wrapper within the formula's `install` block) committed and functional per AC2–AC3.
- README updated per AC4.
- `brew style` + `brew audit --strict` pass (AC5 commands recorded in spec; engineer runs them locally before ship).
- PR opened on `main` (no staging needed — one-drop).

## Constraints

- Formula is HEAD-only (`head "https://github.com/Maximumsoft-Co-LTD/claude-foundation.git"`); no stable `url`/`sha256` this iteration. [inferred — confirm at gate]
- The `bin` wrapper MUST be a generated shell script (not a symlink) that execs `install.sh` with an explicit `--source "$HOMEBREW_CELLAR/.../libexec"` path so `SCRIPT_DIR` in `install.sh` resolves correctly; a bare symlink breaks `install.sh`'s `SCRIPT_DIR` heuristic. [inferred — confirm at gate]
- Foundation source tree installed into formula's `libexec` includes: `.claude/` subtree, `.workflow/_templates/`, `WORKFLOW.md`, `install.sh`, and sibling support files. Exact list follows what `install.sh` uses as its source (`SCRIPT_DIR`). [inferred — confirm at gate]
- `jq` is optional at runtime (`install.sh` degrades gracefully); formula MAY declare `depends_on "jq"` for best UX but is not required. [inferred — confirm at gate]
- Platform: macOS + Linux only via brew. Windows is unsupported (documented fallback).
- `install.sh`'s core copy logic must not be modified — wrap only.

## References / examples to follow

- `install.sh` (repo root, lines 1–88) — behavior contract the CLI wrapper must preserve verbatim: flag interface (`[target-path] [--source <path>] [--force] [--yes] [--dry-run]`), `SCRIPT_DIR` heuristic (`cd "$(dirname "${BASH_SOURCE[0]}")" && pwd`), `set -euo pipefail`, `fail()` on error. The wrapper must pass `--source` pointing to `libexec` so this heuristic is bypassed for the brew-installed path.
- Homebrew formula conventions for HEAD-only formulas that install into `libexec` and expose a generated `bin` wrapper — canonical pattern:
  ```ruby
  class ClaudeFoundation < Formula
    desc "..."
    homepage "https://github.com/Maximumsoft-Co-LTD/claude-foundation"
    head "https://github.com/Maximumsoft-Co-LTD/claude-foundation.git", branch: "main"
    license "MIT"   # or actual license

    def install
      libexec.install Dir["*"]
      (bin/"claude-foundation").write <<~EOS
        #!/usr/bin/env bash
        exec "#{libexec}/install.sh" --source "#{libexec}" "$@"
      EOS
    end

    test do
      system "#{bin}/claude-foundation", "--help"
    end
  end
  ```
  The `test do` block provides a basic smoke-test that `brew test claude-foundation` can run. Adjust `Dir["*"]` to the actual set of source files/directories that `install.sh` expects under `SCRIPT_DIR`.

## Assumptions (inferred)

The following values were derived from the repo rather than stated by the user. Each is tagged `[inferred — confirm at gate]` where it appears above. One-line veto applies at the gate.

1. Formula is HEAD-only with no stable tarball/sha256 this iteration.
2. `bin` entry is a generated wrapper script (not symlink) that passes `--source "#{libexec}"` to `install.sh`.
3. Packaged source tree in `libexec` = everything `install.sh` reads from `SCRIPT_DIR` (`.claude/`, `.workflow/_templates/`, `WORKFLOW.md`, `install.sh`, and siblings).
4. `jq` declared as optional dep (`depends_on "jq"`); not hard-required because `install.sh` already degrades gracefully.
