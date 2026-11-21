#!/usr/bin/env bash
# One-shot gate: fmt → SBF build → clippy → LiteSVM tests. Usage: bash scripts/check.sh
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/env.sh
cargo fmt --all --check
build_sbf 2>&1 | grep -vE '^\s*$' | tail -n2
(PATH="${PATH#*/rust/bin:}"; cargo clippy --all-targets -q -- -D warnings && cargo test -q -p heartbeat 2>&1 | grep -E 'test result|FAILED|panicked')
mkdir -p target && touch target/.native-check-ok
