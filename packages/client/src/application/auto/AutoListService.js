/**
 * The auto list of ranked play (docs/tcg/23-automatica.md): the player
 * chooses one of their decks and a style, and joins. When someone else
 * joins, even hours later, the server has the AI play both decks and the
 * result arrives as a notification. Once in, the player stays in: there is
 * nothing to leave the list with.
 *
 * Joining takes two steps the player never sees: the server first makes the
 * ticket's secret and sends only its commitment (`auto.prepare`); only then
 * does the browser draw its own 16 random bytes and join with them
 * (`auto.join`), so neither side can steer the game's seed.
 *
 * The server is the record of where the player's ticket stands; it says so
 * on (re)connection, after joining, and when the ticket becomes a game or
 * closes without one.
 */
import { fail, ok } from "@magic8/engine/shared/Result.js";

/** The AI styles a player may choose, as the server knows them. */
export const AutoStyle = Object.freeze({ AGGRESSIVE: "aggressive", BALANCED: "balanced", DEFENSIVE: "defensive" });
export const AUTO_STYLES = Object.freeze([AutoStyle.AGGRESSIVE, AutoStyle.BALANCED, AutoStyle.DEFENSIVE]);
export const AutoListStatus = Object.freeze({ UNKNOWN: "unknown", IDLE: "idle", JOINING: "joining", WAITING: "waiting" });

/**
 * @typedef {Readonly<{ ticket: string, since: number, deckId: string, style: string, entries: number }>} AutoTicket
 * @typedef {Readonly<{ status: string, ticket: AutoTicket | null, waiting: number, lastGame: string | null, closed: string | null, error: Readonly<{ code: string, message: string }> | null }>} AutoListState
 *   `waiting`: how many tickets wait in the list (the player's included); `lastGame`: the game the player's last ticket became;
 *   `closed`: why the last ticket closed without a game (season_ended, failed)
 */

const INITIAL = Object.freeze({ status: AutoListStatus.UNKNOWN, ticket: null, waiting: 0, lastGame: null, closed: null, error: null });
const ENTROPY_BYTES = 16;

export class AutoListService {
  #connection;
  #randomHex;
  #logger;
  /** @type {AutoListState} */
  #state = INITIAL;
  /** @type {Set<(state: AutoListState) => void>} */
  #listeners = new Set();
  /** @type {Array<() => void>} */
  #unsubscribes = [];
  /** Increases on start and stop, so a slow reply for a previous session is ignored. */
  #generation = 0;

  /**
   * @param {{
   *   connection: import("../ports/Realtime.contract.js").RealtimeConnection,
   *   randomHex: (bytes: number) => string,
   *   logger: import("../ports/Logger.contract.js").Logger,
   * }} deps `randomHex`: cryptographically random bytes, as lowercase hex
   */
  constructor({ connection, randomHex, logger }) {
    this.#connection = connection;
    this.#randomHex = randomHex;
    this.#logger = logger;
  }

  get state() {
    return this.#state;
  }

  /**
   * @param {(state: AutoListState) => void} listener
   * @returns {() => void}
   */
  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Signed in: listen, and read where the player's ticket stands. Idempotent. */
  start() {
    if (this.#unsubscribes.length > 0) {
      return;
    }
    this.#generation += 1;
    this.#unsubscribes = [
      this.#connection.subscribe((message) => {
        if (message.t === "auto.status") {
          this.#apply(message.d);
        }
      }),
      this.#connection.onStatus((status) => {
        if (status === "open") {
          void this.refresh();
        }
      }),
    ];
    this.#connection.connect();
    if (this.#connection.status === "open") {
      void this.refresh();
    }
  }

  /** Signed out: forget everything. */
  stop() {
    this.#unsubscribes.forEach((unsubscribe) => unsubscribe());
    this.#unsubscribes = [];
    this.#generation += 1;
    this.#set(INITIAL);
  }

  /** Reads where the player's ticket stands, and how many wait in the list. */
  async refresh() {
    const generation = this.#generation;
    const reply = await this.#connection.request("auto.status", {});
    if (generation !== this.#generation) {
      return;
    }
    if (!reply.ok || reply.value.t !== "auto.status") {
      this.#logger.warn("the auto list could not be read", reply.ok ? reply.value.d : reply.error);
      return;
    }
    this.#apply(reply.value.d);
  }

  /**
   * Joins the auto list with one of the account's decks and a style, paying a ranked entry. There is no leaving it.
   * @param {string} deckId the server's id of the deck
   * @param {string} style one of AutoStyle
   */
  async join(deckId, style) {
    if (this.#state.status === AutoListStatus.JOINING || this.#state.status === AutoListStatus.WAITING) {
      return fail("CONFLICT", "you are already in the auto list");
    }
    const before = this.#state.status;
    this.#set({ status: AutoListStatus.JOINING, error: null, closed: null });
    const prepared = await this.#connection.request("auto.prepare", {});
    const refused = this.#failure(prepared, "auto.prepared");
    if (refused !== null) {
      this.#set({ status: before, error: refused.error });
      return refused;
    }
    const { ticket: id } = /** @type {any} */ (prepared).value.d;
    // Drawn only now: the server is already bound to the ticket's secret.
    const entropy = this.#randomHex(ENTROPY_BYTES);
    const joined = await this.#connection.request("auto.join", { ticket: id, deckId, style, entropy });
    const failure = this.#failure(joined, "auto.status");
    if (failure !== null) {
      this.#set({ status: before, error: failure.error });
      return failure;
    }
    this.#apply(/** @type {any} */ (joined).value.d);
    return ok(this.#state);
  }

  clearError() {
    this.#set({ error: null });
  }

  /**
   * The server's word on the player's ticket.
   * @param {any} status
   */
  #apply(status) {
    const waiting = Number.isSafeInteger(status?.waiting) ? status.waiting : this.#state.waiting;
    const ticket = ticketOf(status);
    if (ticket !== null) {
      this.#set({ status: AutoListStatus.WAITING, ticket, waiting, error: null });
      return;
    }
    // A ticket that just became a game, or closed without one, is no longer waiting.
    const lastGame = typeof status?.game === "string" ? status.game : this.#state.lastGame;
    const closed = typeof status?.reason === "string" ? status.reason : this.#state.closed;
    this.#set({ status: this.#state.status === AutoListStatus.JOINING ? AutoListStatus.JOINING : AutoListStatus.IDLE, ticket: null, waiting, lastGame, closed });
  }

  /**
   * @param {import("@magic8/engine/shared/Result.js").Ok<import("../ports/Realtime.contract.js").ServerMessage> | import("@magic8/engine/shared/Result.js").Fail} reply
   * @param {string} expected
   * @returns {import("@magic8/engine/shared/Result.js").Fail | null}
   */
  #failure(reply, expected) {
    if (!reply.ok) {
      return reply;
    }
    if (reply.value.t !== expected) {
      const error = reply.value.d ?? {};
      return fail(String(error.code ?? "REJECTED"), String(error.message ?? "the server refused"));
    }
    return null;
  }

  /** @param {Partial<AutoListState>} changes */
  #set(changes) {
    this.#state = Object.freeze({ ...this.#state, ...changes });
    for (const listener of this.#listeners) {
      listener(this.#state);
    }
  }
}

/**
 * The player's waiting ticket in a status the server sent, or null when none waits.
 * @param {any} status
 * @returns {AutoTicket | null}
 */
function ticketOf(status) {
  if (status?.state !== "waiting" || typeof status.ticket !== "string") {
    return null;
  }
  return Object.freeze({ ticket: status.ticket, since: Number(status.since) || 0, deckId: String(status.deckId ?? ""), style: String(status.style ?? ""), entries: Number(status.entries) || 0 });
}
