/**
 * NotificationService (docs/tcg/15-notifiche.md): the player's feed of what
 * happened to their orders, trades and sales.
 *
 * - `notify` is called by the other modules inside the unit of work that
 *   makes the change: the row and its NOTIFY commit with the change or not
 *   at all, so a player is never told about something that did not happen,
 *   and never misses something that did (the row waits in the feed).
 * - Delivery is NotificationRelay's job, in every server process.
 * - The feed is read a page at a time; read notifications and very old ones
 *   are purged by a periodic job.
 */
import { AppError } from "../../../kernel/AppError.js";
import { checkNotification, notificationView } from "../domain/Notification.js";

/** The channel NOTIFY uses; NotificationRelay listens to it. */
export const NOTIFICATION_CHANNEL = "m8_notifications";

const DAY = 24 * 60 * 60 * 1000;

export const DEFAULT_NOTIFICATION_POLICY = Object.freeze({
  /** Notifications per page of the feed. */
  pageSize: 30,
  /** Most ids one "mark read" may name. */
  maxMarkIds: 100,
  /** Read notifications are kept this long. */
  keepReadMs: 30 * DAY,
  /** Any notification is kept at most this long. */
  keepAnyMs: 180 * DAY,
  /** Rows deleted per run of the retention job. */
  purgeBatch: 5000,
});

export class NotificationService {
  #repository;
  #clock;
  #unitOfWork;
  #policy;

  /**
   * @param {{
   *   repository: import("../infrastructure/PgNotificationRepository.js").PgNotificationRepository,
   *   clock: import("../../../kernel/time.js").Clock,
   *   unitOfWork: import("../../../kernel/unitOfWork.js").UnitOfWork,
   *   policy?: Partial<typeof DEFAULT_NOTIFICATION_POLICY>,
   * }} deps
   */
  constructor({ repository, clock, unitOfWork, policy = {} }) {
    this.#repository = repository;
    this.#clock = clock;
    this.#unitOfWork = unitOfWork;
    this.#policy = Object.freeze({ ...DEFAULT_NOTIFICATION_POLICY, ...policy });
  }

  /**
   * Records a notification for a player. Call it inside the unit of work of
   * the change it reports (it joins it); on its own it is its own unit.
   * @param {string} userId
   * @param {string} kind one of NotificationKind
   * @param {Record<string, unknown>} data
   * @returns {Promise<number>} the notification's id
   */
  notify(userId, kind, data) {
    const problem = checkNotification(kind, data);
    if (problem !== null) {
      // A programming error in the caller: fail its unit of work rather than lose the notification quietly.
      return Promise.reject(new Error(problem));
    }
    return this.#unitOfWork(() => this.#repository.insert({ userId, kind, data, createdAt: this.#clock.now() }, NOTIFICATION_CHANNEL));
  }

  /**
   * A page of the player's feed, newest first, with the unread count.
   * @param {string} userId
   * @param {unknown} [before] a notification id: the page holds older ones
   */
  async list(userId, before) {
    const cursor = before === undefined || before === null || before === "" ? null : Number(before);
    if (cursor !== null && (!Number.isSafeInteger(cursor) || cursor < 1)) {
      throw new AppError("VALIDATION", "before must be a notification id");
    }
    const rows = await this.#repository.listFor(userId, { before: cursor, limit: this.#policy.pageSize + 1 });
    const unread = await this.#repository.unreadCount(userId);
    const page = rows.slice(0, this.#policy.pageSize);
    return Object.freeze({ notifications: Object.freeze(page.map(notificationView)), unread, more: rows.length > page.length });
  }

  /**
   * The notification a relay pushes, if it is (still) this player's.
   * @param {number} id
   * @param {string} userId
   */
  async view(id, userId) {
    const notification = await this.#repository.find(id);
    return notification === null || notification.userId !== userId ? null : notificationView(notification);
  }

  /**
   * Marks the player's notifications read: the ones named, or all.
   * @param {string} userId
   * @param {{ ids?: unknown, all?: unknown }} request
   * @returns {Promise<{ unread: number }>}
   */
  async markRead(userId, { ids, all }) {
    if (all === true && ids === undefined) {
      await this.#repository.markRead(userId, null, this.#clock.now());
    } else if (all === undefined && this.#validIds(ids)) {
      await this.#repository.markRead(userId, /** @type {number[]} */ (ids), this.#clock.now());
    } else {
      throw new AppError("VALIDATION", `send { "all": true } or { "ids": [...] } with 1 to ${this.#policy.maxMarkIds} notification ids`);
    }
    return { unread: await this.#repository.unreadCount(userId) };
  }

  /** Retention (periodic job). @returns {Promise<number>} rows deleted */
  purge() {
    const now = this.#clock.now();
    return this.#repository.purge({ readBefore: now - this.#policy.keepReadMs, anyBefore: now - this.#policy.keepAnyMs, limit: this.#policy.purgeBatch });
  }

  /** @param {unknown} ids */
  #validIds(ids) {
    return Array.isArray(ids) && ids.length > 0 && ids.length <= this.#policy.maxMarkIds && ids.every((id) => Number.isSafeInteger(id) && id > 0);
  }
}
