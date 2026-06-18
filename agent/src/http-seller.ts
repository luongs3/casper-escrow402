// Adapter: turn a seller's HTTP(S) x402 endpoint into the seller function paySafely expects.
import type { SellerResponse } from "./delivery-verifier.ts";

export function httpSeller(url: string, paymentHeader?: string, timeoutMs = 10_000) {
  return async (request: unknown): Promise<SellerResponse> => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(paymentHeader ? { "x-payment": paymentHeader } : {}),
        },
        body: JSON.stringify(request ?? {}),
        signal: ctrl.signal,
      });
      let body: unknown = null;
      const text = await res.text();
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = text; // non-JSON body preserved as string
      }
      return { status: res.status, body };
    } finally {
      clearTimeout(t);
    }
  };
}
