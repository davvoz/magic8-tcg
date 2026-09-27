/**
 * BoardRelay (docs/tcg/14-vendite.md): the board's push half. Every server
 * process runs one. When a listing changes (listed, reserved, sold,
 * withdrawn, expired) SalesService announces it on the sales channel, after
 * the change committed, with the players it concerns. Each process then
 * tells every player connected to it that the board changed
 * ("sales.board": whoever is looking at it re-reads it) and the players
 * concerned that their listing or purchase did ("sale.updated").
 *
 * The push only makes things faster; the board is the record. When the
 * relay's own listening connection was lost (announcements may have gone by
 * meanwhile) every connected player is told the board changed.
 */
import { parseJson } from "../../../kernel/json.js";

/** The channel NOTIFY uses for board changes; BoardRelay listens to it. */
export const SALES_CHANNEL = "m8_sales";

export class BoardRelay {
  #listen;
  #hub;
  #logger;

  /**
   * @param {{
   *   listen: (channel: string, onPayload: (payload: string) => void, options: { onReconnect: () => void }) => Promise<() => Promise<void>>,
   *   hub: { isConnected: (userId: string) => boolean, connectedUsers: () => Iterable<string>, send: (userId: string, type: string, data: unknown) => void },
   *   logger: import("../../../kernel/logger.js").Logger,
   * }} deps
   */
  constructor({ listen, hub, logger }) {
    this.#listen = listen;
    this.#hub = hub;
    this.#logger = logger;
  }

  /** @returns {Promise<() => Promise<void>>} stop */
  start() {
    return this.#listen(SALES_CHANNEL, (payload) => this.#deliver(payload), { onReconnect: () => this.#broadcast(null) });
  }

  /** @param {string} payload */
  #deliver(payload) {
    const change = parse(payload);
    if (change === null) {
      this.#logger.warn("ignored a malformed board signal", { payload: payload.slice(0, 200) });
      return;
    }
    this.#broadcast(change.listingId);
    for (const userId of new Set(change.userIds)) {
      if (this.#hub.isConnected(userId)) {
        this.#hub.send(userId, "sale.updated", { listingId: change.listingId });
      }
    }
  }

  /** @param {string | null} listingId null: something may have changed */
  #broadcast(listingId) {
    for (const userId of this.#hub.connectedUsers()) {
      this.#hub.send(userId, "sales.board", { listingId });
    }
  }
}

/**
 * @param {string} payload
 * @returns {{ listingId: string, userIds: readonly string[] } | null}
 */
function parse(payload) {
  try {
    const value = /** @type {any} */ (parseJson(payload));
    const valid = typeof value?.listingId === "string" && Array.isArray(value?.userIds) && value.userIds.every((id) => typeof id === "string");
    return valid ? { listingId: value.listingId, userIds: value.userIds } : null;
  } catch {
    return null;
  }
}
