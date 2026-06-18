// paySafely — the Escrow402 core. Wrap any x402 seller call in escrow:
//   open escrow (lock payer's CSPR) → call the seller → verify delivery → release or refund.
// The payer never loses money to a seller that returns junk, errors, or nothing.

import { hashOf } from "./action-hash.ts";
import { verifyDelivery } from "./delivery-verifier.ts";
import type { DeliveryExpectations, SellerResponse } from "./delivery-verifier.ts";
import type { EscrowClient, Reputation } from "./escrow.ts";

export interface PaySafelyInput {
  client: EscrowClient;
  /** Payer (buyer) Casper address. */
  payer: string;
  /** Payee (seller) Casper address. */
  payee: string;
  /** Escrow amount in motes (U512 decimal string). */
  amountMotes: string;
  /** The request payload sent to the seller (also bound into the escrow hash). */
  request: unknown;
  /** Calls the seller's x402 endpoint and returns its response. May throw. */
  seller: (request: unknown) => Promise<SellerResponse>;
  /** What counts as a valid delivery. */
  expectations?: DeliveryExpectations;
}

export interface PaySafelyResult {
  escrowId: number;
  released: boolean;
  actionHash: string;
  response: SellerResponse;
  reasons: string[];
  reputation: Reputation;
  openTxHash?: string;
  settleTxHash?: string;
}

export async function paySafely(input: PaySafelyInput): Promise<PaySafelyResult> {
  const actionHash = hashOf({ payee: input.payee, amountMotes: input.amountMotes, request: input.request });

  const opened = await input.client.open(input.payer, input.payee, input.amountMotes, actionHash);

  // Call the seller. Any throw/timeout becomes a non-delivery (status 0) — fail-closed.
  let response: SellerResponse;
  try {
    response = await input.seller(input.request);
  } catch (err) {
    response = { status: 0, body: { error: (err as Error).message } };
  }

  const verdict = verifyDelivery(response, input.expectations);

  const settle = verdict.ok
    ? await input.client.release(opened.id)
    : await input.client.refund(opened.id);

  const reputation = await input.client.reputationOf(input.payee);

  return {
    escrowId: opened.id,
    released: verdict.ok,
    actionHash,
    response,
    reasons: verdict.reasons,
    reputation,
    openTxHash: opened.txHash,
    settleTxHash: settle.txHash,
  };
}
