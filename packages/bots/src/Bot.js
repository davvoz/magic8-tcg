/**
 * One house player: a STEEM account that is online like a person with the
 * game open. It signs in with its posting key, opens the site's WebSocket
 * with the browser's own client stack (OnlineService, LobbyService, WebCrypto
 * session keys), sits in the lobby, accepts every challenge it can play —
 * with one of its decks, after a moment, as a person would — signs the game
 * the way Keychain would, plays it with the engine's AI (BotPlayer), and
 * goes back to the lobby when it ends.
 *
 * A ranked challenge it cannot play (no ranked entries, not eligible yet, the
 * pair's games of the day played) is declined at once, so the challenger is
 * not left waiting; the log says why.
 *
 * It stays online: a dropped connection reconnects (WebSocketConnection), a
 * session that ended signs in again, a failure retries with growing pauses.
 * Someone opening the account in a browser replaces its connection: the bot
 * steps aside for a while (`replacedPauseMs`), then comes back.
 *
 * The fleet (BotFleet) may also send it into the queue for a player waiting
 * there alone (`search`).
 */
import { ok } from "@magic8/engine/shared/Result.js";
import { signMessage } from "@magic8/steem";
import { LobbyService } from "@magic8/client/src/application/lobby/LobbyService.js";
import { OnlineService, OnlineStatus } from "@magic8/client/src/application/online/OnlineService.js";
import { WebCryptoSessionKeys } from "@magic8/client/src/infrastructure/crypto/webSessionKeys.js";
import { WebSocketConnection } from "@magic8/client/src/infrastructure/realtime/WebSocketConnection.js";
import { BotPlayer } from "./BotPlayer.js";

/** WebSocket close codes after which the connection does not come back by itself. */
const REPLACED = 4000;
const SESSION_ENDED = 4001;
const SIGN_IN_AGAIN_MS = 1000;

export const DEFAULT_BOT_POLICY = Object.freeze({
  /** How long before answering a challenge. */
  answerMs: Object.freeze({ min: 2000, max: 5000 }),
  /** How long "Keychain" takes to sign the game. */
  signMs: Object.freeze({ min: 1000, max: 2500 }),
  /** Extra thought before our first move: the opponent's table shows the coin toss first. */
  openingMs: 3000,
  /** How long the finished game stays on screen before going back to the lobby. */
  leaveMs: Object.freeze({ min: 4000, max: 8000 }),
  /** Someone opened the account elsewhere: how long to leave them the account. */
  replacedPauseMs: 30 * 60 * 1000,
  /** Pauses after consecutive failures to come online. */
  retryMs: Object.freeze([5000, 30_000, 120_000, 600_000]),
});

/**
 * @typedef {import("./BotHttp.js").BotDeck} BotDeck
 * @typedef {Readonly<{ min: number, max: number }>} Range
 * @typedef {{ send: (data: string) => void, close: () => void, readyState: number, onopen: any, onclose: any, onmessage: any, onerror: any }} SocketLike
 */

export class Bot {
  #account;
  #postingKey;
  #style;
  #starterIndex;
  #http;
  #openSocket;
  #timers;
  #delay;
  #random;
  #now;
  #crypto;
  #thinkMs;
  #logger;
  #policy;
  #running = false;
  /** @type {Promise<void> | null} */
  #loop = null;
  /** Ends the pause or the session in progress when the bot is stopped. @type {(() => void) | null} */
  #interrupt = null;
  /** @type {readonly BotDeck[]} */
  #decks = [];
  /** @type {{ connection: WebSocketConnection, online: OnlineService, lobby: LobbyService, player: BotPlayer } | null} */
  #live = null;
  /** Challenges are answered one at a time. */
  #answering = Promise.resolve();
  #busyAnswering = 0;
  /** What the online state was, to notice what changed. */
  /** @type {string} */
  #lastStatus = OnlineStatus.OFFLINE;

  /**
   * @param {{
   *   account: string, postingKey: Uint8Array, style: string, starterIndex: number,
   *   http: import("./BotHttp.js").BotHttp,
   *   openSocket: (request: { cookie: string, origin: string }) => SocketLike,
   *   timers: { setTimeout: (fn: () => void, ms: number) => any, clearTimeout: (handle: any) => void },
   *   delay: (ms: number) => Promise<void>,
   *   random: () => number,
   *   now: () => number,
   *   crypto: Pick<Crypto, "subtle" | "getRandomValues" | "randomUUID">,
   *   thinkMs: Range,
   *   logger: import("@magic8/client/src/application/ports/Logger.contract.js").Logger,
   *   policy?: Partial<typeof DEFAULT_BOT_POLICY>,
   * }} deps `starterIndex`: which free starter deck to claim when the account has no deck; `random`: in [0, 1)
   */
  constructor({ account, postingKey, style, starterIndex, http, openSocket, timers, delay, random, now, crypto, thinkMs, logger, policy = {} }) {
    this.#account = account;
    this.#postingKey = postingKey;
    this.#style = style;
    this.#starterIndex = starterIndex;
    this.#http = http;
    this.#openSocket = openSocket;
    this.#timers = timers;
    this.#delay = delay;
    this.#random = random;
    this.#now = now;
    this.#crypto = crypto;
    this.#thinkMs = thinkMs;
    this.#logger = logger;
    this.#policy = Object.freeze({ ...DEFAULT_BOT_POLICY, ...policy });
  }

  get account() {
    return this.#account;
  }

  /** What the bot is doing, as its client sees it (OnlineStatus). */
  get status() {
    return this.#live?.online.state.status ?? OnlineStatus.OFFLINE;
  }

  /** Free for the fleet's errands: online, in the lobby, not answering a challenge. */
  get available() {
    return this.#live !== null && this.status === OnlineStatus.IDLE && this.#busyAnswering === 0 && this.#live.lobby.state.incoming.length === 0;
  }

  /** Comes online and stays there until stopped. */
  start() {
    if (this.#running) {
      return;
    }
    this.#running = true;
    this.#loop = this.#run();
  }

  async stop() {
    this.#running = false;
    this.#interrupt?.();
    await this.#loop;
  }

  /**
   * Who else is online now (the lobby's list), or null when the bot is not connected.
   * @returns {Promise<readonly { account: string, status: string }[] | null>}
   */
  async onlinePlayers() {
    const live = this.#live;
    if (live === null || live.connection.status !== "open") {
      return null;
    }
    await live.lobby.refresh();
    return live.lobby.state.loaded ? live.lobby.state.players : null;
  }

  /**
   * Queues for a game and waits up to `ms` to be paired; leaves the queue if nobody came.
   * @param {"casual" | "ranked"} mode
   * @param {number} ms
   * @returns {Promise<{ matched: boolean, code: string | null }>} `code`: why the queue refused us
   */
  async search(mode, ms) {
    const live = this.#live;
    const deck = this.#pickDeck();
    if (live === null || deck === null || !this.available) {
      return { matched: false, code: "BUSY" };
    }
    const queued = await live.online.queue(deck.id, mode);
    if (!queued.ok) {
      return { matched: false, code: queued.error.code };
    }
    const matched = await this.#paired(live.online, ms);
    if (!matched && live.online.state.status === OnlineStatus.SEARCHING) {
      await live.online.leaveQueue();
    }
    return { matched, code: null };
  }

  /**
   * Waits until the queue gives us a game (true), takes us out, or `ms` passes (false).
   * @param {OnlineService} online
   * @param {number} ms
   */
  #paired(online, ms) {
    return new Promise((resolve) => {
      let settled = false;
      const settle = (/** @type {boolean} */ matched) => {
        if (!settled) {
          settled = true;
          unsubscribe();
          this.#timers.clearTimeout(timer);
          resolve(matched);
        }
      };
      const check = (/** @type {import("@magic8/client/src/application/online/OnlineService.js").OnlineState} */ state) => {
        if (state.session !== null) {
          settle(true);
        } else if (state.status !== OnlineStatus.SEARCHING) {
          settle(false);
        }
      };
      const unsubscribe = online.subscribe(check);
      const timer = this.#timers.setTimeout(() => settle(false), ms);
      check(online.state);
    });
  }

  async #run() {
    let failures = 0;
    while (this.#running) {
      const outcome = await this.#session();
      failures = outcome === "failed" ? failures + 1 : 0;
      if (!this.#running) {
        break;
      }
      if (outcome === "replaced") {
        this.#logger.warn(`@${this.#account}: the account was opened somewhere else; back in ${Math.round(this.#policy.replacedPauseMs / 60_000)} min`);
      }
      await this.#pause(this.#pauseAfter(outcome, failures));
    }
  }

  /**
   * How long to wait before coming online again.
   * @param {string} outcome how the last stay online ended
   * @param {number} failures consecutive failures so far
   */
  #pauseAfter(outcome, failures) {
    if (outcome === "replaced") {
      return this.#policy.replacedPauseMs;
    }
    if (outcome === "failed") {
      return this.#policy.retryMs[Math.min(failures, this.#policy.retryMs.length) - 1];
    }
    // The session ended (expired, signed out): sign in again, without hammering a server that keeps ending it.
    return SIGN_IN_AGAIN_MS;
  }

  /**
   * One stay online: sign in, have a deck, connect, and play until the connection is gone for good.
   * @returns {Promise<"replaced" | "ended" | "failed" | "stopped">}
   */
  async #session() {
    const signedIn = await this.#http.signIn(this.#account, this.#postingKey);
    if (!signedIn.ok) {
      this.#logger.warn(`@${this.#account}: could not sign in`, signedIn.error);
      return "failed";
    }
    const decks = await this.#loadDecks();
    if (decks.length === 0) {
      this.#logger.error(`@${this.#account}: no playable deck; staying offline`);
      return "failed";
    }
    this.#decks = decks;
    if (!this.#running) {
      return "stopped";
    }
    const outcome = await this.#online(/** @type {string} */ (this.#http.cookie));
    this.#logger.info(`@${this.#account}: offline (${outcome})`);
    return outcome;
  }

  /** The account's playable decks; a new account first claims its free starter deck. */
  async #loadDecks() {
    const listed = await this.#http.decks();
    const playable = listed.ok ? listed.value.filter((deck) => deck.playable) : [];
    if (!listed.ok || playable.length > 0) {
      return playable;
    }
    const starter = await this.#http.starter();
    if (!starter.ok || starter.value.claimed || starter.value.choices.length === 0) {
      return playable;
    }
    const choice = starter.value.choices[this.#starterIndex % starter.value.choices.length];
    const claimed = await this.#http.claimStarter(choice);
    if (!claimed.ok) {
      this.#logger.warn(`@${this.#account}: could not claim the starter deck "${choice}"`, claimed.error);
      return playable;
    }
    this.#logger.info(`@${this.#account}: claimed the starter deck "${choice}"`);
    const again = await this.#http.decks();
    return again.ok ? again.value.filter((deck) => deck.playable) : [];
  }

  /**
   * Connected, in the lobby, playing what comes, until the server ends the session or replaces it.
   * @param {string} cookie
   * @returns {Promise<"replaced" | "ended" | "stopped">}
   */
  #online(cookie) {
    const origin = this.#http.origin;
    const connection = new WebSocketConnection({ url: "", createSocket: () => this.#openSocket({ cookie, origin }), timers: this.#timers, logger: this.#logger });
    const online = new OnlineService({
      connection,
      randomHex: (bytes) => Array.from(this.#crypto.getRandomValues(new Uint8Array(bytes)), (byte) => byte.toString(16).padStart(2, "0")).join(""),
      newCommandId: () => this.#crypto.randomUUID(),
      accountDecks: () => this.#decks.map((deck) => Object.freeze({ id: deck.id, name: deck.name, mix: [], totalCards: 0, playable: true, problem: null })),
      sessionKeys: new WebCryptoSessionKeys({ subtle: this.#crypto.subtle }),
      wallet: { signMessage: async ({ message }) => this.#sign(message) },
      logger: this.#logger,
    });
    const lobby = new LobbyService({ connection, scheduler: { delay: this.#delay }, now: this.#now, logger: this.#logger });
    const think = (/** @type {boolean} */ opening) => this.#between(this.#thinkMs) + (opening ? this.#policy.openingMs : 0);
    const player = new BotPlayer({ style: this.#style, think, delay: this.#delay, logger: this.#logger });
    this.#live = { connection, online, lobby, player };
    this.#lastStatus = OnlineStatus.OFFLINE;
    return new Promise((resolve) => {
      const end = (/** @type {"replaced" | "ended" | "stopped"} */ outcome) => {
        this.#interrupt = null;
        player.stop();
        lobby.stop();
        online.stop();
        this.#live = null;
        resolve(outcome);
      };
      this.#interrupt = () => end("stopped");
      connection.onStatus((status, { code }) => {
        if (status === "open") {
          this.#logger.info(`@${this.#account}: online (${this.#style})`);
        } else if (status === "closed" && (code === REPLACED || code === SESSION_ENDED)) {
          end(code === REPLACED ? "replaced" : "ended");
        }
      });
      online.subscribe((state) => this.#onState(state));
      lobby.onEvent((event) => {
        if (event.kind === "received") {
          this.#answer(event.challenge);
        }
      });
      online.start();
      lobby.start();
    });
  }

  /**
   * "Keychain" signing for this account: the game's session key, after a moment.
   * @param {string} message
   */
  async #sign(message) {
    await this.#delay(this.#between(this.#policy.signMs));
    return ok(signMessage(message, this.#postingKey));
  }

  /** @param {import("@magic8/client/src/application/online/OnlineService.js").OnlineState} state */
  #onState(state) {
    const live = this.#live;
    if (live === null) {
      return;
    }
    const previous = this.#lastStatus;
    this.#lastStatus = state.status;
    live.player.follow(state.status === OnlineStatus.PLAYING || state.status === OnlineStatus.MATCHED ? state.session : null);
    if (state.status !== previous) {
      this.#changed(live.online, state, previous);
    }
  }

  /**
   * What a new online status means: a game started, ended, or was called off.
   * @param {OnlineService} online
   * @param {import("@magic8/client/src/application/online/OnlineService.js").OnlineState} state
   * @param {string} previous
   */
  #changed(online, state, previous) {
    const opponent = `@${state.opponent ?? "?"}`;
    const gameId = state.session?.gameId ?? null;
    if (state.status === OnlineStatus.PLAYING && previous !== OnlineStatus.OVER) {
      this.#logger.info(`@${this.#account}: playing ${opponent}`, { gameId });
    } else if (state.status === OnlineStatus.OVER) {
      const result = state.session?.result;
      this.#logger.info(`@${this.#account}: ${outcomeOf(result)} against ${opponent}`, { gameId, reason: result?.reason });
      void this.#leave(online, gameId);
    } else if (state.status === OnlineStatus.CANCELLED) {
      this.#logger.info(`@${this.#account}: the game with ${opponent} was called off`, { reason: state.error?.message });
      void this.#leave(online, null);
    }
  }

  /**
   * Back to the lobby after looking at the end of the game (unless another game started meanwhile).
   * @param {OnlineService} online
   * @param {string | null} gameId the finished game; null: the game was called off before it started
   */
  async #leave(online, gameId) {
    await this.#delay(this.#between(this.#policy.leaveMs));
    const { status, session } = online.state;
    const stillThere = gameId === null ? status === OnlineStatus.CANCELLED : status === OnlineStatus.OVER && session?.gameId === gameId;
    if (stillThere && this.#live?.online === online) {
      online.dismissGame();
    }
  }

  /**
   * Accepts a challenge after a moment (one at a time); declines what cannot be played.
   * @param {import("@magic8/client/src/application/lobby/LobbyService.js").Challenge} challenge
   */
  #answer(challenge) {
    this.#busyAnswering += 1;
    this.#answering = this.#answering
      .then(() => this.#answerOne(challenge))
      .catch((error) => this.#logger.error(`@${this.#account}: answering a challenge failed`, { error: error instanceof Error ? error.message : String(error) }))
      .finally(() => {
        this.#busyAnswering -= 1;
      });
  }

  /** @param {import("@magic8/client/src/application/lobby/LobbyService.js").Challenge} challenge */
  async #answerOne(challenge) {
    await this.#delay(this.#between(this.#policy.answerMs));
    const live = this.#live;
    if (live === null || !live.lobby.state.incoming.some((open) => open.id === challenge.id)) {
      return;
    }
    const deck = this.#pickDeck();
    const inGame = live.online.state.status === OnlineStatus.MATCHED || live.online.state.status === OnlineStatus.PLAYING;
    if (deck === null || inGame) {
      await live.lobby.decline(challenge.id);
      return;
    }
    const accepted = await live.lobby.accept(challenge.id, deck.id);
    if (accepted.ok) {
      this.#logger.info(`@${this.#account}: accepted a ${challenge.mode} challenge from @${challenge.from} with "${deck.name}"`);
      return;
    }
    if (accepted.error.code === "NOT_FOUND") {
      return;
    }
    this.#logger.warn(`@${this.#account}: cannot accept the ${challenge.mode} challenge from @${challenge.from}; declining`, accepted.error);
    await live.lobby.decline(challenge.id);
  }

  /** One of the account's playable decks, at random. */
  #pickDeck() {
    return this.#decks.length === 0 ? null : this.#decks[Math.floor(this.#random() * this.#decks.length)];
  }

  /** @param {Range} range */
  #between({ min, max }) {
    return Math.round(min + this.#random() * (max - min));
  }

  /**
   * Waits `ms`, or less if the bot is stopped meanwhile.
   * @param {number} ms
   */
  #pause(ms) {
    if (ms <= 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const timer = this.#timers.setTimeout(() => {
        this.#interrupt = null;
        resolve(undefined);
      }, ms);
      this.#interrupt = () => {
        this.#timers.clearTimeout(timer);
        this.#interrupt = null;
        resolve(undefined);
      };
    });
  }
}

/**
 * Our side of a finished game, from the server's game.over.
 * @param {{ winner?: string | null, you?: string } | null | undefined} result
 */
function outcomeOf(result) {
  if (result?.winner === null || result?.winner === undefined) {
    return "draw";
  }
  return result.winner === result.you ? "won" : "lost";
}
