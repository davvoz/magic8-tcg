/**
 * Announced maintenance (docs/tcg/07-runbook.md §1). An operator announces
 * when the server goes down, from the admin page or the command line. From
 * that moment the server starts no new payment or game: no shop orders, no
 * purchases between players, no queue entries (whoever waits leaves the
 * queue). By the announced time nothing is half done, and games in progress
 * have had the countdown to finish. A deploy that succeeds ends it.
 *
 * Every process keeps the notice in memory, the gate its services check. It
 * reads it at start and again whenever the maintenance channel says it
 * changed, whoever changed it (this process, another one, the command line),
 * then tells the players connected to it ("maintenance").
 */
import { AppError } from "../../../kernel/AppError.js";

/** The channel NOTIFY uses when the announcement changes. */
export const MAINTENANCE_CHANNEL = "m8_maintenance";
export const MAX_MESSAGE_LENGTH = 200;
/** An announcement is for the next 24 hours at most. */
export const MAX_LEAD_MINUTES = 24 * 60;

/** @typedef {Readonly<{ startsAt: number, message: string | null }>} MaintenanceNotice */
/** @typedef {Readonly<{ at: string, message: string | null }>} MaintenanceView what players see */
/** @typedef {Readonly<{ userId?: string | null, ip?: string | null }>} Operator null userId: the command line */

/** The gate of a server without maintenance (tests, tools): always open. */
export const ALWAYS_OPEN = Object.freeze({ assertOpen: () => undefined, isClosed: () => false });

export class MaintenanceService {
  #repository;
  #publish;
  #listen;
  #hub;
  #audit;
  #clock;
  #unitOfWork;
  #logger;
  /** @type {MaintenanceNotice | null} */
  #notice = null;
  /** @type {(() => Promise<unknown>)[]} */
  #onClose = [];

  /**
   * @param {{
   *   repository: import("../infrastructure/PgMaintenanceRepository.js").PgMaintenanceRepository,
   *   publish: (channel: string, payload: string) => Promise<unknown>,
   *   listen: (channel: string, onPayload: (payload: string) => void, options: { onReconnect: () => void }) => Promise<() => Promise<void>>,
   *   hub: { connectedUsers: () => Iterable<string>, send: (userId: string, type: string, data: unknown) => void },
   *   audit: import("../../../kernel/audit/AuditTrail.js").AuditTrail,
   *   clock: import("../../../kernel/time.js").Clock,
   *   unitOfWork: import("../../../kernel/unitOfWork.js").UnitOfWork,
   *   logger: import("../../../kernel/logger.js").Logger,
   * }} deps `publish`: a NOTIFY to every server process; sent inside the change's transaction, it goes out with the commit
   */
  constructor({ repository, publish, listen, hub, audit, clock, unitOfWork, logger }) {
    this.#repository = repository;
    this.#publish = publish;
    this.#listen = listen;
    this.#hub = hub;
    this.#audit = audit;
    this.#clock = clock;
    this.#unitOfWork = unitOfWork;
    this.#logger = logger;
  }

  /**
   * Reads the announcement and follows its changes.
   * @returns {Promise<() => Promise<void>>} stop following
   */
  async start() {
    await this.#reload();
    const reload = () => {
      this.#reload().catch((error) => this.#logger.error("maintenance notice could not be read", { error: error instanceof Error ? error.message : String(error) }));
    };
    return this.#listen(MAINTENANCE_CHANNEL, reload, { onReconnect: reload });
  }

  /** @returns {MaintenanceView | null} */
  current() {
    return viewOf(this.#notice);
  }

  isClosed() {
    return this.#notice !== null;
  }

  /**
   * The gate: what may not start during a maintenance calls it first.
   * @param {string} what e.g. "The shop"
   */
  assertOpen(what) {
    if (this.#notice !== null) {
      throw new AppError("MAINTENANCE", `${what} is closed for maintenance. Try again in a few minutes.`);
    }
  }

  /**
   * Runs when a maintenance is announced (the queue empties itself).
   * @param {() => Promise<unknown>} listener
   */
  onClose(listener) {
    this.#onClose.push(listener);
  }

  /**
   * Announces (or moves) a maintenance starting in `minutes`.
   * @param {Operator} operator
   * @param {{ minutes: number, message: string | null }} request
   * @returns {Promise<MaintenanceView>}
   */
  async announce(operator, { minutes, message }) {
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > MAX_LEAD_MINUTES) {
      throw new AppError("VALIDATION", `minutes must be an integer in 0..${MAX_LEAD_MINUTES}`);
    }
    const text = message === null || message.trim() === "" ? null : message.trim();
    if (text !== null && text.length > MAX_MESSAGE_LENGTH) {
      throw new AppError("VALIDATION", `the message is longer than ${MAX_MESSAGE_LENGTH} characters`);
    }
    const now = this.#clock.now();
    const notice = Object.freeze({ startsAt: now + minutes * 60 * 1000, message: text });
    await this.#unitOfWork(async () => {
      await this.#repository.save({ ...notice, at: now });
      await this.#audit.record({ ...actorOf(operator), action: "admin.maintenance_announced", targetKind: "maintenance", details: { startsAt: new Date(notice.startsAt).toISOString(), message: text } });
      await this.#publish(MAINTENANCE_CHANNEL, "changed");
    });
    this.#apply(notice);
    return /** @type {MaintenanceView} */ (viewOf(notice));
  }

  /**
   * Ends the maintenance: everything reopens.
   * @param {Operator} operator
   * @returns {Promise<boolean>} whether one was announced
   */
  async end(operator) {
    const ended = await this.#unitOfWork(async () => {
      const removed = await this.#repository.clear();
      if (removed) {
        await this.#audit.record({ ...actorOf(operator), action: "admin.maintenance_ended", targetKind: "maintenance" });
        await this.#publish(MAINTENANCE_CHANNEL, "changed");
      }
      return removed;
    });
    this.#apply(null);
    return ended;
  }

  async #reload() {
    this.#apply(await this.#repository.find());
  }

  /** @param {MaintenanceNotice | null} notice */
  #apply(notice) {
    const previous = this.#notice;
    if (sameNotice(previous, notice)) {
      return;
    }
    this.#notice = notice;
    if (notice === null) {
      this.#logger.info("maintenance ended");
    } else {
      this.#logger.info("maintenance announced", { startsAt: new Date(notice.startsAt).toISOString() });
    }
    const view = { maintenance: viewOf(notice) };
    for (const userId of this.#hub.connectedUsers()) {
      this.#hub.send(userId, "maintenance", view);
    }
    if (previous === null && notice !== null) {
      this.#close();
    }
  }

  #close() {
    for (const listener of this.#onClose) {
      listener().catch((error) => this.#logger.error("maintenance: closing failed", { error: error instanceof Error ? error.message : String(error) }));
    }
  }
}

/**
 * @param {MaintenanceNotice | null} a
 * @param {MaintenanceNotice | null} b
 */
function sameNotice(a, b) {
  return a === null || b === null ? a === b : a.startsAt === b.startsAt && a.message === b.message;
}

/**
 * @param {MaintenanceNotice | null} notice
 * @returns {MaintenanceView | null}
 */
function viewOf(notice) {
  return notice === null ? null : Object.freeze({ at: new Date(notice.startsAt).toISOString(), message: notice.message });
}

/** @param {Operator} operator */
function actorOf({ userId = null, ip = null }) {
  return { actorKind: /** @type {const} */ ("admin"), actorUserId: userId, ip };
}
