// Pick the escrow client: the live Casper client when the contract + key are configured,
// otherwise the in-memory mock (for local dev / deterministic demos).

import { MockEscrowClient } from "./escrow.ts";
import type { EscrowClient } from "./escrow.ts";
import { CasperEscrowClient, casperConfigFromEnv } from "./casper-client.ts";
import { existsSync } from "node:fs";

/** True when env names a deployed contract and a readable verifier key. */
export function liveConfigured(): boolean {
  const cfg = casperConfigFromEnv();
  return Boolean(cfg.contractHash) && Boolean(cfg.verifierKeyPath) && existsSync(cfg.verifierKeyPath);
}

/**
 * Returns a live CasperEscrowClient when ESCROW402_CONTRACT_HASH (and a readable key) are set,
 * else a MockEscrowClient. Logs the choice to stderr.
 */
export function selectEscrowClient(): EscrowClient {
  if (liveConfigured()) {
    const cfg = casperConfigFromEnv();
    console.error(
      `escrow402: LIVE Casper client (contract ${cfg.contractHash}, chain ${cfg.chainName})`,
    );
    return new CasperEscrowClient(cfg);
  }
  console.error("escrow402: MockEscrowClient (set ESCROW402_CONTRACT_HASH + key to go live)");
  return new MockEscrowClient();
}
