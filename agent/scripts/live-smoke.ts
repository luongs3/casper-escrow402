// Live read-only smoke test against the deployed EscrowRegistry on Casper Testnet.
// Proves the live client can resolve the contract and decode on-chain state — no gas, no writes.
//
// Run from agent/:
//   ESCROW402_CONTRACT_HASH=hash-... node --experimental-strip-types scripts/live-smoke.ts
// (ESCROW402_CONTRACT_HASH is read from agent/.env-style env; defaults to the deployed package.)

import { CasperEscrowClient } from "../src/casper-client.ts";

const contractHash =
  process.env.ESCROW402_CONTRACT_HASH ??
  "hash-e19693d6fd8641f98202ddbff190b1fea37561246b29fad4eb1f073afd3bf415";

const client = new CasperEscrowClient({
  nodeRpc: process.env.ESCROW402_NODE_RPC ?? "https://node.testnet.casper.network/rpc",
  contractHash,
  verifierKeyPath: process.env.ESCROW402_VERIFIER_KEY_PATH ?? "../contract/keys/secret_key.pem",
  chainName: process.env.ESCROW402_CHAIN_NAME ?? "casper-test",
});

console.log("=== Escrow402 live read-only smoke test ===");
console.log("contract:", contractHash);

const self = client.selfAccountHash();
console.log("verifier/deployer account:", self);

const count = await client.count();
console.log("escrow_count():", count);

if (count > 0) {
  const e = await client.getEscrow(0);
  console.log("getEscrow(0):", JSON.stringify(e, null, 2));
}

const rep = await client.reputationOf(self);
console.log("reputationOf(deployer):", JSON.stringify(rep));

console.log("\nOK — live client read path verified against on-chain state.");
