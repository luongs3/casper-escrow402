#!/usr/bin/env bash
# Generate a Casper Testnet keypair and print the public key to fund at the faucet.
set -euo pipefail
cd "$(dirname "$0")/.."   # -> contract/
# shellcheck disable=SC1091
source "$HOME/.cargo/env" 2>/dev/null || true

mkdir -p keys
if [ -f keys/secret_key.pem ]; then
  echo "keys/secret_key.pem already exists — reusing it."
else
  casper-client keygen keys
fi

PUB=$(cat keys/public_key_hex)
echo ""
echo "================================================================"
echo " Your Testnet public key:"
echo "   $PUB"
echo ""
echo " 1. Fund it (free) at:  https://testnet.cspr.live/tools/faucet"
echo "    Paste the key, request tokens, wait ~1 minute."
echo " 2. Then run:           bash scripts/deploy-testnet.sh"
echo "================================================================"
