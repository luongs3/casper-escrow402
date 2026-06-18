// Network-free unit tests for the live-client helpers: dictionary-key derivation, address/key
// serialization, value decoders, and client selection. (The on-chain read/write paths are
// exercised separately by scripts/live-smoke.ts against the deployed contract.)

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dictItemKey,
  addressKeyBytes,
  u64KeyBytes,
  decodeU64LE,
  decodeReputation,
  FIELD,
} from "../src/casper-state.ts";
import { casperConfigFromEnv } from "../src/casper-client.ts";

test("field indices are 1-based in declaration order", () => {
  assert.equal(FIELD.owner, 1);
  assert.equal(FIELD.verifiers, 2);
  assert.equal(FIELD.count, 3);
  assert.equal(FIELD.escrows, 4);
  assert.equal(FIELD.reputations, 5);
});

test("dictItemKey is a stable 64-char hex blake2b digest", () => {
  const k = dictItemKey(FIELD.count);
  assert.match(k, /^[0-9a-f]{64}$/);
  // Deterministic: the `count` Var key matches the value verified on-chain.
  assert.equal(k, dictItemKey(FIELD.count));
});

test("dictItemKey differs per field and per mapping key", () => {
  assert.notEqual(dictItemKey(FIELD.count), dictItemKey(FIELD.owner));
  const a = dictItemKey(FIELD.escrows, u64KeyBytes(0));
  const b = dictItemKey(FIELD.escrows, u64KeyBytes(1));
  assert.notEqual(a, b);
});

test("addressKeyBytes tags account vs contract hashes (33 bytes)", () => {
  const acct = addressKeyBytes("8e23407a8cd5826acba5d6b51c466c35c034d385b6688bfdf40647927a91f90e");
  assert.equal(acct.length, 33);
  assert.equal(acct[0], 0x00); // account tag
  const withPrefix = addressKeyBytes(
    "account-hash-8e23407a8cd5826acba5d6b51c466c35c034d385b6688bfdf40647927a91f90e",
  );
  assert.deepEqual(Array.from(acct), Array.from(withPrefix));
  const contract = addressKeyBytes(
    "hash-e19693d6fd8641f98202ddbff190b1fea37561246b29fad4eb1f073afd3bf415",
  );
  assert.equal(contract[0], 0x01); // contract/package tag
});

test("addressKeyBytes rejects a wrong-length hash", () => {
  assert.throws(() => addressKeyBytes("deadbeef"));
});

test("u64KeyBytes is little-endian 8 bytes", () => {
  assert.deepEqual(Array.from(u64KeyBytes(0)), [0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(Array.from(u64KeyBytes(1)), [1, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(Array.from(u64KeyBytes(258)), [2, 1, 0, 0, 0, 0, 0, 0]);
});

test("decodeU64LE round-trips u64KeyBytes", () => {
  for (const n of [0, 1, 7, 1000, 65_535]) {
    assert.equal(decodeU64LE(Buffer.from(u64KeyBytes(n))), n);
  }
});

test("decodeReputation reads two little-endian u64 counts", () => {
  // released=1, refunded=0 — the exact on-chain bytes for the deployer after one release.
  const bytes = Buffer.from("01000000000000000000000000000000", "hex");
  assert.deepEqual(decodeReputation(bytes), { released: 1, refunded: 0 });
  const mixed = Buffer.from("03000000000000000200000000000000", "hex");
  assert.deepEqual(decodeReputation(mixed), { released: 3, refunded: 2 });
});

test("casperConfigFromEnv falls back to public testnet defaults", () => {
  const saved = { ...process.env };
  delete process.env.ESCROW402_NODE_RPC;
  delete process.env.ESCROW402_CHAIN_NAME;
  const cfg = casperConfigFromEnv();
  assert.equal(cfg.nodeRpc, "https://node.testnet.casper.network/rpc");
  assert.equal(cfg.chainName, "casper-test");
  process.env = saved;
});
