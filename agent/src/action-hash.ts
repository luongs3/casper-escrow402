// Canonical, stable hashing so an escrow binds to exactly the request it pays for.
import { createHash } from "node:crypto";

export function canonicalize(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortDeep((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** 0x-prefixed sha256 of the canonical value. */
export function hashOf(value: unknown): string {
  return `0x${createHash("sha256").update(canonicalize(value)).digest("hex")}`;
}
