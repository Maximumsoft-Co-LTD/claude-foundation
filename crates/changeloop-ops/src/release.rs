use base64::{Engine as _, engine::general_purpose::STANDARD};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use fs2::FileExt;
use semver::Version;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeSet,
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};
use thiserror::Error;
use url::Url;
use zeroize::Zeroize;

const CREDENTIAL_SERVICE: &str = "changeloop-cli";
const MAX_AUTH_REGISTRY_BYTES: u64 = 64 * 1024;
const MAX_CREDENTIAL_BYTES: usize = 64 * 1024;
const MAX_UPDATE_JOURNAL_BYTES: u64 = 64 * 1024;
const MAX_UPDATE_ARTIFACT_BYTES: u64 = 512 * 1024 * 1024;
const MAX_UPDATE_RELEASES: usize = 10_000;
const MAX_UPDATE_SOURCE_BYTES: usize = 16 * 1024;
pub const UPDATE_MANIFEST_SCHEMA_VERSION: u16 = 2;

/// Credential storage is deliberately abstract: production uses the operating
/// system store, while tests can inject an in-memory implementation.
pub trait CredentialStore {
    fn set(&self, account: &str, secret: &str) -> Result<(), ReleaseError>;
    fn get(&self, account: &str) -> Result<Option<String>, ReleaseError>;
    fn delete(&self, account: &str) -> Result<(), ReleaseError>;
    fn backend_name(&self) -> &'static str;
}

#[derive(Clone, Copy, Debug, Default)]
pub struct OsCredentialStore;

impl OsCredentialStore {
    fn entry(account: &str) -> Result<keyring::Entry, ReleaseError> {
        keyring::Entry::new(CREDENTIAL_SERVICE, account)
            .map_err(|error| ReleaseError::Credential(error.to_string()))
    }
}

impl CredentialStore for OsCredentialStore {
    fn set(&self, account: &str, secret: &str) -> Result<(), ReleaseError> {
        Self::entry(account)?
            .set_password(secret)
            .map_err(|error| ReleaseError::Credential(error.to_string()))
    }

    fn get(&self, account: &str) -> Result<Option<String>, ReleaseError> {
        match Self::entry(account)?.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(ReleaseError::Credential(error.to_string())),
        }
    }

    fn delete(&self, account: &str) -> Result<(), ReleaseError> {
        match Self::entry(account)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(ReleaseError::Credential(error.to_string())),
        }
    }

    fn backend_name(&self) -> &'static str {
        if cfg!(target_os = "macos") {
            "macOS Keychain"
        } else if cfg!(target_os = "linux") {
            "Linux Secret Service"
        } else {
            "operating-system credential store"
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct MemoryCredentialStore(
    std::sync::Arc<std::sync::Mutex<std::collections::BTreeMap<String, String>>>,
);

impl CredentialStore for MemoryCredentialStore {
    fn set(&self, account: &str, secret: &str) -> Result<(), ReleaseError> {
        let mut previous = self
            .0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .insert(account.into(), secret.into());
        previous.zeroize();
        Ok(())
    }

    fn get(&self, account: &str) -> Result<Option<String>, ReleaseError> {
        Ok(self
            .0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .get(account)
            .cloned())
    }

    fn delete(&self, account: &str) -> Result<(), ReleaseError> {
        let mut removed = self
            .0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .remove(account);
        removed.zeroize();
        Ok(())
    }

    fn backend_name(&self) -> &'static str {
        "in-memory test store"
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
struct AuthRegistry {
    providers: BTreeSet<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct AuthProfile {
    pub provider: String,
    pub credential_present: bool,
}

pub fn auth_login(
    registry_path: &Path,
    store: &dyn CredentialStore,
    provider: &str,
    secret: &str,
) -> Result<(), ReleaseError> {
    validate_provider(provider)?;
    if secret.trim().is_empty() {
        return Err(ReleaseError::EmptyCredential);
    }
    if secret.len() > MAX_CREDENTIAL_BYTES || secret.chars().any(char::is_control) {
        return Err(ReleaseError::InvalidCredential);
    }
    // Resolve every fallible local input before changing the keyring. The
    // registry contains identifiers only, never credentials.
    let mut previous = store.get(provider)?;
    let mut registry = read_auth_registry(registry_path)?;
    store.set(provider, secret)?;
    registry.providers.insert(provider.into());
    if let Err(error) = write_json_atomic(registry_path, &registry) {
        if let Some(previous) = previous.as_deref() {
            let _ = store.set(provider, previous);
        } else {
            let _ = store.delete(provider);
        }
        previous.zeroize();
        return Err(error);
    }
    previous.zeroize();
    Ok(())
}

pub fn auth_list(
    registry_path: &Path,
    store: &dyn CredentialStore,
) -> Result<Vec<AuthProfile>, ReleaseError> {
    read_auth_registry(registry_path)?
        .providers
        .into_iter()
        .map(|provider| {
            let mut credential = store.get(&provider)?;
            let credential_present = credential.is_some();
            credential.zeroize();
            Ok(AuthProfile {
                provider,
                credential_present,
            })
        })
        .collect()
}

pub fn auth_logout(
    registry_path: &Path,
    store: &dyn CredentialStore,
    provider: &str,
) -> Result<(), ReleaseError> {
    validate_provider(provider)?;
    let mut registry = read_auth_registry(registry_path)?;
    let mut previous = store.get(provider)?;
    store.delete(provider)?;
    registry.providers.remove(provider);
    if let Err(error) = write_json_atomic(registry_path, &registry) {
        if let Some(previous) = previous.as_deref() {
            let _ = store.set(provider, previous);
        }
        previous.zeroize();
        return Err(error);
    }
    previous.zeroize();
    Ok(())
}

fn validate_provider(provider: &str) -> Result<(), ReleaseError> {
    if !matches!(provider, "anthropic" | "openai") {
        return Err(ReleaseError::InvalidProvider);
    }
    Ok(())
}

fn read_auth_registry(path: &Path) -> Result<AuthRegistry, ReleaseError> {
    match open_private_state_read(path, MAX_AUTH_REGISTRY_BYTES, "authentication registry") {
        Ok(file) => {
            let registry: AuthRegistry = serde_json::from_slice(&read_limited(
                file,
                MAX_AUTH_REGISTRY_BYTES,
                "authentication registry",
            )?)?;
            for provider in &registry.providers {
                validate_provider(provider)?;
            }
            Ok(registry)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(AuthRegistry::default()),
        Err(error) => Err(error.into()),
    }
}

fn open_private_state_read(path: &Path, limit: u64, label: &'static str) -> std::io::Result<File> {
    let metadata = fs::symlink_metadata(path)?;
    validate_private_state_metadata(&metadata, path, limit, label)?;
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC);
    }
    let file = options.open(path)?;
    validate_private_state_metadata(&file.metadata()?, path, limit, label)?;
    Ok(file)
}

fn validate_private_state_metadata(
    metadata: &fs::Metadata,
    path: &Path,
    limit: u64,
    label: &'static str,
) -> std::io::Result<()> {
    if !metadata.file_type().is_file() || metadata.len() > limit {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!(
                "{label} must be a regular non-symlink file no larger than {limit} bytes: {}",
                path.display()
            ),
        ));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if metadata.nlink() != 1 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!(
                    "{label} must have exactly one hard link: {}",
                    path.display()
                ),
            ));
        }
    }
    Ok(())
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum InstallMethod {
    Homebrew,
    Cargo,
    Npm,
    Standalone,
    Unknown,
}

pub fn detect_install_method(executable: &Path) -> InstallMethod {
    let path = executable.to_string_lossy().to_ascii_lowercase();
    if path.contains("/cellar/") || path.contains("/homebrew/") {
        InstallMethod::Homebrew
    } else if path.contains("/.cargo/bin/") {
        InstallMethod::Cargo
    } else if path.contains("node_modules") || path.contains("/npm/") {
        InstallMethod::Npm
    } else if executable.is_absolute() {
        InstallMethod::Standalone
    } else {
        InstallMethod::Unknown
    }
}

#[must_use]
pub const fn update_path_safety() -> &'static str {
    #[cfg(unix)]
    {
        "dirfd-openat-nofollow-single-link-owner-checked"
    }
    #[cfg(not(unix))]
    {
        "portable-best-effort; final path-swap TOCTOU is not closed"
    }
}

pub fn shell_completion(shell: &str) -> Result<String, ReleaseError> {
    const COMMANDS: &str = "ask run change contract resume fork sessions status undo redo jobs review prove land auth setup models migrate config privacy lsp formatter mcp serve doctor update completion";
    let script = match shell {
        "bash" => format!(
            r#"_cloop() {{
  local cur="${{COMP_WORDS[COMP_CWORD]}}" cmd="${{COMP_WORDS[1]}}" words=""
  if (( COMP_CWORD == 1 )); then
    words="{COMMANDS}"
  else
    case "$cmd" in
      change) words="confirm discard" ;;
      contract) words="approve" ;;
      auth) words="login list logout anthropic openai" ;;
      setup) words="status --provider --model --sandbox --accept-privacy --accept-provider-data anthropic openai read-only workspace-write danger-full-access" ;;
      completion) words="bash zsh fish" ;;
      migrate) words="--dry-run --apply" ;;
      config) words="explain" ;;
      privacy) words="inspect export delete" ;;
      lsp|formatter) words="status" ;;
      serve) words="--stdio --unix --http" ;;
      update) words="check recover --manifest --artifact --public-key --target --channel-manifest --channel --offline stable beta preview" ;;
      mcp) words="add list extensions auth remove run refresh logout stdio unix http" ;;
    esac
  fi
  COMPREPLY=( $(compgen -W "$words" -- "$cur") )
}}
complete -F _cloop cloop"#
        ),
        "zsh" => format!(
            r#"#compdef cloop
local -a commands
commands=({COMMANDS})
if (( CURRENT == 2 )); then
  _values 'command' $commands
else
  case $words[2] in
    change) _values 'action' confirm discard ;;
    contract) _values 'action' approve ;;
    auth) _values 'action/provider' login list logout anthropic openai ;;
    setup) _values 'setup option' status --provider --model --sandbox --accept-privacy --accept-provider-data anthropic openai read-only workspace-write danger-full-access ;;
    completion) _values 'shell' bash zsh fish ;;
    migrate) _values 'migration action' --dry-run --apply ;;
    config) _values 'action' explain ;;
    privacy) _values 'action' inspect export delete ;;
    lsp|formatter) _values 'action' status ;;
    serve) _values 'transport' --stdio --unix --http ;;
    update) _values 'update action/option' check recover --manifest --artifact --public-key --target --channel-manifest --channel --offline stable beta preview ;;
    mcp) _values 'MCP action/transport' add list extensions auth remove run refresh logout stdio unix http ;;
  esac
fi"#
        ),
        "fish" => format!(
            "complete -c cloop -f -n '__fish_use_subcommand' -a '{COMMANDS}'\n\
complete -c cloop -f -n '__fish_seen_subcommand_from change' -a 'confirm discard'\n\
complete -c cloop -f -n '__fish_seen_subcommand_from contract' -a 'approve'\n\
complete -c cloop -f -n '__fish_seen_subcommand_from auth' -a 'login list logout anthropic openai'\n\
complete -c cloop -f -n '__fish_seen_subcommand_from setup' -a 'status --provider --model --sandbox --accept-privacy --accept-provider-data anthropic openai read-only workspace-write danger-full-access'\n\
complete -c cloop -f -n '__fish_seen_subcommand_from completion' -a 'bash zsh fish'\n\
complete -c cloop -f -n '__fish_seen_subcommand_from migrate' -a '--dry-run --apply'\n\
complete -c cloop -f -n '__fish_seen_subcommand_from config' -a 'explain'\n\
complete -c cloop -f -n '__fish_seen_subcommand_from privacy' -a 'inspect export delete'\n\
complete -c cloop -f -n '__fish_seen_subcommand_from lsp formatter' -a 'status'\n\
complete -c cloop -f -n '__fish_seen_subcommand_from serve' -a '--stdio --unix --http'\n\
complete -c cloop -f -n '__fish_seen_subcommand_from update' -a 'check recover --manifest --artifact --public-key --target --channel-manifest --channel --offline stable beta preview'\n\
complete -c cloop -f -n '__fish_seen_subcommand_from mcp' -a 'add list extensions auth remove run refresh logout stdio unix http'"
        ),
        _ => return Err(ReleaseError::UnsupportedShell),
    };
    Ok(format!("{script}\n"))
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateManifest {
    pub schema_version: u16,
    pub version: String,
    pub target_triple: String,
    pub artifact_kind: UpdateArtifactKind,
    pub artifact_sha256: String,
    pub artifact_size: u64,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum UpdateArtifactKind {
    StandaloneExecutable,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SignedUpdateManifest {
    pub manifest: UpdateManifest,
    pub signature: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateRelease {
    pub version: String,
    pub channel: String,
    pub target_triple: String,
    pub artifact_kind: UpdateArtifactKind,
    pub manifest_source: String,
    pub artifact_source: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateChannelManifest {
    pub version: u16,
    pub releases: Vec<UpdateRelease>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SignedUpdateChannelManifest {
    pub manifest: UpdateChannelManifest,
    pub signature: String,
}

pub fn verify_channel_manifest(
    signed: &SignedUpdateChannelManifest,
    public_key: &[u8; 32],
) -> Result<(), ReleaseError> {
    let signature_bytes = STANDARD
        .decode(&signed.signature)
        .map_err(|_| ReleaseError::InvalidSignature)?;
    let signature =
        Signature::from_slice(&signature_bytes).map_err(|_| ReleaseError::InvalidSignature)?;
    let key = VerifyingKey::from_bytes(public_key).map_err(|_| ReleaseError::InvalidPublicKey)?;
    key.verify(&serde_json::to_vec(&signed.manifest)?, &signature)
        .map_err(|_| ReleaseError::InvalidSignature)
}

/// Discover the newest release only after authenticating the channel manifest.
/// Sources are returned as opaque HTTPS URLs or explicit local paths; fetching
/// and replacement remain separate so no unverified bytes can be installed.
pub fn discover_update(
    signed: &SignedUpdateChannelManifest,
    public_key: &[u8; 32],
    current_version: &str,
    channel: &str,
    offline: bool,
) -> Result<Option<UpdateRelease>, ReleaseError> {
    verify_channel_manifest(signed, public_key)?;
    if signed.manifest.version != UPDATE_MANIFEST_SCHEMA_VERSION {
        return Err(ReleaseError::UnsupportedChannelManifestVersion);
    }
    if !matches!(channel, "stable" | "beta" | "preview") {
        return Err(ReleaseError::InvalidChannel);
    }
    if signed.manifest.releases.len() > MAX_UPDATE_RELEASES {
        return Err(ReleaseError::InputTooLarge {
            label: "update release catalog",
            limit: MAX_UPDATE_RELEASES as u64,
        });
    }
    let current = Version::parse(current_version).map_err(|_| ReleaseError::InvalidVersion)?;
    let mut candidates = signed
        .manifest
        .releases
        .iter()
        .filter(|release| release.channel == channel)
        .map(|release| {
            verify_update_target(&release.target_triple, release.artifact_kind)?;
            let version =
                Version::parse(&release.version).map_err(|_| ReleaseError::InvalidVersion)?;
            for source in [&release.manifest_source, &release.artifact_source] {
                validate_update_source(source, offline)?;
            }
            Ok((version, release.clone()))
        })
        .collect::<Result<Vec<_>, ReleaseError>>()?;
    candidates.sort_by(|left, right| right.0.cmp(&left.0));
    Ok(candidates
        .into_iter()
        .find(|(version, _)| version > &current)
        .map(|(_, release)| release))
}

fn validate_update_source(source: &str, offline: bool) -> Result<(), ReleaseError> {
    if source.is_empty()
        || source.len() > MAX_UPDATE_SOURCE_BYTES
        || source.chars().any(char::is_control)
    {
        return Err(ReleaseError::InsecureManifestSource);
    }
    if offline {
        if Url::parse(source).is_ok() || source.contains("://") {
            return Err(ReleaseError::OfflineRemoteSource);
        }
        return Ok(());
    }
    let parsed = Url::parse(source).map_err(|_| ReleaseError::InsecureManifestSource)?;
    if parsed.scheme() != "https"
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.fragment().is_some()
    {
        return Err(ReleaseError::InsecureManifestSource);
    }
    Ok(())
}

impl SignedUpdateManifest {
    pub fn signed_bytes(&self) -> Result<Vec<u8>, ReleaseError> {
        Ok(serde_json::to_vec(&self.manifest)?)
    }
}

pub fn verify_update(
    signed: &SignedUpdateManifest,
    artifact: &[u8],
    public_key: &[u8; 32],
    current_version: &str,
) -> Result<(), ReleaseError> {
    verify_update_metadata(signed, public_key, current_version)?;
    if artifact.len() as u64 != signed.manifest.artifact_size
        || sha256(artifact) != signed.manifest.artifact_sha256
    {
        return Err(ReleaseError::ChecksumMismatch);
    }
    Ok(())
}

fn verify_update_metadata(
    signed: &SignedUpdateManifest,
    public_key: &[u8; 32],
    current_version: &str,
) -> Result<(), ReleaseError> {
    let signature_bytes = STANDARD
        .decode(&signed.signature)
        .map_err(|_| ReleaseError::InvalidSignature)?;
    let signature =
        Signature::from_slice(&signature_bytes).map_err(|_| ReleaseError::InvalidSignature)?;
    let key = VerifyingKey::from_bytes(public_key).map_err(|_| ReleaseError::InvalidPublicKey)?;
    key.verify(&signed.signed_bytes()?, &signature)
        .map_err(|_| ReleaseError::InvalidSignature)?;
    if signed.manifest.schema_version != UPDATE_MANIFEST_SCHEMA_VERSION {
        return Err(ReleaseError::UnsupportedUpdateManifestVersion);
    }
    verify_update_target(
        &signed.manifest.target_triple,
        signed.manifest.artifact_kind,
    )?;
    let current = Version::parse(current_version).map_err(|_| ReleaseError::InvalidVersion)?;
    let candidate =
        Version::parse(&signed.manifest.version).map_err(|_| ReleaseError::InvalidVersion)?;
    if candidate <= current {
        return Err(ReleaseError::RollbackRejected);
    }
    Ok(())
}

pub fn current_update_target_triple() -> Result<&'static str, ReleaseError> {
    if cfg!(all(
        target_arch = "x86_64",
        target_os = "linux",
        target_env = "gnu"
    )) {
        Ok("x86_64-unknown-linux-gnu")
    } else if cfg!(all(
        target_arch = "aarch64",
        target_os = "linux",
        target_env = "gnu"
    )) {
        Ok("aarch64-unknown-linux-gnu")
    } else if cfg!(all(target_arch = "x86_64", target_os = "macos")) {
        Ok("x86_64-apple-darwin")
    } else if cfg!(all(target_arch = "aarch64", target_os = "macos")) {
        Ok("aarch64-apple-darwin")
    } else {
        Err(ReleaseError::UnsupportedUpdateTarget)
    }
}

fn verify_update_target(
    target_triple: &str,
    artifact_kind: UpdateArtifactKind,
) -> Result<(), ReleaseError> {
    if artifact_kind != UpdateArtifactKind::StandaloneExecutable {
        return Err(ReleaseError::UnsupportedUpdateArtifactKind);
    }
    let current = current_update_target_triple()?;
    if target_triple != current {
        return Err(ReleaseError::UpdateTargetMismatch {
            expected: current,
            actual: target_triple.to_owned(),
        });
    }
    Ok(())
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum UpdateJournalState {
    Prepared,
    Installed,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct UpdateJournal {
    state: UpdateJournalState,
    original_sha256: String,
    replacement_sha256: String,
    version: String,
}

pub fn apply_update(
    target: &Path,
    artifact_path: &Path,
    signed: &SignedUpdateManifest,
    public_key: &[u8; 32],
    current_version: &str,
) -> Result<(), ReleaseError> {
    // Authenticate and bind the candidate to this executable's platform before
    // opening artifact bytes or creating any update sidecars.
    verify_update_metadata(signed, public_key, current_version)?;
    if signed.manifest.artifact_size > MAX_UPDATE_ARTIFACT_BYTES {
        return Err(ReleaseError::InputTooLarge {
            label: "update artifact",
            limit: MAX_UPDATE_ARTIFACT_BYTES,
        });
    }
    let artifact = read_limited(
        File::open(artifact_path)?,
        MAX_UPDATE_ARTIFACT_BYTES,
        "update artifact",
    )?;
    verify_update(signed, &artifact, public_key, current_version)?;
    apply_verified_update(target, &artifact, signed, InterruptPoint::None)
}

/// Applies a standalone CLI update only after its authenticated bytes match
/// the executable format and machine declared by the signed target triple.
/// The installed bytes are hashed again before the backup is removed.
pub fn apply_update_with_self_check(
    target: &Path,
    artifact_path: &Path,
    signed: &SignedUpdateManifest,
    public_key: &[u8; 32],
    current_version: &str,
) -> Result<(), ReleaseError> {
    verify_update_metadata(signed, public_key, current_version)?;
    if signed.manifest.artifact_size > MAX_UPDATE_ARTIFACT_BYTES {
        return Err(ReleaseError::InputTooLarge {
            label: "update artifact",
            limit: MAX_UPDATE_ARTIFACT_BYTES,
        });
    }
    let artifact = read_limited(
        File::open(artifact_path)?,
        MAX_UPDATE_ARTIFACT_BYTES,
        "update artifact",
    )?;
    verify_update(signed, &artifact, public_key, current_version)?;
    validate_standalone_executable(&artifact, &signed.manifest.target_triple)?;
    apply_verified_update(target, &artifact, signed, InterruptPoint::None)
}

fn validate_standalone_executable(
    artifact: &[u8],
    target_triple: &str,
) -> Result<(), ReleaseError> {
    let valid = match target_triple {
        "x86_64-unknown-linux-gnu" => {
            artifact.get(..6) == Some(b"\x7fELF\x02\x01")
                && artifact.get(18..20) == Some(&62_u16.to_le_bytes())
        }
        "aarch64-unknown-linux-gnu" => {
            artifact.get(..6) == Some(b"\x7fELF\x02\x01")
                && artifact.get(18..20) == Some(&183_u16.to_le_bytes())
        }
        "x86_64-apple-darwin" => {
            artifact.get(..4) == Some(&0xfeedfacf_u32.to_le_bytes())
                && artifact.get(4..8) == Some(&0x0100_0007_u32.to_le_bytes())
        }
        "aarch64-apple-darwin" => {
            artifact.get(..4) == Some(&0xfeedfacf_u32.to_le_bytes())
                && artifact.get(4..8) == Some(&0x0100_000c_u32.to_le_bytes())
        }
        _ => false,
    };
    if valid {
        Ok(())
    } else {
        Err(ReleaseError::UpdateSelfCheckFailed(
            "artifact executable header does not match its signed target".into(),
        ))
    }
}

pub fn recover_update(target: &Path) -> Result<bool, ReleaseError> {
    #[cfg(unix)]
    {
        recover_update_unix(target)
    }
    #[cfg(not(unix))]
    {
        recover_update_portable(target)
    }
}

#[cfg(not(unix))]
fn recover_update_portable(target: &Path) -> Result<bool, ReleaseError> {
    reject_symlink_target(target)?;
    let paths = UpdatePaths::new(target)?;
    fs::create_dir_all(&paths.directory)?;
    let lock = fs::OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .truncate(false)
        .open(&paths.lock)?;
    lock.try_lock_exclusive()
        .map_err(|_| ReleaseError::UpdateLocked)?;
    recover_update_unlocked(target, &paths)
}

#[cfg(not(unix))]
fn recover_update_unlocked(target: &Path, paths: &UpdatePaths) -> Result<bool, ReleaseError> {
    if !paths.journal.exists() {
        return Ok(false);
    }
    let journal: UpdateJournal = serde_json::from_slice(&read_limited(
        File::open(&paths.journal)?,
        MAX_UPDATE_JOURNAL_BYTES,
        "update journal",
    )?)?;
    let target_hash = hash_if_exists(target)?;
    if target_hash.as_deref() == Some(&journal.replacement_sha256) {
        remove_if_exists(&paths.backup)?;
        remove_if_exists(&paths.stage)?;
        remove_if_exists(&paths.journal)?;
        sync_directory(&paths.directory)?;
        return Ok(true);
    }
    if paths.backup.exists()
        && hash_if_exists(&paths.backup)?.as_deref() == Some(&journal.original_sha256)
    {
        remove_if_exists(target)?;
        fs::rename(&paths.backup, target)?;
        remove_if_exists(&paths.stage)?;
        remove_if_exists(&paths.journal)?;
        sync_directory(&paths.directory)?;
        return Ok(true);
    }
    Err(ReleaseError::RecoveryConflict)
}

#[cfg(unix)]
struct UnixUpdateDirectory {
    path: PathBuf,
    directory: File,
    target: std::ffi::CString,
    stage: std::ffi::CString,
    backup: std::ffi::CString,
    journal: std::ffi::CString,
    journal_stage: std::ffi::CString,
    lock: std::ffi::CString,
    device: u64,
    inode: u64,
}

#[cfg(unix)]
impl UnixUpdateDirectory {
    fn open(target: &Path) -> Result<Self, ReleaseError> {
        use std::os::{fd::FromRawFd, unix::ffi::OsStrExt, unix::fs::MetadataExt};
        let path = target
            .parent()
            .ok_or(ReleaseError::InvalidTarget)?
            .to_path_buf();
        fs::create_dir_all(&path)?;
        let encoded = std::ffi::CString::new(path.as_os_str().as_bytes())
            .map_err(|_| ReleaseError::InvalidTarget)?;
        let fd = unsafe {
            libc::open(
                encoded.as_ptr(),
                libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            )
        };
        if fd < 0 {
            return Err(std::io::Error::last_os_error().into());
        }
        let directory = unsafe { File::from_raw_fd(fd) };
        let metadata = directory.metadata()?;
        if metadata.uid() != unsafe { libc::geteuid() } || metadata.mode() & 0o022 != 0 {
            return Err(ReleaseError::UnsafeUpdatePath(
                "update directory must be owned by the current user and not group/world-writable"
                    .into(),
            ));
        }
        let target_name = target.file_name().ok_or(ReleaseError::InvalidTarget)?;
        let target = std::ffi::CString::new(target_name.as_bytes())
            .map_err(|_| ReleaseError::InvalidTarget)?;
        let display = target_name.to_string_lossy();
        let name = |suffix: &str| {
            std::ffi::CString::new(format!(".{display}.{suffix}"))
                .map_err(|_| ReleaseError::InvalidTarget)
        };
        Ok(Self {
            path,
            target,
            stage: name("update-stage")?,
            backup: name("update-backup")?,
            journal: name("update-journal.json")?,
            journal_stage: name("update-journal.stage")?,
            lock: name("update.lock")?,
            device: metadata.dev(),
            inode: metadata.ino(),
            directory,
        })
    }

    fn verify_parent(&self) -> Result<(), ReleaseError> {
        use std::os::unix::fs::MetadataExt;
        let metadata = fs::symlink_metadata(&self.path)?;
        if !metadata.file_type().is_dir()
            || metadata.dev() != self.device
            || metadata.ino() != self.inode
        {
            return Err(ReleaseError::UpdateParentChanged);
        }
        Ok(())
    }

    fn stat(&self, name: &std::ffi::CStr) -> Result<Option<libc::stat>, ReleaseError> {
        use std::os::fd::AsRawFd;
        let mut stat = std::mem::MaybeUninit::<libc::stat>::uninit();
        let result = unsafe {
            libc::fstatat(
                self.directory.as_raw_fd(),
                name.as_ptr(),
                stat.as_mut_ptr(),
                libc::AT_SYMLINK_NOFOLLOW,
            )
        };
        if result == 0 {
            Ok(Some(unsafe { stat.assume_init() }))
        } else {
            let error = std::io::Error::last_os_error();
            if error.kind() == std::io::ErrorKind::NotFound {
                Ok(None)
            } else {
                Err(error.into())
            }
        }
    }

    fn validate_stat(&self, name: &str, stat: &libc::stat) -> Result<(), ReleaseError> {
        if stat.st_mode & libc::S_IFMT == libc::S_IFLNK {
            return Err(ReleaseError::SymlinkTargetRejected);
        }
        if stat.st_mode & libc::S_IFMT != libc::S_IFREG
            || stat.st_nlink != 1
            || stat.st_uid != unsafe { libc::geteuid() }
        {
            return Err(ReleaseError::UnsafeUpdatePath(format!(
                "{name} must be a current-user-owned regular file with one link"
            )));
        }
        Ok(())
    }

    fn open_existing(
        &self,
        name: &std::ffi::CStr,
        label: &str,
        writable: bool,
    ) -> Result<File, ReleaseError> {
        use std::os::{
            fd::{AsRawFd, FromRawFd},
            unix::fs::MetadataExt,
        };
        self.verify_parent()?;
        if let Some(stat) = self.stat(name)? {
            self.validate_stat(label, &stat)?;
        }
        let flags = if writable {
            libc::O_RDWR
        } else {
            libc::O_RDONLY
        };
        let fd = unsafe {
            libc::openat(
                self.directory.as_raw_fd(),
                name.as_ptr(),
                flags | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            )
        };
        if fd < 0 {
            return Err(std::io::Error::last_os_error().into());
        }
        let file = unsafe { File::from_raw_fd(fd) };
        let metadata = file.metadata()?;
        if !metadata.is_file()
            || metadata.nlink() != 1
            || metadata.uid() != unsafe { libc::geteuid() }
        {
            return Err(ReleaseError::UnsafeUpdatePath(format!(
                "{label} must be a current-user-owned regular file with one link"
            )));
        }
        Ok(file)
    }

    fn create_exclusive(
        &self,
        name: &std::ffi::CStr,
        label: &str,
        bytes: &[u8],
        mode: libc::mode_t,
    ) -> Result<(), ReleaseError> {
        use std::os::fd::{AsRawFd, FromRawFd};
        self.verify_parent()?;
        if self.stat(name)?.is_some() {
            return Err(ReleaseError::UnsafeUpdatePath(format!(
                "{label} already exists"
            )));
        }
        let fd = unsafe {
            libc::openat(
                self.directory.as_raw_fd(),
                name.as_ptr(),
                libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                mode as libc::c_uint,
            )
        };
        if fd < 0 {
            return Err(std::io::Error::last_os_error().into());
        }
        let mut file = unsafe { File::from_raw_fd(fd) };
        if unsafe { libc::fchmod(file.as_raw_fd(), mode) } < 0 {
            return Err(std::io::Error::last_os_error().into());
        }
        file.write_all(bytes)?;
        file.sync_all()?;
        Ok(())
    }

    fn hash(&self, name: &std::ffi::CStr, label: &str) -> Result<Option<String>, ReleaseError> {
        if self.stat(name)?.is_none() {
            return Ok(None);
        }
        let mut file = self.open_existing(name, label, false)?;
        Ok(Some(sha256_reader(&mut file)?))
    }

    fn remove(&self, name: &std::ffi::CStr, label: &str) -> Result<(), ReleaseError> {
        use std::os::fd::AsRawFd;
        self.verify_parent()?;
        let Some(stat) = self.stat(name)? else {
            return Ok(());
        };
        self.validate_stat(label, &stat)?;
        if unsafe { libc::unlinkat(self.directory.as_raw_fd(), name.as_ptr(), 0) } < 0 {
            return Err(std::io::Error::last_os_error().into());
        }
        Ok(())
    }

    fn rename(&self, from: &std::ffi::CStr, to: &std::ffi::CStr) -> Result<(), ReleaseError> {
        use std::os::fd::AsRawFd;
        self.verify_parent()?;
        if self.stat(to)?.is_some() {
            return Err(ReleaseError::UnsafeUpdatePath(
                "update rename destination already exists".into(),
            ));
        }
        if unsafe {
            libc::renameat(
                self.directory.as_raw_fd(),
                from.as_ptr(),
                self.directory.as_raw_fd(),
                to.as_ptr(),
            )
        } < 0
        {
            return Err(std::io::Error::last_os_error().into());
        }
        self.directory.sync_all()?;
        self.verify_parent()
    }

    fn replace_journal(&self, journal: &UpdateJournal) -> Result<(), ReleaseError> {
        use std::os::fd::AsRawFd;
        self.remove(&self.journal_stage, "journal stage")?;
        self.create_exclusive(
            &self.journal_stage,
            "journal stage",
            &serde_json::to_vec_pretty(journal)?,
            0o600,
        )?;
        if let Some(stat) = self.stat(&self.journal)? {
            self.validate_stat("journal", &stat)?;
        }
        self.verify_parent()?;
        if unsafe {
            libc::renameat(
                self.directory.as_raw_fd(),
                self.journal_stage.as_ptr(),
                self.directory.as_raw_fd(),
                self.journal.as_ptr(),
            )
        } < 0
        {
            return Err(std::io::Error::last_os_error().into());
        }
        self.directory.sync_all()?;
        self.verify_parent()
    }

    fn lock(&self) -> Result<File, ReleaseError> {
        use std::os::fd::{AsRawFd, FromRawFd};
        self.verify_parent()?;
        // The pinned directory inode is the authoritative lock. A same-user
        // process may rename a sidecar pathname, but cannot thereby create a
        // second lock domain for this directory transaction.
        self.directory
            .try_lock_exclusive()
            .map_err(|_| ReleaseError::UpdateLocked)?;
        if let Some(stat) = self.stat(&self.lock)? {
            self.validate_stat("lock", &stat)?;
        }
        let fd = unsafe {
            libc::openat(
                self.directory.as_raw_fd(),
                self.lock.as_ptr(),
                libc::O_RDWR | libc::O_CREAT | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                0o600,
            )
        };
        if fd < 0 {
            return Err(std::io::Error::last_os_error().into());
        }
        let file = unsafe { File::from_raw_fd(fd) };
        let metadata = file.metadata()?;
        use std::os::unix::fs::MetadataExt;
        if !metadata.is_file()
            || metadata.nlink() != 1
            || metadata.uid() != unsafe { libc::geteuid() }
        {
            return Err(ReleaseError::UnsafeUpdatePath("unsafe update lock".into()));
        }
        if unsafe { libc::fchmod(file.as_raw_fd(), 0o600) } < 0 {
            return Err(std::io::Error::last_os_error().into());
        }
        file.try_lock_exclusive()
            .map_err(|_| ReleaseError::UpdateLocked)?;
        Ok(file)
    }
}

#[cfg(unix)]
fn recover_update_unix(target: &Path) -> Result<bool, ReleaseError> {
    let update = UnixUpdateDirectory::open(target)?;
    let _lock = update.lock()?;
    recover_update_unix_locked(&update)
}

#[cfg(unix)]
fn recover_update_unix_locked(update: &UnixUpdateDirectory) -> Result<bool, ReleaseError> {
    if update.stat(&update.journal)?.is_none() {
        if let Some(stat) = update.stat(&update.stage)? {
            update.validate_stat("stage", &stat)?;
            return Err(ReleaseError::RecoveryConflict);
        }
        if let Some(stat) = update.stat(&update.backup)? {
            update.validate_stat("backup", &stat)?;
            return Err(ReleaseError::RecoveryConflict);
        }
        return Ok(false);
    }
    let journal_file = update.open_existing(&update.journal, "journal", false)?;
    let journal_bytes = read_limited(journal_file, MAX_UPDATE_JOURNAL_BYTES, "update journal")?;
    let journal: UpdateJournal = serde_json::from_slice(&journal_bytes)?;
    if update.hash(&update.target, "target")?.as_deref() == Some(&journal.replacement_sha256) {
        update.remove(&update.backup, "backup")?;
        update.remove(&update.stage, "stage")?;
        update.remove(&update.journal, "journal")?;
        update.directory.sync_all()?;
        return Ok(true);
    }
    if update.hash(&update.backup, "backup")?.as_deref() == Some(&journal.original_sha256) {
        update.remove(&update.target, "target")?;
        update.rename(&update.backup, &update.target)?;
        update.remove(&update.stage, "stage")?;
        update.remove(&update.journal, "journal")?;
        update.directory.sync_all()?;
        return Ok(true);
    }
    Err(ReleaseError::RecoveryConflict)
}

#[cfg(unix)]
fn apply_verified_update_unix(
    target: &Path,
    artifact: &[u8],
    signed: &SignedUpdateManifest,
    interrupt: InterruptPoint,
) -> Result<(), ReleaseError> {
    use std::os::{fd::AsRawFd, unix::fs::MetadataExt};
    let update = UnixUpdateDirectory::open(target)?;
    let _lock = update.lock()?;
    recover_update_unix_locked(&update)?;
    let mut original_file = update.open_existing(&update.target, "target", false)?;
    let original_metadata = original_file.metadata()?;
    if original_metadata.mode() & 0o022 != 0 {
        return Err(ReleaseError::UnsafeUpdatePath(
            "update target must not be group/world writable".into(),
        ));
    }
    let original_sha256 = sha256_reader(&mut original_file)?;
    update.create_exclusive(
        &update.stage,
        "stage",
        artifact,
        (original_metadata.mode() & 0o777) as libc::mode_t,
    )?;
    let journal = UpdateJournal {
        state: UpdateJournalState::Prepared,
        original_sha256,
        replacement_sha256: sha256(artifact),
        version: signed.manifest.version.clone(),
    };
    update.replace_journal(&journal)?;
    let current = update
        .stat(&update.target)?
        .ok_or(ReleaseError::RecoveryConflict)?;
    if current.st_dev as u64 != original_metadata.dev() || current.st_ino != original_metadata.ino()
    {
        return Err(ReleaseError::UpdateParentChanged);
    }
    update.rename(&update.target, &update.backup)?;
    if interrupt == InterruptPoint::AfterBackup {
        return Err(ReleaseError::SimulatedInterruption);
    }
    update.rename(&update.stage, &update.target)?;
    let mut installed = update.open_existing(&update.target, "installed target", false)?;
    installed.sync_all()?;
    if unsafe { libc::fsync(update.directory.as_raw_fd()) } < 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    if interrupt == InterruptPoint::AfterInstall {
        return Err(ReleaseError::SimulatedInterruption);
    }
    #[cfg(test)]
    if interrupt == InterruptPoint::CorruptAfterInstall {
        // Model an external post-install modification without weakening the
        // production verification handle, which intentionally stays read-only.
        drop(installed);
        let mut corruptor = update.open_existing(&update.target, "installed target", true)?;
        corruptor.set_len(0)?;
        corruptor.write_all(b"corrupted")?;
        corruptor.sync_all()?;
        drop(corruptor);
        installed = update.open_existing(&update.target, "installed target", false)?;
    }
    if sha256_reader(&mut installed)? != journal.replacement_sha256 {
        drop(installed);
        update.remove(&update.target, "target")?;
        update.rename(&update.backup, &update.target)?;
        update.remove(&update.journal, "journal")?;
        update.directory.sync_all()?;
        return Err(ReleaseError::UpdatePostInstallVerificationFailed);
    }
    update.replace_journal(&UpdateJournal {
        state: UpdateJournalState::Installed,
        ..journal
    })?;
    update.remove(&update.backup, "backup")?;
    update.remove(&update.journal, "journal")?;
    update.directory.sync_all()?;
    update.verify_parent()
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum InterruptPoint {
    None,
    AfterBackup,
    AfterInstall,
    #[cfg(test)]
    CorruptAfterInstall,
}

fn apply_verified_update(
    target: &Path,
    artifact: &[u8],
    signed: &SignedUpdateManifest,
    interrupt: InterruptPoint,
) -> Result<(), ReleaseError> {
    #[cfg(unix)]
    {
        apply_verified_update_unix(target, artifact, signed, interrupt)
    }
    #[cfg(not(unix))]
    {
        apply_verified_update_portable(target, artifact, signed, interrupt)
    }
}

#[cfg(not(unix))]
fn apply_verified_update_portable(
    target: &Path,
    artifact: &[u8],
    signed: &SignedUpdateManifest,
    interrupt: InterruptPoint,
) -> Result<(), ReleaseError> {
    reject_symlink_target(target)?;
    let paths = UpdatePaths::new(target)?;
    fs::create_dir_all(&paths.directory)?;
    let lock = fs::OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .truncate(false)
        .open(&paths.lock)?;
    lock.try_lock_exclusive()
        .map_err(|_| ReleaseError::UpdateLocked)?;
    recover_update_unlocked(target, &paths)?;
    let original_sha256 = sha256_reader(&mut File::open(target)?)?;
    write_synced(&paths.stage, artifact)?;
    copy_permissions(target, &paths.stage)?;
    let journal = UpdateJournal {
        state: UpdateJournalState::Prepared,
        original_sha256,
        replacement_sha256: sha256(artifact),
        version: signed.manifest.version.clone(),
    };
    write_json_atomic(&paths.journal, &journal)?;
    fs::rename(target, &paths.backup)?;
    sync_directory(&paths.directory)?;
    if interrupt == InterruptPoint::AfterBackup {
        return Err(ReleaseError::SimulatedInterruption);
    }
    fs::rename(&paths.stage, target)?;
    sync_directory(&paths.directory)?;
    if interrupt == InterruptPoint::AfterInstall {
        return Err(ReleaseError::SimulatedInterruption);
    }
    #[cfg(test)]
    if interrupt == InterruptPoint::CorruptAfterInstall {
        fs::write(target, b"corrupted")?;
    }
    if hash_if_exists(target)?.as_deref() != Some(&journal.replacement_sha256) {
        remove_if_exists(target)?;
        fs::rename(&paths.backup, target)?;
        remove_if_exists(&paths.journal)?;
        sync_directory(&paths.directory)?;
        return Err(ReleaseError::UpdatePostInstallVerificationFailed);
    }
    write_json_atomic(
        &paths.journal,
        &UpdateJournal {
            state: UpdateJournalState::Installed,
            ..journal
        },
    )?;
    remove_if_exists(&paths.backup)?;
    remove_if_exists(&paths.journal)?;
    sync_directory(&paths.directory)?;
    Ok(())
}

#[cfg(not(unix))]
struct UpdatePaths {
    directory: PathBuf,
    stage: PathBuf,
    backup: PathBuf,
    journal: PathBuf,
    lock: PathBuf,
}
#[cfg(not(unix))]
impl UpdatePaths {
    fn new(target: &Path) -> Result<Self, ReleaseError> {
        let directory = target
            .parent()
            .ok_or(ReleaseError::InvalidTarget)?
            .to_path_buf();
        let name = target
            .file_name()
            .ok_or(ReleaseError::InvalidTarget)?
            .to_string_lossy();
        Ok(Self {
            stage: directory.join(format!(".{name}.update-stage")),
            backup: directory.join(format!(".{name}.update-backup")),
            journal: directory.join(format!(".{name}.update-journal.json")),
            lock: directory.join(format!(".{name}.update.lock")),
            directory,
        })
    }
}

fn write_json_atomic(path: &Path, value: &impl Serialize) -> Result<(), ReleaseError> {
    let parent = path.parent().ok_or(ReleaseError::InvalidTarget)?;
    fs::create_dir_all(parent)?;
    let parent_identity = PrivateStateParentIdentity::capture(parent)?;
    let bytes = serde_json::to_vec_pretty(value)?;
    if u64::try_from(bytes.len()).unwrap_or(u64::MAX) > MAX_UPDATE_JOURNAL_BYTES {
        return Err(ReleaseError::InputTooLarge {
            label: "private JSON state",
            limit: MAX_UPDATE_JOURNAL_BYTES,
        });
    }
    static STAGE_SEQUENCE: AtomicU64 = AtomicU64::new(1);
    let name = path
        .file_name()
        .and_then(std::ffi::OsStr::to_str)
        .unwrap_or("state");
    let mut staged = None;
    for _ in 0..32 {
        let sequence = STAGE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let candidate = parent.join(format!(".{name}.{}.{}.stage", std::process::id(), sequence));
        match write_synced(&candidate, &bytes) {
            Ok(()) => {
                staged = Some(candidate);
                break;
            }
            Err(ReleaseError::Io(error)) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(error),
        }
    }
    let stage = staged.ok_or_else(|| {
        ReleaseError::UnsafeStatePath("could not allocate unique staging file".into())
    })?;
    let result = (|| {
        parent_identity.verify(parent)?;
        fs::rename(&stage, path)?;
        sync_directory(parent)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&stage);
    }
    result
}

struct PrivateStateParentIdentity {
    canonical: PathBuf,
    metadata: fs::Metadata,
}

impl PrivateStateParentIdentity {
    fn capture(parent: &Path) -> Result<Self, ReleaseError> {
        let metadata = fs::symlink_metadata(parent)?;
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            return Err(ReleaseError::UnsafeStatePath(parent.display().to_string()));
        }
        Ok(Self {
            canonical: fs::canonicalize(parent)?,
            metadata,
        })
    }

    fn verify(&self, parent: &Path) -> Result<(), ReleaseError> {
        let current = fs::symlink_metadata(parent)?;
        if !current.is_dir()
            || current.file_type().is_symlink()
            || fs::canonicalize(parent)? != self.canonical
        {
            return Err(ReleaseError::StateParentChanged);
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            if current.dev() != self.metadata.dev() || current.ino() != self.metadata.ino() {
                return Err(ReleaseError::StateParentChanged);
            }
        }
        Ok(())
    }
}

fn write_synced(path: &Path, bytes: &[u8]) -> Result<(), ReleaseError> {
    let mut options = fs::OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path)?;
    if let Err(error) = file.write_all(bytes).and_then(|()| file.sync_all()) {
        drop(file);
        let _ = fs::remove_file(path);
        return Err(error.into());
    }
    Ok(())
}

#[cfg(not(unix))]
fn copy_permissions(source: &Path, destination: &Path) -> Result<(), ReleaseError> {
    fs::set_permissions(destination, fs::metadata(source)?.permissions())?;
    Ok(())
}

fn sync_directory(path: &Path) -> Result<(), ReleaseError> {
    #[cfg(unix)]
    File::open(path)?.sync_all()?;
    Ok(())
}

#[cfg(not(unix))]
fn hash_if_exists(path: &Path) -> Result<Option<String>, ReleaseError> {
    match File::open(path) {
        Ok(mut file) => Ok(Some(sha256_reader(&mut file)?)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}

#[cfg(not(unix))]
fn reject_symlink_target(path: &Path) -> Result<(), ReleaseError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            Err(ReleaseError::SymlinkTargetRejected)
        }
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

#[cfg(not(unix))]
fn remove_if_exists(path: &Path) -> Result<(), ReleaseError> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

pub fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn sha256_reader(reader: &mut impl Read) -> Result<String, ReleaseError> {
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

fn read_limited(
    reader: impl Read,
    limit: u64,
    label: &'static str,
) -> Result<Vec<u8>, ReleaseError> {
    let mut bytes = Vec::new();
    reader
        .take(limit.saturating_add(1))
        .read_to_end(&mut bytes)?;
    if u64::try_from(bytes.len()).unwrap_or(u64::MAX) > limit {
        return Err(ReleaseError::InputTooLarge { label, limit });
    }
    Ok(bytes)
}

pub fn decode_public_key(encoded: &str) -> Result<[u8; 32], ReleaseError> {
    STANDARD
        .decode(encoded)
        .map_err(|_| ReleaseError::InvalidPublicKey)?
        .try_into()
        .map_err(|_| ReleaseError::InvalidPublicKey)
}

#[derive(Debug, Error)]
pub enum ReleaseError {
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error("{label} exceeds the safe {limit}-byte limit")]
    InputTooLarge { label: &'static str, limit: u64 },
    #[error("credential store failure: {0}")]
    Credential(String),
    #[error("provider must be 'anthropic' or 'openai'")]
    InvalidProvider,
    #[error("credential cannot be empty")]
    EmptyCredential,
    #[error("credential must be at most 65536 bytes and contain no control characters")]
    InvalidCredential,
    #[error("unsupported shell; expected bash, zsh, or fish")]
    UnsupportedShell,
    #[error("update signature is invalid")]
    InvalidSignature,
    #[error("update public key is invalid")]
    InvalidPublicKey,
    #[error("update artifact checksum or size does not match manifest")]
    ChecksumMismatch,
    #[error("update version is invalid")]
    InvalidVersion,
    #[error("update would not advance the installed version")]
    RollbackRejected,
    #[error("update target is invalid")]
    InvalidTarget,
    #[error("update channel must be stable, beta, or preview")]
    InvalidChannel,
    #[error("update channel manifest version is unsupported")]
    UnsupportedChannelManifestVersion,
    #[error("update manifest version is unsupported")]
    UnsupportedUpdateManifestVersion,
    #[error("self-update is unsupported on this build target")]
    UnsupportedUpdateTarget,
    #[error("update artifact kind is unsupported")]
    UnsupportedUpdateArtifactKind,
    #[error("update targets {actual}, but this executable requires {expected}")]
    UpdateTargetMismatch {
        expected: &'static str,
        actual: String,
    },
    #[error("signed update candidate failed executable validation: {0}")]
    UpdateSelfCheckFailed(String),
    #[error("installed update bytes failed verification and the previous executable was restored")]
    UpdatePostInstallVerificationFailed,
    #[error("online update manifest sources must use HTTPS")]
    InsecureManifestSource,
    #[error("offline update discovery cannot use a remote manifest source")]
    OfflineRemoteSource,
    #[error("another update holds the installation lock")]
    UpdateLocked,
    #[error("update recovery found conflicting installation files")]
    RecoveryConflict,
    #[error("refusing to replace an update target through a symbolic link")]
    SymlinkTargetRejected,
    #[error("unsafe update filesystem path: {0}")]
    UnsafeUpdatePath(String),
    #[error("unsafe private-state filesystem path: {0}")]
    UnsafeStatePath(String),
    #[error("private-state parent directory changed during the transaction")]
    StateParentChanged,
    #[error("update parent directory changed during the transaction")]
    UpdateParentChanged,
    #[error("simulated update interruption")]
    SimulatedInterruption,
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    use tempfile::tempdir;

    fn signed(artifact: &[u8], version: &str) -> (SignedUpdateManifest, [u8; 32]) {
        let key = SigningKey::from_bytes(&[7; 32]);
        let manifest = UpdateManifest {
            schema_version: UPDATE_MANIFEST_SCHEMA_VERSION,
            version: version.into(),
            target_triple: current_update_target_triple().unwrap().into(),
            artifact_kind: UpdateArtifactKind::StandaloneExecutable,
            artifact_sha256: sha256(artifact),
            artifact_size: artifact.len() as u64,
        };
        let bytes = serde_json::to_vec(&manifest).unwrap();
        let signature = STANDARD.encode(key.sign(&bytes).to_bytes());
        (
            SignedUpdateManifest {
                manifest,
                signature,
            },
            key.verifying_key().to_bytes(),
        )
    }

    #[test]
    fn credentials_never_enter_registry_and_store_is_injectable() {
        let root = tempdir().unwrap();
        let path = root.path().join("auth.json");
        let store = MemoryCredentialStore::default();
        auth_login(&path, &store, "openai", "top-secret").unwrap();
        assert!(!fs::read_to_string(&path).unwrap().contains("top-secret"));
        assert_eq!(store.get("openai").unwrap().as_deref(), Some("top-secret"));
        assert_eq!(
            auth_list(&path, &store).unwrap(),
            vec![AuthProfile {
                provider: "openai".into(),
                credential_present: true
            }]
        );
        auth_logout(&path, &store, "openai").unwrap();
        assert!(store.get("openai").unwrap().is_none());
    }

    #[test]
    fn invalid_credentials_are_rejected_before_keyring_or_registry_mutation() {
        let root = tempdir().unwrap();
        let path = root.path().join("auth.json");
        let store = MemoryCredentialStore::default();

        for secret in [
            "line\nbreak".to_owned(),
            "x".repeat(MAX_CREDENTIAL_BYTES + 1),
        ] {
            assert!(matches!(
                auth_login(&path, &store, "openai", &secret),
                Err(ReleaseError::InvalidCredential)
            ));
            assert_eq!(store.get("openai").unwrap(), None);
            assert!(!path.exists());
        }
    }

    #[test]
    fn memory_credential_store_recovers_from_mutex_poisoning() {
        let store = MemoryCredentialStore::default();
        let poisoner = store.clone();
        assert!(
            std::thread::spawn(move || {
                let _guard = poisoner.0.lock().unwrap();
                panic!("poison credential store");
            })
            .join()
            .is_err()
        );

        store.set("openai", "secret").unwrap();
        assert_eq!(store.get("openai").unwrap().as_deref(), Some("secret"));
        store.delete("openai").unwrap();
        assert_eq!(store.get("openai").unwrap(), None);
    }

    #[cfg(unix)]
    #[test]
    fn auth_registry_ignores_predictable_stage_symlink() {
        use std::os::unix::fs::symlink;
        let root = tempdir().unwrap();
        let registry = root.path().join("auth.json");
        let victim = root.path().join("victim");
        fs::write(&victim, b"do-not-touch").unwrap();
        symlink(&victim, root.path().join("auth.stage")).unwrap();
        let store = MemoryCredentialStore::default();

        auth_login(&registry, &store, "openai", "secret").unwrap();
        assert_eq!(fs::read(victim).unwrap(), b"do-not-touch");
        assert_eq!(store.get("openai").unwrap().as_deref(), Some("secret"));
        assert_eq!(auth_list(&registry, &store).unwrap().len(), 1);
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            fs::metadata(&registry).unwrap().permissions().mode() & 0o077,
            0
        );
    }

    #[cfg(unix)]
    #[test]
    fn auth_registry_reader_rejects_symlinks_hardlinks_and_sparse_files() {
        use std::os::unix::fs::symlink;
        let root = tempdir().unwrap();
        let source = root.path().join("source.json");
        fs::write(&source, br#"{"providers":["openai"]}"#).unwrap();
        let symlink_path = root.path().join("symlink.json");
        symlink(&source, &symlink_path).unwrap();
        let hardlink_path = root.path().join("hardlink.json");
        fs::hard_link(&source, &hardlink_path).unwrap();
        let sparse_path = root.path().join("sparse.json");
        File::create(&sparse_path)
            .unwrap()
            .set_len(MAX_AUTH_REGISTRY_BYTES + 1)
            .unwrap();
        let store = MemoryCredentialStore::default();

        assert!(auth_list(&symlink_path, &store).is_err());
        assert!(auth_list(&hardlink_path, &store).is_err());
        assert!(auth_list(&sparse_path, &store).is_err());
    }

    #[test]
    fn auth_registry_revalidates_provider_scope_before_keyring_access() {
        let root = tempdir().unwrap();
        let path = root.path().join("auth.json");
        fs::write(&path, br#"{"providers":["unrelated-keyring-account"]}"#).unwrap();
        let store = MemoryCredentialStore::default();
        store
            .set("unrelated-keyring-account", "must-not-disclose")
            .unwrap();

        assert!(matches!(
            auth_list(&path, &store),
            Err(ReleaseError::InvalidProvider)
        ));
    }

    #[cfg(unix)]
    #[test]
    fn auth_registry_rejects_symlinked_parent_and_rolls_back_keyring() {
        use std::os::unix::fs::symlink;
        let root = tempdir().unwrap();
        let outside = tempdir().unwrap();
        let linked = root.path().join("config");
        symlink(outside.path(), &linked).unwrap();
        let store = MemoryCredentialStore::default();

        assert!(auth_login(&linked.join("auth.json"), &store, "openai", "secret").is_err());
        assert_eq!(store.get("openai").unwrap(), None);
        assert!(!outside.path().join("auth.json").exists());
    }

    #[cfg(unix)]
    #[test]
    fn keyring_registry_failures_roll_back_login_and_logout() {
        use std::os::unix::fs::PermissionsExt;

        let root = tempdir().unwrap();
        let path = root.path().join("auth.json");
        let store = MemoryCredentialStore::default();
        auth_login(&path, &store, "openai", "old-secret").unwrap();
        fs::set_permissions(root.path(), fs::Permissions::from_mode(0o500)).unwrap();
        let login = auth_login(&path, &store, "openai", "new-secret");
        assert!(login.is_err());
        assert_eq!(store.get("openai").unwrap().as_deref(), Some("old-secret"));
        let logout = auth_logout(&path, &store, "openai");
        assert!(logout.is_err());
        assert_eq!(store.get("openai").unwrap().as_deref(), Some("old-secret"));
        fs::set_permissions(root.path(), fs::Permissions::from_mode(0o700)).unwrap();
    }

    #[test]
    fn signed_update_rejects_tamper_and_downgrade() {
        let artifact = b"new binary";
        let (signed, public) = signed(artifact, "2.0.0");
        assert!(matches!(
            verify_update(&signed, b"tampered", &public, "1.0.0"),
            Err(ReleaseError::ChecksumMismatch)
        ));
        assert!(matches!(
            verify_update(&signed, artifact, &public, "2.0.0"),
            Err(ReleaseError::RollbackRejected)
        ));
        let mut bad = signed.clone();
        bad.manifest.version = "3.0.0".into();
        assert!(matches!(
            verify_update(&bad, artifact, &public, "1.0.0"),
            Err(ReleaseError::InvalidSignature)
        ));
    }

    #[test]
    fn signed_update_rejects_wrong_platform_before_artifact_or_target_mutation() {
        let root = tempdir().unwrap();
        let target = root.path().join("cloop");
        let missing_artifact = root.path().join("missing-candidate");
        fs::write(&target, b"known-good").unwrap();
        let key = SigningKey::from_bytes(&[31; 32]);
        let current = current_update_target_triple().unwrap();
        let wrong = if current == "x86_64-unknown-linux-gnu" {
            "aarch64-unknown-linux-gnu"
        } else {
            "x86_64-unknown-linux-gnu"
        };
        let manifest = UpdateManifest {
            schema_version: UPDATE_MANIFEST_SCHEMA_VERSION,
            version: "2.0.0".into(),
            target_triple: wrong.into(),
            artifact_kind: UpdateArtifactKind::StandaloneExecutable,
            artifact_sha256: sha256(b"candidate"),
            artifact_size: b"candidate".len() as u64,
        };
        let signed = SignedUpdateManifest {
            signature: STANDARD
                .encode(key.sign(&serde_json::to_vec(&manifest).unwrap()).to_bytes()),
            manifest,
        };

        assert!(matches!(
            apply_update(
                &target,
                &missing_artifact,
                &signed,
                &key.verifying_key().to_bytes(),
                "1.0.0"
            ),
            Err(ReleaseError::UpdateTargetMismatch { .. })
        ));
        assert_eq!(fs::read(&target).unwrap(), b"known-good");
        assert_eq!(fs::read_dir(root.path()).unwrap().count(), 1);
    }

    #[test]
    fn legacy_unsigned_shape_and_signed_target_tampering_fail_closed() {
        let legacy = br#"{"version":"2.0.0","artifactSha256":"00","artifactSize":1}"#;
        assert!(serde_json::from_slice::<UpdateManifest>(legacy).is_err());

        let artifact = b"candidate";
        let (mut signed, public) = signed(artifact, "2.0.0");
        signed.manifest.target_triple = "aarch64-unknown-linux-gnu".into();
        assert!(matches!(
            verify_update(&signed, artifact, &public, "1.0.0"),
            Err(ReleaseError::InvalidSignature)
        ));
    }

    #[cfg(unix)]
    #[test]
    fn failed_candidate_self_check_preserves_target_without_sidecars() {
        use std::os::unix::fs::PermissionsExt;

        let root = tempdir().unwrap();
        let target = root.path().join("cloop");
        let artifact_path = root.path().join("candidate");
        let artifact = b"#!/bin/sh\nprintf 'not-the-signed-version\\n'\n";
        fs::write(&target, b"known-good").unwrap();
        fs::write(&artifact_path, artifact).unwrap();
        fs::set_permissions(&artifact_path, fs::Permissions::from_mode(0o755)).unwrap();
        let (signed, public) = signed(artifact, "2.0.0");

        assert!(matches!(
            apply_update_with_self_check(&target, &artifact_path, &signed, &public, "1.0.0"),
            Err(ReleaseError::UpdateSelfCheckFailed(_))
        ));
        assert_eq!(fs::read(&target).unwrap(), b"known-good");
        let names = fs::read_dir(root.path())
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect::<Vec<_>>();
        assert_eq!(names.len(), 2);
    }

    #[test]
    fn update_rejects_oversized_artifact_before_reading_it() {
        let root = tempdir().unwrap();
        let target = root.path().join("cloop");
        let missing_artifact = root.path().join("missing-artifact");
        fs::write(&target, b"old").unwrap();
        let key = SigningKey::from_bytes(&[9; 32]);
        let manifest = UpdateManifest {
            schema_version: UPDATE_MANIFEST_SCHEMA_VERSION,
            version: "2.0.0".into(),
            target_triple: current_update_target_triple().unwrap().into(),
            artifact_kind: UpdateArtifactKind::StandaloneExecutable,
            artifact_sha256: sha256(b"unused"),
            artifact_size: MAX_UPDATE_ARTIFACT_BYTES + 1,
        };
        let signature =
            STANDARD.encode(key.sign(&serde_json::to_vec(&manifest).unwrap()).to_bytes());
        let signed = SignedUpdateManifest {
            manifest,
            signature,
        };

        assert!(matches!(
            apply_update(
                &target,
                &missing_artifact,
                &signed,
                &key.verifying_key().to_bytes(),
                "1.0.0"
            ),
            Err(ReleaseError::InputTooLarge {
                label: "update artifact",
                limit: MAX_UPDATE_ARTIFACT_BYTES
            })
        ));
        assert_eq!(fs::read(target).unwrap(), b"old");
    }

    #[test]
    fn recovery_rejects_an_oversized_journal_without_mutation() {
        let root = tempdir().unwrap();
        let target = root.path().join("cloop");
        fs::write(&target, b"old").unwrap();
        let journal = root.path().join(".cloop.update-journal.json");
        let oversized = File::create(&journal).unwrap();
        oversized.set_len(MAX_UPDATE_JOURNAL_BYTES + 1).unwrap();

        assert!(matches!(
            recover_update(&target),
            Err(ReleaseError::InputTooLarge {
                label: "update journal",
                limit: MAX_UPDATE_JOURNAL_BYTES
            })
        ));
        assert_eq!(fs::read(target).unwrap(), b"old");
    }

    #[test]
    fn interrupted_update_recovers_original_or_completed_replacement() {
        let root = tempdir().unwrap();
        let target = root.path().join("cloop");
        fs::write(&target, b"old").unwrap();
        let (signed, _) = signed(b"new", "2.0.0");
        assert!(matches!(
            apply_verified_update(&target, b"new", &signed, InterruptPoint::AfterBackup),
            Err(ReleaseError::SimulatedInterruption)
        ));
        assert!(recover_update(&target).unwrap());
        assert_eq!(fs::read(&target).unwrap(), b"old");

        assert!(matches!(
            apply_verified_update(&target, b"new", &signed, InterruptPoint::AfterInstall),
            Err(ReleaseError::SimulatedInterruption)
        ));
        assert!(recover_update(&target).unwrap());
        assert_eq!(fs::read(&target).unwrap(), b"new");
    }

    #[test]
    fn failed_post_install_hash_restores_the_previous_executable() {
        let root = tempdir().unwrap();
        let target = root.path().join("cloop");
        fs::write(&target, b"known-good").unwrap();
        let (signed, _) = signed(b"candidate", "2.0.0");

        assert!(matches!(
            apply_verified_update(
                &target,
                b"candidate",
                &signed,
                InterruptPoint::CorruptAfterInstall
            ),
            Err(ReleaseError::UpdatePostInstallVerificationFailed)
        ));
        assert_eq!(fs::read(&target).unwrap(), b"known-good");
        assert!(!root.path().join(".cloop.update-backup").exists());
        assert!(!root.path().join(".cloop.update-journal.json").exists());
    }

    #[cfg(unix)]
    #[test]
    fn update_refuses_symlink_target_without_touching_destination() {
        use std::os::unix::fs::symlink;

        let root = tempdir().unwrap();
        let destination = root.path().join("owned-cloop");
        let target = root.path().join("cloop");
        let artifact_path = root.path().join("candidate");
        fs::write(&destination, b"old").unwrap();
        fs::write(&artifact_path, b"new").unwrap();
        symlink(&destination, &target).unwrap();
        let (signed, public) = signed(b"new", "2.0.0");
        assert!(matches!(
            apply_update(&target, &artifact_path, &signed, &public, "1.0.0"),
            Err(ReleaseError::SymlinkTargetRejected)
        ));
        assert_eq!(fs::read(&destination).unwrap(), b"old");
        assert!(
            fs::symlink_metadata(&target)
                .unwrap()
                .file_type()
                .is_symlink()
        );
    }

    #[cfg(unix)]
    #[test]
    fn update_rejects_hostile_sidecar_links_hardlinks_and_permissions() {
        use std::os::unix::fs::{PermissionsExt, symlink};

        for sidecar in [
            ".cloop.update-stage",
            ".cloop.update-backup",
            ".cloop.update-journal.json",
            ".cloop.update-journal.stage",
            ".cloop.update.lock",
        ] {
            let root = tempdir().unwrap();
            let target = root.path().join("cloop");
            let victim = root.path().join("victim");
            fs::write(&target, b"old").unwrap();
            fs::write(&victim, b"do-not-touch").unwrap();
            symlink(&victim, root.path().join(sidecar)).unwrap();
            let (signed, _) = signed(b"new", "2.0.0");
            assert!(apply_verified_update(&target, b"new", &signed, InterruptPoint::None).is_err());
            assert_eq!(
                fs::read(&target).unwrap(),
                b"old",
                "target changed for {sidecar}"
            );
            assert_eq!(
                fs::read(&victim).unwrap(),
                b"do-not-touch",
                "victim changed for {sidecar}"
            );
        }

        let root = tempdir().unwrap();
        let target = root.path().join("cloop");
        let alias = root.path().join("cloop-hardlink");
        fs::write(&target, b"old").unwrap();
        fs::hard_link(&target, &alias).unwrap();
        let (hardlink_manifest, _) = signed(b"new", "2.0.0");
        assert!(matches!(
            apply_verified_update(&target, b"new", &hardlink_manifest, InterruptPoint::None),
            Err(ReleaseError::UnsafeUpdatePath(_))
        ));
        assert_eq!(fs::read(&alias).unwrap(), b"old");

        let root = tempdir().unwrap();
        let target = root.path().join("cloop");
        let victim = root.path().join("victim");
        fs::write(&target, b"old").unwrap();
        fs::write(&victim, b"do-not-touch").unwrap();
        fs::hard_link(&victim, root.path().join(".cloop.update-stage")).unwrap();
        let (sidecar_manifest, _) = signed(b"new", "2.0.0");
        assert!(matches!(
            apply_verified_update(&target, b"new", &sidecar_manifest, InterruptPoint::None),
            Err(ReleaseError::UnsafeUpdatePath(_))
        ));
        assert_eq!(fs::read(&victim).unwrap(), b"do-not-touch");

        let root = tempdir().unwrap();
        let target = root.path().join("cloop");
        fs::write(&target, b"old").unwrap();
        fs::set_permissions(&target, fs::Permissions::from_mode(0o777)).unwrap();
        let (permission_manifest, _) = signed(b"new", "2.0.0");
        assert!(matches!(
            apply_verified_update(&target, b"new", &permission_manifest, InterruptPoint::None),
            Err(ReleaseError::UnsafeUpdatePath(_))
        ));

        let root = tempdir().unwrap();
        let install = root.path().join("group-writable-install");
        fs::create_dir(&install).unwrap();
        fs::set_permissions(&install, fs::Permissions::from_mode(0o770)).unwrap();
        let target = install.join("cloop");
        fs::write(&target, b"old").unwrap();
        let (directory_manifest, _) = signed(b"new", "2.0.0");
        assert!(matches!(
            apply_verified_update(&target, b"new", &directory_manifest, InterruptPoint::None),
            Err(ReleaseError::UnsafeUpdatePath(_))
        ));
        assert_eq!(fs::read(&target).unwrap(), b"old");
    }

    #[cfg(unix)]
    #[test]
    fn update_detects_parent_swap_and_serializes_apply_recovery() {
        let root = tempdir().unwrap();
        let install = root.path().join("install");
        fs::create_dir(&install).unwrap();
        let target = install.join("cloop");
        fs::write(&target, b"old").unwrap();
        let update = UnixUpdateDirectory::open(&target).unwrap();
        let _lock = update.lock().unwrap();
        assert!(matches!(
            recover_update(&target),
            Err(ReleaseError::UpdateLocked)
        ));
        drop(_lock);

        let moved = root.path().join("install-moved");
        fs::rename(&install, &moved).unwrap();
        fs::create_dir(&install).unwrap();
        assert!(matches!(
            update.verify_parent(),
            Err(ReleaseError::UpdateParentChanged)
        ));
        assert_eq!(fs::read(moved.join("cloop")).unwrap(), b"old");
    }

    #[cfg(unix)]
    #[test]
    fn update_path_safety_reports_dirfd_contract() {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        assert_eq!(
            update_path_safety(),
            "dirfd-openat-nofollow-single-link-owner-checked"
        );
        let root = tempdir().unwrap();
        let target = root.path().join("cloop");
        fs::write(&target, b"old").unwrap();
        let update = UnixUpdateDirectory::open(&target).unwrap();
        let mut stat = update.stat(&update.target).unwrap().unwrap();
        stat.st_uid = unsafe { libc::geteuid() }.saturating_add(1);
        assert!(matches!(
            update.validate_stat("target", &stat),
            Err(ReleaseError::UnsafeUpdatePath(_))
        ));
        fs::set_permissions(&target, fs::Permissions::from_mode(0o751)).unwrap();
        let (manifest, _) = signed(b"new", "2.0.0");
        apply_verified_update(&target, b"new", &manifest, InterruptPoint::None).unwrap();
        assert_eq!(fs::metadata(&target).unwrap().mode() & 0o777, 0o751);
    }

    #[test]
    fn completion_and_install_detection_cover_public_contract() {
        let commands = [
            "ask",
            "run",
            "resume",
            "fork",
            "sessions",
            "status",
            "undo",
            "redo",
            "jobs",
            "review",
            "prove",
            "land",
            "auth",
            "setup",
            "models",
            "migrate",
            "config",
            "privacy",
            "lsp",
            "formatter",
            "mcp",
            "serve",
            "doctor",
            "update",
            "completion",
        ];
        for shell in ["bash", "zsh", "fish"] {
            let completion = shell_completion(shell).unwrap();
            assert!(completion.contains("cloop"));
            for command in commands {
                assert!(completion.contains(command), "{shell} omitted {command}");
            }
        }
        assert_eq!(
            detect_install_method(Path::new("/opt/homebrew/Cellar/changeloop/1/bin/cloop")),
            InstallMethod::Homebrew
        );
        assert_eq!(
            detect_install_method(Path::new("/Users/a/.cargo/bin/cloop")),
            InstallMethod::Cargo
        );
    }

    #[test]
    fn channel_discovery_verifies_signature_before_source_or_version_selection() {
        let key = SigningKey::from_bytes(&[9; 32]);
        let target = current_update_target_triple().unwrap();
        let manifest = UpdateChannelManifest {
            version: UPDATE_MANIFEST_SCHEMA_VERSION,
            releases: vec![
                UpdateRelease {
                    version: "1.1.0".into(),
                    channel: "stable".into(),
                    target_triple: target.into(),
                    artifact_kind: UpdateArtifactKind::StandaloneExecutable,
                    manifest_source: "https://updates.example/stable-1.1.json".into(),
                    artifact_source: "https://updates.example/cloop-1.1".into(),
                },
                UpdateRelease {
                    version: "1.2.0".into(),
                    channel: "stable".into(),
                    target_triple: target.into(),
                    artifact_kind: UpdateArtifactKind::StandaloneExecutable,
                    manifest_source: "https://updates.example/stable-1.2.json".into(),
                    artifact_source: "https://updates.example/cloop-1.2".into(),
                },
            ],
        };
        let signature =
            STANDARD.encode(key.sign(&serde_json::to_vec(&manifest).unwrap()).to_bytes());
        let signed = SignedUpdateChannelManifest {
            manifest,
            signature,
        };
        let discovered = discover_update(
            &signed,
            &key.verifying_key().to_bytes(),
            "1.0.0",
            "stable",
            false,
        )
        .unwrap()
        .unwrap();
        assert_eq!(discovered.version, "1.2.0");

        let mut tampered = signed.clone();
        tampered.manifest.releases[0].version = "9.0.0".into();
        assert!(matches!(
            discover_update(
                &tampered,
                &key.verifying_key().to_bytes(),
                "1.0.0",
                "stable",
                false
            ),
            Err(ReleaseError::InvalidSignature)
        ));

        let unsupported_manifest = UpdateChannelManifest {
            version: UPDATE_MANIFEST_SCHEMA_VERSION + 1,
            releases: signed.manifest.releases.clone(),
        };
        let unsupported = SignedUpdateChannelManifest {
            signature: STANDARD.encode(
                key.sign(&serde_json::to_vec(&unsupported_manifest).unwrap())
                    .to_bytes(),
            ),
            manifest: unsupported_manifest,
        };
        assert!(matches!(
            discover_update(
                &unsupported,
                &key.verifying_key().to_bytes(),
                "1.0.0",
                "stable",
                false
            ),
            Err(ReleaseError::UnsupportedChannelManifestVersion)
        ));

        let legacy_manifest = UpdateChannelManifest {
            version: 1,
            releases: signed.manifest.releases.clone(),
        };
        let legacy = SignedUpdateChannelManifest {
            signature: STANDARD.encode(
                key.sign(&serde_json::to_vec(&legacy_manifest).unwrap())
                    .to_bytes(),
            ),
            manifest: legacy_manifest,
        };
        assert!(matches!(
            discover_update(
                &legacy,
                &key.verifying_key().to_bytes(),
                "1.0.0",
                "stable",
                false
            ),
            Err(ReleaseError::UnsupportedChannelManifestVersion)
        ));
    }

    #[test]
    fn offline_discovery_requires_explicit_local_sources() {
        let key = SigningKey::from_bytes(&[11; 32]);
        let manifest = UpdateChannelManifest {
            version: UPDATE_MANIFEST_SCHEMA_VERSION,
            releases: vec![UpdateRelease {
                version: "2.0.0".into(),
                channel: "stable".into(),
                target_triple: current_update_target_triple().unwrap().into(),
                artifact_kind: UpdateArtifactKind::StandaloneExecutable,
                manifest_source: "./signed-release.json".into(),
                artifact_source: "./cloop".into(),
            }],
        };
        let signature =
            STANDARD.encode(key.sign(&serde_json::to_vec(&manifest).unwrap()).to_bytes());
        let signed = SignedUpdateChannelManifest {
            manifest,
            signature,
        };
        assert_eq!(
            discover_update(
                &signed,
                &key.verifying_key().to_bytes(),
                "1.0.0",
                "stable",
                true
            )
            .unwrap()
            .unwrap()
            .manifest_source,
            "./signed-release.json"
        );
        assert!(matches!(
            discover_update(
                &signed,
                &key.verifying_key().to_bytes(),
                "1.0.0",
                "stable",
                false
            ),
            Err(ReleaseError::InsecureManifestSource)
        ));
    }

    #[test]
    fn update_discovery_rejects_malformed_or_credential_bearing_sources() {
        let key = SigningKey::from_bytes(&[12; 32]);
        for source in [
            "https://",
            "https://user:secret@updates.example/release.json",
            "https://updates.example/release.json#unsigned-selection",
            "https://updates.example/line\nbreak",
        ] {
            let manifest = UpdateChannelManifest {
                version: UPDATE_MANIFEST_SCHEMA_VERSION,
                releases: vec![UpdateRelease {
                    version: "2.0.0".into(),
                    channel: "stable".into(),
                    target_triple: current_update_target_triple().unwrap().into(),
                    artifact_kind: UpdateArtifactKind::StandaloneExecutable,
                    manifest_source: source.into(),
                    artifact_source: "https://updates.example/cloop".into(),
                }],
            };
            let signed = SignedUpdateChannelManifest {
                signature: STANDARD
                    .encode(key.sign(&serde_json::to_vec(&manifest).unwrap()).to_bytes()),
                manifest,
            };
            assert!(matches!(
                discover_update(
                    &signed,
                    &key.verifying_key().to_bytes(),
                    "1.0.0",
                    "stable",
                    false
                ),
                Err(ReleaseError::InsecureManifestSource)
            ));
        }

        let manifest = UpdateChannelManifest {
            version: UPDATE_MANIFEST_SCHEMA_VERSION,
            releases: vec![UpdateRelease {
                version: "2.0.0".into(),
                channel: "stable".into(),
                target_triple: current_update_target_triple().unwrap().into(),
                artifact_kind: UpdateArtifactKind::StandaloneExecutable,
                manifest_source: "file:///tmp/release.json".into(),
                artifact_source: "/tmp/cloop".into(),
            }],
        };
        let signed = SignedUpdateChannelManifest {
            signature: STANDARD
                .encode(key.sign(&serde_json::to_vec(&manifest).unwrap()).to_bytes()),
            manifest,
        };
        assert!(matches!(
            discover_update(
                &signed,
                &key.verifying_key().to_bytes(),
                "1.0.0",
                "stable",
                true
            ),
            Err(ReleaseError::OfflineRemoteSource)
        ));
    }
}
