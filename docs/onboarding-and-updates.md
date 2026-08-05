# First-run setup and secure updates

First-run setup is explicit and safe for terminals, TUI launchers, and automated
environments. It stores provider/model selection and disclosure acknowledgements,
but never accepts or persists a credential:

```sh
cloop setup --provider openai --model <model> \
  --sandbox workspace-write --accept-privacy --accept-provider-data
cloop auth login openai
cloop setup status
```

`auth login` writes the secret to the operating-system credential store. The
user configuration contains provider identifiers only. Analytics and crash
upload remain disabled; enabling them is deliberately outside first-run setup.
When the requested sandbox cannot be provided, setup records a read-only
effective capability and reports why.

Provider, model and disclosure inputs are validated before the atomic config
write. A failed setup or invalid auth provider leaves no partial profile. After
setup, `cloop setup status`, `cloop models`, and `cloop status` report the same
selected provider/model; `providerConfigured` does not mean `providerReady`
until the official credential-store login succeeds.

Shell completion includes nested actions, transports and required flags:

```sh
cloop completion bash > /tmp/cloop.bash && source /tmp/cloop.bash
cloop completion zsh > "${fpath[1]}/_cloop"
cloop completion fish > ~/.config/fish/completions/cloop.fish
```

The generated scripts are safe to inspect before installation. Release tests
syntax-check each installed shell and verify every public CLI command remains
represented.

`cloop doctor` and `cloop privacy inspect` report the exact resolved user and
project paths, credential-store boundary, retained session count, and possible
network destinations, including the selected provider, configured MCP servers,
and web-domain allowlist. Query strings/fragments and credential values are not
shown. They do not probe a provider or upload repository data.

Workflow metrics and audits remain local. Analytics and crash upload are
independent opt-ins and no uploader is implemented in the current release.
Prompts, source, diffs, and tool output leave the machine only as input to the
selected model execution or an explicitly authorized external tool/web call.
SQLite events, drafts and runtime pauses enforce recursive redaction again at
the persistence boundary; local privacy indexes and hook audits use the same
redaction contract. This defense-in-depth boundary applies even if a caller
forgets to redact first.

## Signed update flow

Tagged releases publish one raw `cloop-<version>-<target>` executable, one
Ed25519-signed release manifest, and one target-specific signed stable-channel
manifest per supported target. The signed channel identifies both HTTPS
download locations (`manifestSource` and `artifactSource`); the signed release
manifest binds the executable's version, byte size, and SHA-256. `SHA256SUMS`
and `UPDATE_SHA256SUMS` also receive GitHub-OIDC cosign signatures and build
provenance covers the release archives.

The release workflow reads the 32-byte Ed25519 seed only from the
`CHANGELOOP_UPDATE_SIGNING_KEY_BASE64` Actions secret and checks it against the
public `CHANGELOOP_UPDATE_PUBLIC_KEY_BASE64` repository variable. A tagged
release fails before publication if either is absent, malformed, or mismatched;
private material is never passed as a command-line argument or written to an
artifact.

Channel discovery authenticates its signed manifest before selecting a version
or trusting its release-manifest source:

```sh
cloop update check --channel-manifest ./update-channel-stable-<target>.json \
  --public-key <base64-ed25519-public-key> --channel stable
```

This verifies a downloaded channel file without fetching either signed URL.
`--offline` is reserved for a separately signed channel whose manifest and
artifact sources are explicit local paths; it rejects the HTTPS sources in a
published channel. Applying the downloaded raw executable remains a distinct
step:

```sh
cloop update --manifest ./cloop-<version>-<target>.update.json \
  --artifact ./cloop-<version>-<target> \
  --public-key <base64-ed25519-public-key> --target /explicit/path/to/cloop
```

The release signature, artifact SHA-256, artifact size, and strictly increasing
semantic version are checked before replacement. Install method is detected for
diagnostics. Interrupted replacement is recoverable with:

```sh
cloop update recover --target /explicit/path/to/cloop
```

On macOS/Linux the updater pins the installation directory with a directory
file descriptor and performs leaf opens/renames relative to it with
`O_NOFOLLOW`. Target, stage, backup, journal and lock files must be regular,
single-link files owned by the current user; world-writable targets/directories
are rejected. File and directory `fsync` ordering makes the prepared journal
durable before backup/install renames, and parent-directory identity is checked
throughout. `cloop doctor` reports `updatePathSafety`; non-Unix builds explicitly
report the portable best-effort TOCTOU limitation instead of claiming parity.

The updater never chooses a target from an unresolved shell variable and never
performs an implicit package-manager, commit, or push operation. Invoking
self-update without `--target` refuses Homebrew, Cargo and npm-managed binaries
and prints the corresponding `brew upgrade`, `cargo install`, or `npm update`
command. Direct replacement is reserved for detected standalone installs;
explicit administrative/test targets still receive all path-safety checks.

## Migration and compatibility alias

Run `cloop migrate --dry-run` first and pass its exact `digest` to
`cloop migrate --apply <digest>`. If source state changes, the apply is rejected;
transaction journals and backups preserve a recovery path. Legacy
`foundation.json`, `.foundation/`, receipts and read-only `.workflow/`
provenance remain available after migration. Release archives also ship the
`claude-foundation` compatibility alias, which invokes the same `cloop` surface
for the documented compatibility window.
