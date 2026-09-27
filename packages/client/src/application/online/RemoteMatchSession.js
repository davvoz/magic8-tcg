/**
 * A match played on the game server, behind the same interface the match
 * screen uses for a local MatchSession. The server is the authority: this
 * session only holds the latest snapshot the server sent for our seat,
 * forwards our commands, and relays updates. Nothing here decides a rule.
 *
 * `submit` resolves when the server acknowledges; the command names the
 * version it was decided on, so a stale click is refused (STALE_VERSION)
 * instead of being applied to a different state.
 *
 * In game protocol v2 every command is signed with the game's session key
 * (docs/tcg/12) before it leaves; a command that cannot be signed is not sent.
 *
 * With no seat it is a spectator's session: it shows what the server
 * streams to spectators (no hand on either side) and submits nothing.
 */
import { fail, ok } from "@magic8/engine/shared/Result.js";

/**
 * The decision clock the server sends with every view (docs/tcg/02 §3.7):
 * who is being timed and by when. `deadline` is a server timestamp
 * (milliseconds since epoch), comparable with the client's own clock only
 * loosely — it is shown, never enforced, here.
 * @typedef {Readonly<{ activeSeat: string | null, deadline: number | null, reserveMs: Readonly<Record<string, number>> }>} MatchClock
 */

export class RemoteMatchSession {
  #gameId;
  #seat;
  #request;
  #newCommandId;
  #onStop;
  #onAck;
  #signMove;
  /** Game protocol version, from the server's views. */
  #protocol = 1;
  /** @type {any} */
  #snapshot = null;
  /** The decision clock, as the server last sent it. @type {MatchClock | null} */
  #clock = null;
  #version = 0;
  #stopped = false;
  /** @type {any} */
  #result = null;
  /** @type {Set<(update: { events: readonly any[], version: number, playerId: string | null }) => void>} */
  #listeners = new Set();

  /**
   * @param {{
   *   gameId: string, seat: string | null, request: import("../ports/Realtime.contract.js").RealtimeConnection["request"], newCommandId: () => string,
   *   onStop?: () => void, onAck?: (ack: Readonly<Record<string, unknown>>) => void,
   *   signMove?: (move: import("../ports/SessionKeys.contract.js").MoveToSign) => Promise<string | null>,
   * }} deps seat null: watching; onAck: every accepted command's ack (signed by the server, docs/tcg/11); signMove: v2 signatures
   */
  constructor({ gameId, seat, request, newCommandId, onStop = () => undefined, onAck = () => undefined, signMove = async () => null }) {
    this.#gameId = gameId;
    this.#seat = seat;
    this.#request = request;
    this.#newCommandId = newCommandId;
    this.#onStop = onStop;
    this.#onAck = onAck;
    this.#signMove = signMove;
  }

  get gameId() {
    return this.#gameId;
  }

  get seat() {
    return this.#seat;
  }

  get humanPlayerIds() {
    return Object.freeze(this.#seat === null ? [] : [this.#seat]);
  }

  get isSpectating() {
    return this.#seat === null;
  }

  get version() {
    return this.#version;
  }

  get isOver() {
    return this.#snapshot?.isOver === true;
  }

  get isStopped() {
    return this.#stopped;
  }

  /** True once the server has sent a snapshot (the game started). */
  get hasSnapshot() {
    return this.#snapshot !== null;
  }

  /** The server's final word, once the game ended. */
  get result() {
    return this.#result;
  }

  /** Who is on the clock and by when, as the server last sent it (null before the first view). */
  get clock() {
    return this.#clock;
  }

  /** @param {(update: { events: readonly any[], version: number, playerId: string | null }) => void} listener */
  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /**
   * A state (and the events that led to it) from the server.
   * @param {{ version: number, snapshot: any, events?: readonly any[], protocol?: number, clock?: MatchClock }} update
   */
  apply(update) {
    if (update.snapshot === null || update.snapshot === undefined || update.version < this.#version) {
      return;
    }
    this.#snapshot = update.snapshot;
    this.#version = update.version;
    this.#protocol = typeof update.protocol === "number" ? update.protocol : this.#protocol;
    this.#clock = update.clock ?? this.#clock;
    const published = Object.freeze({ events: update.events ?? [], version: update.version, playerId: null });
    for (const listener of this.#listeners) {
      listener(published);
    }
  }

  /** @param {any} result the server's game.over */
  finish(result) {
    this.#result = result;
  }

  /**
   * @param {Readonly<Record<string, unknown>>} command
   * @returns {Promise<import("@magic8/engine/shared/Result.js").Ok<any> | import("@magic8/engine/shared/Result.js").Fail>}
   */
  async submit(command) {
    if (this.#stopped) {
      return fail("GAME_OVER", "the match was left");
    }
    if (this.#seat === null) {
      return fail("SPECTATOR", "spectators cannot play");
    }
    const withoutPlayer = { ...command };
    delete withoutPlayer.playerId;
    const move = { gameId: this.#gameId, commandId: this.#newCommandId(), expectedVersion: this.#version, command: withoutPlayer };
    const signed = await this.#signatureFor(move);
    if (signed === null) {
      return fail("SESSION_REQUIRED", "this browser has no authorised key to sign the move");
    }
    const reply = await this.#request("game.command", { ...move, ...signed });
    if (!reply.ok) {
      return reply;
    }
    const { t, d } = reply.value;
    if (t === "game.ack" && d.ok === true) {
      this.#onAck(d);
      return ok(d);
    }
    const error = t === "game.ack" ? d.error : d;
    return fail(error?.code ?? "REJECTED", error?.message ?? "the server refused the move");
  }

  /**
   * What a command carries besides itself: nothing in v1, its signature from v2 on (null: cannot be signed).
   * @param {import("../ports/SessionKeys.contract.js").MoveToSign} move
   * @returns {Promise<{ signature?: string } | null>}
   */
  async #signatureFor(move) {
    if (this.#protocol < 2) {
      return {};
    }
    const signature = await this.#signMove(move);
    return signature === null ? null : { signature };
  }

  /** Stops showing the match; the game goes on (or ends) on the server. */
  stop() {
    if (this.#stopped) {
      return;
    }
    this.#stopped = true;
    this.#listeners.clear();
    this.#onStop();
  }

  whenIdle() {
    return Promise.resolve();
  }

  /** @param {string | null} _perspectivePlayerId the server only ever sends our own perspective (or the spectators') */
  snapshotFor(_perspectivePlayerId) {
    return this.#snapshot;
  }

  /**
   * @param {readonly any[]} events already redacted by the server for our seat
   * @param {string | null} _perspectivePlayerId
   */
  eventsFor(events, _perspectivePlayerId) {
    return events;
  }

  /** @param {string} playerId */
  controllerKindOf(playerId) {
    return playerId === this.#seat ? "human" : "remote";
  }
}
