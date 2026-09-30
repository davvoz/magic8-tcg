/**
 * An in-memory STEEM chain: transfers land in blocks and in both accounts'
 * histories; the irreversible block moves when told to; a transaction can be
 * dropped to simulate a micro-fork. It implements the chain reader the real
 * SteemTransferPaymentProvider uses, and answers the JSON-RPC calls of the
 * real SteemBlockchainProvider / SteemTransactionProvider: broadcast
 * transactions are checked like a node would (TaPoS, expiration, canonical
 * signatures by a posting key of the signer, duplicates) and included in
 * the next block produced.
 */
import { createHash } from "node:crypto";
import {
  SteemBlockchainProvider,
  SteemPublicationReader,
  SteemTransactionProvider,
  SteemTransferPaymentProvider,
  fromBroadcastJson,
  publicKeyOf,
  recoverSignerKeys,
  serializeTransaction,
  transactionDigest,
  transactionId,
} from "@magic8/steem";

const BLOCK_MS = 3000;

/** @param {number} blockNum */
export const blockIdOf = (blockNum) => blockNum.toString(16).padStart(8, "0") + createHash("sha256").update(`block:${blockNum}`).digest("hex").slice(0, 32);
/** @param {number} time */
const chainTime = (time) => new Date(time).toISOString().slice(0, 19);

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

  /** @type {Map<string, { posting: string[], active: string[], owner: string[], rc: { max: bigint, current: bigint } }>} */
  accounts = new Map();
  /** @type {{ txId: string, operations: { type: string, data: Record<string, unknown> }[] }[]} */
  mempool = [];
  /** Broadcasts accepted by a node but never included (a lost transaction). */
  loseBroadcasts = false;
  /** Broadcasts that fail at the node, after it relayed them or not. */
  failBroadcasts = /** @type {null | "relayed" | "refused"} */ (null);
  /** @type {Set<string>} */
  #seenTxIds = new Set();

  /**
   * A broadcaster account whose posting authority is `privateKey`.
   * @param {string} name
   * @param {Uint8Array} privateKey
   * @param {{ active?: boolean, rcBasisPoints?: number }} [options] active: the same key also controls active (a misconfiguration)
   */
  addAccount(name, privateKey, { active = false, rcBasisPoints = 10_000 } = {}) {
    const key = publicKeyOf(privateKey);
    const other = publicKeyOf(new Uint8Array(32).fill(9));
    const max = 1_000_000_000_000n;
    this.accounts.set(name, { posting: [key], active: [active ? key : other], owner: [other], rc: { max, current: (max * BigInt(rcBasisPoints)) / 10_000n } });
  }

  /** @param {string} name @param {number} basisPoints */
  setResourceCredits(name, basisPoints) {
    const account = /** @type {any} */ (this.accounts.get(name));
    account.rc.current = (account.rc.max * BigInt(basisPoints)) / 10_000n;
  }

  /** Produces a block with the mempool's transactions; time moves one block. */
  produceBlock() {
    this.headBlock += 1;
    this.time += BLOCK_MS;
    const included = this.mempool;
    this.mempool = [];
    this.blocks.set(this.headBlock, included);
    for (const transaction of included) {
      transaction.operations.forEach((operation, opIndex) => {
        for (const account of new Set([...operation.data.required_auths, ...operation.data.required_posting_auths])) {
          const entries = this.history.get(account) ?? [];
          entries.push(Object.freeze({ index: entries.length, txId: transaction.txId, blockNum: this.headBlock, opIndex, virtual: false, time: this.time, operation }));
          this.history.set(account, entries);
        }
      });
    }
    return this.headBlock;
  }

  /**
   * The root account publishes a manifest with its active key (Keychain does
   * this on a person's computer; the fake skips the signature).
   * @param {string} root
   * @param {string} json
   */
  publishManifest(root, json) {
    this.mempool.push({ txId: createHash("sha256").update(`manifest:${json}:${this.headBlock}`).digest("hex").slice(0, 40), operations: [{ type: "custom_json", data: { required_auths: [root], required_posting_auths: [], id: "m8tcg_manifest", json } }] });
  }

  /** @param {number} count */
  produceBlocks(count) {
    for (let index = 0; index < count; index += 1) {
      this.produceBlock();
    }
  }

  /**
   * Checks a broadcast transaction like a node, then queues it for the next block.
   * @param {any} json
   */
  #broadcast(json) {
    const { transaction, signatures } = fromBroadcastJson(json);
    const bytes = serializeTransaction(transaction);
    const txId = transactionId(bytes);
    if (this.#seenTxIds.has(txId)) {
      throw new Error("Duplicate transaction check failed");
    }
    const referenced = [...this.blocks.keys(), this.headBlock].find((blockNum) => (blockNum & 0xffff) === transaction.refBlockNum && Number.parseInt(blockIdOf(blockNum).slice(8, 16).match(/../g).reverse().join(""), 16) === transaction.refBlockPrefix);
    if (referenced === undefined) {
      throw new Error("transaction tapos exception");
    }
    if (transaction.expiration * 1000 <= this.time || transaction.expiration * 1000 > this.time + 3600_000) {
      throw new Error("transaction expiration exception");
    }
    const keys = recoverSignerKeys(transactionDigest(bytes), signatures);
    for (const operation of transaction.operations) {
      for (const signer of operation.requiredPostingAuths) {
        const account = this.accounts.get(signer);
        if (account === undefined || !keys.some((key) => key !== null && account.posting.includes(key))) {
          throw new Error(`missing required posting authority: ${signer}`);
        }
      }
    }
    if (this.failBroadcasts === "refused") {
      throw new Error("node refused the transaction");
    }
    this.#seenTxIds.add(txId);
    if (!this.loseBroadcasts) {
      this.mempool.push({ txId, operations: json.operations.map(([type, data]) => ({ type, data })) });
    }
    if (this.failBroadcasts === "relayed") {
      throw new Error("timeout after relaying");
    }
    return {};
  }

  /** JSON-RPC of one node, as SteemRpcClient.call would answer. */
  rpc() {
    const methods = {
      "condenser_api.get_dynamic_global_properties": () => ({ head_block_number: this.headBlock, head_block_id: blockIdOf(this.headBlock), time: chainTime(this.time), last_irreversible_block_num: this.irreversibleBlock }),
      "condenser_api.get_accounts": ([names]) =>
        names.filter((name) => this.accounts.has(name)).map((name) => {
          const account = this.accounts.get(name);
          const authority = (keys) => ({ weight_threshold: 1, account_auths: [], key_auths: keys.map((key) => [key, 1]) });
          return { name, owner: authority(account.owner), active: authority(account.active), posting: authority(account.posting), memo_key: account.posting[0] };
        }),
      "condenser_api.get_account_history": ([account, start, limit]) => {
        const entries = this.history.get(account) ?? [];
        const upto = Math.min(start, entries.length - 1);
        return entries.slice(Math.max(0, upto - limit), upto + 1).map((entry) => [entry.index, { trx_id: entry.txId, block: entry.blockNum, op_in_trx: entry.opIndex, virtual_op: 0, timestamp: chainTime(entry.time), op: [entry.operation.type, entry.operation.data] }]);
      },
      "condenser_api.get_block": ([blockNum]) => {
        const transactions = this.blocks.get(blockNum);
        return transactions === undefined ? null : { timestamp: chainTime(this.time), transaction_ids: transactions.map((transaction) => transaction.txId), transactions: transactions.map((transaction) => ({ operations: transaction.operations.map((operation) => [operation.type, operation.data]) })) };
      },
      "condenser_api.broadcast_transaction": ([transaction]) => this.#broadcast(transaction),
      "rc_api.find_rc_accounts": ({ accounts }) => ({
        rc_accounts: accounts.filter((name) => this.accounts.has(name)).map((name) => {
          const { rc } = this.accounts.get(name);
          return { account: name, max_rc: String(rc.max), rc_manabar: { current_mana: String(rc.current), last_update_time: Math.floor(this.time / 1000) } };
        }),
      }),
    };
    return {
      call: async (method, params) => {
        const handler = methods[method];
        if (handler === undefined) {
          throw new Error(`fake node: ${method} is not supported`);
        }
        return structuredClone(handler(params));
      },
    };
  }

  /**
   * The real transaction provider and publication reader on this chain.
   * @param {ReadonlyMap<string, string>} keys account → WIF
   */
  publishing(keys) {
    const rpc = this.rpc();
    const chain = new SteemBlockchainProvider({ rpc });
    return { transactions: new SteemTransactionProvider({ rpc, chain, keys }), reader: new SteemPublicationReader({ chain }) };
  }

  /** Every block so far becomes irreversible. */
  finalize() {
    this.irreversibleBlock = this.headBlock;
  }

  /**
   * The transaction is no longer in its block (a micro-fork dropped it), nor
   * in any account's history: a node rebuilds the history of the fork it follows.
   * @param {string} txId
   */
  drop(txId) {
    for (const [blockNum, transactions] of this.blocks) {
      this.blocks.set(blockNum, transactions.filter((transaction) => transaction.txId !== txId));
    }
    for (const [account, entries] of this.history) {
      this.history.set(account, entries.filter((entry) => entry.txId !== txId));
    }
  }

  /** The chain reader of one node (every node sees this same chain). */
  reader() {
    return {
      getHead: async () => ({ headBlock: this.headBlock, irreversibleBlock: this.irreversibleBlock, time: this.time }),
      getBlock: async (blockNum) => (this.blocks.has(blockNum) ? { blockNum, time: this.time, transactions: this.blocks.get(blockNum) } : null),
      getAccountHistory: async (account, after, limit) => (this.history.get(account) ?? []).filter((entry) => entry.index > after).slice(0, limit),
      getLatestHistoryIndex: async (account) => (this.history.get(account) ?? []).length - 1,
      getLatestHistoryEntry: async (account) => (this.history.get(account) ?? []).at(-1) ?? null,
    };
  }

  /** The real STEEM payment adapter on this chain, with two verifier nodes. */
  paymentProvider() {
    return new SteemTransferPaymentProvider({ history: this.reader(), verifiers: [this.reader(), this.reader()] });
  }
}
