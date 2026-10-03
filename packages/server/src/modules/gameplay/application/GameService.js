/**
 * GameService: creates games, keeps one GameActor per live game, rebuilds
 * actors from the database (after a restart, or when an actor failed to
 * persist), and routes every player input to the right actor.
 *
 * A game is created with a fresh 32-byte secret (sealed at rest), the
 * players' frozen decks and their commitments (GAME_CREATED, docs/tcg/03 §5):
 * the server is bound to its randomness and to both decks before either
 * player contributes entropy, and the first player is decided by lot from
 * the resulting seed. In protocol v2 the game starts only once both
 * players have also authorised their session keys with Keychain; a player
 * who declines, or does not answer in time, calls the game off.
 *
 * Every accepted command gets an ack signed with the server's ack key, when
 * one is configured (docs/tcg/11-ack-firmati.md).
 *
 * Anyone signed in may watch one live game at a time (docs/tcg/10); the
 * watch ends when they stop, disconnect, or the game ends.
 */
import { createCoreCommandRegistry } from "@magic8/engine/domain/commands/registerCoreCommands.js";
import { GameMode, GameProtocol, GameRecorder, LATEST_GAME_PROTOCOL, ackMessage, bytesToHex, canonicalDeck, deckCommitment, hexToBytes, seedCommitment } from "@magic8/protocol";
import { assertImplements } from "../../../kernel/contracts.js";
import { ulid } from "../../../kernel/ulid.js";
import { DEFAULT_TIME_POLICY } from "../domain/TurnClock.js";
import { GameActor, GameError, GameStatus } from "./GameActor.js";
import { GAME_REPOSITORY_METHODS } from "./ports.js";

const SECRET_BYTES = 32;

/**
 * @typedef {Readonly<{ userId: string, account: string, deckId: string | null, deck: readonly { cardId: string, count: number }[] }>} Entrant
 */

export class GameService {
  #repository;
  #currentContent;
  #contentVersion;
  #effects;
  #secrets;
  #notifier;
  #clock;
  #random;
  #unitOfWork;
  #audit;
  #logger;
  #timePolicy;
  #network;
  #results;
  #ackSigner;
  #signatures;
  #gameProtocol;
  /** @type {((summary: import("./ports.js").FinishedGame) => Promise<void>)[]} */
  #finishedListeners = [];
  /** @type {((summary: import("./ports.js").AbortedGame) => Promise<void>)[]} */
  #abortedListeners = [];
  /** @type {Map<string, GameActor>} */
  #actors = new Map();
  /** @type {Map<string, string>} spectator user id → game id */
  #watching = new Map();
  /** @type {Map<string, Promise<GameActor | null>>} actors being rebuilt */
  #loading = new Map();

  /**
   * @param {{
   *   repository: import("./ports.js").GameRepository,
   *   currentContent: () => { hash: string, engineVersion: string, content: import("@magic8/engine/domain/content/GameContent.js").GameContent },
   *   contentVersion: (hash: string) => Promise<{ hash: string, engineVersion: string, content: import("@magic8/engine/domain/content/GameContent.js").GameContent } | null>,
   *   effects: import("@magic8/engine/domain/effects/EffectRegistry.js").EffectRegistry,
   *   secrets: import("../../../kernel/crypto/SecretBox.js").SecretBox,
   *   notifier: import("./ports.js").GameNotifier,
   *   clock: import("../../../kernel/time.js").Clock,
   *   random: import("../../../kernel/random.js").SecureRandom,
   *   unitOfWork: import("../../../kernel/unitOfWork.js").UnitOfWork,
   *   audit: import("../../../kernel/audit/AuditTrail.js").AuditTrail,
   *   logger: import("../../../kernel/logger.js").Logger,
   *   network: string,
   *   results?: import("./ports.js").ResultOutbox | null,
   *   timePolicy?: Partial<import("../domain/TurnClock.js").TimePolicy>,
   *   ackSigner?: import("./ports.js").AckSigner | null,
   *   signatures?: import("./ports.js").MoveSignatures | null,
   *   gameProtocol?: number,
   * }} deps `gameProtocol`: the version new games are created with (2: signed moves, which needs `signatures`)
   */
  constructor({ repository, currentContent, contentVersion, effects, secrets, notifier, clock, random, unitOfWork, audit, logger, network, results = null, timePolicy = {}, ackSigner = null, signatures = null, gameProtocol = LATEST_GAME_PROTOCOL }) {
    assertImplements(repository, GAME_REPOSITORY_METHODS, "GameRepository");
    this.#repository = repository;
    this.#currentContent = currentContent;
    this.#contentVersion = contentVersion;
    this.#effects = effects;
    this.#secrets = secrets;
    this.#notifier = notifier;
    this.#clock = clock;
    this.#random = random;
    this.#unitOfWork = unitOfWork;
    this.#audit = audit;
    this.#logger = logger;
    this.#network = network;
    this.#results = results;
    this.#ackSigner = ackSigner;
    this.#signatures = signatures;
    this.#gameProtocol = gameProtocol;
    this.#timePolicy = Object.freeze({ ...DEFAULT_TIME_POLICY, ...timePolicy });  }

  /**
   * Called after a game ends and is committed (ranking, statistics). A listener that fails is logged; the game is over anyway.
   * @param {(summary: import("./ports.js").FinishedGame) => Promise<void>} listener
   */
  onGameFinished(listener) {
    this.#finishedListeners.push(listener);
  }

  /**
   * Called while a game that never started is called off, inside that unit of work: what the listener writes
   * commits with the abort, and a listener that fails fails the abort like any failed write.
   * @param {(summary: import("./ports.js").AbortedGame) => Promise<void>} listener
   */
  onGameAborted(listener) {
    this.#abortedListeners.push(listener);
  }

  /**
   * Finished games of a mode since a time, oldest first (listeners catch up on games they missed).
   * @param {{ mode: string, since: number, limit?: number }} query
   */
  finishedGames({ mode, since, limit = 500 }) {
    return this.#repository.listFinished({ mode, since, limit });
  }

  /**
   * @param {string} userId
   * @param {string} mode
   */
  countFinished(userId, mode) {
    return this.#repository.countFinished(userId, mode);
  }

  /**
   * The finished games an account played, newest first, a page at a time: `next` continues the list, null at its end.
   * @param {{ account: string, before?: string | null, limit?: number }} query
   */
  async history({ account, before = null, limit = 30 }) {
    const games = await this.#repository.listHistory({ account, before, limit: limit + 1 });
    const page = games.slice(0, limit);
    return Object.freeze({ account, games: Object.freeze(page), next: games.length > limit ? page[page.length - 1].gameId : null });
  }

  get timePolicy() {
    return this.#timePolicy;
  }

  /** The public key that signs acks, or null when acks are not signed. */
  get ackKey() {
    return this.#ackSigner?.publicKey ?? null;
  }

  /**
   * Creates a game for two entrants (seat order as given) and tells both.
   * @param {{ mode?: string, entrants: readonly Entrant[] }} request
   * @returns {Promise<string>} the game id
   */
  async createGame(request) {
    const staged = await this.#unitOfWork(() => this.stageGame(request));
    this.launchGame(staged);
    return staged.game.id;
  }

  /**
   * Writes a new game inside the caller's unit of work (matchmaking pairs
   * the tickets and creates the game atomically). Nothing is announced:
   * call launchGame once the unit of work has committed.
   * @param {{ mode?: string, entrants: readonly Entrant[] }} request
   * @returns {Promise<Readonly<{ game: import("./ports.js").StoredGame, recorder: GameRecorder }>>}
   */
  async stageGame({ mode = GameMode.CASUAL, entrants }) {
    const { hash, engineVersion } = this.#currentContent();
    const id = ulid(this.#clock, this.#random);
    const secret = bytesToHex(this.#random.bytes(SECRET_BYTES));
    const decks = entrants.map((entrant) => canonicalDeck(entrant.deck.map((entry) => [entry.cardId, entry.count])));
    const recorder = new GameRecorder({ gameId: id, secret, decks, version: this.#gameProtocol });
    const now = this.#clock.now();
    const created = recorder.created({ mode, network: this.#network, engineVersion, contentHash: hash, accounts: entrants.map((entrant) => entrant.account), ms: 0 });
    /** @type {import("./ports.js").StoredGame} */
    const game = Object.freeze({
      id,
      mode,
      status: GameStatus.CREATED,
      network: this.#network,
      protocolVersion: this.#gameProtocol,
      engineVersion,
      contentHash: hash,
      sealedSecret: this.#secrets.seal(hexToBytes(secret), secretContext(id)),
      seedCommit: seedCommitment(secret),
      firstSeat: null,
      winnerSeat: null,
      endReason: null,
      version: 0,
      lastEventSeq: created.event.i,
      chainHead: created.head,
      createdAt: now,
      startedAt: null,
      finishedAt: null,
      players: Object.freeze(
        entrants.map((entrant, index) =>
          Object.freeze({
            seat: seatAt(index),
            userId: entrant.userId,
            account: entrant.account,
            deckId: entrant.deckId,
            deck: decks[index],
            deckCommit: deckCommitment(secret, index, decks[index]),
            entropy: null,
            entropySource: null,
          }),
        ),
      ),
    });
    await this.#repository.insertGame(game, created);
    await this.#audit.record({ actorKind: "system", action: "gameplay.game_created", targetKind: "game", targetId: id, details: { mode, seats: entrants.map((entrant) => entrant.account), content: hash } });
    return Object.freeze({ game, recorder });
  }

  /**
   * Starts the actor of a committed game and tells both players (they answer with their entropy).
   * @param {Readonly<{ game: import("./ports.js").StoredGame, recorder: GameRecorder }>} staged
   */
  launchGame({ game, recorder }) {
    this.#actors.set(game.id, this.#newActor(game, recorder, this.#currentContent().content));
    for (const player of game.players) {
      const opponent = game.players.find((other) => other.seat !== player.seat);
      const authorizeDeadline = game.protocolVersion >= GameProtocol.V2 ? { authorizeDeadline: game.createdAt + this.#timePolicy.authorizeMs } : {};
      this.#notifier.send(player.userId, "match.found", { gameId: game.id, seat: player.seat, opponent: { account: opponent?.account ?? null }, seedCommit: game.seedCommit, protocol: game.protocolVersion, entropyDeadline: game.createdAt + this.#timePolicy.entropyMs, ...authorizeDeadline });
    }
  }

  /**
   * The live game a user plays in, if any.
   * @param {string} userId
   */
  activeGameOf(userId) {
    for (const actor of this.#actors.values()) {
      if (!actor.isOver && actor.seatOf(userId) !== null) {
        return Promise.resolve(actor.id);
      }
    }
    return this.#repository.activeGameOf(userId);
  }

  /**
   * The users seated in a game this process runs that is not over (the lobby's "in a game").
   * @returns {Set<string>}
   */
  playingUsers() {
    const playing = new Set();
    for (const actor of this.#actors.values()) {
      if (!actor.isOver) {
        for (const userId of actor.userIds()) {
          playing.add(userId);
        }
      }
    }
    return playing;
  }

  /**
   * @param {string} userId
   * @param {unknown} gameId
   * @param {unknown} entropy
   */
  async entropy(userId, gameId, entropy) {
    const actor = await this.#actorFor(gameId);
    return actor === null ? notInGame() : actor.entropy(userId, entropy);
  }

  /**
   * v2: authorises the key the player's browser signs moves with.
   * @param {string} userId
   * @param {{ gameId: unknown, key: unknown, authorization: unknown }} request
   */
  async session(userId, { gameId, key, authorization }) {
    const actor = await this.#actorFor(gameId);
    return actor === null ? notInGame() : actor.session(userId, { key, authorization });
  }

  /**
   * v2: the player will not authorise a session key; the game, not yet started, is called off.
   * @param {string} userId
   * @param {unknown} gameId
   */
  async decline(userId, gameId) {
    const actor = await this.#actorFor(gameId);
    return actor === null ? notInGame() : actor.decline(userId);
  }

  /**
   * @param {string} userId
   * @param {{ gameId: unknown, commandId: unknown, expectedVersion: unknown, command: unknown, signature?: unknown }} request
   */
  async command(userId, { gameId, commandId, expectedVersion, command, signature }) {
    const actor = await this.#actorFor(gameId);
    if (actor === null) {
      return Object.freeze({ commandId: String(commandId).slice(0, 36), ok: false, error: Object.freeze({ code: GameError.NOT_IN_GAME, message: "no such game" }) });
    }
    return actor.command(userId, { commandId, expectedVersion, command, signature });
  }

  /**
   * @param {string} userId
   * @param {{ gameId: unknown, commandId: unknown, expectedVersion?: unknown, signature?: unknown }} request
   */
  async concede(userId, { gameId, commandId, expectedVersion, signature }) {
    const actor = await this.#actorFor(gameId);
    if (actor === null) {
      return Object.freeze({ commandId: String(commandId).slice(0, 36), ok: false, error: Object.freeze({ code: GameError.NOT_IN_GAME, message: "no such game" }) });
    }
    return actor.concede(userId, { commandId, expectedVersion, signature });
  }

  /**
   * The user's view of a game (their own perspective), or null.
   * @param {string} userId
   * @param {unknown} gameId
   */
  async view(userId, gameId) {
    const actor = await this.#actorFor(gameId);
    return actor === null ? null : actor.view(userId);
  }

  /**
   * Starts watching a live game (and stops watching any other).
   * @param {string} userId
   * @param {unknown} gameId
   */
  async watch(userId, gameId) {
    const actor = await this.#actorFor(gameId);
    if (actor === null) {
      return notInGame();
    }
    if (this.#watching.get(userId) !== actor.id) {
      this.unwatch(userId);
    }
    const result = await actor.watch(userId);
    if (result.ok) {
      this.#watching.set(userId, actor.id);
    }
    return result;
  }

  /** @param {string} userId */
  unwatch(userId) {
    const gameId = this.#watching.get(userId);
    if (gameId !== undefined) {
      this.#watching.delete(userId);
      this.#actors.get(gameId)?.unwatch(userId);
    }
  }

  /**
   * Games being played now, the most watched first.
   * @param {number} [limit]
   */
  liveGames(limit = 50) {
    const live = [...this.#actors.values()].filter((actor) => actor.status === GameStatus.ACTIVE && !actor.isOver).map((actor) => actor.summary());
    live.sort((left, right) => right.spectators - left.spectators || (right.startedAt ?? 0) - (left.startedAt ?? 0));
    return Object.freeze(live.slice(0, limit));
  }

  /**
   * A user connected or left: their games' clocks take it into account.
   * @param {string} userId
   * @param {boolean} connected
   */
  async presence(userId, connected) {
    if (!connected) {
      this.unwatch(userId);
    }
    const gameId = await this.activeGameOf(userId);
    const actor = gameId === null ? null : await this.#actorFor(gameId);
    await actor?.presence(userId, connected);
  }

  /** Runs every live game's timers; forgets finished games. */
  async tick() {
    for (const actor of [...this.#actors.values()]) {
      if (actor.isOver) {
        this.#actors.delete(actor.id);
        this.#forgetSpectators(actor.id);
        continue;
      }
      try {
        await actor.tick();
      } catch (error) {
        this.#logger.error("game tick failed", { game: actor.id, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  /** Rebuilds every unfinished game (server start). Players count as absent until they reconnect. */
  async restoreAll() {
    let restored = 0;
    for (const gameId of await this.#repository.listActive()) {
      const actor = await this.#actorFor(gameId);
      if (actor !== null) {
        for (const userId of await this.#playersOf(gameId)) {
          await actor.presence(userId, false);
        }
        restored += 1;
      }
    }
    return restored;
  }

  /** @param {string} gameId */
  #forgetSpectators(gameId) {
    for (const [userId, watched] of this.#watching) {
      if (watched === gameId) {
        this.#watching.delete(userId);
      }
    }
  }

  /** @param {unknown} gameId */
  async #actorFor(gameId) {
    if (typeof gameId !== "string") {
      return null;
    }
    const live = this.#actors.get(gameId);
    if (live !== undefined) {
      return live;
    }
    const pending = this.#loading.get(gameId) ?? this.#load(gameId);
    this.#loading.set(gameId, pending);
    try {
      return await pending;
    } finally {
      this.#loading.delete(gameId);
    }
  }

  /** @param {string} gameId */
  async #load(gameId) {
    const game = await this.#repository.findGame(gameId);
    if (game === null || game.status === GameStatus.FINISHED || game.status === GameStatus.ABORTED) {
      return null;
    }
    const version = game.engineVersion === this.#currentContent().engineVersion ? await this.#contentVersion(game.contentHash) : null;
    if (version === null) {
      this.#logger.error("the game's content or engine version cannot be loaded; the game cannot resume", { game: gameId, content: game.contentHash, engine: game.engineVersion });
      return null;
    }
    const secret = bytesToHex(this.#secrets.open(game.sealedSecret, secretContext(gameId)));
    /** @type {Record<string, string>} */
    const entropies = {};
    for (const player of game.players) {
      if (player.entropy !== null) {
        entropies[player.seat] = player.entropy;
      }
    }
    const recorder = new GameRecorder({ gameId, secret, decks: game.players.map((player) => player.deck), head: game.chainHead, nextSeq: game.lastEventSeq + 1, entropies, version: game.protocolVersion });
    const actor = this.#newActor(game, recorder, version.content);
    actor.replay(await this.#repository.listEvents(gameId));
    this.#actors.set(gameId, actor);
    // A rebuilt actor keeps streaming to whoever watched the one it replaces.
    for (const [userId, watched] of this.#watching) {
      if (watched === gameId) {
        actor.watch(userId).catch(() => this.#watching.delete(userId));
      }
    }
    return actor;
  }

  /**
   * @param {import("./ports.js").StoredGame} game
   * @param {GameRecorder} recorder
   * @param {import("@magic8/engine/domain/content/GameContent.js").GameContent} content the version the game was created with
   */
  #newActor(game, recorder, content) {
    return new GameActor({
      game,
      recorder,
      content: { rules: content.gameRules, catalog: content.catalog, effects: this.#effects, createCommands: createCoreCommandRegistry },
      repository: this.#repository,
      notifier: this.#notifier,
      clock: this.#clock,
      random: this.#random,
      unitOfWork: this.#unitOfWork,
      logger: this.#logger,
      timePolicy: this.#timePolicy,
      onBroken: (gameId) => {
        this.#logger.error("game actor failed to persist; it will be rebuilt from the database", { game: gameId });
        this.#actors.delete(gameId);
      },
      signAck: (fields) => this.#signAck(fields),
      signatures: this.#signatures,
      results: this.#results,
      onAborted: async (summary) => {
        for (const listener of this.#abortedListeners) {
          await listener(summary);
        }
      },
      onFinished: (summary) => {
        for (const listener of this.#finishedListeners) {
          listener(summary).catch((error) => this.#logger.error("a finished-game listener failed", { game: summary.gameId, error: error instanceof Error ? error.message : String(error) }));
        }
      },
    });
  }

  /** @type {import("./GameActor.js").AckSignature} */
  #signAck(fields) {
    if (this.#ackSigner === null) {
      return {};
    }
    const at = this.#clock.now();
    const key = this.#ackSigner.publicKey;
    return Object.freeze({ at, key, sig: this.#ackSigner.sign(ackMessage({ ...fields, at, key })) });
  }

  /** @param {string} gameId */
  async #playersOf(gameId) {
    const game = await this.#repository.findGame(gameId);
    return game === null ? [] : game.players.map((player) => player.userId);
  }
}

/** @param {number} index */
const seatAt = (index) => (index === 0 ? "s0" : "s1");

/** @param {string} gameId */
const secretContext = (gameId) => `game:${gameId}`;

function notInGame() {
  return Object.freeze({ ok: false, error: Object.freeze({ code: GameError.NOT_IN_GAME, message: "no such game" }) });
}
