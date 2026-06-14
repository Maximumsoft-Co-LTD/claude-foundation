class ClaudeFoundation < Formula
  desc "Drop the /dev workflow (spec → plan → implement → ship) into any project"
  homepage "https://github.com/Maximumsoft-Co-LTD/claude-foundation"
  url "https://github.com/Maximumsoft-Co-LTD/claude-foundation/archive/refs/tags/v2.0.0.tar.gz"
  sha256 "4bd1b55855dd727ae5cfe0098529788666ab77197b9740c0a7638b39c762de58"
  license "MIT"
  head "https://github.com/Maximumsoft-Co-LTD/claude-foundation.git", branch: "main"

  def install
    libexec.install ".claude", ".workflow", "WORKFLOW.md", "CLAUDE.md",
                    "install.sh", "install-cursor.sh", "cli.sh", "dashboard"

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
  end
end
