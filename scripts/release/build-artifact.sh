#!/bin/sh
set -eu

if [ "$#" -ne 3 ]; then
  echo "usage: $0 <target-triple> <version> <output-directory>" >&2
  exit 64
fi

target=$1
version=$2
output=$3
case "$target" in
  x86_64-unknown-linux-gnu|aarch64-unknown-linux-gnu|x86_64-apple-darwin|aarch64-apple-darwin) ;;
  *) echo "unsupported release target: $target" >&2; exit 64 ;;
esac
case "$version" in
  ''|*[!0-9A-Za-z.+-]*) echo "invalid version: $version" >&2; exit 64 ;;
esac

root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
binary="$root/target/$target/release/cloop"
name="changeloop-$version-$target"
stage="$output/$name"

cargo build --locked --release --target "$target" -p changeloop-cli
test -x "$binary"
mkdir -p "$stage"
install -m 755 "$binary" "$stage/cloop"
cat > "$stage/claude-foundation" <<'EOF'
#!/bin/sh
exec "$(dirname -- "$0")/cloop" "$@"
EOF
chmod 755 "$stage/claude-foundation"
install -m 644 "$root/LICENSE" "$stage/LICENSE"
install -m 644 "$root/docs/roadmap.md" "$stage/ROADMAP.md"

# The standard-library writer normalizes ordering, gzip/tar timestamps and
# ownership on both GNU/Linux and macOS (whose bsdtar lacks GNU --sort).
python3 "$root/scripts/release/reproducible-tar.py" "$stage" "$output/$name.tar.gz"
rm -r "$stage"
echo "$output/$name.tar.gz"
