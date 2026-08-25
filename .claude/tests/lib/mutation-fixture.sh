#!/usr/bin/env sh
# Build a private source tree for mutation tests. Mutants must never touch the
# checkout: private trees let independent mutation suites run concurrently and
# make interruption cleanup a plain temporary-directory removal.

create_mutation_fixture() {
  mutation_source_root="$1"
  mutation_fixture_root="$2"

  mkdir -p "$mutation_fixture_root/.claude" "$mutation_fixture_root/openspec"
  cp -R "$mutation_source_root/.claude/harness" \
    "$mutation_fixture_root/.claude/harness"
  cp -R "$mutation_source_root/.claude/tests" \
    "$mutation_fixture_root/.claude/tests"
  cp -R "$mutation_source_root/openspec/schemas" \
    "$mutation_fixture_root/openspec/schemas"
  cp "$mutation_source_root/openspec/config.yaml" \
    "$mutation_fixture_root/openspec/config.yaml"
  if [ -d "$mutation_source_root/node_modules" ]; then
    ln -s "$mutation_source_root/node_modules" "$mutation_fixture_root/node_modules"
  fi
}
