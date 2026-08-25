#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

shell_count=0
while IFS= read -r path; do
  [ -n "$path" ] || continue
  case "$(head -n 1 "$path")" in
    *bash*) bash -n "$path" ;;
    *) sh -n "$path" ;;
  esac
  shell_count=$((shell_count + 1))
done < <(git ls-files '*.sh')

ruby -c Formula/claude-foundation.rb >/dev/null
ruby -e 'require "yaml"; ARGV.each { |path| YAML.parse_file(path) }' .github/workflows/*.yml

node -e '
  const { readFileSync } = require("node:fs");
  const { execFileSync } = require("node:child_process");
  const paths = execFileSync("git", ["ls-files", "*.json"], { encoding: "utf8" }).trim().split("\n").filter(Boolean);
  for (const path of paths) JSON.parse(readFileSync(path, "utf8"));
  process.stdout.write(`static surfaces: ${paths.length} JSON files valid\n`);
'
printf 'static surfaces: %s shell files, workflow YAML and Formula syntax valid\n' "$shell_count"
