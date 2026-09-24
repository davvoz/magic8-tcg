/**
 * ChainOutbox: protocol records waiting to be published on chain
 * (docs/tcg/03-game-blockchain-protocol.md §16). A record is written in the
 * same transaction as the state it describes — a fulfilled order and its
 * receipt commit together — and is immutable afterwards (database
 * triggers). The broadcaster that publishes BUILT records arrives in M5; the
 * outbox guarantees nothing is lost until then.
 */
import { sha256Hex, utf8 } from "@magic8/protocol";

export const OutboxKind = Object.freeze({ GAME_RECORD: "GAME_RECORD", RECEIPT: "RECEIPT" });
/** Receipts go out before game records: players wait for them. */
const RECEIPT_PRIORITY = 0;

export class ChainOutbox {
  #repository;
  #clock;

  /**
   * @param {{ repository: import("../infrastructure/PgOutboxRepository.js").PgOutboxRepository, clock: import("../../../kernel/time.js").Clock }} deps
   */
  constructor({ repository, clock }) {
    this.#repository = repository;
    this.#clock = clock;
  }

  /**
   * @param {{ network: string, orderId: string, parts: readonly string[] }} receipt canonical JSON of each part
   */
  async enqueueReceipt({ network, orderId, parts }) {
    for (const payload of parts) {
      await this.#repository.insert({ network, kind: OutboxKind.RECEIPT, orderId, payload, payloadHash: sha256Hex(utf8(payload)), priority: RECEIPT_PRIORITY, at: this.#clock.now() });
    }
  }

  /**
   * @param {string} orderId
   * @returns {Promise<readonly Readonly<{ payload: string, status: string }>[]>}
   */
  receiptsOf(orderId) {
    return this.#repository.listForOrder(orderId);
  }
}
