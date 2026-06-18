// Escrow402 demo: a buyer agent pays two sellers through escrow.
// Run: npm run demo
//
// Seller A delivers valid data → escrow releases, A's reputation rises.
// Seller B returns junk → escrow AUTO-REFUNDS the buyer, B's reputation falls.
// Seller C throws → treated as non-delivery → buyer refunded (fail-closed).

import { paySafely } from "../src/pay-safely.ts";
import { MockEscrowClient } from "../src/escrow.ts";
import type { SellerResponse } from "../src/delivery-verifier.ts";

const client = new MockEscrowClient();
const BUYER = "01-buyer-agent";
const SELLER_A = "01-seller-good";
const SELLER_B = "01-seller-junk";
const SELLER_C = "01-seller-dead";
const PRICE = "1000000000"; // 1 CSPR in motes

const goodSeller = async (): Promise<SellerResponse> => ({
  status: 200,
  body: { price: 2451.12, asset: "GOLD-USD", timestamp: Date.now() },
});
const junkSeller = async (): Promise<SellerResponse> => ({ status: 200, body: {} });
const deadSeller = async (): Promise<SellerResponse> => {
  throw new Error("connection reset");
};

const cases = [
  { name: "Seller A (valid data feed)", payee: SELLER_A, seller: goodSeller },
  { name: "Seller B (empty response)", payee: SELLER_B, seller: junkSeller },
  { name: "Seller C (endpoint down)", payee: SELLER_C, seller: deadSeller },
  { name: "Seller A again (valid)", payee: SELLER_A, seller: goodSeller },
];

console.log("=== Escrow402 demo: pay-per-call x402 with escrowed settlement ===\n");

for (const c of cases) {
  const r = await paySafely({
    client,
    payer: BUYER,
    payee: c.payee,
    amountMotes: PRICE,
    request: { feed: "GOLD-USD" },
    seller: c.seller,
    expectations: { requiredFields: ["price", "asset"], maxAgeMs: 60_000 },
  });
  const tag = r.released ? "RELEASE ✅ (seller paid)" : "REFUND ↩︎ (buyer protected)";
  console.log(`${c.name}: ${tag}`);
  console.log(`   escrow #${r.escrowId}  open=${r.openTxHash}  settle=${r.settleTxHash}`);
  console.log(`   why: ${r.reasons[r.reasons.length - 1]}`);
  console.log(
    `   ${c.payee} reputation: ${r.reputation.released} released / ${r.reputation.refunded} refunded ` +
      `(${(r.reputation.scoreBps / 100).toFixed(1)}%)`,
  );
  console.log();
}

console.log(`Total escrows settled: ${await client.count()}.`);
console.log(`Seller A trust score: ${(await client.reputationOf(SELLER_A)).scoreBps / 100}%`);
console.log(`Seller B trust score: ${(await client.reputationOf(SELLER_B)).scoreBps / 100}%`);
