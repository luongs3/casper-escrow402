import { test } from "node:test";
import assert from "node:assert/strict";
import { MockEscrowClient, STATE_OPEN, STATE_RELEASED, STATE_REFUNDED, scoreBps } from "../src/escrow.ts";

test("open creates an OPEN escrow bound to payer/payee/amount/hash", async () => {
  const c = new MockEscrowClient();
  const { id } = await c.open("p", "s", "1000", "0xhash");
  const e = await c.getEscrow(id);
  assert.equal(e.state, STATE_OPEN);
  assert.equal(e.payer, "p");
  assert.equal(e.payee, "s");
  assert.equal(e.amountMotes, "1000");
});

test("zero amount is rejected", async () => {
  const c = new MockEscrowClient();
  await assert.rejects(() => c.open("p", "s", "0", "0x"));
});

test("release pays seller and builds reputation", async () => {
  const c = new MockEscrowClient();
  const { id } = await c.open("p", "s", "1000", "0x");
  await c.release(id);
  assert.equal((await c.getEscrow(id)).state, STATE_RELEASED);
  const rep = await c.reputationOf("s");
  assert.equal(rep.released, 1);
  assert.equal(rep.scoreBps, 10_000);
});

test("refund returns payer and dings reputation", async () => {
  const c = new MockEscrowClient();
  const { id } = await c.open("p", "s", "1000", "0x");
  await c.refund(id);
  assert.equal((await c.getEscrow(id)).state, STATE_REFUNDED);
  assert.equal((await c.reputationOf("s")).refunded, 1);
  assert.equal((await c.reputationOf("s")).scoreBps, 0);
});

test("cannot double-settle an escrow", async () => {
  const c = new MockEscrowClient();
  const { id } = await c.open("p", "s", "1000", "0x");
  await c.release(id);
  await assert.rejects(() => c.release(id));
  await assert.rejects(() => c.refund(id));
});

test("unknown escrow throws", async () => {
  const c = new MockEscrowClient();
  await assert.rejects(() => c.getEscrow(99));
});

test("scoreBps matches the on-chain formula", () => {
  assert.equal(scoreBps(0, 0), 0);
  assert.equal(scoreBps(3, 1), 7500);
  assert.equal(scoreBps(1, 0), 10_000);
});
