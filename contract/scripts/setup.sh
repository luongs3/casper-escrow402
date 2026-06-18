#!/usr/bin/env bash
# One-time toolchain setup for deploying Escrow402 to Casper. Safe to re-run.
set -euo pipefail
echo "== Escrow402 toolchain setup =="

if ! command -v rustup >/dev/null 2>&1; then
  echo "-- installing rustup --"
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
fi
# shellcheck disable=SC1091
source "$HOME/.cargo/env"

echo "-- adding wasm target --"
rustup target add wasm32-unknown-unknown

echo "-- installing cargo-odra --"
cargo install cargo-odra --locked || true

if ! command -v casper-client >/dev/null 2>&1; then
  echo "-- installing casper-client (for keygen) --"
  cargo install casper-client --locked || true
fi

echo ""
echo "Done. $(rustc --version)"
echo "Next: bash scripts/keygen.sh"
