class ClaudeFoundation < Formula
  desc "Drop the /dev workflow (spec → plan → implement → ship) into any project"
  homepage "https://github.com/Maximumsoft-Co-LTD/claude-foundation"
  license "MIT"
  head "https://github.com/Maximumsoft-Co-LTD/claude-foundation.git", branch: "main"

  def install
    libexec.install ".claude", ".workflow", "WORKFLOW.md", "CLAUDE.md",
                    "install.sh", "install-cursor.sh"

    (bin/"claude-foundation").write <<~EOS
      #!/usr/bin/env bash
      exec "#{libexec}/install.sh" "$@" --source "#{libexec}"
    EOS
    chmod 0755, bin/"claude-foundation"
  end

  test do
    system "#{bin}/claude-foundation", "--help"
  end
end
