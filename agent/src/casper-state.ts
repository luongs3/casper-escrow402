// On-chain read helpers for the Escrow402 EscrowRegistry (Odra 2.x / Casper 2.0).
//
// Odra stores a module's `Var`/`Mapping` fields in a single contract dictionary named "state".
// The dictionary item key for a field is:
//
//     blake2b256( index_bytes(fieldIndex)  ++  mapping_key.to_bytes() )   // hex, 64 chars
//
// where Odra assigns fields a 1-BASED index in declaration order, and index_bytes packs the path
// into a big-endian u32 for indices <= 15 (our case). A top-level `Var` has empty mapping data; a
// `Mapping<K,V>` appends the Casper-serialized key bytes. (Verified against the live contract:
// owner=1, verifiers=2, count=3, escrows=4, reputations=5.)
//
// These are READ-ONLY global-state queries — no gas, no signing.

import casper from "casper-js-sdk";

const { byteHash } = casper;

// EscrowRegistry field indices (1-based, declaration order in contract/src/lib.rs).
export const FIELD = {
  owner: 1,
  verifiers: 2,
  count: 3,
  escrows: 4,
  reputations: 5,
} as const;

export const STATE_DICT = "state";

/** Casper Key tags for the serialized form used as Odra mapping keys. */
const KEY_TAG_ACCOUNT = 0x00;
const KEY_TAG_HASH = 0x01;

/** big-endian u32 of a field index (path length 1, index <= 15). */
function indexBytes(fieldIndex: number): Uint8Array {
  return Uint8Array.from([
    (fieldIndex >>> 24) & 0xff,
    (fieldIndex >>> 16) & 0xff,
    (fieldIndex >>> 8) & 0xff,
    fieldIndex & 0xff,
  ]);
}

/** The Odra dictionary item key (hex) for a field + optional serialized mapping key. */
export function dictItemKey(fieldIndex: number, mappingKey: Uint8Array = new Uint8Array()): string {
  const preimage = new Uint8Array(4 + mappingKey.length);
  preimage.set(indexBytes(fieldIndex), 0);
  preimage.set(mappingKey, 4);
  return Buffer.from(byteHash(preimage)).toString("hex");
}

/**
 * Serialize a Casper address (account-hash hex or "hash-"/"account-hash-" prefixed) into the
 * Key bytes Odra uses as a Mapping<Address, _> key: a 1-byte tag + 32-byte hash.
 */
export function addressKeyBytes(address: string): Uint8Array {
  let tag = KEY_TAG_ACCOUNT;
  let hex = address;
  if (hex.startsWith("account-hash-")) {
    hex = hex.slice("account-hash-".length);
    tag = KEY_TAG_ACCOUNT;
  } else if (hex.startsWith("hash-")) {
    hex = hex.slice("hash-".length);
    tag = KEY_TAG_HASH;
  }
  const bytes = Buffer.from(hex, "hex");
  if (bytes.length !== 32) {
    throw new Error(`addressKeyBytes: expected 32-byte hash, got ${bytes.length} from "${address}"`);
  }
  return Uint8Array.from([tag, ...bytes]);
}

/** Casper-serialized u64 (little-endian, 8 bytes) — the key form for Mapping<u64, _>. */
export function u64KeyBytes(n: number | bigint): Uint8Array {
  const out = new Uint8Array(8);
  let v = BigInt(n);
  for (let i = 0; i < 8; i++) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

// ---- raw JSON-RPC (the typed SDK query API needs typed key objects; raw RPC is simpler here) ----

export interface RpcConfig {
  nodeRpc: string;
}

async function rpc(cfg: RpcConfig, method: string, params: unknown): Promise<any> {
  const res = await fetch(cfg.nodeRpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) {
    throw new Error(`RPC ${method} failed: ${json.error.message} (${json.error.code})`);
  }
  return json.result;
}

/** Resolve a contract package hash ("hash-..." or bare hex) to its current contract version hash. */
export async function resolveContractHash(cfg: RpcConfig, packageHash: string): Promise<string> {
  const key = packageHash.startsWith("hash-") ? packageHash : `hash-${packageHash}`;
  const result = await rpc(cfg, "query_global_state", { key });
  const sv = result.stored_value;
  const pkg = sv.ContractPackage ?? sv.Package ?? sv.SmartContract;
  if (!pkg) throw new Error(`resolveContractHash: not a package: ${Object.keys(sv).join(",")}`);
  const versions = pkg.versions ?? pkg.contract_versions ?? [];
  if (!versions.length) throw new Error("resolveContractHash: package has no versions");
  const latest = versions[versions.length - 1];
  const ch: string = latest.contract_hash ?? latest.contractHash;
  // The dictionary query wants the Key::Hash form: "hash-<64hex>".
  return ch.replace(/^contract-/, "hash-");
}

/** Read a dictionary item's raw CLValue inner bytes (Vec<u8> wrapper stripped) as a Buffer. */
export async function readStateBytes(
  cfg: RpcConfig,
  contractKeyHash: string,
  itemKey: string,
): Promise<Buffer | null> {
  const srh = (await rpc(cfg, "chain_get_state_root_hash", null)).state_root_hash;
  let result: any;
  try {
    result = await rpc(cfg, "state_get_dictionary_item", {
      state_root_hash: srh,
      dictionary_identifier: {
        ContractNamedKey: {
          key: contractKeyHash,
          dictionary_name: STATE_DICT,
          dictionary_item_key: itemKey,
        },
      },
    });
  } catch (err) {
    // "Query failed" => the item doesn't exist (e.g. unknown escrow / no reputation yet).
    if (String(err).includes("Query failed")) return null;
    throw err;
  }
  const cl = result.stored_value.CLValue;
  // Odra stores values as CLValue of type List<U8>; `bytes` is a length-prefixed (u32 LE) byte list.
  const raw = Buffer.from(cl.bytes, "hex");
  // Strip the 4-byte length prefix of the List<U8>.
  return raw.subarray(4);
}

// ---- decoders for the EscrowRegistry value types ----

export function decodeU64LE(bytes: Buffer): number {
  let v = 0n;
  for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(bytes[i]);
  return Number(v);
}

/** Reputation { released: u64, refunded: u64 } -> the two counts. */
export function decodeReputation(bytes: Buffer): { released: number; refunded: number } {
  return {
    released: decodeU64LE(bytes.subarray(0, 8)),
    refunded: decodeU64LE(bytes.subarray(8, 16)),
  };
}
