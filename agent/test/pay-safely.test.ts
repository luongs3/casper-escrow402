import { test } from "node:test";
import assert from "node:assert/strict";
import { paySafely } from "../src/pay-safely.ts";
import { MockEscrowClient } from "../src/escrow.ts";
import type { SellerResponse } from "../src/delivery-verifier.ts";

const good = async (): Promise<SellerResponse> => ({ status: 200, body: { price: 1, asset: "X", timestamp: Date.now() } });
const junk = async (): Promise<SellerResponse> => ({ status: 200, body: {} });
const dead = async (): Promise<SellerResponse> => { throw new Error("down"); };

const base = (client: MockEscrowClient, seller: any, payee = "s") => ({
  client, payer: "buyer", payee, amountMotes: "1000000000",
  request: { feed: "X" }, seller,
  expectations: { requiredFields: ["price", "asset"], maxAgeMs: 60_000 },
});

test("valid delivery releases the escrow to the seller", async () => {
  const c = new MockEscrowClient();
  const r = await paySafely(base(c, good));
  assert.equal(r.released, true);
  assert.equal((await c.getEscrow(r.escrowId)).state, 1);
  assert.equal(r.reputation.released, 1);
});

test("junk delivery auto-refunds the buyer", async () => {
  const c = new MockEscrowClient();
  const r = await paySafely(base(c, junk));
  assert.equal(r.released, false);
  assert.equal((await c.getEscrow(r.escrowId)).state, 2);
  assert.equal(r.reputation.refunded, 1);
});

test("seller that throws is treated as non-delivery and refunds (fail-closed)", async () => {
  const c = new MockEscrowClient();
  const r = await paySafely(base(c, dead));
  assert.equal(r.released, false);
  assert.equal(r.response.status, 0);
});

test("escrow binds to a deterministic action hash of payee+amount+request", async () => {
  const c = new MockEscrowClient();
  const r1 = await paySafely(base(c, good));
  const r2 = await paySafely(base(c, good));
  assert.match(r1.actionHash, /^0x[0-9a-f]{64}$/);
  assert.equal(r1.actionHash, r2.actionHash); // same inputs => same binding
});

test("reputation reflects mixed history", async () => {
  const c = new MockEscrowClient();
  await paySafely(base(c, good));
  await paySafely(base(c, good));
  await paySafely(base(c, junk));
  const rep = await c.reputationOf("s");
  assert.equal(rep.released, 2);
  assert.equal(rep.refunded, 1);
  assert.equal(rep.scoreBps, 6666);
});
