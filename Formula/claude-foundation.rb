class ClaudeFoundation < Formula
  desc "Drop the /dev workflow (spec → plan → ship) + team-mode role commands"
  homepage "https://github.com/Maximumsoft-Co-LTD/claude-foundation"
  url "https://github.com/Maximumsoft-Co-LTD/claude-foundation/archive/refs/tags/v2.5.10.tar.gz"
  sha256 "3ac1b5e3b4a4079e5bc095ede9669dd0e016fcbfc4bf4d6d0e146b09e226c50a"
  license "MIT"
  head "https://github.com/Maximumsoft-Co-LTD/claude-foundation.git", branch: "main"

  # This formula compiles nothing — `install` only copies files. But Homebrew
  # runs its fatal "Xcode/CLT too outdated" check on every *build-from-source*
  # install (formula_installer.rb: `!pour_bottle? && DevelopmentTools.installed?`),
  # so without a bottle, users on a newer macOS with an older Xcode are blocked
  # for a toolchain they never need. Publishing one platform-independent `:all`
  # bottle makes `pour_bottle?` true and skips that check on every platform.
  #
  # The bottle is built + uploaded by .github/workflows/bottle.yml on release;
  # paste the printed block here at release time (see RELEASING.md). Shape:
  #
  #   bottle do
  #     root_url "https://github.com/Maximumsoft-Co-LTD/claude-foundation/releases/download/vX.Y.Z"
  #     sha256 cellar: :any_skip_relocation, all: "<sha256 from the bottle job>"
  #   end

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
