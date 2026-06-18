//! Escrow402 — EscrowRegistry
//!
//! The on-chain settlement core of the x402 trust layer for Casper agents. A payer escrows a
//! micropayment against a seller's promised delivery; a registered verifier (the off-chain
//! delivery checker) then either RELEASES the funds to the seller or REFUNDS the payer if the
//! delivery failed. Every settlement updates the seller's reputation. Unlike a self-declared
//! "intent" attestation, the escrow binds to real custodied value and a real escrow id — there
//! is nothing to spoof: the money only moves on a genuine settlement.
//!
//! Security model (carried from the Vouch audit):
//!   * Funds are custodied by the contract; `release`/`refund` move them, and both are gated.
//!   * `release` and forced `refund` require a registered verifier; the payer may self-refund
//!     only after the timeout (so a stalled/malicious verifier can't trap funds forever).
//!   * `init` is re-entrancy guarded (no owner takeover / count reset).
//!   * Reputation counters use saturating arithmetic.

// Odra 2.x (Casper 2.0/Condor) contracts compile to a `no_std` wasm target; `std` only for tests.
#![cfg_attr(not(test), no_std)]
#![cfg_attr(not(test), no_main)]

extern crate alloc;

use odra::casper_types::U512;
use odra::prelude::*;

/// Refund window: after this many ms the payer can self-refund an still-Open escrow.
const REFUND_TIMEOUT_MS: u64 = 24 * 60 * 60 * 1000; // 24h

pub const STATE_OPEN: u8 = 0;
pub const STATE_RELEASED: u8 = 1;
pub const STATE_REFUNDED: u8 = 2;

#[odra::odra_type]
pub struct Escrow {
    pub payer: Address,
    pub payee: Address,
    pub amount: U512,
    /// Hash binding the escrow to the specific x402 request/response it pays for.
    pub action_hash: String,
    pub state: u8,
    pub opened_at: u64,
}

#[odra::odra_type]
pub struct Reputation {
    pub released: u64,
    pub refunded: u64,
}

impl Reputation {
    /// Settlement success-rate in basis points (0..=10000). 0 history => 0.
    pub fn score_bps(&self) -> u64 {
        let total = self.released.saturating_add(self.refunded);
        if total == 0 {
            0
        } else {
            ((self.released as u128).saturating_mul(10_000) / total as u128) as u64
        }
    }
}

#[odra::event]
pub struct EscrowOpened {
    pub id: u64,
    pub payer: Address,
    pub payee: Address,
    pub amount: U512,
}

#[odra::event]
pub struct Settled {
    pub id: u64,
    pub payee: Address,
    pub released: bool,
}

#[odra::module(errors = Error, events = [EscrowOpened, Settled])]
pub struct EscrowRegistry {
    owner: Var<Address>,
    verifiers: Mapping<Address, bool>,
    count: Var<u64>,
    escrows: Mapping<u64, Escrow>,
    reputations: Mapping<Address, Reputation>,
}

#[odra::odra_error]
pub enum Error {
    AlreadyInitialized = 1,
    NotOwner = 2,
    NotVerifier = 3,
    UnknownEscrow = 4,
    EscrowNotOpen = 5,
    ZeroAmount = 6,
    NotPayer = 7,
    TimeoutNotReached = 8,
}

#[odra::module]
impl EscrowRegistry {
    /// Deploy-time init. Re-entrancy guarded. Deployer becomes owner + first verifier.
    pub fn init(&mut self) {
        if self.owner.get().is_some() {
            self.env().revert(Error::AlreadyInitialized);
        }
        let deployer = self.env().caller();
        self.owner.set(deployer);
        self.verifiers.set(&deployer, true);
        self.count.set(0);
    }

    // ---- owner-gated admin ----

    pub fn add_verifier(&mut self, verifier: Address) {
        self.assert_owner();
        self.verifiers.set(&verifier, true);
    }

    pub fn remove_verifier(&mut self, verifier: Address) {
        self.assert_owner();
        self.verifiers.set(&verifier, false);
    }

    pub fn is_verifier(&self, who: Address) -> bool {
        self.verifiers.get_or_default(&who)
    }

    pub fn owner(&self) -> Address {
        self.owner.get().unwrap_or_revert(&self.env())
    }

    // ---- core: open / release / refund ----

    /// Open an escrow against a seller's promised delivery. Payable: attach the CSPR to escrow.
    /// Returns the new escrow id.
    #[odra(payable)]
    pub fn open_escrow(&mut self, payee: Address, action_hash: String) -> u64 {
        let amount = self.env().attached_value();
        if amount == U512::zero() {
            self.env().revert(Error::ZeroAmount);
        }
        let id = self.count.get_or_default();
        self.escrows.set(
            &id,
            Escrow {
                payer: self.env().caller(),
                payee,
                amount,
                action_hash,
                state: STATE_OPEN,
                opened_at: self.env().get_block_time(),
            },
        );
        self.count.set(id.saturating_add(1));
        self.env().emit_event(EscrowOpened {
            id,
            payer: self.env().caller(),
            payee,
            amount,
        });
        id
    }

    /// Release escrowed funds to the seller — delivery verified. Verifier-gated.
    pub fn release(&mut self, id: u64) {
        self.assert_verifier();
        let mut e = self.load_open(id);
        e.state = STATE_RELEASED;
        let (payee, amount) = (e.payee, e.amount);
        self.escrows.set(&id, e);
        self.bump_reputation(payee, true);
        self.env().transfer_tokens(&payee, &amount);
        self.env().emit_event(Settled { id, payee, released: true });
    }

    /// Refund escrowed funds to the payer — delivery failed. Verifier-gated.
    pub fn refund(&mut self, id: u64) {
        self.assert_verifier();
        self.do_refund(id);
    }

    /// Payer self-refund, allowed only after the timeout (anti-fund-trap escape hatch).
    pub fn refund_expired(&mut self, id: u64) {
        let e = self.load_open(id);
        if self.env().caller() != e.payer {
            self.env().revert(Error::NotPayer);
        }
        if self.env().get_block_time().saturating_sub(e.opened_at) < REFUND_TIMEOUT_MS {
            self.env().revert(Error::TimeoutNotReached);
        }
        self.do_refund(id);
    }

    // ---- views ----

    pub fn get_escrow(&self, id: u64) -> Escrow {
        self.escrows.get(&id).unwrap_or_revert_with(&self.env(), Error::UnknownEscrow)
    }

    pub fn escrow_count(&self) -> u64 {
        self.count.get_or_default()
    }

    pub fn reputation_of(&self, who: Address) -> Reputation {
        self.reputations.get(&who).unwrap_or(Reputation { released: 0, refunded: 0 })
    }

    pub fn reputation_score(&self, who: Address) -> u64 {
        self.reputation_of(who).score_bps()
    }

    // ---- internal ----

    fn do_refund(&mut self, id: u64) {
        let mut e = self.load_open(id);
        e.state = STATE_REFUNDED;
        let (payer, payee, amount) = (e.payer, e.payee, e.amount);
        self.escrows.set(&id, e);
        self.bump_reputation(payee, false);
        self.env().transfer_tokens(&payer, &amount);
        self.env().emit_event(Settled { id, payee, released: false });
    }

    fn load_open(&self, id: u64) -> Escrow {
        let e = self.escrows.get(&id).unwrap_or_revert_with(&self.env(), Error::UnknownEscrow);
        if e.state != STATE_OPEN {
            self.env().revert(Error::EscrowNotOpen);
        }
        e
    }

    fn bump_reputation(&mut self, who: Address, released: bool) {
        let mut rep = self.reputations.get(&who).unwrap_or(Reputation { released: 0, refunded: 0 });
        if released {
            rep.released = rep.released.saturating_add(1);
        } else {
            rep.refunded = rep.refunded.saturating_add(1);
        }
        self.reputations.set(&who, rep);
    }

    fn assert_owner(&self) {
        if self.env().caller() != self.owner.get().unwrap_or_revert(&self.env()) {
            self.env().revert(Error::NotOwner);
        }
    }

    fn assert_verifier(&self) {
        if !self.verifiers.get_or_default(&self.env().caller()) {
            self.env().revert(Error::NotVerifier);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use odra::host::{Deployer, HostRef, NoArgs};

    #[test]
    fn deployer_is_owner_and_verifier() {
        let env = odra_test::env();
        let registry = EscrowRegistry::deploy(&env, NoArgs);
        let deployer = env.get_account(0);
        assert_eq!(registry.owner(), deployer);
        assert!(registry.is_verifier(deployer));
        assert_eq!(registry.escrow_count(), 0);
    }

    #[test]
    fn open_release_pays_seller_and_builds_reputation() {
        let env = odra_test::env();
        let mut registry = EscrowRegistry::deploy(&env, NoArgs);
        let payee = env.get_account(1);

        let id = registry.with_tokens(U512::from(1_000_000_000u64)).open_escrow(payee, "0xabc".into());
        assert_eq!(id, 0);
        assert_eq!(registry.get_escrow(0).state, STATE_OPEN);

        registry.release(0);
        assert_eq!(registry.get_escrow(0).state, STATE_RELEASED);
        let rep = registry.reputation_of(payee);
        assert_eq!(rep.released, 1);
        assert_eq!(rep.refunded, 0);
        assert_eq!(registry.reputation_score(payee), 10_000);
    }

    #[test]
    fn open_refund_returns_payer_and_dings_reputation() {
        let env = odra_test::env();
        let mut registry = EscrowRegistry::deploy(&env, NoArgs);
        let payee = env.get_account(1);
        registry.with_tokens(U512::from(500_000_000u64)).open_escrow(payee, "0xdef".into());
        registry.refund(0);
        assert_eq!(registry.get_escrow(0).state, STATE_REFUNDED);
        let rep = registry.reputation_of(payee);
        assert_eq!(rep.refunded, 1);
        assert_eq!(registry.reputation_score(payee), 0);
    }

    #[test]
    fn non_verifier_cannot_release() {
        let env = odra_test::env();
        let mut registry = EscrowRegistry::deploy(&env, NoArgs);
        let attacker = env.get_account(1);
        let payee = env.get_account(2);
        registry.with_tokens(U512::from(1_000u64)).open_escrow(payee, "0x1".into());
        env.set_caller(attacker);
        assert_eq!(registry.try_release(0), Err(Error::NotVerifier.into()));
    }

    #[test]
    fn cannot_double_settle() {
        let env = odra_test::env();
        let mut registry = EscrowRegistry::deploy(&env, NoArgs);
        let payee = env.get_account(1);
        registry.with_tokens(U512::from(1_000u64)).open_escrow(payee, "0x1".into());
        registry.release(0);
        assert_eq!(registry.try_release(0), Err(Error::EscrowNotOpen.into()));
        assert_eq!(registry.try_refund(0), Err(Error::EscrowNotOpen.into()));
    }

    #[test]
    fn zero_amount_rejected() {
        let env = odra_test::env();
        let mut registry = EscrowRegistry::deploy(&env, NoArgs);
        let payee = env.get_account(1);
        assert_eq!(
            registry.try_open_escrow(payee, "0x1".into()),
            Err(Error::ZeroAmount.into())
        );
    }
}
