class ClaudeFoundation < Formula
  desc "OpenSpec-native change harness for AI coding agents"
  homepage "https://github.com/Maximumsoft-Co-LTD/claude-foundation"
  url "https://github.com/Maximumsoft-Co-LTD/claude-foundation/archive/refs/tags/v3.2.17.tar.gz"
  sha256 "7623c8bea9611ccf749dbeb5b5439a3f294999d115c9aa54ecf2ca5258a0831a"
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
    root_url "https://github.com/Maximumsoft-Co-LTD/claude-foundation/releases/download/v3.2.17"
    sha256 cellar: :any_skip_relocation, arm64_sequoia: "b800063aaa435ca126d627fb238784ec68a23ce35d4429afc41aa92fb1cfccc0"
  end

  def install
    libexec.install ".claude", ".foundation", ".workflow", "openspec",
                    "WORKFLOW.md", "CLAUDE.md", "package.json", "package-lock.json",
                    "foundation.json", "install.sh", "install-cursor.sh",
                    "install-opencode.sh", "install-codex.sh", "cli.sh", "dashboard"

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

    # cli.sh routes install/dashboard commands and forwards native workflow
    # commands to the runtime installed in the current project.
    (bin/"claude-foundation").write <<~EOS
      #!/usr/bin/env bash
      exec "#{libexec}/cli.sh" "$@"
    EOS
    chmod 0755, bin/"claude-foundation"
  end

  test do
    help = shell_output("#{bin}/claude-foundation --help")
    assert_match "proof readiness", help
    assert_match "land check", help
    assert_match "change start", help
    assert_match version.to_s, shell_output("#{bin}/claude-foundation version")

    project = testpath/"project"
    project.mkpath
    system bin/"claude-foundation", "init", project, "--yes"
    assert_path_exists project/"foundation.json"
  end
end
