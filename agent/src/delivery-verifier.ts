// Delivery verifier — decides whether a seller actually delivered what the payment bought.
// This is the old Vouch risk engine, re-pointed: instead of judging the buyer's intent, it
// judges the seller's RESPONSE. Pure and deterministic so every release/refund is explainable.
//
// Design stance: FAIL-CLOSED. Anything the verifier can't confirm as good delivery → refund the
// payer. The buyer's money is protected by default.

export interface SellerResponse {
  /** HTTP-ish status. 0 means the call threw / never returned. */
  status: number;
  /** Parsed body (object) or null. */
  body: unknown;
}

export interface DeliveryExpectations {
  /** Require a 2xx status. Default true. */
  requireStatus2xx?: boolean;
  /** Require a non-empty body (non-null, non-empty object/array/string). Default true. */
  requireNonEmpty?: boolean;
  /** Top-level fields that must be present and non-null on the body object. */
  requiredFields?: string[];
  /** If set, body must carry a numeric/string `timestamp` (ms) no older than this. */
  maxAgeMs?: number;
  /** Optional custom predicate; must return true for a pass. */
  predicate?: (body: unknown) => boolean;
}

export interface DeliveryResult {
  ok: boolean;
  reasons: string[];
}

function isEmpty(body: unknown): boolean {
  if (body == null) return true;
  if (typeof body === "string") return body.trim().length === 0;
  if (Array.isArray(body)) return body.length === 0;
  if (typeof body === "object") return Object.keys(body as object).length === 0;
  return false;
}

export function verifyDelivery(
  resp: SellerResponse,
  exp: DeliveryExpectations = {},
): DeliveryResult {
  const reasons: string[] = [];
  let ok = true;
  const fail = (msg: string) => {
    ok = false;
    reasons.push(msg);
  };

  const requireStatus2xx = exp.requireStatus2xx ?? true;
  const requireNonEmpty = exp.requireNonEmpty ?? true;

  if (requireStatus2xx) {
    if (resp.status === 0) fail("seller call did not return (threw/timed out)");
    else if (resp.status < 200 || resp.status >= 300) fail(`non-2xx status ${resp.status}`);
    else reasons.push(`status ${resp.status} ok`);
  }

  if (requireNonEmpty) {
    if (isEmpty(resp.body)) fail("empty response body");
    else reasons.push("response body present");
  }

  if (exp.requiredFields?.length) {
    const body = (resp.body ?? {}) as Record<string, unknown>;
    for (const f of exp.requiredFields) {
      if (body[f] == null) fail(`missing required field "${f}"`);
    }
    if (ok) reasons.push(`all required fields present: ${exp.requiredFields.join(", ")}`);
  }

  if (exp.maxAgeMs != null) {
    const body = (resp.body ?? {}) as Record<string, unknown>;
    const ts = Number(body.timestamp);
    if (!Number.isFinite(ts)) fail("no usable timestamp for freshness check");
    else {
      const age = Date.now() - ts;
      if (age > exp.maxAgeMs) fail(`stale data: ${age}ms old > max ${exp.maxAgeMs}ms`);
      else reasons.push(`fresh (${age}ms old)`);
    }
  }

  if (exp.predicate) {
    let passed = false;
    try {
      passed = exp.predicate(resp.body);
    } catch {
      passed = false;
    }
    if (!passed) fail("custom predicate rejected the response");
    else reasons.push("custom predicate passed");
  }

  reasons.push(ok ? "verdict: DELIVERED → release" : "verdict: NOT DELIVERED → refund");
  return { ok, reasons };
}
