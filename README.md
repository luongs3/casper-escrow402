# Escrow402 — verifiable escrow, settlement & reputation for Casper's x402 economy

**Casper Agentic Buildathon 2026.** x402 payments are final and non-refundable: an agent pays per
request, and if the seller returns junk, an error, or nothing, the money is gone. **Escrow402 is
the trust layer that makes machine-to-machine payments safe.** It wraps any x402 call:

1. **Lock** — the payer's micropayment is escrowed in an Odra contract on Casper, not paid directly.
2. **Verify** — the seller's response is checked by a pluggable delivery verifier (status, non-empty, required fields, freshness).
3. **Settle** — valid delivery → funds **release** to the seller; bad delivery → escrow **auto-refunds** the payer.
4. **Reputation** — every settlement updates the seller's on-chain reputation, exposed as an MCP `trust_score` tool agents query *before* they pay.

```
  buyer agent ──pay_safely(seller, amount)──▶ Escrow402
       ▲                                          │ 1. open escrow (lock CSPR)  ── on-chain ──▶ EscrowRegistry
       │                                          │ 2. call seller's x402 endpoint
       │  4. response + receipt                   │ 3. verify delivery
       │                                          ▼
       └───────────────  release → seller paid  |  refund → buyer made whole  ── on-chain ──▶ + reputation
```

## Why this, and why it's different

The Casper field is full of agents that *consume* x402 (sell data, make payments) and risk
*sentinels* that vet your own action before you sign. **Nobody builds the trust rails the x402
economy itself depends on.** On EVM these exist (PayCrow, x402Disputes, ERC-8004 reputation); on
Casper — the first L1 with live x402 — they don't yet. Escrow402 fills that gap, and because it
settles on **real custodied value and a real escrow id**, there is no "did the attestation bind to
the real tx?" problem: the money only moves on a genuine, verified settlement.

## Live on Casper Testnet

The `EscrowRegistry` is **deployed and proven on-chain** (Casper 2.0 testnet, `casper-test`):

- **Contract:** [`hash-e19693d6…afd3bf415`](https://testnet.cspr.live/contract-package/e19693d6fd8641f98202ddbff190b1fea37561246b29fad4eb1f073afd3bf415)
- A full settlement loop (deploy → `open_escrow` → `release` → reputation) has executed on-chain,
  both from the Rust deploy binary **and** from the TypeScript `CasperEscrowClient`. Transaction
  hashes and explorer links are in [`contract/DEPLOYED.md`](contract/DEPLOYED.md).
- The on-chain reputation reads back as `released=2, refunded=0` (100% settled).

## Layout

| Path | What |
|---|---|
| `contract/` | Odra (Rust) `EscrowRegistry`: payable `open_escrow`, verifier-gated `release`/`refund`, payer self-refund after timeout, on-chain reputation. Deployed to testnet. |
| `agent/src/` | `delivery-verifier`, `escrow` client (mock + **live `casper-client`**), `pay-safely` core, `http-seller`, x402 `mcp-server`, `server`, `select-client` |
| `agent/demo/` | A buyer agent paying good/junk/dead sellers — release vs auto-refund |

## Quick start

```bash
cd agent && npm install
npm test     # 28 unit tests: delivery verifier, escrow state machine, paySafely, live-client helpers
npm run demo # end-to-end: release on valid delivery, auto-refund on junk/dead seller
npm run mcp  # MCP server (pay_safely + trust_score tools)
npm run serve # HTTP: POST /pay-safely, GET /trust/:address
```

By default the agent uses an in-memory mock that mirrors the contract. To run against the **live
testnet contract**, set the env and the client switches automatically:

```bash
export ESCROW402_CONTRACT_HASH=hash-e19693d6fd8641f98202ddbff190b1fea37561246b29fad4eb1f073afd3bf415
export ESCROW402_VERIFIER_KEY_PATH=../contract/keys/secret_key.pem
npm run smoke:read   # read-only: escrow_count, getEscrow, reputation — from on-chain state
npm run smoke:write  # full open→release loop on-chain (spends testnet gas)
```

## Build & deploy the contract

```bash
cd contract
bash scripts/setup.sh         # rust (nightly per rust-toolchain.toml) + cargo-odra
cargo odra build              # -> wasm/EscrowRegistry.wasm  (needs wasm-opt + wasm-strip)
cp casper-test.env.sample casper-test.env   # point at a testnet node
ODRA_CASPER_LIVENET_ENV=casper-test cargo run --bin escrow402_on_livenet --features=livenet
```

Built with **Odra 2.x** (Casper 2.0 / Condor). See `contract/DEPLOYED.md` for the toolchain notes.

## License
MIT — original work for the Casper Agentic Buildathon 2026.
