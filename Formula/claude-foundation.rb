class ClaudeFoundation < Formula
  desc "OpenSpec-native change harness for AI coding agents"
  homepage "https://github.com/Maximumsoft-Co-LTD/claude-foundation"
  url "https://github.com/Maximumsoft-Co-LTD/claude-foundation/archive/refs/tags/v3.5.7.tar.gz"
  sha256 "ac3624e36939f6ea63e8d2a3fe94a031965199ed9340c1853da7f9c1ea184883"
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
    root_url "https://github.com/Maximumsoft-Co-LTD/claude-foundation/releases/download/v3.5.7"
    sha256 cellar: :any_skip_relocation, arm64_sequoia: "60cd59a0707935aba7dbb2729d8bf65cfd441fef94301cb58d0d5c410269e56b"
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
    assert_match "change start", help
    assert_match "advance", help

    full_help = shell_output("#{bin}/claude-foundation help --all")
    assert_match "proof readiness", full_help
    assert_match "land check", full_help
    assert_match version.to_s, shell_output("#{bin}/claude-foundation version")

    instruction = JSON.parse(shell_output("#{bin}/claude-foundation host instruction changes"))
    assert_equal 1, instruction.fetch("protocol")
    assert_equal "changes", instruction.fetch("command")

    project = testpath/"project"
    project.mkpath
    system bin/"claude-foundation", "init", project, "--yes"
    assert_path_exists project/"foundation.json"
  end
end
