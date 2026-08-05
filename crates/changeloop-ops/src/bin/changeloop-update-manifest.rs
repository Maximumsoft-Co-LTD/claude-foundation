//! Offline release helper for producing the exact Ed25519 manifests consumed
//! by `cloop update`. Private key material is accepted only through the
//! `CHANGELOOP_UPDATE_SIGNING_KEY_BASE64` environment variable.

use base64::{Engine as _, engine::general_purpose::STANDARD};
use changeloop_ops::{
    SignedUpdateChannelManifest, SignedUpdateManifest, UPDATE_MANIFEST_SCHEMA_VERSION,
    UpdateArtifactKind, UpdateChannelManifest, UpdateManifest, UpdateRelease,
};
use ed25519_dalek::{Signer, SigningKey};
use semver::Version;
use sha2::{Digest, Sha256};
use std::env;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use zeroize::Zeroize;

const PRIVATE_KEY_ENV: &str = "CHANGELOOP_UPDATE_SIGNING_KEY_BASE64";
const PUBLIC_KEY_ENV: &str = "CHANGELOOP_UPDATE_PUBLIC_KEY_BASE64";

fn main() {
    if let Err(error) = run(env::args().skip(1).collect()) {
        eprintln!("update manifest generation failed: {error}");
        std::process::exit(1);
    }
}

fn run(args: Vec<String>) -> Result<(), String> {
    let [
        version,
        channel,
        target_triple,
        artifact,
        manifest_source,
        artifact_source,
        release_output,
        channel_output,
    ] = args.as_slice()
    else {
        return Err(
            "usage: changeloop-update-manifest <version> <channel> <target-triple> <artifact> <https-manifest-source> <https-artifact-source> <release-output> <channel-output>".into(),
        );
    };
    let mut private = decode_private_key_env()?;
    let expected_public = decode_key_env(PUBLIC_KEY_ENV)?;
    let signing_key = SigningKey::from_bytes(&private);
    private.zeroize();
    if signing_key.verifying_key().to_bytes() != expected_public {
        return Err("configured update public key does not match the signing key".into());
    }
    generate(
        version,
        channel,
        target_triple,
        Path::new(artifact),
        manifest_source,
        artifact_source,
        Path::new(release_output),
        Path::new(channel_output),
        &signing_key,
    )
}

fn decode_key_env(name: &str) -> Result<[u8; 32], String> {
    let encoded =
        env::var(name).map_err(|_| format!("required environment variable {name} is absent"))?;
    STANDARD
        .decode(encoded.trim())
        .map_err(|_| format!("{name} is not valid base64"))?
        .try_into()
        .map_err(|_| format!("{name} must encode exactly 32 bytes"))
}

fn decode_private_key_env() -> Result<[u8; 32], String> {
    let mut encoded = env::var(PRIVATE_KEY_ENV)
        .map_err(|_| format!("required environment variable {PRIVATE_KEY_ENV} is absent"))?;
    let decoded = STANDARD
        .decode(encoded.trim())
        .map_err(|_| format!("{PRIVATE_KEY_ENV} is not valid base64"));
    encoded.zeroize();
    let mut decoded = decoded?;
    if decoded.len() != 32 {
        decoded.zeroize();
        return Err(format!("{PRIVATE_KEY_ENV} must encode exactly 32 bytes"));
    }
    let mut key = [0_u8; 32];
    key.copy_from_slice(&decoded);
    decoded.zeroize();
    Ok(key)
}

#[allow(clippy::too_many_arguments)]
fn generate(
    version: &str,
    channel: &str,
    target_triple: &str,
    artifact: &Path,
    manifest_source: &str,
    artifact_source: &str,
    release_output: &Path,
    channel_output: &Path,
    signing_key: &SigningKey,
) -> Result<(), String> {
    Version::parse(version).map_err(|_| "version is not valid semver".to_owned())?;
    if !matches!(channel, "stable" | "beta" | "preview") {
        return Err("channel must be stable, beta, or preview".into());
    }
    if !matches!(
        target_triple,
        "x86_64-unknown-linux-gnu"
            | "aarch64-unknown-linux-gnu"
            | "x86_64-apple-darwin"
            | "aarch64-apple-darwin"
    ) {
        return Err("target triple is not a supported Changeloop release target".into());
    }
    if !manifest_source.starts_with("https://") || !artifact_source.starts_with("https://") {
        return Err("published manifest and artifact sources must use HTTPS".into());
    }
    let (artifact_sha256, artifact_size) = hash_file(artifact)?;
    let manifest = UpdateManifest {
        schema_version: UPDATE_MANIFEST_SCHEMA_VERSION,
        version: version.into(),
        target_triple: target_triple.into(),
        artifact_kind: UpdateArtifactKind::StandaloneExecutable,
        artifact_sha256,
        artifact_size,
    };
    let signature = STANDARD.encode(
        signing_key
            .sign(&serde_json::to_vec(&manifest).map_err(|error| error.to_string())?)
            .to_bytes(),
    );
    let signed_release = SignedUpdateManifest {
        manifest,
        signature,
    };
    write_json_atomic(release_output, &signed_release)?;

    let manifest = UpdateChannelManifest {
        version: UPDATE_MANIFEST_SCHEMA_VERSION,
        releases: vec![UpdateRelease {
            version: version.into(),
            channel: channel.into(),
            target_triple: target_triple.into(),
            artifact_kind: UpdateArtifactKind::StandaloneExecutable,
            manifest_source: manifest_source.into(),
            artifact_source: artifact_source.into(),
        }],
    };
    let signature = STANDARD.encode(
        signing_key
            .sign(&serde_json::to_vec(&manifest).map_err(|error| error.to_string())?)
            .to_bytes(),
    );
    write_json_atomic(
        channel_output,
        &SignedUpdateChannelManifest {
            manifest,
            signature,
        },
    )
}

fn hash_file(path: &Path) -> Result<(String, u64), String> {
    let mut file = File::open(path).map_err(|error| error.to_string())?;
    let mut digest = Sha256::new();
    let mut size = 0_u64;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
        size = size.saturating_add(read as u64);
    }
    Ok((format!("{:x}", digest.finalize()), size))
}

fn write_json_atomic(path: &Path, value: &impl serde::Serialize) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "output path has no parent".to_owned())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let temporary = temporary_path(path);
    let result = (|| {
        let mut file = File::create(&temporary).map_err(|error| error.to_string())?;
        serde_json::to_writer_pretty(&mut file, value).map_err(|error| error.to_string())?;
        file.write_all(b"\n").map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        fs::rename(&temporary, path).map_err(|error| error.to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

fn temporary_path(path: &Path) -> PathBuf {
    let mut name = path.as_os_str().to_owned();
    name.push(".tmp");
    PathBuf::from(name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use changeloop_ops::{discover_update, verify_update};
    use tempfile::tempdir;

    #[test]
    fn generated_release_and_channel_are_consumable_and_tamper_safe() {
        let root = tempdir().unwrap();
        let artifact = root.path().join("cloop.tar.gz");
        let release = root.path().join("cloop.tar.gz.update.json");
        let channel = root.path().join("update-channel-stable-test.json");
        fs::write(&artifact, b"release artifact").unwrap();
        let key = SigningKey::from_bytes(&[42; 32]);
        generate(
            "2.0.0",
            "stable",
            changeloop_ops::current_update_target_triple().unwrap(),
            &artifact,
            "https://example.invalid/cloop.tar.gz.update.json",
            "https://example.invalid/cloop",
            &release,
            &channel,
            &key,
        )
        .unwrap();
        let signed_release: SignedUpdateManifest =
            serde_json::from_slice(&fs::read(release).unwrap()).unwrap();
        assert_eq!(
            signed_release.manifest.target_triple,
            changeloop_ops::current_update_target_triple().unwrap()
        );
        assert_eq!(
            signed_release.manifest.artifact_kind,
            UpdateArtifactKind::StandaloneExecutable
        );
        let public = key.verifying_key().to_bytes();
        verify_update(&signed_release, b"release artifact", &public, "1.0.0").unwrap();
        assert!(verify_update(&signed_release, b"tampered", &public, "1.0.0").is_err());
        assert!(verify_update(&signed_release, b"release artifact", &public, "2.0.0").is_err());

        let signed_channel: SignedUpdateChannelManifest =
            serde_json::from_slice(&fs::read(channel).unwrap()).unwrap();
        let discovered = discover_update(&signed_channel, &public, "1.0.0", "stable", false)
            .unwrap()
            .unwrap();
        assert_eq!(discovered.version, "2.0.0");
        assert_eq!(
            discovered.target_triple,
            changeloop_ops::current_update_target_triple().unwrap()
        );

        assert!(
            generate(
                "2.0.0",
                "stable",
                "unsupported-vendor-platform",
                &artifact,
                "https://example.invalid/release.json",
                "https://example.invalid/cloop",
                &root.path().join("invalid-release.json"),
                &root.path().join("invalid-channel.json"),
                &key,
            )
            .is_err()
        );
    }
}
