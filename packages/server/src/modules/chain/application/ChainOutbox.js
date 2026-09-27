/**
 * ChainOutbox: protocol records waiting to be published on chain
 * (docs/tcg/03-game-blockchain-protocol.md §16): purchase receipts, pack
 * epochs, trades, sales and game results. A game's history stays in the
 * database; only its result, committing to that history, is published. A record is written in the
 * same transaction as the state it describes — a fulfilled order and its
 * receipt commit together — and is immutable afterwards (database
 * triggers). The ChainBroadcaster publishes BUILT records; the ChainTracker
 * follows them until they are irreversible.
 */
import { sha256Hex, utf8 } from "@magic8/protocol";

export const OutboxKind = Object.freeze({ RECEIPT: "RECEIPT", EPOCH: "EPOCH", TRADE: "TRADE", SALE: "SALE", RESULT: "RESULT" });
/** Every kind goes out in the order it was written. */
const PRIORITY = 0;

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
      await this.#repository.insert({ network, kind: OutboxKind.RECEIPT, orderId, payload, payloadHash: sha256Hex(utf8(payload)), priority: PRIORITY, at: this.#clock.now() });
    }
  }

  /**
   * A pack epoch commitment or reveal (m8tcg_epoch).
   * @param {{ network: string, payload: string }} entry canonical JSON
   */
  async enqueueEpoch({ network, payload }) {
    await this.#repository.insert({ network, kind: OutboxKind.EPOCH, payload, payloadHash: sha256Hex(utf8(payload)), priority: PRIORITY, at: this.#clock.now() });
  }

  /**
   * A completed trade (m8tcg_trade), written with the swap it records.
   * @param {{ network: string, tradeId: string, payload: string }} entry canonical JSON
   */
  async enqueueTrade({ network, payload }) {
    await this.#repository.insert({ network, kind: OutboxKind.TRADE, payload, payloadHash: sha256Hex(utf8(payload)), priority: PRIORITY, at: this.#clock.now() });
  }

  /**
   * A completed sale between players (m8tcg_sale), written with the hand-over it records.
   * @param {{ network: string, listingId: string, payload: string }} entry canonical JSON
   */
  async enqueueSale({ network, payload }) {
    await this.#repository.insert({ network, kind: OutboxKind.SALE, payload, payloadHash: sha256Hex(utf8(payload)), priority: PRIORITY, at: this.#clock.now() });
  }

  /**
   * The result of a finished game (m8tcg_result), written with its last event.
   * @param {{ network: string, gameId: string, payload: string }} entry canonical JSON
   */
  async enqueueResult({ network, gameId, payload }) {
    await this.#repository.insert({ network, kind: OutboxKind.RESULT, gameId, payload, payloadHash: sha256Hex(utf8(payload)), priority: PRIORITY, at: this.#clock.now() });
  }

  /**
   * @param {string} orderId
   * @returns {Promise<readonly Readonly<{ payload: string, status: string }>[]>}
   */
  receiptsOf(orderId) {
    return this.#repository.listForOrder(orderId);
  }
}
