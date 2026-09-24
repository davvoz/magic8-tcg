/**
 * An in-memory STEEM chain for payment tests: transfers land in blocks and
 * in both accounts' histories; the irreversible block moves when told to; a
 * transaction can be dropped to simulate a micro-fork. It implements the
 * chain reader the real SteemTransferPaymentProvider uses, so tests exercise
 * the real adapter.
 */
import { SteemTransferPaymentProvider } from "@magic8/steem";

export class FakeSteemLedger {
  headBlock = 1000;
  irreversibleBlock = 1000;
  /** @type {Map<string, any[]>} */
  history = new Map();
  /** @type {Map<number, { txId: string, operations: { type: string, data: Record<string, unknown> }[] }[]>} */
  blocks = new Map();
  #transactions = 0;
  /** Block time of the next transfer (ms); tests move it with the clock. */
  time = Date.UTC(2026, 8, 24, 10, 0, 0);

  /**
   * @param {{ from: string, to: string, amount: string, memo: string, time?: number }} transfer amount as the chain writes it, e.g. "1.000 STEEM"
   * @returns {{ txId: string, blockNum: number }}
   */
  transfer({ from, to, amount, memo, time = this.time }) {
    this.#transactions += 1;
    this.headBlock += 1;
    const txId = this.#transactions.toString(16).padStart(40, "0");
    const blockNum = this.headBlock;
    const operation = { type: "transfer", data: { from, to, amount, memo } };
    this.blocks.set(blockNum, [{ txId, operations: [operation] }]);
    for (const account of new Set([from, to])) {
      const entries = this.history.get(account) ?? [];
      entries.push(Object.freeze({ index: entries.length, txId, blockNum, opIndex: 0, virtual: false, time, operation }));
      this.history.set(account, entries);
    }
    return { txId, blockNum };
  }

  /** Every block so far becomes irreversible. */
  finalize() {
    this.irreversibleBlock = this.headBlock;
  }

  /**
   * The transaction is no longer in its block (a micro-fork dropped it).
   * @param {string} txId
   */
  drop(txId) {
    for (const [blockNum, transactions] of this.blocks) {
      this.blocks.set(blockNum, transactions.filter((transaction) => transaction.txId !== txId));
    }
  }

  /** The chain reader of one node (every node sees this same chain). */
  reader() {
    return {
      getHead: async () => ({ headBlock: this.headBlock, irreversibleBlock: this.irreversibleBlock, time: this.time }),
      getBlock: async (blockNum) => (this.blocks.has(blockNum) ? { blockNum, time: this.time, transactions: this.blocks.get(blockNum) } : null),
      getAccountHistory: async (account, after, limit) => (this.history.get(account) ?? []).filter((entry) => entry.index > after).slice(0, limit),
      getLatestHistoryIndex: async (account) => (this.history.get(account) ?? []).length - 1,
    };
  }

  /** The real STEEM payment adapter on this chain, with two verifier nodes. */
  paymentProvider() {
    return new SteemTransferPaymentProvider({ history: this.reader(), verifiers: [this.reader(), this.reader()] });
  }
}
