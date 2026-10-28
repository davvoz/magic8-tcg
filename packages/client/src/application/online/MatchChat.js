/**
 * The chat of an online game (docs/tcg/28-chat.md), as the match screen
 * uses it: the lines heard so far, saying one, and muting the others.
 *
 * The server decides who hears what: a player's line reaches both players
 * and the spectators, a spectator's only the spectators. This side just
 * keeps what it was sent (the latest MAX_LINES) and tells its listeners.
 * A line is said through the server and heard back from it like anyone
 * else's, so what shows is always what the others read.
 *
 * Muting hides what the others say from then on (one's own lines still
 * show); it lasts as long as the game is on screen.
 */
import { fail, ok } from "@magic8/engine/shared/Result.js";

/** Who said a line: one of the players, or someone watching. */
export const ChatFrom = Object.freeze({ PLAYER: "player", SPECTATOR: "spectator" });

/** The longest line the server keeps, in characters; the field stops there. */
export const MAX_CHAT_LENGTH = 140;

/** Lines kept for the chat dialog. */
const MAX_LINES = 50;

/**
 * @typedef {Readonly<{ gameId: string, from: string, seat: string | null, account: string, text: string, at: number }>} ChatLine
 *   `seat`: the player's, null for a spectator
 */

export class MatchChat {
  #gameId;
  #request;
  #account;
  /** @type {ChatLine[]} */
  #lines = [];
  #muted = false;
  /** @type {Set<(line: ChatLine) => void>} */
  #listeners = new Set();

  /**
   * @param {{ gameId: string, request: import("../ports/Realtime.contract.js").RealtimeConnection["request"], account: () => string | null, lines?: readonly unknown[] }} deps
   *   `account`: who is signed in here (their own lines are never muted); `lines`: what was said before (a spectator's history)
   */
  constructor({ gameId, request, account, lines = [] }) {
    this.#gameId = gameId;
    this.#request = request;
    this.#account = account;
    this.catchUp(lines);
  }

  get gameId() {
    return this.#gameId;
  }

  /** The lines heard, oldest first. @returns {readonly ChatLine[]} */
  get lines() {
    return this.#lines;
  }

  get muted() {
    return this.#muted;
  }

  /** @param {boolean} muted */
  setMuted(muted) {
    this.#muted = muted;
  }

  /**
   * Whether a line is the signed-in person's own.
   * @param {ChatLine} line
   */
  isOwn(line) {
    return line.account === this.#account();
  }

  /**
   * Says a line at the table. It shows once the server sends it back.
   * @param {string} text
   * @returns {Promise<import("@magic8/engine/shared/Result.js").Ok<undefined> | import("@magic8/engine/shared/Result.js").Fail>}
   */
  async say(text) {
    const line = text.trim();
    if (line.length === 0) {
      return fail("INVALID_CHAT", "nothing to say");
    }
    const reply = await this.#request("game.chat", { gameId: this.#gameId, text: Array.from(line).slice(0, MAX_CHAT_LENGTH).join("") });
    if (reply.ok && reply.value.t === "game.chatted") {
      return ok(undefined);
    }
    const error = reply.ok ? reply.value.d : reply.error;
    return fail(error?.details?.code ?? error?.code ?? "REJECTED", error?.message ?? "the line was not sent");
  }

  /**
   * A line the server sent (game.chat, watch.chat); anything malformed or about another game is ignored.
   * @param {unknown} message
   */
  hear(message) {
    const line = chatLineOf(message);
    if (line === null || line.gameId !== this.#gameId || (this.#muted && !this.isOwn(line))) {
      return;
    }
    this.#lines = [...this.#lines, line].slice(-MAX_LINES);
    for (const listener of this.#listeners) {
      listener(line);
    }
  }

  /**
   * What was said, as the server keeps it (a spectator's history, sent again
   * after a reconnection): only the lines newer than the last one heard are added.
   * @param {readonly unknown[]} lines
   */
  catchUp(lines) {
    const since = this.#lines.at(-1)?.at ?? -Infinity;
    for (const message of Array.isArray(lines) ? lines : []) {
      const line = chatLineOf(message);
      if (line !== null && line.at > since) {
        this.hear(line);
      }
    }
  }

  /**
   * @param {(line: ChatLine) => void} listener
   * @returns {() => void}
   */
  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}

/**
 * @param {unknown} message
 * @returns {ChatLine | null}
 */
function chatLineOf(message) {
  if (message === null || typeof message !== "object") {
    return null;
  }
  const { gameId, from, seat, account, text, at } = /** @type {Record<string, unknown>} */ (message);
  if (typeof gameId !== "string" || typeof account !== "string" || typeof text !== "string" || typeof at !== "number" || (from !== ChatFrom.PLAYER && from !== ChatFrom.SPECTATOR)) {
    return null;
  }
  return Object.freeze({ gameId, from, seat: typeof seat === "string" ? seat : null, account, text, at });
}
