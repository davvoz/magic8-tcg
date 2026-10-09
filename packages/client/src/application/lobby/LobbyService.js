/**
 * The lobby (docs/tcg/17-lobby-e-sfide.md): who else is online, and
 * challenges between players — a casual or ranked game proposed to someone
 * in particular, which starts as soon as they accept.
 *
 * Signed in, the service listens on the realtime connection from the start,
 * so a challenge reaches the player on any screen (`onEvent`, the toasts).
 * The list of players is read on every (re)connection and, while a screen
 * shows it (`watch`), every few seconds. The server is the record: a
 * challenge closes when the server says so (answered, taken back, lapsed,
 * a player left), and the game an accepted challenge starts arrives like
 * any other (match.found, through OnlineService).
 */
import { fail, ok } from "@magic8/engine/shared/Result.js";

export const ChallengeMode = Object.freeze({ CASUAL: "casual", RANKED: "ranked" });
export const PlayerActivity = Object.freeze({ IDLE: "idle", SEARCHING: "searching", PLAYING: "playing" });
/** Why a challenge closed (the server's challenge.closed). */
export const ChallengeEnd = Object.freeze({ ACCEPTED: "accepted", DECLINED: "declined", CANCELLED: "cancelled", EXPIRED: "expired", OFFLINE: "offline", BUSY: "busy", MAINTENANCE: "maintenance", PAIR_LIMIT: "pair_limit" });
/** How often a shown list of players is read again. */
const POLL_MS = 5000;

/**
 * @typedef {Readonly<{ account: string, status: string }>} OnlinePlayer
 * @typedef {Readonly<{ id: string, from: string, to: string, mode: string, deadline: number }>} Challenge `deadline`: when it lapses, on this browser's clock
 * @typedef {Readonly<{ players: readonly OnlinePlayer[], incoming: readonly Challenge[], outgoing: Challenge | null, loaded: boolean, error: Readonly<{ code: string, message: string }> | null }>} LobbyState
 * @typedef {Readonly<{ kind: "received", challenge: Challenge } | { kind: "closed", challenge: Challenge, reason: string, outgoing: boolean }>} LobbyEvent
 */

const INITIAL = Object.freeze({ players: Object.freeze([]), incoming: Object.freeze([]), outgoing: null, loaded: false, error: null });

export class LobbyService {
  #connection;
  #scheduler;
  #now;
  #logger;
  /** @type {LobbyState} */
  #state = INITIAL;
  /** @type {Set<(state: LobbyState) => void>} */
  #listeners = new Set();
  /** @type {Set<(event: LobbyEvent) => void>} */
  #eventListeners = new Set();
  /** @type {Array<() => void>} */
  #unsubscribes = [];
  /** Screens showing the list right now. */
  #watchers = 0;
  /** Increases on start and stop, so a slow read for a previous session is ignored. */
  #generation = 0;
  #polling = false;

  /**
   * @param {{
   *   connection: import("../ports/Realtime.contract.js").RealtimeConnection,
   *   scheduler: import("../ports/Scheduler.contract.js").Scheduler,
   *   now: () => number,
   *   logger: import("../ports/Logger.contract.js").Logger,
   * }} deps
   */
  constructor({ connection, scheduler, now, logger }) {
    this.#connection = connection;
    this.#scheduler = scheduler;
    this.#now = now;
    this.#logger = logger;
  }

  get state() {
    return this.#state;
  }

  /**
   * @param {(state: LobbyState) => void} listener
   * @returns {() => void}
   */
  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /**
   * Hears challenges arriving and closing, on any screen.
   * @param {(event: LobbyEvent) => void} listener
   * @returns {() => void}
   */
  onEvent(listener) {
    this.#eventListeners.add(listener);
    return () => this.#eventListeners.delete(listener);
  }

  /** Signed in: listen and read the lobby. Idempotent. */
  start() {
    if (this.#unsubscribes.length > 0) {
      return;
    }
    this.#generation += 1;
    this.#unsubscribes = [
      this.#connection.subscribe((message) => this.#onMessage(message)),
      this.#connection.onStatus((status) => {
        if (status === "open") {
          void this.refresh();
        } else if (status === "closed") {
          // The server forgets the challenges of a player who left.
          this.#set({ incoming: Object.freeze([]), outgoing: null });
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

  /**
   * A screen shows the list: it is read again every few seconds until the returned function is called.
   * @returns {() => void}
   */
  watch() {
    this.#watchers += 1;
    void this.refresh();
    if (!this.#polling) {
      void this.#poll();
    }
    let watching = true;
    return () => {
      if (watching) {
        watching = false;
        this.#watchers -= 1;
      }
    };
  }

  /** Reads who is online and the player's challenges. */
  async refresh() {
    const generation = this.#generation;
    const reply = await this.#connection.request("lobby.list", {});
    if (generation !== this.#generation) {
      return;
    }
    if (!reply.ok || reply.value.t !== "lobby.players") {
      const error = reply.ok ? reply.value.d : reply.error;
      this.#logger.warn("the lobby could not be read", error);
      return;
    }
    const { players, challenges } = reply.value.d;
    this.#set({
      players: Object.freeze(players.map((/** @type {any} */ player) => Object.freeze({ account: String(player.account), status: String(player.status) }))),
      incoming: Object.freeze(challenges.incoming.map((/** @type {any} */ view) => this.#challengeOf(view))),
      outgoing: challenges.outgoing === null ? null : this.#challengeOf(challenges.outgoing),
      loaded: true,
    });
  }

  /**
   * Challenges an online player with one of the account's decks (replaces a challenge already out).
   * @param {string} account
   * @param {string} mode ChallengeMode
   * @param {string} deckId the server's id of the deck
   */
  async challenge(account, mode, deckId) {
    const reply = await this.#connection.request("challenge.send", { to: account, mode, deckId });
    const failure = this.#failure(reply, "challenge.sent");
    if (failure !== null) {
      return failure;
    }
    const challenge = this.#challengeOf(/** @type {any} */ (reply).value.d);
    this.#set({ outgoing: challenge, error: null });
    return ok(challenge);
  }

  /**
   * Accepts a challenge with one of the account's decks; the game starts (match.found follows).
   * @param {string} challengeId
   * @param {string} deckId
   */
  async accept(challengeId, deckId) {
    const reply = await this.#connection.request("challenge.accept", { challengeId, deckId });
    const failure = this.#failure(reply, "challenge.accepted");
    if (failure !== null) {
      // A challenge that is gone (lapsed, taken back, past the daily ranked games of the pair) leaves the list; a bad deck leaves it open.
      if (failure.error.code === "NOT_FOUND" || failure.error.code === "CONFLICT" || failure.error.code === "LIMIT_REACHED") {
        this.#forget(challengeId);
      }
      return failure;
    }
    this.#forget(challengeId);
    this.#set({ error: null });
    return ok(Object.freeze({ gameId: String(/** @type {any} */ (reply).value.d.gameId) }));
  }

  /** @param {string} challengeId */
  async decline(challengeId) {
    this.#forget(challengeId);
    const reply = await this.#connection.request("challenge.decline", { challengeId });
    return this.#failure(reply, "challenge.declined") ?? ok(undefined);
  }

  /** Takes back the challenge the player has out. */
  async cancel() {
    const outgoing = this.#state.outgoing;
    if (outgoing === null) {
      return ok(undefined);
    }
    this.#set({ outgoing: null });
    const reply = await this.#connection.request("challenge.cancel", { challengeId: outgoing.id });
    return this.#failure(reply, "challenge.cancelled") ?? ok(undefined);
  }

  /** Forgets the last error shown. */
  clearError() {
    this.#set({ error: null });
  }

  async #poll() {
    this.#polling = true;
    while (this.#watchers > 0) {
      await this.#scheduler.delay(POLL_MS);
      if (this.#watchers > 0 && this.#unsubscribes.length > 0) {
        await this.refresh();
      }
    }
    this.#polling = false;
  }

  /** @param {import("../ports/Realtime.contract.js").ServerMessage} message */
  #onMessage({ t, d }) {
    if (t === "challenge.received") {
      const challenge = this.#challengeOf(d);
      this.#set({ incoming: Object.freeze([...this.#state.incoming.filter((open) => open.id !== challenge.id), challenge]) });
      this.#emit({ kind: "received", challenge });
    } else if (t === "challenge.closed") {
      this.#closed(String(d.challengeId), String(d.reason));
    }
  }

  /**
   * @param {string} challengeId
   * @param {string} reason
   */
  #closed(challengeId, reason) {
    const outgoing = this.#state.outgoing?.id === challengeId ? this.#state.outgoing : null;
    const challenge = outgoing ?? this.#state.incoming.find((open) => open.id === challengeId) ?? null;
    if (challenge === null) {
      return;
    }
    this.#forget(challengeId);
    this.#emit({ kind: "closed", challenge, reason, outgoing: outgoing !== null });
  }

  /** @param {string} challengeId */
  #forget(challengeId) {
    this.#set({
      incoming: Object.freeze(this.#state.incoming.filter((open) => open.id !== challengeId)),
      outgoing: this.#state.outgoing?.id === challengeId ? null : this.#state.outgoing,
    });
  }

  /**
   * @param {any} view the server's challenge
   * @returns {Challenge}
   */
  #challengeOf(view) {
    return Object.freeze({ id: String(view.id), from: String(view.from), to: String(view.to), mode: String(view.mode), deadline: this.#now() + Math.max(0, Number(view.expiresInMs) || 0) });
  }

  /**
   * The failure in a reply (also kept as the state's error), or null when the server answered `expected`.
   * @param {import("@magic8/engine/shared/Result.js").Ok<import("../ports/Realtime.contract.js").ServerMessage> | import("@magic8/engine/shared/Result.js").Fail} reply
   * @param {string} expected
   */
  #failure(reply, expected) {
    if (reply.ok && reply.value.t === expected) {
      return null;
    }
    const error = reply.ok ? reply.value.d : reply.error;
    const code = String(error?.code ?? "UNKNOWN");
    const message = String(error?.message ?? "the server did not answer");
    this.#set({ error: Object.freeze({ code, message }) });
    return fail(code, message);
  }

  /** @param {LobbyEvent} event */
  #emit(event) {
    for (const listener of this.#eventListeners) {
      listener(event);
    }
  }

  /** @param {Partial<LobbyState>} changes */
  #set(changes) {
    this.#state = Object.freeze({ ...this.#state, ...changes });
    for (const listener of this.#listeners) {
      listener(this.#state);
    }
  }
}
