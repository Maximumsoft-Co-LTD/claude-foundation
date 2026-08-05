#!/bin/sh
set -eu

if [ "$#" -lt 1 ]; then
  echo "usage: $0 <file>..." >&2
  exit 64
fi

for file in "$@"; do
  test -f "$file"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file"
  else
    shasum -a 256 "$file"
  fi
done
