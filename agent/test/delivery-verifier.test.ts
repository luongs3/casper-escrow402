import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyDelivery } from "../src/delivery-verifier.ts";

test("valid 2xx non-empty response with required fields passes", () => {
  const r = verifyDelivery(
    { status: 200, body: { price: 1, asset: "X", timestamp: Date.now() } },
    { requiredFields: ["price", "asset"], maxAgeMs: 60_000 },
  );
  assert.equal(r.ok, true);
});

test("status 0 (threw/timed out) fails — fail closed", () => {
  assert.equal(verifyDelivery({ status: 0, body: null }).ok, false);
});

test("non-2xx fails", () => {
  assert.equal(verifyDelivery({ status: 500, body: { x: 1 } }).ok, false);
});

test("empty body fails", () => {
  assert.equal(verifyDelivery({ status: 200, body: {} }).ok, false);
  assert.equal(verifyDelivery({ status: 200, body: "" }).ok, false);
  assert.equal(verifyDelivery({ status: 200, body: [] }).ok, false);
});

test("missing required field fails", () => {
  const r = verifyDelivery({ status: 200, body: { price: 1 } }, { requiredFields: ["price", "asset"] });
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => x.includes("asset")));
});

test("stale data fails the freshness check", () => {
  const r = verifyDelivery({ status: 200, body: { v: 1, timestamp: Date.now() - 120_000 } }, { maxAgeMs: 60_000 });
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => x.includes("stale")));
});

test("custom predicate is honored and a throwing predicate fails closed", () => {
  assert.equal(verifyDelivery({ status: 200, body: { n: 5 } }, { predicate: (b: any) => b.n > 3 }).ok, true);
  assert.equal(verifyDelivery({ status: 200, body: { n: 1 } }, { predicate: (b: any) => b.n > 3 }).ok, false);
  assert.equal(
    verifyDelivery({ status: 200, body: null }, { requireNonEmpty: false, predicate: (b: any) => b.n > 3 }).ok,
    false,
  );
});
