/**
 * The player's notification feed (docs/tcg/15-notifiche.md): what happened
 * to their orders, trades and sales while they were elsewhere.
 *
 * Signed in, the service keeps the realtime connection open and reads the
 * feed on every (re)connection; new notifications are pushed on that
 * connection and announced to `onArrival` listeners (the toasts), and the
 * server may ask for a fresh read (`notifications.resync`) when it could
 * have missed some. The server's feed is the record: nothing here is
 * trusted beyond the current screen.
 *
 * States: idle (signed out) → loading → ready | failed.
 */
import { parseNotification } from "./parseNotification.js";

export const NotificationStatus = Object.freeze({ IDLE: "idle", LOADING: "loading", READY: "ready", FAILED: "failed" });

/**
 * @typedef {import("../ports/NotificationsApi.contract.js").PlayerNotification} PlayerNotification
 * @typedef {Readonly<{ status: string, items: readonly PlayerNotification[], unread: number, more: boolean, error: string | null }>} NotificationState
 */

const INITIAL = Object.freeze({ status: NotificationStatus.IDLE, items: Object.freeze([]), unread: 0, more: false, error: null });

export class NotificationService {
  #api;
  #connection;
  #logger;
  /** @type {NotificationState} */
  #state = INITIAL;
  /** @type {Set<(state: NotificationState) => void>} */
  #listeners = new Set();
  /** @type {Set<(notification: PlayerNotification) => void>} */
  #arrivalListeners = new Set();
  /** @type {Array<() => void>} */
  #unsubscribes = [];
  /** Increases on start and stop, so a slow read for a previous session is ignored. */
  #generation = 0;
  /** Whether the feed was read once in this session (later reads may announce what they find). */
  #loadedOnce = false;

  /**
   * @param {{
   *   api: import("../ports/NotificationsApi.contract.js").NotificationsApi,
   *   connection: import("../ports/Realtime.contract.js").RealtimeConnection,
   *   logger: import("../ports/Logger.contract.js").Logger,
   * }} deps
   */
  constructor({ api, connection, logger }) {
    this.#api = api;
    this.#connection = connection;
    this.#logger = logger;
  }

  get state() {
    return this.#state;
  }

  /**
   * @param {(state: NotificationState) => void} listener
   * @returns {() => void}
   */
  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /**
   * Hears each notification that arrives while the player is here (not the backlog read at sign-in).
   * @param {(notification: PlayerNotification) => void} listener
   * @returns {() => void}
   */
  onArrival(listener) {
    this.#arrivalListeners.add(listener);
    return () => this.#arrivalListeners.delete(listener);
  }

  /** Signed in: listen, connect, read the feed. Idempotent. */
  start() {
    if (this.#unsubscribes.length > 0) {
      return;
    }
    this.#generation += 1;
    this.#loadedOnce = false;
    this.#unsubscribes = [
      this.#connection.subscribe((message) => this.#onMessage(message)),
      this.#connection.onStatus((status) => {
        if (status === "open") {
          this.refresh();
        }
      }),
    ];
    this.#connection.connect();
    this.refresh();
  }

  /** Signed out: forget everything (the connection is closed by whoever owns the session). */
  stop() {
    this.#unsubscribes.forEach((unsubscribe) => unsubscribe());
    this.#unsubscribes = [];
    this.#generation += 1;
    this.#set(INITIAL);
  }

  /** Reads the newest page again (keeps notifications pushed meanwhile). */
  async refresh() {
    const generation = this.#generation;
    this.#set({ status: this.#state.status === NotificationStatus.READY ? NotificationStatus.READY : NotificationStatus.LOADING });
    const page = await this.#api.list();
    if (generation !== this.#generation) {
      return;
    }
    if (!page.ok) {
      this.#logger.warn("notifications could not be read", page.error);
      this.#set({ status: this.#state.status === NotificationStatus.READY ? NotificationStatus.READY : NotificationStatus.FAILED, error: page.error.message });
      return;
    }
    const known = new Set(this.#state.items.map((item) => item.id));
    const newest = this.#state.items[0]?.id ?? 0;
    const fresh = this.#loadedOnce ? page.value.notifications.filter((item) => !known.has(item.id) && item.id > newest && !item.read) : [];
    const kept = this.#state.items.filter((item) => !page.value.notifications.some((listed) => listed.id === item.id) && item.id > (page.value.notifications[0]?.id ?? 0));
    this.#loadedOnce = true;
    this.#set({ status: NotificationStatus.READY, items: Object.freeze([...kept, ...page.value.notifications]), unread: page.value.unread, more: page.value.more, error: null });
    fresh.reverse().forEach((item) => this.#announce(item));
  }

  /** Reads the next (older) page. */
  async loadMore() {
    const oldest = this.#state.items.at(-1);
    if (!this.#state.more || oldest === undefined) {
      return;
    }
    const generation = this.#generation;
    const page = await this.#api.list(oldest.id);
    if (generation !== this.#generation) {
      return;
    }
    if (!page.ok) {
      this.#set({ error: page.error.message });
      return;
    }
    const known = new Set(this.#state.items.map((item) => item.id));
    this.#set({ items: Object.freeze([...this.#state.items, ...page.value.notifications.filter((item) => !known.has(item.id))]), more: page.value.more, unread: page.value.unread, error: null });
  }

  /** Marks every notification read. */
  async markAllRead() {
    if (this.#state.unread === 0) {
      return;
    }
    const generation = this.#generation;
    this.#set({ items: Object.freeze(this.#state.items.map((item) => (item.read ? item : Object.freeze({ ...item, read: true })))), unread: 0 });
    const marked = await this.#api.markRead({ all: true });
    if (generation !== this.#generation) {
      return;
    }
    if (marked.ok) {
      this.#set({ unread: marked.value.unread });
    } else {
      this.#logger.warn("notifications could not be marked read", marked.error);
    }
  }

  /** @param {import("../ports/Realtime.contract.js").ServerMessage} message */
  #onMessage({ t, d }) {
    if (t === "notifications.resync") {
      this.refresh();
      return;
    }
    if (t !== "notification") {
      return;
    }
    const notification = parseNotification(d);
    if (notification === null || this.#state.items.some((item) => item.id === notification.id)) {
      return;
    }
    const items = [notification, ...this.#state.items].sort((left, right) => right.id - left.id);
    this.#set({ items: Object.freeze(items), unread: this.#state.unread + (notification.read ? 0 : 1) });
    this.#announce(notification);
  }

  /** @param {PlayerNotification} notification */
  #announce(notification) {
    for (const listener of this.#arrivalListeners) {
      listener(notification);
    }
  }

  /** @param {Partial<NotificationState>} patch */
  #set(patch) {
    this.#state = Object.freeze({ ...this.#state, ...patch });
    for (const listener of this.#listeners) {
      listener(this.#state);
    }
  }
}
