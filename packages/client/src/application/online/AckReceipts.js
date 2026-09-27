/**
 * The signed acks a player keeps (docs/tcg/11-ack-firmati.md): the server's
 * signature on every move it accepted: proof of what the server accepted,
 * should a game ever be disputed. Each ack is checked as it arrives: one that
 * does not verify proves nothing, so the player is told at once.
 *
 * Stored per game in the browser (the most recent 20 games).
 */
export const RECEIPTS_INDEX_KEY = "m8.acks.index";
/** @param {string} gameId */
export const receiptsKey = (gameId) => `m8.acks.${gameId}`;
const MAX_GAMES = 20;
const MAX_ACKS_PER_GAME = 2000;

/**
 * @typedef {Readonly<{ gameId: string, commandId: string, seq: number, head: string, version: number, at: number, key: string, sig: string }>} KeptAck
 */

export class AckReceipts {
  #store;
  #verify;
  #logger;

  /**
   * @param {{
   *   store: import("../../infrastructure/persistence/KeyValueStore.contract.js").KeyValueStore,
   *   verify: (ack: unknown) => boolean,
   *   logger: import("../ports/Logger.contract.js").Logger,
   * }} deps verify: the ack is well formed and signed by the key it names
   */
  constructor({ store, verify, logger }) {
    this.#store = store;
    this.#verify = verify;
    this.#logger = logger;
  }

  /**
   * Keeps an ack from the server, if it verifies.
   * @param {string} gameId
   * @param {Readonly<Record<string, unknown>>} ack the server's `game.ack`
   * @param {string | null} expectedKey the key the server announced, when known
   * @returns {boolean} false when the ack is unsigned, mis-signed or signed by another key
   */
  keep(gameId, ack, expectedKey) {
    /** @type {Record<string, unknown>} */
    const kept = { gameId, ...ack };
    delete kept.ok;
    if (!this.#verify(kept) || (expectedKey !== null && kept.key !== expectedKey)) {
      this.#logger.warn("the server's ack does not verify", { gameId, commandId: kept.commandId });
      return false;
    }
    const acks = this.forGame(gameId);
    if (acks.some((existing) => existing.commandId === kept.commandId) || acks.length >= MAX_ACKS_PER_GAME) {
      return true;
    }
    this.#write(receiptsKey(gameId), [...acks, kept]);
    this.#index(gameId);
    return true;
  }

  /**
   * @param {string} gameId
   * @returns {readonly KeptAck[]}
   */
  forGame(gameId) {
    const stored = this.#read(receiptsKey(gameId));
    return Array.isArray(stored) ? stored : [];
  }

  /** @param {string} gameId */
  #index(gameId) {
    const stored = this.#read(RECEIPTS_INDEX_KEY);
    const games = (Array.isArray(stored) ? stored : []).filter((id) => id !== gameId);
    games.push(gameId);
    for (const dropped of games.splice(0, Math.max(0, games.length - MAX_GAMES))) {
      this.#store.delete(receiptsKey(dropped));
    }
    this.#write(RECEIPTS_INDEX_KEY, games);
  }

  /** @param {string} key */
  #read(key) {
    const read = this.#store.read(key);
    if (!read.ok || read.value === null) {
      return null;
    }
    try {
      return JSON.parse(read.value);
    } catch {
      return null;
    }
  }

  /**
   * @param {string} key
   * @param {unknown} value
   */
  #write(key, value) {
    const written = this.#store.write(key, JSON.stringify(value));
    if (!written.ok) {
      this.#logger.warn("an ack could not be stored", { key });
    }
  }
}
