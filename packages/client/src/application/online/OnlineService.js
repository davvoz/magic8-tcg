/**
 * Online play, as a use case the screens drive: connect, queue with an
 * account deck, get matched, contribute entropy, play, and resume after a
 * drop. The game itself runs on the server (RemoteMatchSession).
 *
 * Entropy: when a match is found the server has already committed to its
 * secret (seedCommit); only then does the client draw its 16 random bytes
 * and send them, so neither side can steer the seed (docs/tcg/03 §5).
 *
 * States: offline → connecting → idle ⇄ searching → matched → playing → over,
 * or matched → cancelled when the game is called off before it starts.
 *
 * In game protocol v2 (docs/tcg/12) the browser makes a session key for the
 * game as soon as it is matched (or after a reload, for a game in progress)
 * and asks the wallet to authorise it with the account's posting key; every
 * move is then signed with it. That signature is also how a player accepts
 * the game: the server starts it only once both have signed, and while it
 * waits the state says who has (`acceptance`). Saying no to the wallet
 * declines the game; the server then calls it off for both players and each
 * is told who did not accept (game.aborted). The wallet prompt itself, and
 * the rule that the player is asked at most once unprompted per game, live
 * in SessionAuthorizer.
 *
 * Side effects (entropy, wallet prompts) happen on events that mean
 * something new — a match found, a welcome after (re)connecting, a move the
 * player tries — never on the routine game views the server keeps sending.
 *
 * Every move the server accepts comes back with a signed ack; with a
 * `receipts` store they are checked and kept (docs/tcg/11-ack-firmati.md).
 *
 * Watching (docs/tcg/10-spettatori.md) runs beside those states: one game
 * at a time, shown through a seatless RemoteMatchSession, resumed after a
 * reconnection until it ends or the player stops watching.
 */
import { fail, ok } from "@magic8/engine/shared/Result.js";
import { cancellationNotice } from "./cancellation.js";
import { RemoteMatchSession } from "./RemoteMatchSession.js";
import { AuthorizationState, SessionAuthorizer } from "./SessionAuthorizer.js";

export const OnlineStatus = Object.freeze({
  OFFLINE: "offline",
  CONNECTING: "connecting",
  IDLE: "idle",
  SEARCHING: "searching",
  MATCHED: "matched",
  PLAYING: "playing",
  OVER: "over",
  /** The game was called off before it started: a player did not accept it (v2). */
  CANCELLED: "cancelled",
});

/**
 * @typedef {Readonly<{ id: string, name: string, mix: readonly import("@magic8/engine/domain/decks/factionMix.js").FactionShare[], totalCards: number, playable: boolean, problem: string | null }>} OnlineDeck id is the server's deck id
 * @typedef {Readonly<{ you: boolean, opponent: boolean }>} Acceptance v2, while the game waits for its players: who has accepted it with Keychain
 * @typedef {Readonly<{ status: string, error: Readonly<{ code: string, message: string }> | null, opponent: string | null, session: RemoteMatchSession | null, watching: RemoteMatchSession | null, acceptance: Acceptance | null }>} OnlineState
 */

const INITIAL = Object.freeze({ status: OnlineStatus.OFFLINE, error: null, opponent: null, session: null, watching: null, acceptance: null });

export class OnlineService {
  #connection;
  #randomHex;
  #newCommandId;
  #accountDecks;
  #liveGames;
  #receipts;
  #sessionKeys;
  #authorizer;
  #logger;
  /** The signed-in account, from the welcome. @type {string | null} */
  #account = null;
  /** @type {Set<string>} games this browser is done with (cancelled, dismissed): late news about them is ignored */
  #closedGames = new Set();
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
    this.#authorizer = new SessionAuthorizer({ sessionKeys: this.#sessionKeys, wallet: wallet ?? null, send: (type, data) => this.#connection.request(type, data) });
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
    // Already open (the notifications opened it at sign-in): say hello now.
    if (this.#connection.status === "open") {
      this.#onStatus("open", null);
    }
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
      this.#close(session.gameId);
    }
    this.#state.session?.stop();
    this.#set({ status: OnlineStatus.IDLE, session: null, opponent: null, acceptance: null });
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
    if (activeGame !== null && !this.#closedGames.has(activeGame.gameId)) {
      this.#adopt(activeGame);
      this.#resumed(activeGame);
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
    } else if (t === "game.aborted") {
      this.#cancelled(d);
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
      signMove: (move) => this.#signMove(gameId, move),
    });
  }

  /**
   * v2: signs a move with the game's key. Without one (the player refused
   * Keychain after a reload) the move they are trying to make is what asks
   * Keychain again — the player's own action, never a background retry.
   * @param {string} gameId
   * @param {import("../ports/SessionKeys.contract.js").MoveToSign} move
   */
  async #signMove(gameId, move) {
    const signature = (await this.#sessionKeys?.sign(move)) ?? null;
    if (signature !== null) {
      return signature;
    }
    const outcome = await this.#authorizer.retry(gameId, this.#account);
    this.#authorized(gameId, outcome);
    return outcome.state === AuthorizationState.AUTHORIZED ? ((await this.#sessionKeys?.sign(move)) ?? null) : null;
  }

  /**
   * v2: asks the wallet to authorise this game's key — once; SessionAuthorizer never asks twice unprompted.
   * @param {string} gameId
   */
  async #requestAuthorization(gameId) {
    this.#authorized(gameId, await this.#authorizer.ask(gameId, this.#account));
  }

  /**
   * What an authorisation attempt means for the game. Before the start, no
   * signature means the game is declined; during it, the player is told
   * their moves cannot be sent until they sign (their next move asks).
   * @param {string} gameId
   * @param {import("./SessionAuthorizer.js").Authorization} outcome
   */
  #authorized(gameId, outcome) {
    if (outcome.state === AuthorizationState.AUTHORIZED) {
      this.#accepted(gameId);
    } else if (outcome.state === AuthorizationState.REFUSED || outcome.state === AuthorizationState.UNAVAILABLE) {
      if (this.#waitingFor(gameId)) {
        void this.#decline(gameId);
      } else if (this.#state.session?.gameId === gameId) {
        this.#set({ error: { code: "SESSION_REFUSED", message: `Your moves in this game are not signed (${outcome.reason ?? "Keychain did not sign"}). Your next move will ask Keychain again.` } });
      }
    }
  }

  /**
   * Whether `gameId` is our game and it has not started yet.
   * @param {string} gameId
   */
  #waitingFor(gameId) {
    return this.#state.status === OnlineStatus.MATCHED && this.#state.session?.gameId === gameId;
  }

  /**
   * Our signature is in: the lobby shows we have accepted until the server says more.
   * @param {string} gameId
   */
  #accepted(gameId) {
    if (this.#state.error?.code === "SESSION_REFUSED" && this.#state.session?.gameId === gameId) {
      this.#set({ error: null });
    }
    const acceptance = this.#state.acceptance;
    if (this.#waitingFor(gameId) && acceptance !== null) {
      this.#set({ acceptance: Object.freeze({ ...acceptance, you: true }) });
    }
  }

  /**
   * v2: we will not sign this game. The server calls it off and tells both
   * players; the lobby says so at once, without waiting for that message.
   * @param {string} gameId
   */
  async #decline(gameId) {
    const seat = this.#state.session?.seat ?? "";
    this.#cancelled({ gameId, reason: "declined", seats: [seat], you: seat });
    const reply = await this.#connection.request("game.decline", { gameId });
    if (!reply.ok || reply.value.t !== "game.declined") {
      this.#logger.warn("the game could not be declined; the server calls it off when its time runs out", reply.ok ? reply.value.d : reply.error);
    }
  }

  /**
   * The server called our game off before it started (game.aborted): back to
   * the lobby, saying who did not accept it.
   * @param {{ gameId: string, reason: string, seats: readonly string[], you: string }} aborted
   */
  #cancelled(aborted) {
    const session = this.#state.session;
    if (session === null || session.gameId !== aborted.gameId) {
      return;
    }
    this.#close(aborted.gameId);
    session.stop();
    this.#lastView = null;
    this.#set({ status: OnlineStatus.CANCELLED, session: null, acceptance: null, error: cancellationNotice(aborted, this.#state.opponent) });
  }

  /**
   * This browser is done with the game: its key goes, an open wallet prompt for it will be ignored, late views of it too.
   * @param {string} gameId
   */
  #close(gameId) {
    this.#closedGames.add(gameId);
    this.#authorizer.close(gameId);
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
    const acceptance = (found.protocol ?? 1) >= 2 ? Object.freeze({ you: false, opponent: false }) : null;
    this.#set({ status: OnlineStatus.MATCHED, opponent: found.opponent.account, session, error: null, acceptance });
    // Our entropy, drawn only now that the server is committed to its secret.
    this.#sendEntropy(found.gameId);
    if ((found.protocol ?? 1) >= 2) {
      // Accepting the game: the one Keychain prompt the player gets without asking for it.
      void this.#requestAuthorization(found.gameId);
    }
  }

  /**
   * Back to a game after (re)connecting: what may not have reached the
   * server is sent again, and a page that lost its key (reloaded) asks
   * Keychain for a new one — once.
   * @param {any} view
   */
  #resumed(view) {
    if (view.status === "CREATED") {
      // The server ignores an entropy it already has.
      this.#sendEntropy(view.gameId);
    }
    if (view.protocol >= 2 && (view.status === "CREATED" || view.status === "ACTIVE") && this.#sessionKeys?.has(view.gameId) !== true) {
      void this.#requestAuthorization(view.gameId);
    }
  }

  /**
   * A game view from the server: create the session if needed, then update it. No side effects.
   * @param {any} view
   */
  #adopt(view) {
    if (this.#closedGames.has(view.gameId)) {
      return;
    }
    let session = this.#state.session;
    if (session === null || session.gameId !== view.gameId) {
      session = this.#playerSession(view.gameId, view.seat);
    }
    session.apply(view);
    this.#lastView = view;
    this.#set({ status: statusOfGame(view.status), session, opponent: view.opponent?.account ?? this.#state.opponent, acceptance: acceptanceIn(view) });
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
  if (gameStatus === "ABORTED") {
    return OnlineStatus.CANCELLED;
  }
  return gameStatus === "CREATED" ? OnlineStatus.MATCHED : OnlineStatus.OVER;
}

/**
 * v2: who has accepted the game, while it waits for its players; null otherwise.
 * @param {any} view the server's game view
 * @returns {Acceptance | null}
 */
function acceptanceIn(view) {
  const authorized = view.authorized;
  if (view.status !== "CREATED" || authorized === null || typeof authorized !== "object") {
    return null;
  }
  const opponentSeat = Object.keys(authorized).find((seat) => seat !== view.seat);
  return Object.freeze({ you: authorized[view.seat] === true, opponent: opponentSeat !== undefined && authorized[opponentSeat] === true });
}
