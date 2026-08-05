# Interface stability and deprecation policy

Changeloop labels public CLI commands, configuration fields, and protocol/SDK
features as `experimental`, `beta`, or `stable`. A label describes the
compatibility promise, not whether the implementation has tests.

| Label | Compatibility contract |
|---|---|
| `experimental` | May change or be removed in any release. Release notes identify user-visible changes when practical. |
| `beta` | Intended for integration testing. Breaking changes require release-note notice and a migration note; one minor release of overlap is the default when safe. |
| `stable` | Breaking removal or semantic change requires a documented replacement, deprecation diagnostics, and at least one full minor release plus 90 days before removal. |

For a stable protocol major version, clients receive an explicit compatibility
error rather than best-effort decoding. The previous stable major remains
supported for at least one major release unless doing so would preserve an
actively exploitable vulnerability. Generated Rust/TypeScript clients carry
the same maturity metadata as the schema feature they expose.

For stable CLI/config features, deprecation diagnostics name the replacement
and never print secret values. Deprecated legacy environment variables and the
`claude-foundation` compatibility alias follow the window stated in the
migration roadmap; their use is observable locally so users can migrate before
removal.

Security exception: a feature may be disabled immediately when continued use
would cross a hard security boundary or cause irreversible data loss. The
release must fail closed, document the reason and recovery path, and must not
silently reinterpret the disabled interface as weaker authority.

The current `cloop 0.1.x` public surface is labeled `experimental`. Promotion
to beta or stable requires the matching roadmap/release gates; passing unit
tests alone does not promote maturity.

No command, configuration field, protocol feature, generated client, TUI
surface, updater, or extension API in `0.1.x` should be described as stable or
GA solely because it appears in help output or has local tests. The release
notes and negotiated protocol metadata are authoritative for any future
promotion.
