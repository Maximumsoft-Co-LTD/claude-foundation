# Releasing

How to cut a new version of claude-foundation and update the Homebrew formula.

For the current backend simplification, start with the concise
[release status](docs/reports/user-scenario-release-status.md) and
[scenario test plan](docs/reports/user-scenario-test-plan.md). The status page
separates implementation completion from paid and production evidence; the test
plan defines the executable portfolio without repeating implementation history.

The formula (`Formula/claude-foundation.rb`) ships **two** install paths:

- **Stable** — `url` + `sha256` pinned to a tagged release tarball. `brew install claude-foundation` and `brew upgrade claude-foundation` use this. This is what the steps below bump.
- **HEAD** — `head "…git", branch: "main"`. `brew install --HEAD claude-foundation` tracks `main` and never needs a release.

We follow [Semantic Versioning](https://semver.org/) and [Keep a Changelog](https://keepachangelog.com/). Tags are `vMAJOR.MINOR.PATCH` (e.g. `v1.3.0`).

## One-action release (recommended)

`.github/workflows/release.yml` does the whole mechanical release on a current-Xcode macOS runner. You do only the editorial part:

1. **Write the changelog.** Add the release's entries under `## [Unreleased]` in `CHANGELOG.md` and push to `main`. (This is the only hand-written part; everything below is automated.)
2. **Trigger the release.** Actions tab → **Release** → *Run workflow* → enter the new version (e.g. `2.5.11`). Or: `gh workflow run release.yml -f version=2.5.11`.

The workflow then: renames `## [Unreleased]` → `## [X.Y.Z]` (dated) + adds a fresh `## [Unreleased]` + fixes the link refs · bumps `VERSION` + the `WORKFLOW.md` mirror · commits `chore(release): vX.Y.Z` + tags + pushes · computes the tarball `sha256` and bumps the formula `url`/`sha256` · publishes the GitHub release from the new changelog section · builds + uploads the bottle and arms the formula's `bottle do` block · commits `chore(brew): formula for vX.Y.Z`. **Result: 2 bot commits + a tag + a published, bottled release.**

It refuses to run if the version is malformed, the tag already exists, or `## [Unreleased]` is empty (nothing to release).

> **Rehearse first.** Run it with **`dry_run: true`** (`gh workflow run release.yml -f version=2.5.11 -f dry_run=true`) to do the edits + build the bottle and print the diffs **without** pushing, tagging, or publishing anything. Recommended before the first real use, and any time the release machinery changed.

> **Coverage.** The bottle is built on one pinned arm64 macOS runner (`macos-15` → `arm64_sequoia`, which also pours on `arm64_tahoe`/macOS 26 via forward-compat). Intel macOS, Linux, and macOS older than Sequoia fall back to build-from-source. To widen coverage, build on a CI matrix and add one `sha256 … <tag>:` line per platform. `bottle.yml` remains the manual tool for retro-fixing/rebuilding the bottle for an already-tagged release.

Before the workflow rehearsal, run `npm run release:upgrade-matrix`. The
versioned policy in `scripts/release/supported-upgrades.json` selects every tag
from v3.2.19 through the current `VERSION` and tests all four host adapters.
The report is source-bound and may be retained with `--output <path>`; a dirty
source report is useful rehearsal evidence but cannot be release sign-off.

Run `npm run release:local-rehearsal` to build a tracked/untracked-nonignored
workspace archive, extract it, install a disposable consumer, verify CLI
version/help, and lint the formula. The retained archive and JSON report live
under ignored `.foundation/test-results/release/local/` by default. This closes
the local source-artifact checks but does not replace the macOS bottle dry run.

## Cutting a release (manual fallback)

Use this if the workflow is unavailable or you're releasing by hand. Replace `X.Y.Z` with the new version throughout.

1. **Bump the version + changelog.**
   - Write the bare version (no `v` prefix) into `VERSION`, e.g. `echo "X.Y.Z" > VERSION`. This is the source of truth for `claude-foundation version`; keep it in lockstep with the tag below.
   - Update every surface that states the release. `run-doc-consistency.sh` derives its expectations from `VERSION`, so a surface left behind fails the suite rather than drifting quietly:
     - `**Version X.Y.Z**` in `WORKFLOW.md`, `README.md`, and `README.th.md`
     - `<b>vX.Y.Z</b>` in `website/index.html`
     - `**vX.Y.Z**` in `website/docs/src/content/docs/index.md` and its `th/` mirror
     - `| Pin | vX.Y.Z |` in `website/docs/src/content/docs/cli.md` and its `th/` mirror

     The runtime and protocol-API numbers alongside them come from `protocol.json` and only move when a wire contract does.
   - In `CHANGELOG.md`, rename the `## [Unreleased]` heading to `## [X.Y.Z] - YYYY-MM-DD`, add a fresh empty `## [Unreleased]` above it, and update the link-reference block at the bottom:
     ```
     [Unreleased]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/vX.Y.Z...HEAD
     [X.Y.Z]: https://github.com/Maximumsoft-Co-LTD/claude-foundation/compare/v<prev>...vX.Y.Z
     ```

2. **Tag the source snapshot and push it.** Tag the commit you want to release (usually the tip of `main`):
   ```bash
   git tag -a vX.Y.Z -m "Release vX.Y.Z — <one-line summary>"
   git push origin vX.Y.Z
   ```
   Pushing the tag makes GitHub generate the source tarball at
   `https://github.com/Maximumsoft-Co-LTD/claude-foundation/archive/refs/tags/vX.Y.Z.tar.gz`.

3. **Compute the tarball `sha256`:**
   ```bash
   curl -fsSL https://github.com/Maximumsoft-Co-LTD/claude-foundation/archive/refs/tags/vX.Y.Z.tar.gz \
     | shasum -a 256
   ```

4. **Update the formula.** In `Formula/claude-foundation.rb`, set the `url` to the new tag tarball and replace `sha256` with the value from step 3. Keep the `head` block. Component order must stay `desc → homepage → url → sha256 → license → head` (Homebrew `brew style` enforces it).

5. **Validate the formula:**
   ```bash
   ruby -c Formula/claude-foundation.rb          # syntax
   brew style Formula/claude-foundation.rb       # lint (must be 0 offenses)
   brew audit --strict --formula Formula/claude-foundation.rb   # run from within the tap; warnings OK for a private tap
   ```

6. **Commit the changelog + formula** (one PR), e.g. `chore(release): vX.Y.Z`, and merge to `main`.

7. **Publish the GitHub release** (human-facing notes from the changelog section):
   ```bash
   gh release create vX.Y.Z --title "vX.Y.Z" --notes-file <(sed -n '/## \[X.Y.Z\]/,/## \[/p' CHANGELOG.md)
   ```

8. **Ship the bottle** (skips Homebrew's Xcode/CLT check — see below). Publishing the release in step 7 fires `.github/workflows/bottle.yml` on a `macos-latest` runner. It checks out the formula from `main` for its *shape* but **rewrites `url`/`sha256` to the tag being bottled** before building (so release order can't produce a wrong-payload bottle — the v2.8.1 lesson), builds a per-platform bottle, uploads it to the `vX.Y.Z` release, and prints a `bottle do` block in the job summary. Copy/merge that block into `Formula/claude-foundation.rb` **right after the `head` line**, then commit + merge (a formula-only commit — no re-tag needed; `root_url` points at the already-published release):
   ```ruby
   bottle do
     root_url "https://github.com/Maximumsoft-Co-LTD/claude-foundation/releases/download/vX.Y.Z"
     sha256 cellar: :any_skip_relocation, arm64_tahoe: "<sha256 from the bottle job summary>"
   end
   ```
   The job runs per platform you build on — add a `sha256 … <tag>:` line per platform; tags with no line fall back to build-from-source. Re-run `brew style` after pasting (component order: `… → license → head → bottle → def install`).

9. **Verify the upgrade path** on a machine that has the tap:
   ```bash
   brew update
   brew upgrade claude-foundation          # pours the bottle on a matching platform — no toolchain check
   brew info claude-foundation             # confirm it reports the new version
   ```

## Why the bottle (skips the Xcode/CLT check)

The formula compiles nothing — `install` only copies files. But Homebrew runs its fatal *"Your Xcode/Command Line Tools are too outdated"* check on every **build-from-source** install:

```ruby
# Homebrew/formula_installer.rb
if !pour_bottle? && DevelopmentTools.installed?
  Homebrew::Install.perform_build_from_source_checks   # raises the outdated-Xcode error
end
```

The gate is purely `pour_bottle?` — it never inspects whether a compiler is actually used. With **no bottle**, every stable `brew install` is build-from-source, so a user on a newer macOS (e.g. Tahoe 26) with an older Xcode is blocked for a toolchain the formula never needs. Publishing a bottle (`cellar: :any_skip_relocation`) makes `pour_bottle?` true **on a matching platform** and skips the check. The formula's `bin` wrapper bakes an absolute prefix, so it is **not** `:all`-eligible — brew emits a per-platform bottle (e.g. `arm64_tahoe`); platforms without a `sha256 … <tag>:` line keep building from source. `brew install --HEAD` always builds from source (HEAD ignores bottles), which is expected.

**The bottle must be built where Xcode is current** — building a bottle is itself a build-from-source op, so it can't be produced on the very machine that hits the error. That's why the workflow runs on `macos-latest`. To cover more platforms, build the bottle on each (a CI matrix) and add one `sha256 … <tag>:` line per platform.

> **Asset filename gotcha.** `brew bottle` writes the file as `name--version.<tag>.bottle.tar.gz` (**double** dash), but with a custom `root_url` brew *downloads* via `url_encode` = `name-version.<tag>.bottle.tar.gz` (**single** dash). The asset uploaded to the release must use the **single-dash** name or `brew install` 404s. The workflow renames it automatically before upload; if you ever upload by hand, rename `--` → `-` first. (Content is identical, so the `sha256` is unchanged.)

**Retro-fixing an already-released version**: trigger the workflow by hand — `gh workflow run bottle.yml -f tag=vX.Y.Z` (or the Actions tab → *Build Homebrew bottle* → Run workflow → enter the tag). It uploads the bottle to that existing release and prints the block; paste it into the formula and push a formula-only commit. No re-tag.

> **Note on tarball hashes.** GitHub's `archive/refs/tags/*.tar.gz` checksums are stable, so the `sha256` you compute once stays valid. If you ever re-tag the same version (don't), the hash changes and the formula must be re-bumped.

## Branch protection (recommended, not yet enabled)

Because `brew install --HEAD` and the tap clone both track `main`, a force-push to `main` would ship rewritten history to everyone tracking HEAD. Enabling branch protection on `main` is recommended:

```bash
gh api -X PUT repos/Maximumsoft-Co-LTD/claude-foundation/branches/main/protection \
  -H "Accept: application/vnd.github+json" \
  -f "required_pull_request_reviews[required_approving_review_count]=1" \
  -F "enforce_admins=false" \
  -F "required_status_checks=null" \
  -F "restrictions=null" \
  -F "allow_force_pushes=false" \
  -F "allow_deletions=false"
```

This was intentionally **left disabled** for now (it would block the current direct-push workflow); enable it when the team is ready to require PRs into `main`.
