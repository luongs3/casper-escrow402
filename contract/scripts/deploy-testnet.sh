#!/usr/bin/env bash
# Build the wasm and deploy EscrowRegistry to Casper Testnet, proving open->release on-chain.
set -euo pipefail
cd "$(dirname "$0")/.."   # -> contract/
# shellcheck disable=SC1091
source "$HOME/.cargo/env" 2>/dev/null || true

if [ ! -f casper-test.env ]; then
  echo "Missing contract/casper-test.env"
  echo "  cp casper-test.env.sample casper-test.env   # then fill in the secret key path + CSPR.cloud token"
  exit 1
fi

echo "== building wasm (cargo odra build) =="
cargo odra build

echo "== deploying to casper-test =="
ODRA_CASPER_LIVENET_ENV=casper-test cargo run --bin escrow402_on_livenet --features=livenet | tee /tmp/escrow402-deploy.log

ADDR=$(grep -oE 'ESCROW402_CONTRACT_ADDRESS=hash-[0-9a-f]+' /tmp/escrow402-deploy.log | head -1 | cut -d= -f2 || true)
if [ -n "${ADDR:-}" ]; then
  echo "ESCROW402_CONTRACT_HASH=$ADDR" > ../agent/.env
  echo ""
  echo "Deployed: $ADDR"
  echo "Wrote ../agent/.env (ESCROW402_CONTRACT_HASH). View it on https://testnet.cspr.live"
else
  echo "Could not parse a contract address from the output — check /tmp/escrow402-deploy.log"
  exit 1
fi
