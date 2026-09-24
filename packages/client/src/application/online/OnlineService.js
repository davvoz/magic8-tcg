/**
 * Online play, as a use case the screens drive: connect, queue with an
 * account deck, get matched, contribute entropy, play, and resume after a
 * drop. The game itself runs on the server (RemoteMatchSession).
 *
 * Entropy: when a match is found the server has already committed to its
 * secret (seedCommit); only then does the client draw its 16 random bytes
 * and send them, so neither side can steer the seed (docs/tcg/03 §5).
 *
 * States: offline → connecting → idle ⇄ searching → matched → playing → over.
 */
import { fail, ok } from "@magic8/engine/shared/Result.js";
import { RemoteMatchSession } from "./RemoteMatchSession.js";

export const OnlineStatus = Object.freeze({
  OFFLINE: "offline",
  CONNECTING: "connecting",
  IDLE: "idle",
  SEARCHING: "searching",
  MATCHED: "matched",
  PLAYING: "playing",
  OVER: "over",
});

/**
 * @typedef {Readonly<{ id: string, name: string, faction: string, totalCards: number, playable: boolean, problem: string | null }>} OnlineDeck id is the server's deck id
 * @typedef {Readonly<{ status: string, error: Readonly<{ code: string, message: string }> | null, opponent: string | null, session: RemoteMatchSession | null }>} OnlineState
 */

const INITIAL = Object.freeze({ status: OnlineStatus.OFFLINE, error: null, opponent: null, session: null });

export class OnlineService {
  #connection;
  #randomHex;
  #newCommandId;
  #accountDecks;
  #logger;
  /** @type {OnlineState} */
  #state = INITIAL;
  /** @type {Set<(state: OnlineState) => void>} */
  #listeners = new Set();
  #started = false;
  /** The last game view the server sent (to rebuild a session). @type {any} */
  #lastView = null;

  /**
   * @param {{
   *   connection: import("../ports/Realtime.contract.js").RealtimeConnection,
   *   randomHex: (bytes: number) => string,
   *   newCommandId: () => string,
   *   accountDecks: () => readonly OnlineDeck[],
   *   logger: import("../ports/Logger.contract.js").Logger,
   * }} deps
   */
  constructor({ connection, randomHex, newCommandId, accountDecks, logger }) {
    this.#connection = connection;
    this.#randomHex = randomHex;
    this.#newCommandId = newCommandId;
    this.#accountDecks = accountDecks;
    this.#logger = logger;
  }

  get state() {
    return this.#state;
  }

  /** The account's decks, with whether the server would accept each for a game. */
  decks() {
    return this.#accountDecks();
  }

  /**
   * @param {(state: OnlineState) => void} listener
   * @returns {() => void}
   */
  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Connects (once); every (re)connection says hello and resumes a running game. */
  start() {
    if (this.#started) {
      return;
    }
    this.#started = true;
    this.#connection.onStatus((status, { code }) => this.#onStatus(status, code));
    this.#connection.subscribe((message) => this.#onMessage(message));
    this.#connection.connect();
  }

  /** Disconnects for good (sign-out). */
  stop() {
    this.#started = false;
    this.#connection.close();
    this.#state.session?.stop();
    this.#set(INITIAL);
  }

  /**
   * @param {string} deckId the server's id of an account deck
   * @param {"casual" | "ranked"} [mode]
   */
  async queue(deckId, mode = "casual") {
    const reply = await this.#connection.request("queue.join", { mode, deckId });
    if (!reply.ok || reply.value.t === "error") {
      const error = reply.ok ? reply.value.d : reply.error;
      this.#set({ error: { code: error.code, message: error.message } });
      return fail(error.code, error.message);
    }
    this.#set({ status: OnlineStatus.SEARCHING, error: null });
    return ok(undefined);
  }

  async leaveQueue() {
    await this.#connection.request("queue.leave", {});
    this.#set({ status: OnlineStatus.IDLE });
  }

  /**
   * The session to show: the current one, or a fresh one on the same game
   * when the match screen was left (a left session no longer listens).
   */
  resume() {
    const session = this.#state.session;
    if (session === null || !session.isStopped) {
      return session;
    }
    const fresh = new RemoteMatchSession({ gameId: session.gameId, seat: session.seat, request: (type, data) => this.#connection.request(type, data), newCommandId: this.#newCommandId });
    if (this.#lastView !== null) {
      fresh.apply(this.#lastView);
    }
    if (session.result !== null) {
      fresh.finish(session.result);
    }
    this.#set({ session: fresh });
    return fresh;
  }

  /** Back to the lobby once a finished game has been looked at. */
  dismissGame() {
    this.#state.session?.stop();
    this.#set({ status: OnlineStatus.IDLE, session: null, opponent: null });
  }

  /**
   * @param {string} status
   * @param {number | null} code
   */
  async #onStatus(status, code) {
    if (status === "connecting") {
      this.#set({ status: this.#state.session === null ? OnlineStatus.CONNECTING : this.#state.status });
      return;
    }
    if (status === "closed") {
      const error = code === 4000 ? { code: "REPLACED", message: "the game was opened in another tab" } : null;
      this.#set({ status: this.#state.session === null ? OnlineStatus.OFFLINE : this.#state.status, error });
      return;
    }
    const hello = await this.#connection.request("hello", { resume: null });
    if (!hello.ok || hello.value.t !== "welcome") {
      this.#set({ status: OnlineStatus.OFFLINE, error: { code: "HELLO_FAILED", message: "the game server did not welcome us" } });
      return;
    }
    const { activeGame, queue } = hello.value.d;
    if (activeGame !== null) {
      this.#adopt(activeGame);
    } else if (this.#state.session === null) {
      this.#set({ status: queue.state === "searching" ? OnlineStatus.SEARCHING : OnlineStatus.IDLE, error: null });
    }
  }

  /** @param {import("../ports/Realtime.contract.js").ServerMessage} message */
  #onMessage({ t, d }) {
    if (t === "queue.status") {
      if (this.#state.session === null) {
        this.#set({ status: d.state === "searching" ? OnlineStatus.SEARCHING : OnlineStatus.IDLE });
      }
    } else if (t === "match.found") {
      this.#matched(d);
    } else if (t === "game.events" || t === "game.state") {
      this.#adopt(d);
    } else if (t === "game.over") {
      this.#state.session?.finish(d);
      this.#set({ status: OnlineStatus.OVER });
    } else if (t === "session.replaced") {
      this.#set({ error: { code: "REPLACED", message: "the game was opened in another tab" } });
    }
  }

  /** @param {{ gameId: string, seat: string, opponent: { account: string | null } }} found */
  #matched(found) {
    const session = new RemoteMatchSession({ gameId: found.gameId, seat: found.seat, request: (type, data) => this.#connection.request(type, data), newCommandId: this.#newCommandId });
    this.#set({ status: OnlineStatus.MATCHED, opponent: found.opponent.account, session, error: null });
    // Our entropy, drawn only now that the server is committed to its secret.
    this.#sendEntropy(found.gameId);
  }

  /**
   * A game view from the server: create the session if needed (resume), then update it.
   * @param {any} view
   */
  #adopt(view) {
    let session = this.#state.session;
    if (session === null || session.gameId !== view.gameId) {
      session = new RemoteMatchSession({ gameId: view.gameId, seat: view.seat, request: (type, data) => this.#connection.request(type, data), newCommandId: this.#newCommandId });
    }
    session.apply(view);
    this.#lastView = view;
    if (view.status === "CREATED") {
      // Reconnected before the game started: our entropy may not have arrived (the server ignores a second one).
      this.#sendEntropy(view.gameId);
    }
    this.#set({ status: statusOfGame(view.status), session, opponent: view.opponent?.account ?? this.#state.opponent });
  }

  /** @param {string} gameId */
  #sendEntropy(gameId) {
    this.#connection.request("game.entropy", { gameId, entropy: this.#randomHex(16) }).then((reply) => {
      if (!reply.ok || reply.value.t === "error") {
        this.#logger.warn("entropy not accepted", reply.ok ? reply.value.d : reply.error);
      }
    });
  }

  /** @param {Partial<OnlineState>} changes */
  #set(changes) {
    this.#state = Object.freeze({ ...this.#state, ...changes });
    for (const listener of this.#listeners) {
      listener(this.#state);
    }
  }
}

/** @param {string} gameStatus the server's game status */
function statusOfGame(gameStatus) {
  if (gameStatus === "ACTIVE") {
    return OnlineStatus.PLAYING;
  }
  return gameStatus === "CREATED" ? OnlineStatus.MATCHED : OnlineStatus.OVER;
}
