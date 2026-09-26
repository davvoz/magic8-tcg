/**
 * NotificationRelay (docs/tcg/15-notifiche.md): the push half. Every server
 * process runs one. It listens to the notifications channel, which carries
 * only { id, userId } once the writing transaction has committed; the
 * process holding that player's connection reads the row and sends it.
 * Players connected elsewhere, or not at all, cost it nothing.
 *
 * The push only makes things faster; the feed is the record. A client reads
 * its feed when it connects, and when the relay's own listening connection
 * was lost (notifications may have gone by meanwhile) every connected
 * player is told to read it again.
 */
import { parseJson } from "../../../kernel/json.js";
import { NOTIFICATION_CHANNEL } from "./NotificationService.js";

export class NotificationRelay {
  #notifications;
  #listen;
  #hub;
  #logger;

  /**
   * @param {{
   *   notifications: import("./NotificationService.js").NotificationService,
   *   listen: (channel: string, onPayload: (payload: string) => void, options: { onReconnect: () => void }) => Promise<() => Promise<void>>,
   *   hub: { isConnected: (userId: string) => boolean, connectedUsers: () => Iterable<string>, send: (userId: string, type: string, data: unknown) => void },
   *   logger: import("../../../kernel/logger.js").Logger,
   * }} deps
   */
  constructor({ notifications, listen, hub, logger }) {
    this.#notifications = notifications;
    this.#listen = listen;
    this.#hub = hub;
    this.#logger = logger;
  }

  /** @returns {Promise<() => Promise<void>>} stop */
  start() {
    return this.#listen(NOTIFICATION_CHANNEL, (payload) => void this.#deliver(payload), { onReconnect: () => this.#resyncAll() });
  }

  /** @param {string} payload */
  async #deliver(payload) {
    const signal = parse(payload);
    if (signal === null) {
      this.#logger.warn("ignored a malformed notification signal", { payload: payload.slice(0, 200) });
      return;
    }
    if (!this.#hub.isConnected(signal.userId)) {
      return;
    }
    try {
      const view = await this.#notifications.view(signal.id, signal.userId);
      if (view !== null) {
        this.#hub.send(signal.userId, "notification", view);
      }
    } catch (error) {
      // The row is in the feed: the player sees it when the client next reads it.
      this.#logger.warn("could not push a notification", { notification: signal.id, error: error instanceof Error ? error.message : String(error) });
    }
  }

  #resyncAll() {
    this.#logger.warn("notification channel reconnected: connected players re-read their feed");
    for (const userId of this.#hub.connectedUsers()) {
      this.#hub.send(userId, "notifications.resync", {});
    }
  }
}

/**
 * @param {string} payload
 * @returns {{ id: number, userId: string } | null}
 */
function parse(payload) {
  try {
    const value = /** @type {any} */ (parseJson(payload));
    return Number.isSafeInteger(value?.id) && typeof value?.userId === "string" ? { id: value.id, userId: value.userId } : null;
  } catch {
    return null;
  }
}
