class ClaudeFoundation < Formula
  desc "Drop the /dev workflow (spec → plan → implement → ship) into any project"
  homepage "https://github.com/Maximumsoft-Co-LTD/claude-foundation"
  url "https://github.com/Maximumsoft-Co-LTD/claude-foundation/archive/refs/tags/v1.3.0.tar.gz"
  sha256 "79d98c0b0c028c3502e94e34cbda3d4a456eb862a8edbf3c4f2387487098c545"
  license "MIT"
  head "https://github.com/Maximumsoft-Co-LTD/claude-foundation.git", branch: "main"

  def install
    components = [".claude", ".workflow", "WORKFLOW.md", "CLAUDE.md",
                  "install.sh", "install-cursor.sh"]
    # The CLI router (cli.sh) and the dashboard ship from source (HEAD) today.
    # They fold into the stable tarball at the next tagged release; after that,
    # drop this guard and install/exec cli.sh unconditionally.
    components += ["cli.sh", "dashboard"] if build.head?
    libexec.install components

    if build.head?
      # cli.sh routes subcommands (installer + dashboard-*) and finds its
      # siblings relative to itself, so it needs no --source.
      (bin/"claude-foundation").write <<~EOS
        #!/usr/bin/env bash
        exec "#{libexec}/cli.sh" "$@"
      EOS
    else
      (bin/"claude-foundation").write <<~EOS
        #!/usr/bin/env bash
        exec "#{libexec}/install.sh" "$@" --source "#{libexec}"
      EOS
    end
    chmod 0755, bin/"claude-foundation"
  end

  test do
    system "#{bin}/claude-foundation", "--help"
  end
end
