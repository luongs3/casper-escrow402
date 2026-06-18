# Escrow402 — Casper Testnet Deployment Receipts

**Step A complete.** `EscrowRegistry` is deployed and the full settlement loop
(open escrow → release → reputation) is proven on-chain on **Casper Testnet (casper-test, Casper 2.0 / Condor)**.

## Contract
- **Address:** `hash-e19693d6fd8641f98202ddbff190b1fea37561246b29fad4eb1f073afd3bf415`
- **Package:** `contract-package-e19693d6fd8641f98202ddbff190b1fea37561246b29fad4eb1f073afd3bf415`
- Explorer: https://testnet.cspr.live/contract-package/e19693d6fd8641f98202ddbff190b1fea37561246b29fad4eb1f073afd3bf415

## Transactions (all verified SUCCESS via `info_get_transaction` on node.testnet.casper.network)
| Step | Transaction hash | Explorer |
|------|------------------|----------|
| Deploy (install) | `24bbb1fe4be2dab96bede2dda666dbf91d1a457d140847610d408cea3698b26d` | https://testnet.cspr.live/transaction/24bbb1fe4be2dab96bede2dda666dbf91d1a457d140847610d408cea3698b26d |
| open_escrow (1 CSPR locked) | `bda9613108fe52f95e065ebb0b7c526f73c5b4ef22896274f1d7c8fba38c9f21` | https://testnet.cspr.live/transaction/bda9613108fe52f95e065ebb0b7c526f73c5b4ef22896274f1d7c8fba38c9f21 |
| release (paid payee) | `453074b3dff22ef8209e92750edc4dea85c3ca5884a4cc20f8d58250f94ae586` | https://testnet.cspr.live/transaction/453074b3dff22ef8209e92750edc4dea85c3ca5884a4cc20f8d58250f94ae586 |

Result read back from on-chain state: `reputation_score(payee) = 10000 bps` (100% settled).

### Step B — live TypeScript client (casper-js-sdk v5) settling on-chain
The `CasperEscrowClient` (agent/src/casper-client.ts) drives the same contract from TypeScript:
payable `open_escrow` through Odra's session-wasm proxy, direct `release`/`refund`, and read-only
global-state decoding of escrows/reputation/count. Verified by a real on-chain loop:

| Step | Transaction hash | Cost |
|------|------------------|------|
| open_escrow (escrow #1, via proxy) | `991046750053ef0fd9ab8ffe12ebe3d9a537c99ebc67aeb0d8851b346e00849f` | 521 CSPR |
| release (escrow #1) | `efd9c25ef4bce63394790fa522168662b158d75a7f4ca72c6cef92a1f097a6ce` | 20 CSPR |

After this loop the on-chain reputation read back as `released=2, refunded=0` (escrow_count=2),
proving the TS write path mutates real state. Reproduce: `cd agent && npm run smoke:read` (read-only)
or `scripts/live-write-smoke.ts` (spends gas).

## Deployer / verifier account
- Public key: `014ebba742941e7fb60c4d846892d10995538569f4af64ef28bbcdae00ef65c484`
- Account hash: `8e23407a8cd5826acba5d6b51c466c35c034d385b6688bfdf40647927a91f90e`
- Balance: 1000 → ~580 CSPR after deploy + open + release (testnet, no real value).

## Toolchain / build notes (Casper 2.0 migration)
Testnet is Casper 2.0 (Condor); the original code targeted Casper 1.x. Changes made to deploy:
- Odra `1.4.0` → `2.8.1` (all four crates), pinned `nightly-2026-01-01` via `rust-toolchain.toml`.
- `lib.rs`: added `#![cfg_attr(not(test), no_std)]` / `no_main` + `extern crate alloc`.
- 2.x build wiring: root `build.rs` (`odra_build::build()`), rewritten `bin/build_{contract,schema}.rs`,
  build bins renamed `escrow402_contract_*`, host-only `odra-build` dep.
- Deploy bin: `use odra::host::HostRef` (for `with_tokens`); idempotent load via
  `ESCROW402_CONTRACT_ADDRESS`; payable gas raised to 512 CSPR (Casper 2.0 routes payable calls
  through a session-wasm proxy).
- Node: token-free public RPC `https://node.testnet.casper.network` (cspr.cloud needs a token).

## Build / deploy commands
```bash
cd contract
cargo odra build                       # -> wasm/EscrowRegistry.wasm
# fresh deploy + open + release:
ODRA_CASPER_LIVENET_ENV=casper-test cargo run --bin escrow402_on_livenet --features=livenet
# reuse existing contract (open + release only):
ESCROW402_CONTRACT_ADDRESS=hash-e19693d6...415 ODRA_CASPER_LIVENET_ENV=casper-test \
  cargo run --bin escrow402_on_livenet --features=livenet
```
