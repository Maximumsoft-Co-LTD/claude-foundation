#!/bin/sh
set -eu

release_mode=false
if [ "${1:-}" = --release ]; then
  release_mode=true
  shift
fi
if [ "$#" -ne 1 ]; then
  echo "usage: $0 [--release] <cloop-binary>" >&2
  exit 64
fi

cloop=$(CDPATH= cd -- "$(dirname -- "$1")" && pwd)/$(basename -- "$1")
test -x "$cloop"
scratch=$(mktemp -d "${TMPDIR:-/tmp}/changeloop-compat.XXXXXX")
trap 'chmod -R u+w "$scratch" 2>/dev/null || true; rm -rf "$scratch"' EXIT HUP INT TERM
export CHANGELOOP_DATA_DIR="$scratch/state"
export CHANGELOOP_CONFIG_HOME="$scratch/config"

passed=0
skipped=0
total=0

pass() {
  total=$((total + 1))
  passed=$((passed + 1))
  printf '%s: PASS\n' "$1"
}

skip() {
  if [ "$release_mode" = true ]; then
    fail "$1" "required_case_skipped:$2"
  fi
  total=$((total + 1))
  skipped=$((skipped + 1))
  printf '%s: SKIP reason=%s\n' "$1" "$2"
}

fail() {
  printf '%s: FAIL reason=%s\n' "$1" "$2" >&2
  exit 1
}

if [ "${CHANGELOOP_COMPAT_POLICY_TEST_ONLY:-0}" = 1 ]; then
  skip required-policy-fixture simulated_missing_release_capability
  test "$skipped" -eq 1
  echo "repository compatibility skip policy: PASS"
  exit 0
fi

git_quiet() { git -c user.name=compat -c user.email=compat@example.invalid "$@" >/dev/null; }

init_repo() {
  directory=$1
  mkdir -p "$directory"
  git_quiet -C "$directory" init
  printf 'base\n' > "$directory/tracked.txt"
  git_quiet -C "$directory" add tracked.txt
  git_quiet -C "$directory" commit -m base
}

probe_status() {
  name=$1
  directory=$2
  (cd "$directory" && "$cloop" status >/dev/null) || fail "$name" status_rejected
  pass "$name"
}

seed_change() {
  directory=$1
  mkdir -p "$directory/.changeloop"
  printf '%s\n' '{"sessions":{"compat":{"kind":"change","prompt":"compatibility","created_at_ms":1}},"changes":{"compat":{"session_id":"compat","expected_revision":"seed","proof":null,"reviewed":false,"landed":false,"land_operation":null}},"jobs":{}}' > "$directory/.changeloop/operational.json"
  printf '%s\n' '{"command":"sh","args":["-c","cat >/dev/null; printf '\''%s'\'' '\''{\"reviewerModelFamily\":\"compatibility-fixture\",\"findings\":[],\"completedAtMs\":1}'\''"]}' \
    > "$directory/.changeloop/reviewer.json"
}

prove_review() {
  directory=$1
  seed_change "$directory"
  # The reviewer above is repository content and does not run until the
  # operator approves exactly these bytes under a declared model family.
  (cd "$directory" \
    && "$cloop" approve grant --reviewer-family compatibility-fixture --yes >/dev/null \
    && "$cloop" prove compat >/dev/null \
    && "$cloop" review compat >/dev/null)
}

clean="$scratch/clean"
init_repo "$clean"
probe_status clean "$clean"

printf 'dirty\n' >> "$clean/tracked.txt"
printf 'untracked\n' > "$clean/untracked.txt"
(cd "$clean" && "$cloop" status >/dev/null) || fail dirty status_rejected
git -C "$clean" diff --quiet --exit-code && fail dirty working_tree_was_modified
pass dirty

nongit="$scratch/non-git"
mkdir "$nongit"
probe_status non-git "$nongit"

symlink_repo="$scratch/symlink"
init_repo "$symlink_repo"
ln -s tracked.txt "$symlink_repo/tracked-link"
prove_review "$symlink_repo" || fail symlink proof_or_review_failed
if (cd "$symlink_repo" && "$cloop" land compat >/dev/null 2>&1); then
  fail symlink land_accepted_unsupported_symlink
fi
test -L "$symlink_repo/tracked-link" || fail symlink link_was_overwritten
pass symlink

rename_repo="$scratch/rename-delete"
init_repo "$rename_repo"
mv "$rename_repo/tracked.txt" "$rename_repo/renamed.txt"
prove_review "$rename_repo" || fail rename-delete proof_or_review_failed
(cd "$rename_repo" && "$cloop" land compat >/dev/null) || fail rename-delete land_failed
test ! -e "$rename_repo/tracked.txt" && test -f "$rename_repo/renamed.txt" \
  || fail rename-delete projection_changed
pass rename-delete

nested="$scratch/nested"
init_repo "$nested"
init_repo "$nested/child"
probe_status nested-repository "$nested/child"

monorepo="$scratch/monorepo"
init_repo "$monorepo"
mkdir -p "$monorepo/packages/api/src" "$monorepo/packages/web/src"
printf 'api\n' > "$monorepo/packages/api/src/lib.txt"
printf 'web\n' > "$monorepo/packages/web/src/lib.txt"
prove_review "$monorepo" || fail monorepo proof_or_review_failed
pass monorepo

source_repo="$scratch/sparse-source"
init_repo "$source_repo"
mkdir -p "$source_repo/keep" "$source_repo/omit"
printf 'keep\n' > "$source_repo/keep/a"
printf 'omit\n' > "$source_repo/omit/b"
git_quiet -C "$source_repo" add keep omit
git_quiet -C "$source_repo" commit -m sparse
sparse="$scratch/sparse"
git clone --quiet --no-local --filter=blob:none "$source_repo" "$sparse" 2>/dev/null
git -C "$sparse" sparse-checkout set keep
test -f "$sparse/keep/a" && test ! -e "$sparse/omit/b" || fail sparse-checkout projection_invalid
probe_status sparse-checkout "$sparse"

submodule_source="$scratch/submodule-source"
init_repo "$submodule_source"
submodule_host="$scratch/submodule-host"
init_repo "$submodule_host"
git -c protocol.file.allow=always -C "$submodule_host" submodule add --quiet "$submodule_source" vendor/local
git_quiet -C "$submodule_host" commit -am submodule
prove_review "$submodule_host" || fail submodule proof_or_review_failed
git -C "$submodule_host" submodule status | grep -q 'vendor/local' || fail submodule declaration_missing
pass submodule

lfs_pointer="$scratch/lfs-pointer"
init_repo "$lfs_pointer"
printf '*.dat filter=lfs diff=lfs merge=lfs -text\n' > "$lfs_pointer/.gitattributes"
printf 'version https://git-lfs.github.com/spec/v1\noid sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nsize 123456\n' > "$lfs_pointer/asset.dat"
prove_review "$lfs_pointer" || fail git-lfs-pointer proof_or_review_failed
grep -q '^oid sha256:' "$lfs_pointer/asset.dat" || fail git-lfs-pointer pointer_changed
pass git-lfs-pointer

if command -v git-lfs >/dev/null 2>&1 || git lfs version >/dev/null 2>&1; then
  git -C "$lfs_pointer" lfs pointer --check --file=asset.dat >/dev/null \
    || fail git-lfs-local-tool pointer_rejected
  pass git-lfs-local-tool
else
  skip git-lfs-local-tool host_capability_git_lfs_unavailable
fi

case_repo="$scratch/case-sensitive"
init_repo "$case_repo"
printf 'upper\n' > "$case_repo/Case.txt"
printf 'lower\n' > "$case_repo/case.txt"
if [ "$(find "$case_repo" -maxdepth 1 -name '*ase.txt' | wc -l | tr -d ' ')" = 2 ]; then
  git_quiet -C "$case_repo" add Case.txt case.txt
  prove_review "$case_repo" || fail case-sensitive-path-collision proof_or_review_failed
  pass case-sensitive-path-collision
else
  skip case-sensitive-path-collision host_filesystem_case_insensitive
fi

large="$scratch/large-binary"
init_repo "$large"
dd if=/dev/zero of="$large/large.bin" bs=1048576 count=5 2>/dev/null
printf '\001\002\000\377binary\000payload' > "$large/small.bin"
prove_review "$large" || fail large-binary proof_or_review_failed
test "$(wc -c < "$large/large.bin" | tr -d ' ')" = 5242880 || fail large-binary large_file_changed
grep -q 'binary' "$large/small.bin" || fail large-binary binary_file_changed
pass large-binary

readonly="$scratch/read-only"
init_repo "$readonly"
seed_change "$readonly"
before=$(cksum "$readonly/.changeloop/operational.json")
chmod 500 "$readonly/.changeloop"
if (cd "$readonly" && "$cloop" prove compat >/dev/null 2>&1); then
  chmod 700 "$readonly/.changeloop"
  fail read-only write_unexpectedly_succeeded
fi
chmod 700 "$readonly/.changeloop"
after=$(cksum "$readonly/.changeloop/operational.json")
test "$before" = "$after" || fail read-only state_partially_overwritten
pass read-only

full_disk="$scratch/full-disk"
init_repo "$full_disk"
seed_change "$full_disk"
before=$(cksum "$full_disk/.changeloop/operational.json")
if (cd "$full_disk" && (ulimit -f 0; "$cloop" prove compat >/dev/null 2>&1)); then
  fail full-disk-simulated write_limit_unexpectedly_succeeded
fi
after=$(cksum "$full_disk/.changeloop/operational.json")
test "$before" = "$after" || fail full-disk-simulated state_partially_overwritten
pass full-disk-simulated

conflict="$scratch/external-edit-conflict"
init_repo "$conflict"
printf 'candidate\n' > "$conflict/tracked.txt"
prove_review "$conflict" || fail external-edit-conflict proof_or_review_failed
printf 'external-after-proof\n' > "$conflict/tracked.txt"
if (cd "$conflict" && "$cloop" land compat >/dev/null 2>&1); then
  fail external-edit-conflict land_overwrote_external_edit
fi
grep -q 'external-after-proof' "$conflict/tracked.txt" || fail external-edit-conflict external_edit_lost
pass external-edit-conflict

multi="$scratch/multi-repository"
init_repo "$multi/producer"
init_repo "$multi/consumer"
printf 'producer-change\n' > "$multi/producer/tracked.txt"
printf 'consumer-change\n' > "$multi/consumer/tracked.txt"
prove_review "$multi/producer" || fail multi-repository-independent producer_proof_failed
prove_review "$multi/consumer" || fail multi-repository-independent consumer_proof_failed
printf 'producer-external\n' > "$multi/producer/tracked.txt"
if (cd "$multi/producer" && "$cloop" land compat >/dev/null 2>&1); then
  fail multi-repository-independent producer_conflict_was_not_isolated
fi
(cd "$multi/consumer" && "$cloop" land compat >/dev/null) \
  || fail multi-repository-independent consumer_land_was_blocked_by_other_repository
grep -q 'producer-external' "$multi/producer/tracked.txt" \
  || fail multi-repository-independent producer_external_edit_lost
pass multi-repository-independent

printf '%s\n' '{"repositories":[{"name":"producer","path":"producer"},{"name":"consumer","path":"consumer"}]}' > "$multi/changeloop.json"
declaration=$(cd "$multi" && "$cloop" config explain repositories) \
  || fail multi-repository-declaration config_rejected_repository_declaration
printf '%s' "$declaration" | grep -q 'producer' \
  || fail multi-repository-declaration producer_missing_from_effective_config
printf '%s' "$declaration" | grep -q 'consumer' \
  || fail multi-repository-declaration consumer_missing_from_effective_config
pass multi-repository-declaration
skip snapshot-undo no_public_checkpoint_creation_surface_for_hermetic_cli_fixture

test $((passed + skipped)) -eq "$total" || fail matrix-accounting count_mismatch
if [ "$release_mode" = true ] && [ "$skipped" -ne 0 ]; then
  fail matrix-accounting release_evidence_contains_skips
fi
printf 'repository compatibility matrix: PASS passed=%s skipped=%s total=%s\n' "$passed" "$skipped" "$total"
