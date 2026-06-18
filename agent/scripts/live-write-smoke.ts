// Live WRITE smoke test: drive a full settlement loop on-chain through the TS client.
// open_escrow (payable, via proxy) -> release -> read back state. Spends real testnet gas.
//
// Run from agent/:
//   ESCROW402_CONTRACT_HASH=hash-... node --experimental-strip-types scripts/live-write-smoke.ts

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

const self = client.selfAccountHash();
console.log("=== Escrow402 live WRITE smoke (real on-chain txs) ===");
console.log("contract:", contractHash);
console.log("account:", self);
console.log("count before:", await client.count());

// 1. open an escrow against ourselves (1 CSPR), through the payable proxy.
console.log("\nopen_escrow (1 CSPR, payable via proxy)...");
const opened = await client.open(self, self, "1000000000", "0xts-write-smoke");
console.log("  -> escrow id", opened.id, "tx", opened.txHash);

// 2. release it (we are the registered verifier).
console.log("release...");
const released = await client.release(opened.id);
console.log("  -> tx", released.txHash);

// 3. read back the settled escrow + reputation.
const e = await client.getEscrow(opened.id);
console.log("\ngetEscrow:", JSON.stringify(e));
console.log("reputation:", JSON.stringify(await client.reputationOf(self)));
console.log("count after:", await client.count());
console.log("\nOK — full open->release loop executed on-chain via the TS client.");
