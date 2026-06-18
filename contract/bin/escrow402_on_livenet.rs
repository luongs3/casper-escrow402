//! Deploy EscrowRegistry to a live Casper network (testnet) and prove the full settlement loop
//! on-chain: deploy (or load) → open an escrow (attach 1 CSPR) → release → read reputation.
//!
//! Run (after `cargo odra build` and a funded key in casper-test.env):
//!   ODRA_CASPER_LIVENET_ENV=casper-test cargo run --bin escrow402_on_livenet --features=livenet
//!
//! Idempotent: set ESCROW402_CONTRACT_ADDRESS=hash-... to reuse an already-deployed contract
//! (skips the install and just runs open→release against it); leave it unset to deploy fresh.

use escrow402_contract::EscrowRegistry;
use odra::casper_types::U512;
use odra::host::{Deployer, HostRef, HostRefLoader, NoArgs};
use odra::prelude::*;

// Casper 2.0 prices a *payable* entrypoint as a session deploy routed "through proxy" (it ships a
// session wasm to attach the CSPR), so it needs a much larger gas budget than a plain call. Unused
// gas is refunded, so we budget generously. 512 CSPR matches Odra's own livenet examples.
const PAYABLE_GAS: u64 = 512_000_000_000;
const CALL_GAS: u64 = 20_000_000_000;
const INSTALL_GAS: u64 = 300_000_000_000;

fn main() {
    let env = odra_casper_livenet_env::env();
    let caller = env.caller();

    // 1. Deploy the contract (deployer becomes owner + first verifier), or load an existing one.
    let mut registry = match std::env::var("ESCROW402_CONTRACT_ADDRESS") {
        Ok(addr) if !addr.is_empty() => {
            let address = Address::from_str(&addr).expect("invalid ESCROW402_CONTRACT_ADDRESS");
            println!("Loading existing EscrowRegistry at {addr}");
            EscrowRegistry::load(&env, address)
        }
        _ => {
            env.set_gas(INSTALL_GAS);
            let registry = EscrowRegistry::deploy(&env, NoArgs);
            println!(
                "ESCROW402_CONTRACT_ADDRESS={}",
                registry.address().to_string()
            );
            registry
        }
    };

    // 2. Open an escrow against ourselves as the seller, attaching 1 CSPR (payable -> via proxy).
    env.set_gas(PAYABLE_GAS);
    let id = registry
        .with_tokens(U512::from(1_000_000_000u64))
        .open_escrow(caller, "0xlivenet-demo".into());
    println!("opened escrow id={id} (1 CSPR locked on-chain)");

    // 3. Release it (we are the deployer = a registered verifier).
    env.set_gas(CALL_GAS);
    registry.release(id);
    println!("released escrow id={id} -> funds paid to payee on-chain");

    // 4. Read the resulting reputation (free state query).
    let score = registry.reputation_score(caller);
    println!("reputation_score(payee)={score} bps (10000 = 100% settled)");
    println!("DONE. View the contract + deploys on https://testnet.cspr.live");
}
