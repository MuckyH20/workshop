#!/usr/bin/env bash
# Narrated Heartbeat demo — fully offline (LiteSVM, warped clock). Usage: bash scripts/demo.sh
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/env.sh
[ -f target/deploy/heartbeat.so ] || build_sbf >/dev/null 2>&1
PATH="${PATH#*/rust/bin:}" cargo test -q -p heartbeat --test demo -- --nocapture 2>&1 | grep -vE '^(running|test result|$)'
