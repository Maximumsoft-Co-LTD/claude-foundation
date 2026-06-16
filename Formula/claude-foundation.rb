class ClaudeFoundation < Formula
  desc "Drop the /dev workflow (spec → plan → ship) + team-mode role commands"
  homepage "https://github.com/Maximumsoft-Co-LTD/claude-foundation"
  url "https://github.com/Maximumsoft-Co-LTD/claude-foundation/archive/refs/tags/v2.3.0.tar.gz"
  sha256 "dbf1ab11a573df4df03e500f18ca468455de459740b17cf85b05c6d72a6dfac9"
  license "MIT"
  head "https://github.com/Maximumsoft-Co-LTD/claude-foundation.git", branch: "main"

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
