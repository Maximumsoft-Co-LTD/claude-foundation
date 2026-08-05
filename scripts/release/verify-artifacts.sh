#!/bin/sh
set -eu

if [ "$#" -ne 2 ]; then
  echo "usage: $0 <artifact-directory> <checksums-file>" >&2
  exit 64
fi

directory=$(CDPATH= cd -- "$1" && pwd)
checksums=$2
case "$checksums" in
  /*) ;;
  *) checksums=$(CDPATH= cd -- "$(dirname -- "$checksums")" && pwd)/$(basename -- "$checksums") ;;
esac
test -s "$checksums"
verified_files=$(mktemp "${TMPDIR:-/tmp}/changeloop-verified.XXXXXX")
actual_files=$(mktemp "${TMPDIR:-/tmp}/changeloop-artifacts.XXXXXX")
trap 'rm -f "$verified_files" "$actual_files"' EXIT HUP INT TERM

# Refuse absolute paths, traversal, duplicates, and files absent from the manifest.
awk '
  NF != 2 || length($1) != 64 || $1 !~ /^[0-9a-fA-F]+$/ { exit 1 }
  $2 ~ /^\*/ { $2=substr($2,2) }
  $2 ~ /^\// || $2 ~ /\// || $2 ~ /(^|\/)\.\.($|\/)/ || seen[$2]++ { exit 1 }
  { print $2 }
' "$checksums" | sort > "$verified_files"

(cd "$directory" && {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum -c "$checksums"
  else
    shasum -a 256 -c "$checksums"
  fi
})

find "$directory" -maxdepth 1 -type f -name 'changeloop-*.tar.gz' -exec basename {} \; | sort > "$actual_files"
cmp -s "$verified_files" "$actual_files" || {
  echo "checksum manifest does not name exactly the release archives" >&2
  exit 1
}
artifact_count=$(wc -l < "$actual_files" | tr -d ' ')
test "$artifact_count" -gt 0

for archive in "$directory"/changeloop-*.tar.gz; do
  test -f "$archive"
  entries=$(tar -tzf "$archive")
  if echo "$entries" | grep -Eq '(^|/)\.\.(/|$)|^/'; then
    echo "unsafe archive path: $archive" >&2
    exit 1
  fi
  # Release archives may contain only regular files and directories. Rejecting
  # links before any extraction prevents a link-then-file escape.
  tar -tvzf "$archive" | awk 'substr($1,1,1) !~ /^[-d]$/ { exit 1 }'
  case "$archive" in
    *-sbom.cdx.tar.gz) ;;
    *)
      top=$(printf '%s\n' "$entries" | sed -n '1s#/$##p')
      test -n "$top"
      printf '%s\n' "$entries" | sort > "$actual_files"
      printf '%s\n' "$top/" "$top/LICENSE" "$top/ROADMAP.md" "$top/claude-foundation" "$top/cloop" | sort > "$verified_files"
      cmp -s "$verified_files" "$actual_files" || {
        echo "unexpected archive contents: $archive" >&2
        exit 1
      }
      tar -tvzf "$archive" | awk '
        $NF ~ /\/(cloop|claude-foundation)$/ {
          found++
          if (substr($1,1,1) != "-" || substr($1,4,1) != "x" || substr($1,7,1) != "x" || substr($1,10,1) != "x") exit 1
        }
        END { if (found != 2) exit 1 }
      '
      ;;
  esac
done

echo "verified $artifact_count release artifact(s)"
