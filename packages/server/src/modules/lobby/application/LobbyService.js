/**
 * LobbyService: who is online, and challenges between them
 * (docs/tcg/17-lobby-e-sfide.md).
 *
 * - Online means connected to the game server's WebSocket right now (the
 *   hub): a signed-in player with the game open. Each one is listed with
 *   what they are doing: ready, searching a queue, or in a game. The list
 *   is built at most once every couple of seconds and shared by everyone
 *   asking.
 * - A challenge proposes a casual or ranked game to an online player, with
 *   the challenger's deck validated and frozen when it is sent (like a queue
 *   ticket). The challenged player accepts with a deck of their own, or
 *   declines; either side hears of it. Unanswered, it lapses after a minute.
 * - Accepting creates the game at once through matchmaking (startDirect),
 *   which takes both players out of any queue; every other challenge of
 *   either player is then called off. Ranked challenges need both players
 *   eligible, and count like queue games: past the daily limit for the same
 *   pair a game is recorded but not rated (T24). When the season charges an
 *   entry fee, both need the entries, checked when the challenge is sent and
 *   accepted, and taken when the game is created (docs/tcg/22).
 * - Challenges live in memory, like the games they lead to (one process,
 *   docs/tcg/06): a player who disconnects takes theirs with them, and a
 *   maintenance calls them all off.
 * - Spam: one challenge out per player at a time (a new one replaces it),
 *   a few waiting per player, and after a refusal the same challenger waits
 *   before asking the same player again.
 */
import { AppError } from "../../../kernel/AppError.js";
import { uuidV4 } from "../../../kernel/random.js";

export const ChallengeMode = Object.freeze({ CASUAL: "casual", RANKED: "ranked" });
const MODES = Object.freeze(Object.values(ChallengeMode));
export const PlayerActivity = Object.freeze({ IDLE: "idle", SEARCHING: "searching", PLAYING: "playing" });
/** Why a challenge closed, as both players are told (challenge.closed). */
export const ChallengeEnd = Object.freeze({
  ACCEPTED: "accepted",
  DECLINED: "declined",
  CANCELLED: "cancelled",
  EXPIRED: "expired",
  /** A player left (disconnected). */
  OFFLINE: "offline",
  /** A player got into a game (this challenge or another accepted, the queue). */
  BUSY: "busy",
  MAINTENANCE: "maintenance",
});
const ACTIVITY_ORDER = Object.freeze({ [PlayerActivity.IDLE]: 0, [PlayerActivity.SEARCHING]: 1, [PlayerActivity.PLAYING]: 2 });

export const DEFAULT_LOBBY_POLICY = Object.freeze({
  /** How long a challenge waits for an answer. */
  challengeTtlMs: 60 * 1000,
  /** Challenges waiting for one player at most. */
  maxIncoming: 5,
  /** After a refusal, how long before the same challenger may ask the same player again. */
  declineCooldownMs: 30 * 1000,
  /** How long a built list of players is reused. */
  listCacheMs: 2000,
  /** Players listed at most. */
  maxPlayers: 200,
});

/**
 * @typedef {Readonly<{ userId: string, account: string }>} Party
 * @typedef {Readonly<{ cardId: string, count: number }>} DeckEntry
 * @typedef {Readonly<{ id: string, from: Party, to: Party, mode: string, deckId: string, deck: readonly DeckEntry[], createdAt: number, expiresAt: number }>} Challenge
 * @typedef {Readonly<{ id: string, from: string, to: string, mode: string, expiresAt: number, expiresInMs: number }>} ChallengeView what players see of a challenge
 * @typedef {Readonly<{ userId: string, account: string, status: string }>} OnlinePlayer
 */

export class LobbyService {
  #hub;
  #accountsOf;
  #findUser;
  #matchmaking;
  #decks;
  #games;
  #ranking;
  #entries;
  #clock;
  #random;
  #logger;
  #gate;
  #policy;
  /** @type {Map<string, Challenge>} */
  #challenges = new Map();
  /** Users whose game is being created right now. @type {Set<string>} */
  #starting = new Set();
  /** "challenger>challenged" → until when the challenger may not ask again. @type {Map<string, number>} */
  #cooldowns = new Map();
  /** @type {Readonly<{ at: number, players: readonly OnlinePlayer[] }> | null} */
  #list = null;

  /**
   * @param {{
   *   hub: { connectedUsers: () => string[], isConnected: (userId: string) => boolean, send: (userId: string, type: string, data: unknown) => void },
   *   accountsOf: (userIds: readonly string[]) => Promise<Map<string, string>>,
   *   findUser: (account: string) => Promise<{ id: string, account: string, status: string } | null>,
   *   matchmaking: import("../../matchmaking/index.js").MatchmakingService,
   *   decks: import("../../decks/index.js").DeckService,
   *   games: { activeGameOf: (userId: string) => Promise<string | null>, playingUsers: () => Set<string> },
   *   ranking: { assertEligible: (userId: string) => Promise<void> },
   *   entries?: { assertCanEnter: (userId: string, mode: string) => Promise<void> },
   *   clock: import("../../../kernel/time.js").Clock,
   *   random: import("../../../kernel/random.js").SecureRandom,
   *   logger: import("../../../kernel/logger.js").Logger,
   *   gate?: { assertOpen: (what: string) => void },
   *   policy?: Partial<typeof DEFAULT_LOBBY_POLICY>,
   * }} deps `entries`: what paid modes cost (by default every mode is free); `gate`: closed during an announced maintenance (no new games)
   */
  constructor({ hub, accountsOf, findUser, matchmaking, decks, games, ranking, entries = { assertCanEnter: async () => undefined }, clock, random, logger, gate = { assertOpen: () => undefined }, policy = {} }) {
    this.#hub = hub;
    this.#accountsOf = accountsOf;
    this.#findUser = findUser;
    this.#matchmaking = matchmaking;
    this.#decks = decks;
    this.#games = games;
    this.#ranking = ranking;
    this.#entries = entries;
    this.#clock = clock;
    this.#random = random;
    this.#logger = logger;
    this.#gate = gate;
    this.#policy = Object.freeze({ ...DEFAULT_LOBBY_POLICY, ...policy });
  }

  /**
   * What a player sees in the lobby: everyone else online, and their own challenges.
   * @param {string} userId
   */
  async view(userId) {
    this.expireDue();
    const players = (await this.#players()).filter((player) => player.userId !== userId).map(({ account, status }) => Object.freeze({ account, status }));
    return Object.freeze({ players: Object.freeze(players), challenges: this.challengesOf(userId) });
  }

  /**
   * A player's open challenges: the ones they received, and the one they sent.
   * @param {string} userId
   */
  challengesOf(userId) {
    const now = this.#clock.now();
    const open = [...this.#challenges.values()];
    const outgoing = open.find((challenge) => challenge.from.userId === userId);
    return Object.freeze({
      incoming: Object.freeze(open.filter((challenge) => challenge.to.userId === userId).map((challenge) => viewOf(challenge, now))),
      outgoing: outgoing === undefined ? null : viewOf(outgoing, now),
    });
  }

  /**
   * Challenges an online player. A challenge the user had out is replaced.
   * @param {{ user: Party, to: unknown, mode: unknown, deckId: unknown }} request
   * @returns {Promise<ChallengeView>}
   */
  async challenge({ user, to, mode: requested, deckId }) {
    this.expireDue();
    const mode = MODES.find((known) => known === requested);
    if (mode === undefined) {
      throw new AppError("VALIDATION", `mode must be one of ${MODES.join(", ")}`);
    }
    this.#gate.assertOpen("Challenges");
    const target = typeof to === "string" ? await this.#findUser(to) : null;
    if (target === null || target.status !== "active" || !this.#hub.isConnected(target.id)) {
      throw new AppError("NOT_FOUND", `@${String(to)} is not online`);
    }
    if (target.id === user.userId) {
      throw new AppError("VALIDATION", "you cannot challenge yourself");
    }
    this.#assertNotCoolingDown(user, target);
    if ([...this.#challenges.values()].filter((challenge) => challenge.to.userId === target.id && challenge.from.userId !== user.userId).length >= this.#policy.maxIncoming) {
      throw new AppError("LIMIT_REACHED", `@${target.account} has too many challenges waiting: try again in a minute`);
    }
    await this.#assertFree(user.userId, "you are already in a game");
    await this.#assertFree(target.id, `@${target.account} is in a game`);
    if (mode === ChallengeMode.RANKED) {
      await this.#ranking.assertEligible(user.userId);
      await this.#ranking.assertEligible(target.id).catch(() => {
        throw new AppError("CONFLICT", `@${target.account} cannot play ranked yet`);
      });
    }
    await this.#assertEntries(mode, user.userId, { userId: target.id, account: target.account });
    const deck = await this.#decks.playableDeckList(user.userId, deckId);
    const previous = [...this.#challenges.values()].find((challenge) => challenge.from.userId === user.userId);
    if (previous !== undefined) {
      this.#close(previous, ChallengeEnd.CANCELLED);
    }
    const now = this.#clock.now();
    /** @type {Challenge} */
    const challenge = Object.freeze({
      id: uuidV4(this.#random),
      from: Object.freeze({ userId: user.userId, account: user.account }),
      to: Object.freeze({ userId: target.id, account: target.account }),
      mode,
      deckId: /** @type {string} */ (deckId),
      deck: Object.freeze(deck.entries.map((entry) => Object.freeze({ cardId: entry.cardId, count: entry.count }))),
      createdAt: now,
      expiresAt: now + this.#policy.challengeTtlMs,
    });
    this.#challenges.set(challenge.id, challenge);
    const view = viewOf(challenge, now);
    this.#hub.send(target.id, "challenge.received", view);
    this.#logger.info("challenge sent", { challenge: challenge.id, mode });
    return view;
  }

  /**
   * Accepts a challenge with one of the user's decks: the game starts at once.
   * @param {{ user: Party, challengeId: unknown, deckId: unknown }} request
   * @returns {Promise<Readonly<{ challengeId: string, gameId: string }>>}
   */
  async accept({ user, challengeId, deckId }) {
    this.expireDue();
    const challenge = this.#openFor(challengeId, (open) => open.to.userId === user.userId);
    this.#gate.assertOpen("Challenges");
    if (!this.#hub.isConnected(challenge.from.userId)) {
      this.#close(challenge, ChallengeEnd.OFFLINE);
      throw new AppError("CONFLICT", `@${challenge.from.account} is no longer online`);
    }
    // A deck that cannot be played, or entries missing, leave the challenge open: the player may pick another deck, or buy entries.
    const deck = await this.#decks.playableDeckList(user.userId, deckId);
    await this.#assertEntries(challenge.mode, user.userId, challenge.from);
    if (this.#challenges.get(challenge.id) !== challenge) {
      throw new AppError("NOT_FOUND", "this challenge is no longer open");
    }
    if (this.#starting.has(challenge.from.userId) || this.#starting.has(challenge.to.userId)) {
      throw new AppError("CONFLICT", "a game is already starting for one of you");
    }
    this.#challenges.delete(challenge.id);
    const parties = [challenge.from.userId, challenge.to.userId];
    parties.forEach((userId) => this.#starting.add(userId));
    let gameId;
    try {
      gameId = await this.#matchmaking.startDirect({
        mode: challenge.mode,
        entrants: [
          { userId: challenge.from.userId, account: challenge.from.account, deckId: challenge.deckId, deck: challenge.deck },
          { userId: user.userId, account: user.account, deckId: /** @type {string} */ (deckId), deck: deck.entries.map((entry) => ({ cardId: entry.cardId, count: entry.count })) },
        ],
      });
    } catch (error) {
      this.#hub.send(challenge.from.userId, "challenge.closed", { challengeId: challenge.id, reason: ChallengeEnd.BUSY });
      throw error;
    } finally {
      parties.forEach((userId) => this.#starting.delete(userId));
    }
    this.#hub.send(challenge.from.userId, "challenge.closed", { challengeId: challenge.id, reason: ChallengeEnd.ACCEPTED, gameId });
    // Both are playing now: whatever else they had open is moot.
    for (const other of [...this.#challenges.values()]) {
      if (parties.includes(other.from.userId) || parties.includes(other.to.userId)) {
        this.#close(other, ChallengeEnd.BUSY);
      }
    }
    this.#logger.info("challenge accepted", { challenge: challenge.id, game: gameId, mode: challenge.mode });
    return Object.freeze({ challengeId: challenge.id, gameId });
  }

  /**
   * The challenged player says no; the challenger waits a little before asking them again.
   * @param {{ user: Party, challengeId: unknown }} request
   */
  decline({ user, challengeId }) {
    const challenge = this.#openFor(challengeId, (open) => open.to.userId === user.userId);
    this.#cooldowns.set(cooldownKey(challenge.from.userId, challenge.to.userId), this.#clock.now() + this.#policy.declineCooldownMs);
    this.#close(challenge, ChallengeEnd.DECLINED, [challenge.from.userId]);
    return Object.freeze({ challengeId: challenge.id });
  }

  /**
   * The challenger takes it back.
   * @param {{ user: Party, challengeId: unknown }} request
   */
  cancel({ user, challengeId }) {
    const challenge = this.#openFor(challengeId, (open) => open.from.userId === user.userId);
    this.#close(challenge, ChallengeEnd.CANCELLED, [challenge.to.userId]);
    return Object.freeze({ challengeId: challenge.id });
  }

  /**
   * A user's connection went: their challenges, sent or received, go too.
   * @param {string} userId
   */
  disconnected(userId) {
    for (const challenge of [...this.#challenges.values()]) {
      if (challenge.from.userId === userId || challenge.to.userId === userId) {
        this.#close(challenge, ChallengeEnd.OFFLINE, [challenge.from.userId === userId ? challenge.to.userId : challenge.from.userId]);
      }
    }
  }

  /**
   * A maintenance was announced: every challenge is called off, and both sides are told.
   * @returns {number} challenges closed
   */
  closeAll() {
    const open = [...this.#challenges.values()];
    open.forEach((challenge) => this.#close(challenge, ChallengeEnd.MAINTENANCE));
    return open.length;
  }

  /**
   * Closes the challenges whose time ran out (both sides are told), and forgets old refusals.
   * @returns {number} challenges expired
   */
  expireDue() {
    const now = this.#clock.now();
    const due = [...this.#challenges.values()].filter((challenge) => challenge.expiresAt <= now);
    due.forEach((challenge) => this.#close(challenge, ChallengeEnd.EXPIRED));
    for (const [key, until] of this.#cooldowns) {
      if (until <= now) {
        this.#cooldowns.delete(key);
      }
    }
    return due.length;
  }

  /**
   * Everyone online with what they are doing, ready players first; rebuilt at most every `listCacheMs`.
   * @returns {Promise<readonly OnlinePlayer[]>}
   */
  async #players() {
    const now = this.#clock.now();
    if (this.#list !== null && now - this.#list.at < this.#policy.listCacheMs) {
      return this.#list.players;
    }
    const ids = this.#hub.connectedUsers();
    const [accounts, waiting] = await Promise.all([this.#accountsOf(ids), this.#matchmaking.waitingUsers()]);
    const playing = this.#games.playingUsers();
    const activityOf = (/** @type {string} */ userId) => {
      if (playing.has(userId) || this.#starting.has(userId)) {
        return PlayerActivity.PLAYING;
      }
      return waiting.has(userId) ? PlayerActivity.SEARCHING : PlayerActivity.IDLE;
    };
    const players = ids
      .flatMap((userId) => {
        const account = accounts.get(userId);
        return account === undefined ? [] : [Object.freeze({ userId, account, status: activityOf(userId) })];
      })
      .sort((left, right) => ACTIVITY_ORDER[left.status] - ACTIVITY_ORDER[right.status] || (left.account < right.account ? -1 : 1))
      .slice(0, this.#policy.maxPlayers);
    this.#list = Object.freeze({ at: now, players: Object.freeze(players) });
    return this.#list.players;
  }

  /**
   * The open challenge with that id, if the predicate says the user may act on it.
   * @param {unknown} challengeId
   * @param {(challenge: Challenge) => boolean} mayAct
   */
  #openFor(challengeId, mayAct) {
    const challenge = typeof challengeId === "string" ? this.#challenges.get(challengeId) : undefined;
    if (challenge === undefined || !mayAct(challenge)) {
      throw new AppError("NOT_FOUND", "this challenge is no longer open");
    }
    return challenge;
  }

  /**
   * @param {Party} user
   * @param {{ id: string, account: string }} target
   */
  #assertNotCoolingDown(user, target) {
    const until = this.#cooldowns.get(cooldownKey(user.userId, target.id));
    if (until !== undefined && until > this.#clock.now()) {
      throw new AppError("RATE_LIMITED", `@${target.account} just declined: wait a moment before asking again`);
    }
  }

  /**
   * Both players hold the entries a game of `mode` costs (nothing to check when it is free).
   * @param {string} mode
   * @param {string} userId the player asking
   * @param {{ userId: string, account: string }} other
   */
  async #assertEntries(mode, userId, other) {
    await this.#entries.assertCanEnter(userId, mode);
    await this.#entries.assertCanEnter(other.userId, mode).catch((error) => {
      throw error instanceof AppError && error.code === "ENTRY_REQUIRED" ? new AppError("CONFLICT", `@${other.account} has no ${mode} entries left`) : error;
    });
  }

  /**
   * @param {string} userId
   * @param {string} message
   */
  async #assertFree(userId, message) {
    if (this.#starting.has(userId) || (await this.#games.activeGameOf(userId)) !== null) {
      throw new AppError("CONFLICT", message);
    }
  }

  /**
   * Forgets a challenge and tells the players concerned why.
   * @param {Challenge} challenge
   * @param {string} reason
   * @param {readonly string[]} [tell] who to tell (default: both)
   */
  #close(challenge, reason, tell = [challenge.from.userId, challenge.to.userId]) {
    if (!this.#challenges.delete(challenge.id)) {
      return;
    }
    for (const userId of tell) {
      this.#hub.send(userId, "challenge.closed", { challengeId: challenge.id, reason });
    }
  }
}

/**
 * @param {Challenge} challenge
 * @param {number} now
 * @returns {ChallengeView}
 */
function viewOf(challenge, now) {
  return Object.freeze({ id: challenge.id, from: challenge.from.account, to: challenge.to.account, mode: challenge.mode, expiresAt: challenge.expiresAt, expiresInMs: Math.max(0, challenge.expiresAt - now) });
}

/**
 * @param {string} challengerId
 * @param {string} challengedId
 */
function cooldownKey(challengerId, challengedId) {
  return `${challengerId}>${challengedId}`;
}
