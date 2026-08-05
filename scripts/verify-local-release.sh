#!/bin/sh
set -eu

# Local, credential-free implementation verification. This deliberately does
# not claim the external GA gates (live providers, signing/notarization,
# multi-platform CI, or source-frozen eight-hour soak evidence).

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$repo_root"

step() {
  printf '\n==> %s\n' "$1"
}

step "Formatting"
cargo fmt --all -- --check
git diff --check

step "Rust workspace tests"
cargo test --workspace --locked

step "Rust lint"
cargo clippy --workspace --all-targets --locked -- -D warnings

step "MSRV dependency contract"
npm run test:msrv

step "Runtime API oracle"
npm run test:oracle

step "Rust harness parity"
npm run test:m9-parity

step "Provider replay corpus"
npm run test:provider-replay

step "TypeScript SDK against the local app-server"
npm run test:sdk

step "Foundation deterministic suites"
sh .claude/tests/run-all.sh

step "Debug CLI build"
cargo build --locked -p changeloop-cli

step "Repository compatibility matrix (developer mode)"
sh tests/compatibility/repository-matrix.sh target/debug/cloop

step "Hermetic lifecycle"
sh tests/compatibility/hermetic-lifecycle-e2e.sh target/debug/cloop

step "Release automation policy"
sh tests/compatibility/release-automation.sh

step "Local performance contract tests"
npm run test:performance

step "Release CLI build"
cargo build --locked --release -p changeloop-cli

printf '\nLocal implementation verification: PASS\n'
printf '%s\n' 'Release-mode SKIPs and external/time-bound GA evidence are still required; see docs/roadmap-traceability.md.'
