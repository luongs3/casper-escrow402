// Live Casper Testnet EscrowClient — calls the deployed EscrowRegistry contract via casper-js-sdk.
//
// The EscrowRegistry is deployed on Casper Testnet (package
// hash-e19693d6fd8641f98202ddbff190b1fea37561246b29fad4eb1f073afd3bf415; see contract/DEPLOYED.md).
// This client implements the same EscrowClient interface as MockEscrowClient, but against real
// on-chain state:
//
//   * open()    — open_escrow is #[odra(payable)]; on Casper 2.0 a payable entrypoint is invoked
//                 through Odra's session-wasm proxy (proxy_caller_with_return.wasm) which forwards
//                 the attached CSPR into the call. Signed by the payer key.
//   * release() / refund() — verifier-gated, non-payable; a direct package-targeted TransactionV1.
//                 Signed by the registered verifier key (= the deployer key here).
//   * getEscrow()/reputationOf()/count() — read-only global-state queries (see casper-state.ts).
//
// casper-js-sdk v5 ships a CommonJS build only; under ESM we default-import then destructure.

import casper from "casper-js-sdk";
import { readFileSync } from "node:fs";
import type { EscrowClient, EscrowState, Reputation } from "./escrow.ts";
import {
  resolveContractHash,
  readStateBytes,
  dictItemKey,
  addressKeyBytes,
  u64KeyBytes,
  decodeU64LE,
  decodeReputation,
  FIELD,
  type RpcConfig,
} from "./casper-state.ts";

const {
  PrivateKey,
  KeyAlgorithm,
  PublicKey,
  RpcClient,
  HttpHandler,
  ContractCallBuilder,
  SessionBuilder,
  Args,
  CLValue,
  CLTypeUInt8,
  Key,
} = casper;

// Odra proxy-call runtime-arg names (from odra-core consts.rs) and our entrypoint arg names.
const PACKAGE_HASH_ARG = "package_hash";
const ENTRY_POINT_ARG = "entry_point";
const ARGS_ARG = "args";
const ATTACHED_VALUE_ARG = "attached_value";
const AMOUNT_ARG = "amount";

// Gas budgets (motes). Unused gas is refunded on Casper 2.0, so these are generous ceilings.
// open_escrow goes through the session proxy (~512 CSPR observed on-chain); release/refund are cheap.
const PAYABLE_GAS = 520_000_000_000n;
const CALL_GAS = 20_000_000_000n;

export interface CasperConfig {
  nodeRpc: string;
  /** Contract PACKAGE hash, "hash-..." or bare hex. */
  contractHash: string;
  /** Path to the ed25519 secret key PEM (payer + verifier; the deployer key here). */
  verifierKeyPath: string;
  chainName: string;
}

export class CasperEscrowClient implements EscrowClient {
  private readonly cfg: CasperConfig;
  private readonly rpcCfg: RpcConfig;
  private readonly rpc: any;
  private key: any | undefined;
  private pub: any | undefined;
  private contractKeyHashCache: string | undefined;
  private readonly proxyWasm: Uint8Array;

  constructor(cfg: CasperConfig) {
    this.cfg = cfg;
    this.rpcCfg = { nodeRpc: cfg.nodeRpc };
    this.rpc = new RpcClient(new HttpHandler(cfg.nodeRpc));
    // Vendored from odra-casper-rpc-client (resources/proxy_caller_with_return.wasm).
    const wasmUrl = new URL("./resources/proxy_caller_with_return.wasm", import.meta.url);
    this.proxyWasm = new Uint8Array(readFileSync(wasmUrl));
  }

  // ---- lazy key + identity ----

  private signer(): { key: any; pub: any } {
    if (!this.key) {
      const pem = readFileSync(this.cfg.verifierKeyPath, "utf8");
      this.key = PrivateKey.fromPem(pem, KeyAlgorithm.ED25519);
      this.pub = this.key.publicKey;
    }
    return { key: this.key, pub: this.pub };
  }

  /** Our own account hash (payer/payee default), hex without prefix. */
  selfAccountHash(): string {
    const { pub } = this.signer();
    return pub.accountHash().toHex().replace(/^account-hash-/, "");
  }

  private barePackageHex(): string {
    return this.cfg.contractHash.replace(/^hash-/, "");
  }

  /** Resolve + cache the contract version hash used for global-state reads. */
  private async contractKeyHash(): Promise<string> {
    if (!this.contractKeyHashCache) {
      this.contractKeyHashCache = await resolveContractHash(this.rpcCfg, this.cfg.contractHash);
    }
    return this.contractKeyHashCache;
  }

  // ---- write paths ----

  async open(
    _payer: string,
    payee: string,
    amountMotes: string,
    actionHash: string,
  ): Promise<{ id: number; txHash?: string }> {
    if (BigInt(amountMotes) <= 0n) throw new Error("zero amount");
    const { key, pub } = this.signer();

    // Inner args for open_escrow(payee: Address, action_hash: String), serialized to bytes for the proxy.
    const payeeKey = Key.newKey(`account-hash-${payee.replace(/^account-hash-/, "")}`);
    const innerArgs = Args.fromMap({
      payee: CLValue.newCLKey(payeeKey),
      action_hash: CLValue.newCLString(actionHash),
    });
    const innerBytes = innerArgs.toBytes();

    const amount = CLValue.newCLUInt512(amountMotes);
    const proxyArgs = Args.fromMap({
      [PACKAGE_HASH_ARG]: CLValue.newCLByteArray(Buffer.from(this.barePackageHex(), "hex")),
      [ENTRY_POINT_ARG]: CLValue.newCLString("open_escrow"),
      // Odra passes the inner entrypoint args as Bytes, i.e. a CLValue List<U8>.
      [ARGS_ARG]: CLValue.newCLList(
        CLTypeUInt8,
        Array.from(innerBytes).map((b) => CLValue.newCLUint8(b)),
      ),
      [ATTACHED_VALUE_ARG]: amount,
      [AMOUNT_ARG]: amount,
    });

    const tx = new SessionBuilder()
      .from(pub)
      .chainName(this.cfg.chainName)
      .wasm(this.proxyWasm)
      .runtimeArgs(proxyArgs)
      .payment(Number(PAYABLE_GAS + BigInt(amountMotes)))
      .build();
    tx.sign(key);
    const txHash = await this.send(tx);

    // The new id is the prior count (ids are sequential; count incremented by this call).
    const idAfter = await this.count();
    return { id: idAfter - 1, txHash };
  }

  async release(id: number): Promise<{ txHash?: string }> {
    return { txHash: await this.directCall("release", id) };
  }

  async refund(id: number): Promise<{ txHash?: string }> {
    return { txHash: await this.directCall("refund", id) };
  }

  private async directCall(entryPoint: "release" | "refund", id: number): Promise<string> {
    const { key, pub } = this.signer();
    const tx = new ContractCallBuilder()
      .byPackageHash(this.barePackageHex())
      .entryPoint(entryPoint)
      .runtimeArgs(Args.fromMap({ id: CLValue.newCLUint64(BigInt(id)) }))
      .payment(Number(CALL_GAS))
      .from(pub)
      .chainName(this.cfg.chainName)
      .build();
    tx.sign(key);
    return this.send(tx);
  }

  /** Put a signed transaction and wait until it is executed; throw on on-chain failure. */
  private async send(tx: any): Promise<string> {
    const res = await this.rpc.putTransaction(tx);
    const txHash: string =
      res?.transactionHash?.toHex?.() ??
      res?.transactionHash?.transactionV1?.toHex?.() ??
      String(res?.transactionHash ?? "");
    await this.waitForSuccess(txHash);
    return txHash;
  }

  private async waitForSuccess(txHash: string, attempts = 30): Promise<void> {
    for (let i = 0; i < attempts; i++) {
      try {
        const info: any = await rpcRaw(this.cfg.nodeRpc, "info_get_transaction", {
          transaction_hash: { Version1: txHash },
        });
        const er = info?.execution_info?.execution_result;
        const v2 = er?.Version2 ?? er;
        if (v2 && ("error_message" in v2 || "cost" in v2)) {
          if (v2.error_message) throw new Error(`tx ${txHash} failed: ${v2.error_message}`);
          return;
        }
      } catch (err) {
        if (String(err).includes("failed:")) throw err;
        // transaction not yet processed — keep polling
      }
      await sleep(2000);
    }
    throw new Error(`tx ${txHash} not finalized after ${attempts} polls`);
  }

  // ---- read paths (global state; no gas) ----

  async getEscrow(id: number): Promise<EscrowState> {
    const ch = await this.contractKeyHash();
    const bytes = await readStateBytes(this.rpcCfg, ch, dictItemKey(FIELD.escrows, u64KeyBytes(id)));
    if (!bytes) throw new Error(`unknown escrow ${id}`);
    return decodeEscrow(id, bytes);
  }

  async reputationOf(addr: string): Promise<Reputation> {
    const ch = await this.contractKeyHash();
    const bytes = await readStateBytes(
      this.rpcCfg,
      ch,
      dictItemKey(FIELD.reputations, addressKeyBytes(addr)),
    );
    const { released, refunded } = bytes ? decodeReputation(bytes) : { released: 0, refunded: 0 };
    const total = released + refunded;
    const scoreBps = total === 0 ? 0 : Math.floor((released * 10_000) / total);
    return { released, refunded, scoreBps };
  }

  async count(): Promise<number> {
    const ch = await this.contractKeyHash();
    const bytes = await readStateBytes(this.rpcCfg, ch, dictItemKey(FIELD.count));
    return bytes ? decodeU64LE(bytes) : 0;
  }
}

// ---- helpers ----

function decodeEscrow(id: number, bytes: Buffer): EscrowState {
  // Escrow { payer: Address, payee: Address, amount: U512, action_hash: String, state: u8, opened_at: u64 }
  let off = 0;
  const readAddress = (): string => {
    const tag = bytes[off];
    off += 1;
    const hash = bytes.subarray(off, off + 32).toString("hex");
    off += 32;
    return (tag === 0x00 ? "account-hash-" : "hash-") + hash;
  };
  const payer = readAddress();
  const payee = readAddress();
  // U512: 1-byte length prefix, then that many LE bytes.
  const amtLen = bytes[off];
  off += 1;
  let amount = 0n;
  for (let i = amtLen - 1; i >= 0; i--) amount = (amount << 8n) | BigInt(bytes[off + i]);
  off += amtLen;
  // String: u32 LE length prefix then utf8.
  const sLen = bytes.readUInt32LE(off);
  off += 4;
  const actionHash = bytes.subarray(off, off + sLen).toString("utf8");
  off += sLen;
  const state = bytes[off];
  off += 1;
  const openedAt = decodeU64LE(bytes.subarray(off, off + 8));
  return { id, payer, payee, amountMotes: amount.toString(), actionHash, state, openedAt };
}

async function rpcRaw(nodeRpc: string, method: string, params: unknown): Promise<any> {
  const res = await fetch(nodeRpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`RPC ${method}: ${json.error.message}`);
  return json.result;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function casperConfigFromEnv(): CasperConfig {
  return {
    nodeRpc: process.env.ESCROW402_NODE_RPC ?? "https://node.testnet.casper.network/rpc",
    contractHash: process.env.ESCROW402_CONTRACT_HASH ?? "",
    verifierKeyPath:
      process.env.ESCROW402_VERIFIER_KEY_PATH ?? "../contract/keys/secret_key.pem",
    chainName: process.env.ESCROW402_CHAIN_NAME ?? "casper-test",
  };
}
