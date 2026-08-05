#!/bin/sh
set -eu

root=$(mktemp -d "${TMPDIR:-/tmp}/changeloop-update.XXXXXX")
trap 'rm -rf "$root"' EXIT HUP INT TERM
target="$root/cloop"
stage="$root/cloop.new"
backup="$root/cloop.backup"

make_program() {
  path=$1
  version=$2
  exit_code=$3
  printf '#!/bin/sh\necho "%s"\nexit %s\n' "$version" "$exit_code" > "$path"
  chmod 755 "$path"
}

install_candidate() {
  candidate=$1
  cp "$candidate" "$stage"
  chmod 755 "$stage"
  mv "$target" "$backup"
  mv "$stage" "$target"
  if "$target" --version >/dev/null 2>&1; then
    rm "$backup"
    return 0
  fi
  rm "$target"
  mv "$backup" "$target"
  return 1
}

make_program "$target" v1 0
make_program "$root/good" v2 0
install_candidate "$root/good"
test "$("$target" --version)" = v2

make_program "$root/bad" v3 42
if install_candidate "$root/bad"; then
  echo "broken candidate unexpectedly installed" >&2
  exit 1
fi
test "$("$target" --version)" = v2
test ! -e "$backup"
test ! -e "$stage"
echo "transactional install and rollback: PASS"
