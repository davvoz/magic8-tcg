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
 *
 * In game protocol v2 (docs/tcg/12) the browser makes a session key for the
 * game as soon as it is matched (or after a reload, for a game in progress)
 * and asks the wallet to authorise it with the account's posting key; every
 * move is then signed with it.
 *
 * Every move the server accepts comes back with a signed ack; with a
 * `receipts` store they are checked and kept (docs/tcg/11-ack-firmati.md).
 *
 * Watching (docs/tcg/10-spettatori.md) runs beside those states: one game
 * at a time, shown through a seatless RemoteMatchSession, resumed after a
 * reconnection until it ends or the player stops watching.
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
 * @typedef {Readonly<{ status: string, error: Readonly<{ code: string, message: string }> | null, opponent: string | null, session: RemoteMatchSession | null, watching: RemoteMatchSession | null }>} OnlineState
 */

const INITIAL = Object.freeze({ status: OnlineStatus.OFFLINE, error: null, opponent: null, session: null, watching: null });

export class OnlineService {
  #connection;
  #randomHex;
  #newCommandId;
  #accountDecks;
  #liveGames;
  #receipts;
  #sessionKeys;
  #wallet;
  #logger;
  /** The signed-in account, from the welcome. @type {string | null} */
  #account = null;
  /** @type {Set<string>} games whose session key is being authorised */
  #authorizing = new Set();
  /** The key the server said it signs acks with. @type {string | null} */
  #ackKey = null;
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
   *   liveGames?: import("../ports/LiveGamesApi.contract.js").LiveGamesApi,
   *   receipts?: import("./AckReceipts.js").AckReceipts,
   *   sessionKeys?: import("../ports/SessionKeys.contract.js").SessionKeys,
   *   wallet?: Pick<import("../ports/WalletConnector.contract.js").WalletConnector, "signMessage">,
   *   logger: import("../ports/Logger.contract.js").Logger,
   * }} deps `sessionKeys` and `wallet` are needed to play games in protocol v2
   */
  constructor({ connection, randomHex, newCommandId, accountDecks, liveGames, receipts, sessionKeys, wallet, logger }) {
    this.#connection = connection;
    this.#randomHex = randomHex;
    this.#newCommandId = newCommandId;
    this.#accountDecks = accountDecks;
    this.#liveGames = liveGames ?? null;
    this.#receipts = receipts ?? null;
    this.#sessionKeys = sessionKeys ?? null;
    this.#wallet = wallet ?? null;
    this.#logger = logger;
  }

  /** Whether this client can list games to watch. */
  get canWatch() {
    return this.#liveGames !== null;
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
    const { session, watching } = this.#state;
    this.#set(INITIAL);
    session?.stop();
    watching?.stop();
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
    const fresh = this.#playerSession(session.gameId, /** @type {string} */ (session.seat));
    if (this.#lastView !== null) {
      fresh.apply(this.#lastView);
    }
    if (session.result !== null) {
      fresh.finish(session.result);
    }
    this.#set({ session: fresh });
    return fresh;
  }

  /** The games being played now, the most watched first. */
  async liveGames() {
    if (this.#liveGames === null) {
      return fail("UNAVAILABLE", "this client cannot list games");
    }
    return this.#liveGames.live();
  }

  /**
   * Starts watching a game (and stops watching any other).
   * @param {string} gameId
   * @returns {Promise<import("@magic8/engine/shared/Result.js").Ok<RemoteMatchSession> | import("@magic8/engine/shared/Result.js").Fail>}
   */
  async watch(gameId) {
    const reply = await this.#connection.request("watch.start", { gameId });
    if (!reply.ok || reply.value.t !== "watch.state") {
      const error = reply.ok ? reply.value.d : reply.error;
      return fail(error.details?.code ?? error.code, error.message);
    }
    const previous = this.#state.watching;
    const session = new RemoteMatchSession({ gameId, seat: null, request: (type, data) => this.#connection.request(type, data), newCommandId: this.#newCommandId, onStop: () => this.#watchStopped(session) });
    session.apply(reply.value.d);
    this.#set({ watching: session });
    if (previous !== null && previous.gameId !== gameId) {
      previous.stop();
    }
    return ok(session);
  }

  /** @param {RemoteMatchSession} session */
  #watchStopped(session) {
    if (this.#state.watching !== session) {
      return;
    }
    this.#set({ watching: null });
    if (!session.isOver) {
      this.#connection.request("watch.stop", {});
    }
  }

  /** Back to the lobby once a finished game has been looked at. */
  dismissGame() {
    const session = this.#state.session;
    if (session !== null) {
      this.#sessionKeys?.forget(session.gameId);
    }
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
    this.#rewatch();
    this.#welcomed(hello.value.d);
  }

  /**
   * The server's welcome: who we are, the ack key, and a game or queue to resume.
   * @param {any} welcome
   */
  #welcomed({ activeGame, queue, ackKey, user }) {
    this.#ackKey = typeof ackKey === "string" ? ackKey : null;
    this.#account = typeof user?.account === "string" ? user.account : null;
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
    } else if (t.startsWith("watch.")) {
      this.#onWatchMessage(t, d);
    } else if (t === "session.replaced") {
      this.#set({ error: { code: "REPLACED", message: "the game was opened in another tab" } });
    }
  }

  /**
   * An update of the game being watched (anything about another game is stale).
   * @param {string} t
   * @param {any} d
   */
  #onWatchMessage(t, d) {
    const watching = this.#state.watching;
    if (watching === null || d.gameId !== watching.gameId) {
      return;
    }
    if (t === "watch.events") {
      watching.apply(d);
    } else if (t === "watch.over") {
      watching.finish(d);
    }
  }

  /** A new connection: the server forgot what we watched, ask again (unless the game ended meanwhile). */
  #rewatch() {
    const watching = this.#state.watching;
    if (watching === null || watching.isOver) {
      return;
    }
    this.#connection.request("watch.start", { gameId: watching.gameId }).then((reply) => {
      if (reply.ok && reply.value.t === "watch.state") {
        watching.apply(reply.value.d);
      }
    });
  }

  /**
   * A session for our seat, whose acks are checked and kept.
   * @param {string} gameId
   * @param {string} seat
   */
  #playerSession(gameId, seat) {
    return new RemoteMatchSession({
      gameId,
      seat,
      request: (type, data) => this.#connection.request(type, data),
      newCommandId: this.#newCommandId,
      onAck: (ack) => this.#keepAck(gameId, ack),
      signMove: (move) => this.#sessionKeys?.sign(move) ?? Promise.resolve(null),
    });
  }

  /**
   * v2: a session key for this game, authorised by the account through the wallet (Keychain asks the player once).
   * @param {string} gameId
   */
  async #authorizeSession(gameId) {
    if (this.#authorizing.has(gameId) || this.#sessionKeys?.has(gameId) === true) {
      return;
    }
    if (this.#sessionKeys === null || this.#wallet === null || this.#account === null) {
      this.#set({ error: { code: "SESSION_UNAVAILABLE", message: "this game needs signed moves, and no wallet can authorise them here" } });
      return;
    }
    this.#authorizing.add(gameId);
    try {
      const { key, authorizationText } = await this.#sessionKeys.create(gameId);
      const signed = await this.#wallet.signMessage({ account: this.#account, message: authorizationText, keyRole: "Posting" });
      const reply = signed.ok ? await this.#connection.request("game.session", { gameId, key, authorization: signed.value }) : null;
      if (reply === null || !reply.ok || reply.value.t !== "game.session") {
        this.#sessionKeys.forget(gameId);
        const refused = reply === null ? "the wallet did not authorise it" : "the server refused it";
        this.#set({ error: { code: "SESSION_REFUSED", message: `this game's signing key is not authorised (${refused}): your moves cannot be sent` } });
      }
    } finally {
      this.#authorizing.delete(gameId);
    }
  }

  /**
   * @param {string} gameId
   * @param {Readonly<Record<string, unknown>>} ack
   */
  #keepAck(gameId, ack) {
    if (this.#receipts !== null && !this.#receipts.keep(gameId, ack, this.#ackKey)) {
      this.#set({ error: { code: "BAD_ACK", message: "the server's signed receipt for a move does not verify" } });
    }
  }

  /** @param {{ gameId: string, seat: string, opponent: { account: string | null }, protocol?: number }} found */
  #matched(found) {
    const session = this.#playerSession(found.gameId, found.seat);
    this.#set({ status: OnlineStatus.MATCHED, opponent: found.opponent.account, session, error: null });
    // Our entropy, drawn only now that the server is committed to its secret.
    this.#sendEntropy(found.gameId);
    if (found.protocol >= 2) {
      this.#authorizeSession(found.gameId);
    }
  }

  /**
   * A game view from the server: create the session if needed (resume), then update it.
   * @param {any} view
   */
  #adopt(view) {
    let session = this.#state.session;
    if (session === null || session.gameId !== view.gameId) {
      session = this.#playerSession(view.gameId, view.seat);
    }
    session.apply(view);
    this.#lastView = view;
    if (view.protocol >= 2 && (view.status === "CREATED" || view.status === "ACTIVE")) {
      // A reloaded page lost its key: authorise a new one for the game in progress.
      this.#authorizeSession(view.gameId);
    }
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
