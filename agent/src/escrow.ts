// Escrow client interface + in-memory mock mirroring the on-chain EscrowRegistry state machine.
// The live CasperEscrowClient (casper-client.ts) implements the same interface.

export const STATE_OPEN = 0;
export const STATE_RELEASED = 1;
export const STATE_REFUNDED = 2;

export interface EscrowState {
  id: number;
  payer: string;
  payee: string;
  amountMotes: string; // U512 as decimal string
  actionHash: string;
  state: number;
  openedAt: number;
}

export interface Reputation {
  released: number;
  refunded: number;
  scoreBps: number;
}

export interface EscrowClient {
  open(payer: string, payee: string, amountMotes: string, actionHash: string): Promise<{ id: number; txHash?: string }>;
  release(id: number): Promise<{ txHash?: string }>;
  refund(id: number): Promise<{ txHash?: string }>;
  getEscrow(id: number): Promise<EscrowState>;
  reputationOf(addr: string): Promise<Reputation>;
  count(): Promise<number>;
}

export function scoreBps(released: number, refunded: number): number {
  const total = released + refunded;
  return total === 0 ? 0 : Math.floor((released * 10_000) / total);
}

export class MockEscrowClient implements EscrowClient {
  private escrows: EscrowState[] = [];
  private reps = new Map<string, { released: number; refunded: number }>();

  async open(payer: string, payee: string, amountMotes: string, actionHash: string) {
    if (BigInt(amountMotes) <= 0n) throw new Error("zero amount");
    const id = this.escrows.length;
    this.escrows.push({ id, payer, payee, amountMotes, actionHash, state: STATE_OPEN, openedAt: Date.now() });
    return { id, txHash: `mock-open-${id}` };
  }

  async release(id: number) {
    const e = this.openOrThrow(id);
    e.state = STATE_RELEASED;
    this.bump(e.payee, true);
    return { txHash: `mock-release-${id}` };
  }

  async refund(id: number) {
    const e = this.openOrThrow(id);
    e.state = STATE_REFUNDED;
    this.bump(e.payee, false);
    return { txHash: `mock-refund-${id}` };
  }

  async getEscrow(id: number) {
    const e = this.escrows[id];
    if (!e) throw new Error(`unknown escrow ${id}`);
    return e;
  }

  async reputationOf(addr: string): Promise<Reputation> {
    const r = this.reps.get(addr) ?? { released: 0, refunded: 0 };
    return { ...r, scoreBps: scoreBps(r.released, r.refunded) };
  }

  async count() {
    return this.escrows.length;
  }

  private openOrThrow(id: number): EscrowState {
    const e = this.escrows[id];
    if (!e) throw new Error(`unknown escrow ${id}`);
    if (e.state !== STATE_OPEN) throw new Error(`escrow ${id} not open`);
    return e;
  }

  private bump(addr: string, released: boolean) {
    const r = this.reps.get(addr) ?? { released: 0, refunded: 0 };
    if (released) r.released += 1;
    else r.refunded += 1;
    this.reps.set(addr, r);
  }
}
