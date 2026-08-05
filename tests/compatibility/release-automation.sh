#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
scratch=$(mktemp -d "${TMPDIR:-/tmp}/changeloop-release.XXXXXX")
trap 'rm -rf "$scratch"' EXIT HUP INT TERM

# Remote actions are executable release dependencies. Mutable major-version
# tags are useful for discovery, but the committed workflows must retain the
# exact reviewed revision until an intentional dependency update changes it.
if grep -R -E 'uses:[[:space:]]+[^[:space:]]+@v[0-9]+' "$root/.github/workflows" >/dev/null; then
  echo "workflow contains a mutable GitHub Action version tag" >&2
  exit 1
fi
if grep -R -E 'uses:[[:space:]]+[^[:space:]]+@' "$root/.github/workflows" \
  | grep -E -v '@[0-9a-f]{40}([[:space:]]+#.*)?$' >/dev/null; then
  echo "workflow action is not pinned to a full commit revision" >&2
  exit 1
fi

# Release commands must consume the reviewed lockfile. Commands that do not
# resolve dependencies (fmt, cyclonedx, audit and deny) are intentionally not
# part of this check.
if grep -R -n -E 'cargo (build|test|clippy|metadata|install)([[:space:]]|$)' \
  "$root/.github/workflows" "$root/scripts/release" "$0" \
  | grep -v -- '--locked' >/dev/null; then
  echo "release automation contains a dependency-resolving cargo command without --locked" >&2
  exit 1
fi

release_workflow="$root/.github/workflows/changeloop-release.yml"
test -s "$release_workflow"
test "$(grep -c 'APPLE_CERTIFICATE_P12_BASE64:' "$release_workflow")" -eq 1
test "$(grep -n 'APPLE_CERTIFICATE_P12_BASE64:' "$release_workflow" | cut -d: -f1)" \
  -gt "$(grep -n 'name: Sign and notarize macOS binary' "$release_workflow" | cut -d: -f1)"
! grep -q 'runs-on: ubuntu-latest' "$root/.github/workflows/rust-supply-chain.yml"
! grep -q 'runs-on: ubuntu-latest' "$root/.github/workflows/workflow-tests.yml"
test "$(grep -c -F '"rust-toolchain.toml"' "$root/.github/workflows/rust-supply-chain.yml")" -eq 2
test "$(grep -c -F '"scripts/release/check-msrv.mjs"' "$root/.github/workflows/rust-supply-chain.yml")" -eq 2
targets='x86_64-unknown-linux-gnu aarch64-unknown-linux-gnu x86_64-apple-darwin aarch64-apple-darwin'
test "$(grep -c -E '^[[:space:]]+target: (x86_64-unknown-linux-gnu|aarch64-unknown-linux-gnu|x86_64-apple-darwin|aarch64-apple-darwin)$' "$release_workflow")" -eq 4
for target in $targets; do
  test "$(grep -c -F "target: $target" "$release_workflow")" -eq 1
done
grep -q -F 'cargo build --locked --release -p changeloop-ops --bin changeloop-update-manifest' "$release_workflow"
grep -q -F 'security:' "$release_workflow"
grep -q -F 'cargo install --locked cargo-audit@0.22.2' "$release_workflow"
grep -q -F 'cargo install --locked cargo-deny@0.20.2' "$release_workflow"
grep -q -F 'cargo audit --deny warnings' "$release_workflow"
grep -q -F 'cargo deny check advisories bans licenses sources' "$release_workflow"
grep -q -F 'needs: [preflight, security]' "$release_workflow"
grep -q -F 'needs: [build, compatibility, security]' "$release_workflow"
grep -q -F 'cargo install --locked cargo-cyclonedx@0.5.9' "$release_workflow"
grep -q -F 'scripts/release/verify-artifacts.sh dist dist/SHA256SUMS' "$release_workflow"
grep -q -F 'name: Verify archive and native executable before upload' "$release_workflow"
grep -q -F 'test "$("$packaged/cloop" --version)" = "$("$packaged/claude-foundation" --version)"' "$release_workflow"
grep -q -F 'test "$(find dist -name '\''*.update.json'\'' -type f | wc -l | tr -d '\'' '\'')" -eq 4' "$release_workflow"
grep -q -F 'test "$(find dist -name '\''update-channel-stable-*.json'\'' -type f | wc -l | tr -d '\'' '\'')" -eq 4' "$release_workflow"
grep -q -F 'sigstore/cosign-installer@' "$release_workflow"
grep -q -F -- '--certificate-identity "https://github.com/${GITHUB_REPOSITORY}/.github/workflows/changeloop-release.yml@${GITHUB_REF}"' "$release_workflow"
! grep -q -F -- '--certificate-identity-regexp' "$release_workflow"
grep -q -F 'actions/attest-build-provenance@' "$release_workflow"
grep -q -F 'xcrun notarytool submit' "$release_workflow"
grep -q -F 'base64 -D > "$cert"' "$release_workflow"
! grep -q -F 'base64 --decode' "$release_workflow"
grep -q -F 'tests/compatibility/repository-matrix.sh --release "$cloop"' "$release_workflow"
grep -q -F 'required_case_skipped:' "$root/tests/compatibility/repository-matrix.sh"
policy_output=$(CHANGELOOP_COMPAT_POLICY_TEST_ONLY=1 \
  "$root/tests/compatibility/repository-matrix.sh" /usr/bin/true)
printf '%s\n' "$policy_output" | grep -q 'required-policy-fixture: SKIP'
if CHANGELOOP_COMPAT_POLICY_TEST_ONLY=1 \
  "$root/tests/compatibility/repository-matrix.sh" --release /usr/bin/true \
  >/dev/null 2>&1; then
  echo "release compatibility mode unexpectedly accepted a required skip" >&2
  exit 1
fi

test "$(awk -F '"' '/^rust-version = / { print $2 }' "$root/Cargo.toml")" = 1.88
test "$(awk -F '"' '/^channel = / { print $2 }' "$root/rust-toolchain.toml")" = 1.88.0
node "$root/scripts/release/check-msrv.mjs" >/dev/null

for script in "$root"/scripts/release/*.sh "$0"; do
  sh -n "$script"
done

# The builder itself is constrained to the same four public release targets.
if "$root/scripts/release/build-artifact.sh" unsupported-target 0.0.0 "$scratch" \
  >/dev/null 2>&1; then
  echo "unsupported release target unexpectedly accepted" >&2
  exit 1
fi

# Keep the static workflow/supply-chain contract independently runnable while
# another job owns Cargo's build lock. The default path below still performs
# all archive, updater, tamper and rollback integration tests.
if [ "${CHANGELOOP_RELEASE_CONTRACT_ONLY:-0}" = 1 ]; then
  echo "release automation contract: PASS"
  exit 0
fi

name=changeloop-0.0.0-test-host
mkdir "$scratch/$name"
printf '#!/bin/sh\nprintf "cloop:%%s\\n" "$*"\n' > "$scratch/$name/cloop"
printf '#!/bin/sh\nexec "$(dirname -- "$0")/cloop" "$@"\n' > "$scratch/$name/claude-foundation"
chmod 755 "$scratch/$name/cloop" "$scratch/$name/claude-foundation"
printf 'license\n' > "$scratch/$name/LICENSE"
printf 'roadmap\n' > "$scratch/$name/ROADMAP.md"
python3 "$root/scripts/release/reproducible-tar.py" "$scratch/$name" "$scratch/$name.tar.gz"
(cd "$scratch" && "$root/scripts/release/checksum.sh" "$name.tar.gz" > checksums.txt)
"$root/scripts/release/verify-artifacts.sh" "$scratch" "$scratch/checksums.txt"

mkdir "$scratch/extracted"
tar -xzf "$scratch/$name.tar.gz" -C "$scratch/extracted"
test -x "$scratch/extracted/$name/cloop"
test -x "$scratch/extracted/$name/claude-foundation"
test "$("$scratch/extracted/$name/cloop" --version)" = "cloop:--version"
test "$("$scratch/extracted/$name/claude-foundation" --version)" = "cloop:--version"
# Updating cloop in place must leave the compatibility alias forwarding to the
# replacement for the promised major-release window.
printf '#!/bin/sh\nprintf "updated:%%s\\n" "$*"\n' > "$scratch/extracted/$name/cloop"
chmod 755 "$scratch/extracted/$name/cloop"
test "$("$scratch/extracted/$name/claude-foundation" status)" = "updated:status"

python3 "$root/scripts/release/reproducible-tar.py" "$scratch/$name" "$scratch/rebuilt.tar.gz"
test "$("$root/scripts/release/checksum.sh" "$scratch/$name.tar.gz" | awk '{print $1}')" = \
  "$("$root/scripts/release/checksum.sh" "$scratch/rebuilt.tar.gz" | awk '{print $1}')"

cp "$scratch/checksums.txt" "$scratch/incomplete-checksums.txt"
printf 'not an archive\n' > "$scratch/unrelated.txt"
checksum=$("$root/scripts/release/checksum.sh" "$scratch/unrelated.txt" | awk '{print $1}')
printf '%s  unrelated.txt\n' "$checksum" > "$scratch/incomplete-checksums.txt"
if "$root/scripts/release/verify-artifacts.sh" "$scratch" "$scratch/incomplete-checksums.txt" >/dev/null 2>&1; then
  echo "manifest omitting the archive unexpectedly verified" >&2
  exit 1
fi

cp "$scratch/checksums.txt" "$scratch/bad-checksums.txt"
printf x >> "$scratch/$name.tar.gz"
if "$root/scripts/release/verify-artifacts.sh" "$scratch" "$scratch/bad-checksums.txt" >/dev/null 2>&1; then
  echo "tampered artifact unexpectedly verified" >&2
  exit 1
fi

evil="$scratch/evil"
evil_name=changeloop-0.0.0-evil-host
mkdir -p "$evil/$evil_name"
cp "$scratch/$name/cloop" "$evil/$evil_name/cloop"
cp "$scratch/$name/LICENSE" "$scratch/$name/ROADMAP.md" "$evil/$evil_name/"
ln -s cloop "$evil/$evil_name/claude-foundation"
python3 "$root/scripts/release/reproducible-tar.py" "$evil/$evil_name" "$evil/$evil_name.tar.gz"
(cd "$evil" && "$root/scripts/release/checksum.sh" "$evil_name.tar.gz" > checksums.txt)
if "$root/scripts/release/verify-artifacts.sh" "$evil" "$evil/checksums.txt" >/dev/null 2>&1; then
  echo "archive containing a symlink unexpectedly verified" >&2
  exit 1
fi

"$root/scripts/release/test-transactional-install.sh"

# Exercise the exact Ed25519 JSON chain published by the tagged workflow. The
# fixture key is generated for this invocation and removed with the scratch
# directory; no private release material is stored in the repository.
openssl genpkey -algorithm ED25519 -out "$scratch/update-test-key.pem" >/dev/null 2>&1
CHANGELOOP_UPDATE_SIGNING_KEY_BASE64=$(
  openssl pkey -in "$scratch/update-test-key.pem" -outform DER | tail -c 32 | openssl base64 -A
)
CHANGELOOP_UPDATE_PUBLIC_KEY_BASE64=$(
  openssl pkey -in "$scratch/update-test-key.pem" -pubout -outform DER | tail -c 32 | openssl base64 -A
)
export CHANGELOOP_UPDATE_SIGNING_KEY_BASE64 CHANGELOOP_UPDATE_PUBLIC_KEY_BASE64
printf '#!/bin/sh\nprintf "old-cli\\n"\n' > "$scratch/update-target"
chmod 755 "$scratch/update-target"
cargo build --locked -p changeloop-ops --bin changeloop-update-manifest
cargo build --locked -p changeloop-cli
cp "$root/target/debug/cloop" "$scratch/update-candidate"
chmod 755 "$scratch/update-candidate"
update_target=$(rustc -vV | sed -n 's/^host: //p')
if env -u CHANGELOOP_UPDATE_SIGNING_KEY_BASE64 -u CHANGELOOP_UPDATE_PUBLIC_KEY_BASE64 \
  "$root/target/debug/changeloop-update-manifest" \
  999.0.0 stable "$update_target" "$scratch/update-candidate" \
  https://updates.invalid/update-release.json https://updates.invalid/cloop \
  "$scratch/absent-release.json" "$scratch/absent-channel.json" >/dev/null 2>&1; then
  echo "update manifests generated without signing configuration" >&2
  exit 1
fi
openssl genpkey -algorithm ED25519 -out "$scratch/other-update-key.pem" >/dev/null 2>&1
other_public=$(
  openssl pkey -in "$scratch/other-update-key.pem" -pubout -outform DER | tail -c 32 | openssl base64 -A
)
if CHANGELOOP_UPDATE_PUBLIC_KEY_BASE64=$other_public \
  "$root/target/debug/changeloop-update-manifest" \
  999.0.0 stable "$update_target" "$scratch/update-candidate" \
  https://updates.invalid/update-release.json https://updates.invalid/cloop \
  "$scratch/mismatch-release.json" "$scratch/mismatch-channel.json" >/dev/null 2>&1; then
  echo "update manifests generated with mismatched public key" >&2
  exit 1
fi
"$root/target/debug/changeloop-update-manifest" \
  999.0.0 stable "$update_target" "$scratch/update-candidate" \
  https://updates.invalid/update-release.json https://updates.invalid/cloop \
  "$scratch/update-release.json" "$scratch/update-channel.json"
"$root/target/debug/cloop" update check \
  --channel-manifest "$scratch/update-channel.json" \
  --public-key "$CHANGELOOP_UPDATE_PUBLIC_KEY_BASE64" --channel stable \
  | grep -q '"artifactSource": "https://updates.invalid/cloop"'

cp "$scratch/update-candidate" "$scratch/update-tampered"
printf x >> "$scratch/update-tampered"
if "$root/target/debug/cloop" update \
  --manifest "$scratch/update-release.json" --artifact "$scratch/update-tampered" \
  --public-key "$CHANGELOOP_UPDATE_PUBLIC_KEY_BASE64" --target "$scratch/update-target" >/dev/null 2>&1; then
  echo "tampered Ed25519 update artifact unexpectedly installed" >&2
  exit 1
fi
case "$update_target" in
  x86_64-unknown-linux-gnu) wrong_update_target=aarch64-unknown-linux-gnu ;;
  *) wrong_update_target=x86_64-unknown-linux-gnu ;;
esac
"$root/target/debug/changeloop-update-manifest" \
  999.0.0 stable "$wrong_update_target" "$scratch/update-candidate" \
  https://updates.invalid/wrong-platform.json https://updates.invalid/wrong-cloop \
  "$scratch/wrong-platform.json" "$scratch/wrong-platform-channel.json"
before_wrong_platform=$(cksum "$scratch/update-target")
if "$root/target/debug/cloop" update \
  --manifest "$scratch/wrong-platform.json" --artifact "$scratch/update-candidate" \
  --public-key "$CHANGELOOP_UPDATE_PUBLIC_KEY_BASE64" --target "$scratch/update-target" >/dev/null 2>&1; then
  echo "validly signed wrong-platform update unexpectedly installed" >&2
  exit 1
fi
test "$before_wrong_platform" = "$(cksum "$scratch/update-target")" || {
  echo "wrong-platform rejection mutated the installed target" >&2
  exit 1
}
"$root/target/debug/cloop" update \
  --manifest "$scratch/update-release.json" --artifact "$scratch/update-candidate" \
  --public-key "$CHANGELOOP_UPDATE_PUBLIC_KEY_BASE64" --target "$scratch/update-target"
cmp "$scratch/update-candidate" "$scratch/update-target"

"$root/target/debug/changeloop-update-manifest" \
  0.0.0 stable "$update_target" "$scratch/update-candidate" \
  https://updates.invalid/downgrade.json https://updates.invalid/old-cloop \
  "$scratch/downgrade.json" "$scratch/downgrade-channel.json"
if "$root/target/debug/cloop" update \
  --manifest "$scratch/downgrade.json" --artifact "$scratch/update-candidate" \
  --public-key "$CHANGELOOP_UPDATE_PUBLIC_KEY_BASE64" --target "$scratch/update-target" >/dev/null 2>&1; then
  echo "downgrade update unexpectedly installed" >&2
  exit 1
fi
unset CHANGELOOP_UPDATE_SIGNING_KEY_BASE64 CHANGELOOP_UPDATE_PUBLIC_KEY_BASE64
echo "release automation: PASS"
