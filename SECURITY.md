# Security Policy

Change Loop is installed into its users' repositories and executes as
part of their development workflow, so we treat security reports with high
priority.

## Supported versions

Only the latest released version (see [`VERSION`](VERSION)) receives security
fixes. Receipts and evidence recorded by earlier runtime API versions are
already invalidated by the runtime's own version pinning.

| Version | Supported |
|---|---|
| Latest release | ✅ |
| Older releases | ❌ — upgrade via `install.sh` or Homebrew |

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report privately through GitHub's private vulnerability reporting:

1. Go to the repository's **Security** tab.
2. Choose **Report a vulnerability** ([direct link](https://github.com/Maximumsoft-Co-LTD/claude-foundation/security/advisories/new)).
3. Describe the issue, the affected surface (installer, harness runtime, hooks,
   host adapters, dashboard), and reproduction steps.

You can expect an acknowledgement within **5 business days**. We will keep you
informed of progress and credit you in the fix's release notes unless you
prefer otherwise.

## Scope notes

Surfaces of particular interest:

- `install.sh` and the host-adapter installers (files written into consumer
  repositories, manifest-driven removal)
- The harness runtime under `.claude/harness/` (sandboxing, Land guards,
  evidence and receipt integrity, secret protection hooks)
- `.claude/hooks/` (notably `protect-secrets.sh`)
- The observability dashboard under `dashboard/`

Vulnerabilities in the AI coding agents Foundation orchestrates (Claude Code,
Cursor, OpenCode, Codex) belong to their respective vendors, but issues in how
Foundation *configures or instructs* those hosts are in scope here.
