class ClaudeFoundation < Formula
  desc "Drop the /dev workflow (spec → plan → ship) + team-mode role commands"
  homepage "https://github.com/Maximumsoft-Co-LTD/claude-foundation"
  url "https://github.com/Maximumsoft-Co-LTD/claude-foundation/archive/refs/tags/v2.10.0.tar.gz"
  sha256 "4552dc9a0ecf7a94355efdef700b9cded1d441af5c387c331bab69ffde24ad3e"
  license "MIT"
  head "https://github.com/Maximumsoft-Co-LTD/claude-foundation.git", branch: "main"

  # This formula compiles nothing — `install` only copies files. But Homebrew
  # runs its fatal "Xcode/CLT too outdated" check on every *build-from-source*
  # install (formula_installer.rb: `!pour_bottle? && DevelopmentTools.installed?`),
  # so without a bottle, users on a newer macOS with an older Xcode are blocked
  # for a toolchain they never need. The bottle below makes `pour_bottle?` true
  # on a matching platform and skips that check there.
  #
  # The `bin` wrapper bakes an absolute prefix, so brew produces a *per-platform*
  # bottle (not an `:all` one). An older-macOS bottle pours on newer macOS
  # (forward-compatible), so arm64_sequoia also covers arm64_tahoe; add a
  # `sha256 … <tag>:` line per platform (see .github/workflows/bottle.yml +
  # RELEASING.md). Platforms with no line fall back to build-from-source.
  bottle do
    root_url "https://github.com/Maximumsoft-Co-LTD/claude-foundation/releases/download/v2.10.0"
    sha256 cellar: :any_skip_relocation, arm64_sequoia: "7b48c09bc14eec2e8eddc4f07b63be51ef55f054807be5757f91d50955a44321"
  end

  def install
    libexec.install ".claude", ".workflow", "WORKFLOW.md", "CLAUDE.md",
                    "install.sh", "install-cursor.sh", "cli.sh", "dashboard"

    # VERSION is cli.sh's source of truth for `claude-foundation version`.
    # Ship the repo file when present (HEAD builds, and tags cut after it was
    # added); otherwise synthesize it from the formula version so older stable
    # tarballs that predate the file still report correctly. The repo file wins
    # on HEAD builds, so this never clobbers it with a "HEAD-<sha>" string.
    if File.exist?("VERSION")
      libexec.install "VERSION"
    else
      (libexec/"VERSION").write("#{version}\n")
    end

    # cli.sh routes subcommands (installer + dashboard-*) and finds its siblings
    # relative to itself, so it needs no --source.
    (bin/"claude-foundation").write <<~EOS
      #!/usr/bin/env bash
      exec "#{libexec}/cli.sh" "$@"
    EOS
    chmod 0755, bin/"claude-foundation"
  end

  test do
    system "#{bin}/claude-foundation", "--help"
    assert_match version.to_s, shell_output("#{bin}/claude-foundation version")
  end
end
