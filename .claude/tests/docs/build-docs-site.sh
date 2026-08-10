#!/usr/bin/env sh
# Build the documentation site as evidence that its pages actually compile.
#
# A grep can prove a page exists; only a build proves its frontmatter parses and
# every sidebar slug resolves. This runs as the `static-analysis` provider.
#
# A worktree sandbox carries tracked files only, so `node_modules` is never
# inherited and the provider has to install before it can build. `npm ci` is
# lockfile-exact and, unlike `npm install`, never rewrites the lockfile — which
# matters here because the lockfile is inside the hashed surface and rewriting
# it mid-proof would expire the very receipt this command is producing.

set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
SITE="$ROOT/website/docs"

[ -f "$SITE/package.json" ] || {
  echo "docs site not found at $SITE" >&2
  exit 1
}

if [ ! -d "$SITE/node_modules" ]; then
  echo "installing docs site dependencies (lockfile-exact)"
  npm --prefix "$SITE" ci --no-audit --no-fund
fi

npm --prefix "$SITE" run build
