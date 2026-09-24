/**
 * GameService: creates games, keeps one GameActor per live game, rebuilds
 * actors from the database (after a restart, or when an actor failed to
 * persist), and routes every player input to the right actor.
 *
 * A game is created with a fresh 32-byte secret (sealed at rest), the
 * players' frozen decks and their commitments (GAME_CREATED, docs/tcg/03 §5):
 * the server is bound to its randomness and to both decks before either
 * player contributes entropy, and the first player is decided by lot from
 * the resulting seed.
 */
import { createCoreCommandRegistry } from "@magic8/engine/domain/commands/registerCoreCommands.js";
import { GameMode, GameRecorder, PROTOCOL_VERSION, bytesToHex, canonicalDeck, deckCommitment, hexToBytes, seedCommitment } from "@magic8/protocol";
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
  /** @type {Map<string, GameActor>} */
  #actors = new Map();
  /** @type {Map<string, Promise<GameActor | null>>} actors being rebuilt */
  #loading = new Map();

  /**
   * @param {{
   *   repository: import("./ports.js").GameRepository,
   *   currentContent: () => { hash: string, engineVersion: string, content: import("@magic8/engine/domain/content/GameContent.js").GameContent },
   *   effects: import("@magic8/engine/domain/effects/EffectRegistry.js").EffectRegistry,
   *   secrets: import("../../../kernel/crypto/SecretBox.js").SecretBox,
   *   notifier: import("./ports.js").GameNotifier,
   *   clock: import("../../../kernel/time.js").Clock,
   *   random: import("../../../kernel/random.js").SecureRandom,
   *   unitOfWork: import("../../../kernel/unitOfWork.js").UnitOfWork,
   *   audit: import("../../../kernel/audit/AuditTrail.js").AuditTrail,
   *   logger: import("../../../kernel/logger.js").Logger,
   *   network: string,
   *   timePolicy?: Partial<import("../domain/TurnClock.js").TimePolicy>,
   * }} deps
   */
  constructor({ repository, currentContent, effects, secrets, notifier, clock, random, unitOfWork, audit, logger, network, timePolicy = {} }) {
    assertImplements(repository, GAME_REPOSITORY_METHODS, "GameRepository");
    this.#repository = repository;
    this.#currentContent = currentContent;
    this.#effects = effects;
    this.#secrets = secrets;
    this.#notifier = notifier;
    this.#clock = clock;
    this.#random = random;
    this.#unitOfWork = unitOfWork;
    this.#audit = audit;
    this.#logger = logger;
    this.#network = network;
    this.#timePolicy = Object.freeze({ ...DEFAULT_TIME_POLICY, ...timePolicy });
  }

  get timePolicy() {
    return this.#timePolicy;
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
    const recorder = new GameRecorder({ gameId: id, secret, decks });
    const now = this.#clock.now();
    const created = recorder.created({ mode, network: this.#network, engineVersion, contentHash: hash, accounts: entrants.map((entrant) => entrant.account), ms: 0 });
    /** @type {import("./ports.js").StoredGame} */
    const game = Object.freeze({
      id,
      mode,
      status: GameStatus.CREATED,
      network: this.#network,
      protocolVersion: PROTOCOL_VERSION,
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
    this.#actors.set(game.id, this.#newActor(game, recorder));
    for (const player of game.players) {
      const opponent = game.players.find((other) => other.seat !== player.seat);
      this.#notifier.send(player.userId, "match.found", { gameId: game.id, seat: player.seat, opponent: { account: opponent?.account ?? null }, seedCommit: game.seedCommit, entropyDeadline: game.createdAt + this.#timePolicy.entropyMs });
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
   * @param {string} userId
   * @param {unknown} gameId
   * @param {unknown} entropy
   */
  async entropy(userId, gameId, entropy) {
    const actor = await this.#actorFor(gameId);
    return actor === null ? notInGame() : actor.entropy(userId, entropy);
  }

  /**
   * @param {string} userId
   * @param {{ gameId: unknown, commandId: unknown, expectedVersion: unknown, command: unknown }} request
   */
  async command(userId, { gameId, commandId, expectedVersion, command }) {
    const actor = await this.#actorFor(gameId);
    if (actor === null) {
      return Object.freeze({ commandId: String(commandId).slice(0, 36), ok: false, error: Object.freeze({ code: GameError.NOT_IN_GAME, message: "no such game" }) });
    }
    return actor.command(userId, { commandId, expectedVersion, command });
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
   * A user connected or left: their games' clocks take it into account.
   * @param {string} userId
   * @param {boolean} connected
   */
  async presence(userId, connected) {
    const gameId = await this.activeGameOf(userId);
    const actor = gameId === null ? null : await this.#actorFor(gameId);
    await actor?.presence(userId, connected);
  }

  /** Runs every live game's timers; forgets finished games. */
  async tick() {
    for (const actor of [...this.#actors.values()]) {
      if (actor.isOver) {
        this.#actors.delete(actor.id);
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
    const { hash } = this.#currentContent();
    if (game.contentHash !== hash) {
      // M5 brings content by hash; until then a game cannot outlive a content change.
      this.#logger.error("game content is no longer loaded; the game cannot resume", { game: gameId, content: game.contentHash });
      return null;
    }
    const secret = bytesToHex(this.#secrets.open(game.sealedSecret, secretContext(gameId)));
    const entropies = Object.fromEntries(game.players.filter((player) => player.entropy !== null).map((player) => [player.seat, player.entropy]));
    const recorder = new GameRecorder({ gameId, secret, decks: game.players.map((player) => player.deck), head: game.chainHead, nextSeq: game.lastEventSeq + 1, entropies });
    const actor = this.#newActor(game, recorder);
    actor.replay(await this.#repository.listEvents(gameId));
    this.#actors.set(gameId, actor);
    return actor;
  }

  /**
   * @param {import("./ports.js").StoredGame} game
   * @param {GameRecorder} recorder
   */
  #newActor(game, recorder) {
    const { content } = this.#currentContent();
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
    });
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
