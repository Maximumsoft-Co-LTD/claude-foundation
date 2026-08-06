//! Keyed authentication for repository-visible lifecycle records.
//!
//! The payload stays ordinary JSON so a person can inspect it. Authority comes
//! from a sidecar MAC whose key lives in the operator's configuration directory
//! — outside the repository. A plain digest would only catch accidents: anyone
//! able to edit the repository can recompute one. HMAC-SHA256 proves that the
//! local cloop installation holding the operator key wrote these exact bytes for
//! this exact project and binding set.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use zeroize::Zeroize as _;

pub const RECORD_AUTH_VERSION: u16 = 1;
const KEY_BYTES: usize = 32;
const MAX_KEY_FILE_BYTES: u64 = 256;
const MAX_SIDECAR_BYTES: u64 = 64 * 1024;

#[derive(Debug, thiserror::Error)]
pub enum RecordAuthError {
    #[error("record authentication key is unavailable")]
    MissingKey,
    #[error("record authentication failed")]
    Invalid,
    #[error("unsupported record authentication version {0}")]
    UnsupportedVersion(u16),
    #[error("unsafe record authentication path: {0}")]
    UnsafePath(PathBuf),
    #[error("record authentication I/O failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("record authentication JSON failed: {0}")]
    Json(#[from] serde_json::Error),
    #[error("OS entropy is unavailable")]
    Entropy,
}

/// Versioned sidecar stored beside one authoritative record.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecordSidecar {
    pub version: u16,
    pub kind: String,
    pub record_id: String,
    pub root: String,
    pub payload_sha256: String,
    pub bindings: BTreeMap<String, String>,
    pub mac: String,
}

/// Operator trust root. The key path is outside every repository.
#[derive(Clone, Debug)]
pub struct RecordAuthenticator {
    key_path: PathBuf,
}

impl RecordAuthenticator {
    #[must_use]
    pub fn key_path_in(config_directory: &Path) -> PathBuf {
        config_directory.join("record-auth-key-v1")
    }

    #[must_use]
    pub fn new(config_directory: &Path) -> Self {
        Self {
            key_path: Self::key_path_in(config_directory),
        }
    }

    /// Ensures a key exists for a write-side operation. Verification never
    /// calls this: merely reading a forged repository must not mint a key and
    /// retroactively trust it.
    pub fn ensure_key(&self) -> Result<(), RecordAuthError> {
        match read_key(&self.key_path) {
            Ok(_) => return Ok(()),
            Err(RecordAuthError::MissingKey) => {}
            Err(error) => return Err(error),
        }
        let parent = self
            .key_path
            .parent()
            .ok_or_else(|| RecordAuthError::UnsafePath(self.key_path.clone()))?;
        fs::create_dir_all(parent)?;
        let mut key = [0_u8; KEY_BYTES];
        getrandom::fill(&mut key).map_err(|_| RecordAuthError::Entropy)?;
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600).custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC);
        }
        match options.open(&self.key_path) {
            Ok(mut file) => {
                file.write_all(&key)?;
                file.sync_all()?;
                Ok(())
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                read_key(&self.key_path).map(|_| ())
            }
            Err(error) => Err(error.into()),
        }
    }

    /// Writes a sidecar for exact payload bytes and exact ordered bindings.
    pub fn sign(
        &self,
        root: &Path,
        kind: &str,
        record_id: &str,
        payload: &[u8],
        bindings: BTreeMap<String, String>,
    ) -> Result<RecordSidecar, RecordAuthError> {
        let canonical_root = fs::canonicalize(root)?;
        ensure_key_parent_outside_root(&self.key_path, &canonical_root)?;
        self.ensure_key()?;
        let mut key = read_key(&self.key_path)?;
        ensure_key_outside_root(&self.key_path, &canonical_root)?;
        let payload_sha256 = format!("sha256:{:x}", Sha256::digest(payload));
        let mac = hmac_sha256(
            &key,
            &framing(
                &canonical_root,
                kind,
                record_id,
                &payload_sha256,
                &bindings,
            ),
        );
        key.zeroize();
        Ok(RecordSidecar {
            version: RECORD_AUTH_VERSION,
            kind: kind.to_owned(),
            record_id: record_id.to_owned(),
            root: canonical_root.display().to_string(),
            payload_sha256,
            bindings,
            mac: format!("sha256:{mac}"),
        })
    }

    /// Verifies a sidecar. Missing key, mismatched bytes, foreign root and
    /// unknown version all fail closed.
    pub fn verify(
        &self,
        root: &Path,
        kind: &str,
        record_id: &str,
        payload: &[u8],
        sidecar: &RecordSidecar,
    ) -> Result<(), RecordAuthError> {
        if sidecar.version != RECORD_AUTH_VERSION {
            return Err(RecordAuthError::UnsupportedVersion(sidecar.version));
        }
        let mut key = read_key(&self.key_path)?;
        let canonical_root = fs::canonicalize(root)?;
        ensure_key_outside_root(&self.key_path, &canonical_root)?;
        let payload_sha256 = format!("sha256:{:x}", Sha256::digest(payload));
        if sidecar.kind != kind
            || sidecar.record_id != record_id
            || sidecar.root != canonical_root.display().to_string()
            || sidecar.payload_sha256 != payload_sha256
        {
            return Err(RecordAuthError::Invalid);
        }
        let expected = hmac_sha256(
            &key,
            &framing(
                &canonical_root,
                kind,
                record_id,
                &payload_sha256,
                &sidecar.bindings,
            ),
        );
        let supplied = sidecar
            .mac
            .strip_prefix("sha256:")
            .ok_or(RecordAuthError::Invalid)?;
        let valid = constant_time_eq(expected.as_bytes(), supplied.as_bytes());
        key.zeroize();
        if !valid {
            return Err(RecordAuthError::Invalid);
        }
        Ok(())
    }

    /// Serializes and writes the sidecar atomically beside the payload. The
    /// payload should be durable first: a crash between them leaves content for
    /// inspection but no authority, which is the safe side of the failure.
    pub fn write_sidecar(
        &self,
        payload_path: &Path,
        sidecar: &RecordSidecar,
    ) -> Result<PathBuf, RecordAuthError> {
        let path = sidecar_path(payload_path);
        let parent = path
            .parent()
            .ok_or_else(|| RecordAuthError::UnsafePath(path.clone()))?;
        let bytes = serde_json::to_vec_pretty(sidecar)?;
        if bytes.len() as u64 > MAX_SIDECAR_BYTES {
            return Err(RecordAuthError::UnsafePath(path));
        }
        let temporary = parent.join(format!(".record-auth-{}.tmp", std::process::id()));
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600).custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC);
        }
        let result = (|| -> Result<(), RecordAuthError> {
            let mut file = options.open(&temporary)?;
            file.write_all(&bytes)?;
            file.sync_all()?;
            fs::rename(&temporary, &path)?;
            Ok(())
        })();
        if result.is_err() {
            let _ = fs::remove_file(&temporary);
        }
        result.map(|()| path)
    }

    pub fn load_sidecar(&self, payload_path: &Path) -> Result<RecordSidecar, RecordAuthError> {
        let path = sidecar_path(payload_path);
        let bytes = read_regular_nofollow(&path, MAX_SIDECAR_BYTES)?;
        Ok(serde_json::from_slice(&bytes)?)
    }
}

#[must_use]
pub fn sidecar_path(payload_path: &Path) -> PathBuf {
    let mut name = payload_path
        .file_name()
        .map(|name| name.to_os_string())
        .unwrap_or_default();
    name.push(".auth.json");
    payload_path.with_file_name(name)
}

fn ensure_key_parent_outside_root(
    key_path: &Path,
    root: &Path,
) -> Result<(), RecordAuthError> {
    let parent = key_path
        .parent()
        .ok_or_else(|| RecordAuthError::UnsafePath(key_path.into()))?;
    // The parent may not exist on first write. Resolve the nearest existing
    // ancestor; if that is already inside the project, creating children below
    // it cannot make the trust root external.
    let mut existing = parent;
    while !existing.exists() {
        existing = existing
            .parent()
            .ok_or_else(|| RecordAuthError::UnsafePath(parent.into()))?;
    }
    let existing = fs::canonicalize(existing)?;
    if existing.starts_with(root) {
        return Err(RecordAuthError::UnsafePath(parent.into()));
    }
    Ok(())
}

fn ensure_key_outside_root(key_path: &Path, root: &Path) -> Result<(), RecordAuthError> {
    let key = fs::canonicalize(key_path)?;
    if key.starts_with(root) {
        return Err(RecordAuthError::UnsafePath(key));
    }
    Ok(())
}

fn read_key(path: &Path) -> Result<[u8; KEY_BYTES], RecordAuthError> {
    let bytes = match read_regular_nofollow(path, MAX_KEY_FILE_BYTES) {
        Ok(bytes) => bytes,
        Err(RecordAuthError::Io(error)) if error.kind() == std::io::ErrorKind::NotFound => {
            return Err(RecordAuthError::MissingKey);
        }
        Err(error) => return Err(error),
    };
    if bytes.len() != KEY_BYTES {
        return Err(RecordAuthError::Invalid);
    }
    let mut key = [0_u8; KEY_BYTES];
    key.copy_from_slice(&bytes);
    Ok(key)
}

fn read_regular_nofollow(path: &Path, limit: u64) -> Result<Vec<u8>, RecordAuthError> {
    let path_metadata = fs::symlink_metadata(path)?;
    if !path_metadata.file_type().is_file() || path_metadata.len() > limit {
        return Err(RecordAuthError::UnsafePath(path.into()));
    }
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC);
    }
    let file = options.open(path)?;
    let metadata = file.metadata()?;
    if !metadata.file_type().is_file() || metadata.len() > limit {
        return Err(RecordAuthError::UnsafePath(path.into()));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        if metadata.nlink() != 1 {
            return Err(RecordAuthError::UnsafePath(path.into()));
        }
        // The key itself must be private. Sidecars may also be 0600; checking
        // all authenticated material keeps a copied world-readable key from
        // being accepted after a rename.
        if path.file_name().is_some_and(|name| name == "record-auth-key-v1")
            && metadata.permissions().mode() & 0o077 != 0
        {
            return Err(RecordAuthError::UnsafePath(path.into()));
        }
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take(limit.saturating_add(1)).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > limit {
        return Err(RecordAuthError::UnsafePath(path.into()));
    }
    Ok(bytes)
}

fn framing(
    root: &Path,
    kind: &str,
    record_id: &str,
    payload_sha256: &str,
    bindings: &BTreeMap<String, String>,
) -> Vec<u8> {
    let mut bytes = Vec::new();
    field(&mut bytes, b"version", &RECORD_AUTH_VERSION.to_be_bytes());
    field(&mut bytes, b"root", root.as_os_str().as_encoded_bytes());
    field(&mut bytes, b"kind", kind.as_bytes());
    field(&mut bytes, b"record-id", record_id.as_bytes());
    field(&mut bytes, b"payload", payload_sha256.as_bytes());
    for (name, value) in bindings {
        field(&mut bytes, b"binding-name", name.as_bytes());
        field(&mut bytes, b"binding-value", value.as_bytes());
    }
    bytes
}

fn field(output: &mut Vec<u8>, label: &[u8], value: &[u8]) {
    output.extend_from_slice(&(label.len() as u64).to_be_bytes());
    output.extend_from_slice(label);
    output.extend_from_slice(&(value.len() as u64).to_be_bytes());
    output.extend_from_slice(value);
}

/// HMAC per RFC 2104, using SHA-256's 64-byte block size.
fn hmac_sha256(key: &[u8], message: &[u8]) -> String {
    const BLOCK: usize = 64;
    let mut normalized = [0_u8; BLOCK];
    if key.len() > BLOCK {
        normalized[..32].copy_from_slice(&Sha256::digest(key));
    } else {
        normalized[..key.len()].copy_from_slice(key);
    }
    let mut inner_pad = [0x36_u8; BLOCK];
    let mut outer_pad = [0x5c_u8; BLOCK];
    for index in 0..BLOCK {
        inner_pad[index] ^= normalized[index];
        outer_pad[index] ^= normalized[index];
    }
    let mut inner = Sha256::new();
    inner.update(inner_pad);
    inner.update(message);
    let inner = inner.finalize();
    let mut outer = Sha256::new();
    outer.update(outer_pad);
    outer.update(inner);
    format!("{:x}", outer.finalize())
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    let mut difference = 0_u8;
    for (left, right) in left.iter().zip(right) {
        difference |= left ^ right;
    }
    difference == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn authenticated_record_round_trips_exact_bytes_and_bindings() {
        let home = tempfile::tempdir().unwrap();
        let root = tempfile::tempdir().unwrap();
        let auth = RecordAuthenticator::new(home.path());
        let bindings = BTreeMap::from([("config".into(), "sha256:abc".into())]);
        let sidecar = auth
            .sign(root.path(), "operational-state", "state", b"payload", bindings)
            .unwrap();
        auth.verify(root.path(), "operational-state", "state", b"payload", &sidecar)
            .unwrap();
    }

    #[test]
    fn authenticated_record_rejects_changed_payload_binding_kind_and_id() {
        let home = tempfile::tempdir().unwrap();
        let root = tempfile::tempdir().unwrap();
        let auth = RecordAuthenticator::new(home.path());
        let sidecar = auth
            .sign(
                root.path(),
                "proof",
                "change",
                b"payload",
                BTreeMap::from([("config".into(), "sha256:abc".into())]),
            )
            .unwrap();
        assert!(auth.verify(root.path(), "proof", "change", b"changed", &sidecar).is_err());
        assert!(auth.verify(root.path(), "review", "change", b"payload", &sidecar).is_err());
        assert!(auth.verify(root.path(), "proof", "other", b"payload", &sidecar).is_err());
        let mut rebound = sidecar.clone();
        rebound.bindings.insert("config".into(), "sha256:def".into());
        assert!(auth.verify(root.path(), "proof", "change", b"payload", &rebound).is_err());
    }

    #[test]
    fn authenticated_record_does_not_transfer_between_projects() {
        let home = tempfile::tempdir().unwrap();
        let first = tempfile::tempdir().unwrap();
        let second = tempfile::tempdir().unwrap();
        let auth = RecordAuthenticator::new(home.path());
        let sidecar = auth
            .sign(first.path(), "proof", "change", b"payload", BTreeMap::new())
            .unwrap();
        assert!(auth.verify(second.path(), "proof", "change", b"payload", &sidecar).is_err());
    }

    #[test]
    fn verification_never_creates_a_missing_key() {
        let home = tempfile::tempdir().unwrap();
        let root = tempfile::tempdir().unwrap();
        let auth = RecordAuthenticator::new(home.path());
        let sidecar = RecordSidecar {
            version: RECORD_AUTH_VERSION,
            kind: "proof".into(),
            record_id: "change".into(),
            root: root.path().display().to_string(),
            payload_sha256: "sha256:forged".into(),
            bindings: BTreeMap::new(),
            mac: "sha256:forged".into(),
        };
        assert!(matches!(
            auth.verify(root.path(), "proof", "change", b"payload", &sidecar),
            Err(RecordAuthError::MissingKey)
        ));
        assert!(!RecordAuthenticator::key_path_in(home.path()).exists());
    }

    #[test]
    fn sidecar_round_trip_is_bounded_and_tamper_evident() {
        let home = tempfile::tempdir().unwrap();
        let root = tempfile::tempdir().unwrap();
        let payload = root.path().join("record.json");
        fs::write(&payload, b"payload").unwrap();
        let auth = RecordAuthenticator::new(home.path());
        let sidecar = auth
            .sign(root.path(), "proof", "change", b"payload", BTreeMap::new())
            .unwrap();
        auth.write_sidecar(&payload, &sidecar).unwrap();
        let loaded = auth.load_sidecar(&payload).unwrap();
        assert_eq!(loaded, sidecar);
        auth.verify(root.path(), "proof", "change", b"payload", &loaded)
            .unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn authentication_key_is_private_regular_and_single_link() {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        let home = tempfile::tempdir().unwrap();
        let auth = RecordAuthenticator::new(home.path());
        auth.ensure_key().unwrap();
        let metadata = fs::symlink_metadata(RecordAuthenticator::key_path_in(home.path())).unwrap();
        assert!(metadata.file_type().is_file());
        assert_eq!(metadata.nlink(), 1);
        assert_eq!(metadata.permissions().mode() & 0o077, 0);
    }

    #[test]
    fn key_directory_inside_the_repository_is_rejected_before_a_key_is_created() {
        let root = tempfile::tempdir().unwrap();
        let home = root.path().join(".operator-config");
        let auth = RecordAuthenticator::new(&home);
        let error = auth
            .sign(
                root.path(),
                "proof",
                "change",
                b"payload",
                BTreeMap::new(),
            )
            .expect_err("a repository-owned key is no trust root");
        assert!(matches!(error, RecordAuthError::UnsafePath(_)), "{error:?}");
        assert!(!RecordAuthenticator::key_path_in(&home).exists());
    }

    #[cfg(unix)]
    #[test]
    fn symlinked_or_hardlinked_key_is_rejected() {
        use std::os::unix::fs::symlink;
        let home = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let outside_key = outside.path().join("key");
        fs::write(&outside_key, [0_u8; KEY_BYTES]).unwrap();
        let link = RecordAuthenticator::key_path_in(home.path());
        symlink(&outside_key, &link).unwrap();
        assert!(matches!(read_key(&link), Err(RecordAuthError::UnsafePath(_))));
        fs::remove_file(&link).unwrap();
        fs::hard_link(&outside_key, &link).unwrap();
        assert!(matches!(read_key(&link), Err(RecordAuthError::UnsafePath(_))));
    }
}
