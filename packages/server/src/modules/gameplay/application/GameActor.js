/**
 * GameActor: the authoritative owner of one game (docs/tcg/01-architettura.md §7.3).
 *
 * Every input — a player's entropy or command, a timer tick, a connection
 * coming or going — goes through one mailbox and runs alone, so the game
 * state has no race conditions (T15). For each accepted input the protocol
 * events (GameRecorder: hash-chained, docs/tcg/03 §6.2) are persisted in one
 * unit of work with a compare-and-set on the last event sequence; only then
 * are the players told. If persisting fails, the actor reports itself broken
 * and the service rebuilds it from the database by replay.
 *
 * Players never choose their seat or player id: the seat comes from the
 * authenticated user (T1), the engine validates every command, and a
 * command must name the version it was decided on (STALE_VERSION otherwise).
 *
 * From game protocol v2 (docs/tcg/12-mosse-firmate.md) a player first
 * authorises a session key with their account (SESSION), then signs every
 * command with it; the server checks both and records the signature in the
 * MOVE, so it can never record a move in a player's name that the player
 * did not sign. Forced moves stay the server's, and say so.
 *
 * A game starts once it has both players' entropy and, in v2, both session
 * keys: nobody is dealt a hand, drawn to go first or put on the clock before
 * both have accepted the game with Keychain. A player who refuses (decline)
 * or lets the time run out calls the game off (GAME_ABORTED): both players
 * are told who did not sign, and nothing counts for either of them.
 *
 * A finished game's result — winner, reason, and the chain head after its
 * last event — goes to the outbox in the same unit of work as that event, to
 * be published once on chain (m8tcg_result, docs/tcg/03 §9): the server
 * commits publicly to a history it keeps in its database.
 *
 * Spectators (docs/tcg/10-spettatori.md) get the table as the SPECTATOR
 * perspective: no hand, no drawn card. That is less than either player
 * sees, so a spectator relaying what they watch to a player tells them
 * nothing new, and the stream needs no delay.
 */
import { SPECTATOR, redactEventsFor } from "@magic8/engine/domain/game/GameSnapshot.js";
import { GamePhase } from "@magic8/engine/domain/game/GamePhase.js";
import { EntropySource, EventKind, ForcedMoveReason, GameProtocol, LIMITS, MOVE_SIGNATURE_PATTERN, SEATS, SESSION_KEY_PATTERN, bytesToHex, canonicalize, commandOfMove, createGameEngine, gameResultRecord, moveMessage, sessionAuthorization, utf8Length } from "@magic8/protocol";
import { CONCEDE_COMMAND, forcedCommandFor } from "../domain/forcedCommand.js";
import { TurnClock } from "../domain/TurnClock.js";

export const GameStatus = Object.freeze({ CREATED: "CREATED", ACTIVE: "ACTIVE", FINISHED: "FINISHED", ABORTED: "ABORTED" });

/** Why a game that never started was called off (GAME_ABORTED `why`). */
export const AbortReason = Object.freeze({
  /** v2: a player refused to authorise their session key. */
  DECLINED: "declined",
  /** v2: a player did not authorise their session key in time. */
  NOT_AUTHORIZED: "not_authorized",
});

export const GameError = Object.freeze({
  NOT_IN_GAME: "NOT_IN_GAME",
  GAME_NOT_ACTIVE: "GAME_NOT_ACTIVE",
  STALE_VERSION: "STALE_VERSION",
  INVALID_COMMAND: "INVALID_COMMAND",
  INVALID_ENTROPY: "INVALID_ENTROPY",
  PLAYER_CANNOT_WATCH: "PLAYER_CANNOT_WATCH",
  /** v2: the seat has not authorised a session key yet. */
  SESSION_REQUIRED: "SESSION_REQUIRED",
  /** v2: the session key's authorisation, or a move's signature, does not check out. */
  INVALID_SIGNATURE: "INVALID_SIGNATURE",
  SPECTATORS_FULL: "SPECTATORS_FULL",
});

/** Spectators one game streams to (each move is sent to every one of them). */
export const MAX_SPECTATORS = 50;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ENTROPY_PATTERN = /^[0-9a-f]{32}$/;
const AUTHORIZATION_PATTERN = /^[0-9a-f]{130}$/;
/** Forced moves one tick may make (a seat's whole turn is a handful of phases). */
const MAX_FORCED_PER_TICK = 20;
/** Acks of rejected commands kept in memory for idempotent re-sends (accepted ones are in the database). */
const REJECTED_ACK_CACHE = 64;

/**
 * @typedef {import("./ports.js").StoredGame} StoredGame
 * @typedef {Readonly<{ commandId: string, ok: boolean, version?: number, head?: string, seq?: number, at?: number, key?: string, sig?: string, error?: Readonly<{ code: string, message: string }> }>} Ack
 * @typedef {(fields: { gameId: string, commandId: string, seq: number, head: string, version: number }) => Readonly<{ at?: number, key?: string, sig?: string }>} AckSignature
 */

export class GameActor {
  #game;
  #recorder;
  /** @type {import("@magic8/engine/domain/game/GameEngine.js").GameEngine | null} */
  #engine = null;
  #content;
  #repository;
  #notifier;
  #clock;
  #random;
  #unitOfWork;
  #logger;
  #onBroken;
  #onFinished;
  #onAborted;
  #signAck;
  #signatures;
  #results;
  /** @type {Map<string, string>} seat → the session key it signs with now (v2) */
  #sessions = new Map();
  #turnClock;
  #status;
  #lastSeq;
  #entropyDeadline;
  /** v2: when the game is called off if a seat has not authorised a session key. */
  #authorizeDeadline;
  /** @type {Map<string, string>} seat → entropy */
  #entropies = new Map();
  /** @type {Map<string, Ack>} */
  #rejected = new Map();
  /** @type {Set<string>} user ids */
  #spectators = new Set();
  /** @type {Promise<unknown>} */
  #mailbox = Promise.resolve();
  #broken = false;

  /**
   * @param {{
   *   game: StoredGame,
   *   recorder: import("@magic8/protocol").GameRecorder,
   *   content: import("@magic8/protocol").GameContent,
   *   repository: import("./ports.js").GameRepository,
   *   notifier: import("./ports.js").GameNotifier,
   *   clock: import("../../../kernel/time.js").Clock,
   *   random: import("../../../kernel/random.js").SecureRandom,
   *   unitOfWork: import("../../../kernel/unitOfWork.js").UnitOfWork,
   *   logger: import("../../../kernel/logger.js").Logger,
   *   timePolicy: import("../domain/TurnClock.js").TimePolicy,
   *   onBroken: (gameId: string) => void,
   *   onFinished: (summary: import("./ports.js").FinishedGame) => void,
   *   onAborted?: (summary: import("./ports.js").AbortedGame) => Promise<void>,
   *   signAck?: AckSignature,
   *   signatures?: import("./ports.js").MoveSignatures | null,
   *   results?: import("./ports.js").ResultOutbox | null,
   * }} deps `signatures` is required for v2 games; `results` receives finished games' results (none: not published);
   *   `onAborted` writes in the unit of work that calls a game off (e.g. gives back what it cost)
   */
  constructor({ game, recorder, content, repository, notifier, clock, random, unitOfWork, logger, timePolicy, onBroken, onFinished, onAborted = async () => undefined, signAck = () => ({}), signatures = null, results = null }) {
    if (recorder.version >= GameProtocol.V2 && signatures === null) {
      throw new Error(`game ${game.id}: a v2 game needs move signature checks`);
    }
    this.#game = game;
    this.#recorder = recorder;
    this.#content = content;
    this.#repository = repository;
    this.#notifier = notifier;
    this.#clock = clock;
    this.#random = random;
    this.#unitOfWork = unitOfWork;
    this.#logger = logger;
    this.#onBroken = onBroken;
    this.#onFinished = onFinished;
    this.#onAborted = onAborted;
    this.#signAck = signAck;
    this.#signatures = signatures;
    this.#results = results;
    this.#status = game.status;
    this.#lastSeq = game.lastEventSeq;
    this.#turnClock = new TurnClock(timePolicy, SEATS);
    this.#entropyDeadline = game.createdAt + timePolicy.entropyMs;
    this.#authorizeDeadline = game.createdAt + timePolicy.authorizeMs;
    for (const player of game.players) {
      if (player.entropy !== null) {
        this.#entropies.set(player.seat, player.entropy);
      }
    }
  }

  get id() {
    return this.#game.id;
  }

  get status() {
    return this.#status;
  }

  get isOver() {
    return this.#status === GameStatus.FINISHED || this.#status === GameStatus.ABORTED;
  }

  get spectatorCount() {
    return this.#spectators.size;
  }

  /** What a live-games list shows about this game. */
  summary() {
    return Object.freeze({
      gameId: this.id,
      mode: this.#game.mode,
      status: this.#status,
      players: this.#seats(),
      turn: this.#engine?.getSnapshot(SPECTATOR).turnNumber ?? 0,
      startedAt: this.#game.startedAt,
      spectators: this.#spectators.size,
    });
  }

  /** @param {string} userId */
  seatOf(userId) {
    return this.#game.players.find((player) => player.userId === userId)?.seat ?? null;
  }

  /** The users seated in this game. */
  userIds() {
    return this.#game.players.map((player) => player.userId);
  }

  /** Whether players must sign their moves (game protocol v2). */
  get signsMoves() {
    return this.#recorder.version >= GameProtocol.V2;
  }

  /**
   * Rebuilds a started game from its persisted moves (restart, or after a failed write).
   * @param {readonly import("@magic8/protocol").ProtocolEvent[]} events
   */
  replay(events) {
    for (const event of events) {
      if (event.k === EventKind.SESSION) {
        this.#sessions.set(/** @type {string} */ (event.a), /** @type {any} */ (event.d).key);
      }
    }
    if (this.#status !== GameStatus.ACTIVE) {
      return;
    }
    this.#engine = this.#createEngine();
    this.#engine.start();
    for (const event of events) {
      const command = commandOf(event, this.#recorder.version);
      if (command !== null) {
        const result = this.#engine.execute({ ...command, playerId: event.a });
        if (!result.ok) {
          throw new Error(`game ${this.id}: event ${event.i} does not replay (${result.error.message})`);
        }
      }
    }
    if (this.#engine.version !== this.#game.version) {
      throw new Error(`game ${this.id}: replay reached version ${this.#engine.version}, the database says ${this.#game.version}`);
    }
    this.#syncClock();
  }

  /**
   * A player's random contribution to the seed (docs/tcg/03 §5), sent after seeing the seed commitment.
   * @param {string} userId
   * @param {unknown} entropy 16 bytes as lowercase hex
   */
  entropy(userId, entropy) {
    return this.#enqueue(async () => {
      const seat = this.seatOf(userId);
      if (seat === null) {
        return fail(GameError.NOT_IN_GAME, "you are not playing this game");
      }
      if (typeof entropy !== "string" || !ENTROPY_PATTERN.test(entropy)) {
        return fail(GameError.INVALID_ENTROPY, "entropy must be 16 bytes as lowercase hex");
      }
      if (this.#status !== GameStatus.CREATED || this.#entropies.has(seat)) {
        return /** @type {const} */ ({ ok: true });
      }
      await this.#join(seat, entropy, EntropySource.CLIENT);
      return /** @type {const} */ ({ ok: true });
    });
  }

  /**
   * v2: the key the player's browser will sign moves with, authorised by their account (a new one replaces the old).
   * @param {string} userId
   * @param {{ key: unknown, authorization: unknown }} grant
   */
  session(userId, { key, authorization }) {
    return this.#enqueue(async () => {
      const seat = this.seatOf(userId);
      if (seat === null) {
        return fail(GameError.NOT_IN_GAME, "you are not playing this game");
      }
      if (!this.signsMoves || this.isOver) {
        return fail(GameError.GAME_NOT_ACTIVE, this.isOver ? "the game is over" : "this game does not use session keys");
      }
      if (typeof key !== "string" || !SESSION_KEY_PATTERN.test(key) || typeof authorization !== "string" || !AUTHORIZATION_PATTERN.test(authorization)) {
        return fail(GameError.INVALID_SIGNATURE, "a session key is an uncompressed P-256 point, its authorisation a Keychain signature");
      }
      const account = /** @type {string} */ (this.#game.players.find((player) => player.seat === seat)?.account);
      const signatures = /** @type {import("./ports.js").MoveSignatures} */ (this.#signatures);
      if (!(await signatures.authorizesSession({ account, message: sessionAuthorization(this.id, key), signature: authorization }))) {
        return fail(GameError.INVALID_SIGNATURE, `the authorisation is not signed by a posting key of @${account}`);
      }
      await this.#recordSession(seat, key, authorization);
      return Object.freeze({ ok: true });
    });
  }

  /**
   * Records a seat's (checked) session key; before the start, it may be the last thing the game waited for.
   * @param {string} seat
   * @param {string} key
   * @param {string} authorization
   */
  async #recordSession(seat, key, authorization) {
    const chained = this.#recorder.session({ seat, key, authorization, clock: { turn: this.#engine === null ? 0 : this.#engine.getSnapshot(null).turnNumber, ms: this.#elapsed() } });
    if (this.#status === GameStatus.CREATED) {
      this.#sessions.set(seat, key);
      await this.#admit([chained], async () => undefined);
      return;
    }
    await this.#persist([chained], {}, async () => undefined);
    this.#sessions.set(seat, key);
  }

  /**
   * v2: the player will not authorise a session key for this game (they said no to Keychain).
   * Only before the start: the game is called off and both players are told.
   * @param {string} userId
   */
  decline(userId) {
    return this.#enqueue(async () => {
      const seat = this.seatOf(userId);
      if (seat === null) {
        return fail(GameError.NOT_IN_GAME, "you are not playing this game");
      }
      if (!this.signsMoves || this.#status !== GameStatus.CREATED) {
        return fail(GameError.GAME_NOT_ACTIVE, this.#status === GameStatus.CREATED ? "this game does not use session keys" : "the game is no longer waiting for players");
      }
      await this.#abort(AbortReason.DECLINED, [seat]);
      return Object.freeze({ ok: true });
    });
  }

  /**
   * @param {string} userId
   * @param {{ commandId: unknown, expectedVersion: unknown, command: unknown, signature?: unknown }} request `signature` from v2 on
   * @returns {Promise<Ack>}
   */
  command(userId, request) {
    return this.#enqueue(() => this.#handleCommand(userId, request));
  }

  /**
   * @param {string} userId
   * @param {{ commandId: unknown, expectedVersion: unknown, command: unknown, signature?: unknown }} request
   * @returns {Promise<Ack>}
   */
  async #handleCommand(userId, { commandId, expectedVersion, command, signature }) {
    if (typeof commandId !== "string" || !UUID_PATTERN.test(commandId)) {
      return rejectedAck(String(commandId).slice(0, 36), GameError.INVALID_COMMAND, "commandId must be a UUID");
    }
    const earlier = this.#rejected.get(commandId) ?? (await this.#repository.findAck(this.id, commandId));
    if (earlier !== null && earlier !== undefined) {
      return /** @type {Ack} */ (earlier);
    }
    const refused = this.#refuse(userId, expectedVersion, command) ?? this.#refuseSignature(userId, { commandId, expectedVersion, command, signature });
    if (refused !== null) {
      return this.#remember(rejectedAck(commandId, refused.code, refused.message));
    }
    const seat = /** @type {string} */ (this.seatOf(userId));
    const signed = this.signsMoves ? { commandId, expectedVersion: /** @type {number} */ (expectedVersion), signature: /** @type {string} */ (signature) } : undefined;
    const applied = this.#apply(seat, /** @type {Record<string, unknown>} */ (command), null, signed);
    if (!applied.ok) {
      return this.#remember(rejectedAck(commandId, applied.error.code, applied.error.message));
    }
    // The ack names the last event the command produced; signed, it is the player's proof of what was accepted (docs/tcg/11).
    const last = applied.chained[applied.chained.length - 1];
    const acknowledged = { commandId, version: applied.version, head: last.head, seq: last.event.i };
    /** @type {Ack} */
    const ack = Object.freeze({ ok: true, ...acknowledged, ...this.#signAck({ gameId: this.id, ...acknowledged }) });
    await this.#commit(applied, { commandId, seat, expectedVersion: /** @type {number} */ (expectedVersion), payload: command, ack });
    this.#turnClock.acted(seat, this.#clock.now());
    this.#afterMove(applied);
    return ack;
  }

  /**
   * Forfeit. In v1, at whatever version the game is (read inside the mailbox, so conceding never goes stale);
   * from v2 on a concession is a signed move like any other, at the version the player signed.
   * @param {string} userId
   * @param {{ commandId: unknown, expectedVersion?: unknown, signature?: unknown }} request
   * @returns {Promise<Ack>}
   */
  concede(userId, { commandId, expectedVersion, signature }) {
    return this.#enqueue(() =>
      this.#handleCommand(userId, { commandId, expectedVersion: this.signsMoves ? expectedVersion : this.#engine?.version ?? 0, command: { type: "CONCEDE" }, signature }),
    );
  }

  /**
   * @param {string} userId
   * @param {boolean} connected
   */
  presence(userId, connected) {
    return this.#enqueue(async () => {
      const seat = this.seatOf(userId);
      if (seat !== null) {
        this.#turnClock.presence(seat, connected, this.#clock.now());
      }
    });
  }

  /** Timers: missing entropy, session keys not authorised in time, decisions that ran out of time, abandonment. */
  tick() {
    return this.#enqueue(async () => {
      const now = this.#clock.now();
      if (this.#status === GameStatus.CREATED && now >= this.#entropyDeadline) {
        for (const seat of SEATS.filter((candidate) => !this.#entropies.has(candidate))) {
          if (this.#status === GameStatus.CREATED) {
            await this.#join(seat, bytesToHex(this.#random.bytes(LIMITS.ENTROPY_BYTES)), EntropySource.SERVER);
          }
        }
      }
      if (this.#status === GameStatus.CREATED && this.signsMoves && now >= this.#authorizeDeadline) {
        await this.#abort(AbortReason.NOT_AUTHORIZED, this.#unauthorizedSeats());
      }
      for (let forced = 0; forced < MAX_FORCED_PER_TICK && this.#status === GameStatus.ACTIVE; forced += 1) {
        const due = this.#turnClock.due(now);
        if (due === null) {
          break;
        }
        await this.#force(due.seat, due.why);
      }
    });
  }

  /**
   * What `userId` may see: their own perspective only.
   * @param {string} userId
   */
  view(userId) {
    return this.#enqueue(async () => {
      const seat = this.seatOf(userId);
      if (seat === null) {
        return null;
      }
      return this.#viewFor(seat);
    });
  }

  /**
   * Starts streaming the game to a user who does not play it; returns what the table shows now.
   * @param {string} userId
   */
  watch(userId) {
    return this.#enqueue(async () => {
      if (this.seatOf(userId) !== null) {
        return fail(GameError.PLAYER_CANNOT_WATCH, "you play this game");
      }
      if (this.isOver) {
        return fail(GameError.GAME_NOT_ACTIVE, "the game is over");
      }
      if (!this.#spectators.has(userId) && this.#spectators.size >= MAX_SPECTATORS) {
        return fail(GameError.SPECTATORS_FULL, `at most ${MAX_SPECTATORS} spectators per game`);
      }
      this.#spectators.add(userId);
      return Object.freeze({ ok: true, view: this.#spectatorView() });
    });
  }

  /** @param {string} userId */
  unwatch(userId) {
    this.#spectators.delete(userId);
  }

  /**
   * @param {string} seat
   * @param {"timeout" | "disconnect" | "abandon"} why
   */
  async #force(seat, why) {
    const command = why === ForcedMoveReason.ABANDON ? CONCEDE_COMMAND : forcedCommandFor(/** @type {any} */ (this.#engine).getSnapshot(seat));
    const applied = this.#apply(seat, command, why);
    if (!applied.ok) {
      // A minimal move the engine refuses is a bug: forfeit rather than stall the game.
      this.#logger.error("forced move refused; conceding", { game: this.id, seat, command, error: applied.error });
      const conceded = this.#apply(seat, CONCEDE_COMMAND, ForcedMoveReason.ABANDON);
      if (conceded.ok) {
        await this.#commit(conceded, null);
        this.#afterMove(conceded);
      }
      return;
    }
    await this.#commit(applied, null);
    this.#afterMove(applied);
    if (applied.turnEndedFor === seat && !applied.over && this.#turnClock.forcedTurnEnded(seat)) {
      await this.#force(seat, ForcedMoveReason.ABANDON);
    }
  }

  /**
   * @param {string} userId
   * @param {unknown} expectedVersion
   * @param {unknown} command
   * @returns {{ code: string, message: string } | null}
   */
  #refuse(userId, expectedVersion, command) {
    if (this.seatOf(userId) === null) {
      return { code: GameError.NOT_IN_GAME, message: "you are not playing this game" };
    }
    if (this.#status !== GameStatus.ACTIVE || this.#engine === null) {
      return { code: GameError.GAME_NOT_ACTIVE, message: "the game is not in progress" };
    }
    if (command === null || typeof command !== "object" || Array.isArray(command) || utf8Length(safeJson(command)) > LIMITS.MAX_COMMAND_BYTES) {
      return { code: GameError.INVALID_COMMAND, message: `a command is an object of at most ${LIMITS.MAX_COMMAND_BYTES} bytes` };
    }
    if (expectedVersion !== this.#engine.version) {
      return { code: GameError.STALE_VERSION, message: `the game is at version ${this.#engine.version}` };
    }
    return null;
  }

  /**
   * v2: the move must be signed by the seat's current session key, over exactly this command, id and version.
   * @param {string} userId
   * @param {{ commandId: string, expectedVersion: unknown, command: unknown, signature: unknown }} move
   * @returns {{ code: string, message: string } | null}
   */
  #refuseSignature(userId, { commandId, expectedVersion, command, signature }) {
    if (!this.signsMoves) {
      return null;
    }
    const key = this.#sessions.get(/** @type {string} */ (this.seatOf(userId)));
    if (key === undefined) {
      return { code: GameError.SESSION_REQUIRED, message: "authorise a session key before playing" };
    }
    const bare = { .../** @type {Record<string, unknown>} */ (command) };
    delete bare.playerId;
    const message = moveMessage({ gameId: this.id, commandId, expectedVersion: /** @type {number} */ (expectedVersion), command: bare });
    const signatures = /** @type {import("./ports.js").MoveSignatures} */ (this.#signatures);
    if (typeof signature !== "string" || !MOVE_SIGNATURE_PATTERN.test(signature) || !signatures.verifiesMove(message, signature, key)) {
      return { code: GameError.INVALID_SIGNATURE, message: "the move is not signed by your session key" };
    }
    return null;
  }

  /**
   * Runs a command in the engine and builds its protocol events (not yet persisted).
   * @param {string} seat
   * @param {Readonly<Record<string, unknown>>} command
   * @param {string | null} forcedWhy
   * @param {{ commandId: string, expectedVersion: number, signature: string }} [signed] v2: the player's signature
   */
  #apply(seat, command, forcedWhy, signed) {
    const engine = /** @type {import("@magic8/engine/domain/game/GameEngine.js").GameEngine} */ (this.#engine);
    const before = engine.getSnapshot(null);
    const withoutPlayer = { ...command };
    delete withoutPlayer.playerId;
    const result = engine.execute({ ...withoutPlayer, playerId: seat });
    if (!result.ok) {
      return /** @type {const} */ ({ ok: false, error: result.error });
    }
    const after = engine.getSnapshot(null);
    const clock = { turn: after.turnNumber, ms: this.#elapsed() };
    const accepted = { ...withoutPlayer, playerId: seat };
    const chained = [forcedWhy === null ? this.#recorder.move({ seat, command: accepted, clock, signed }) : this.#recorder.forcedMove({ seat, command: accepted, reason: forcedWhy, clock })];
    if (after.isOver) {
      chained.push(this.#recorder.finished({ winner: after.winnerId, reason: /** @type {string} a finished game has a reason */ (after.endReason), engineVersion: engine.version, digest: engine.getStateDigest(), clock }));
    } else if (after.turnNumber !== before.turnNumber) {
      chained.push(this.#recorder.checkpoint({ engineVersion: engine.version, digest: engine.getStateDigest(), clock }));
    }
    return /** @type {const} */ ({
      ok: true,
      events: result.value.events,
      chained,
      version: engine.version,
      over: after.isOver,
      winner: after.winnerId,
      reason: after.endReason,
      turnEndedFor: after.turnNumber !== before.turnNumber ? before.activePlayerId : null,
    });
  }

  /**
   * Persists an applied step in one unit of work.
   * @param {any} applied
   * @param {{ commandId: string, seat: string, expectedVersion: number, payload: unknown, ack: Ack } | null} command
   */
  async #commit(applied, command) {
    const now = this.#clock.now();
    const changes = applied.over ? { status: GameStatus.FINISHED, version: applied.version, winnerSeat: applied.winner, endReason: applied.reason, finishedAt: now } : { version: applied.version };
    await this.#persist(applied.chained, changes, async () => {
      if (command !== null) {
        await this.#repository.insertCommand({ gameId: this.id, ...command, accepted: true, at: now });
      }
      const checkpoint = applied.chained.find((chained) => chained.event.k === "STATE_CHECKPOINT");
      if (checkpoint !== undefined) {
        await this.#repository.insertSnapshot(this.id, checkpoint.event.d.ver, checkpoint.event.d.sc);
      }
      if (applied.over) {
        await this.#repository.setResults(this.id, resultsFor(applied.winner));
        await this.#publishResult(applied);
      }
    });
    if (applied.over) {
      this.#status = GameStatus.FINISHED;
      const last = applied.chained[applied.chained.length - 1].event;
      this.#onFinished(
        Object.freeze({
          gameId: this.id,
          mode: this.#game.mode,
          finishedAt: now,
          winnerSeat: applied.winner,
          endReason: applied.reason,
          turn: last.t,
          players: Object.freeze(this.#game.players.map((player) => Object.freeze({ seat: player.seat, userId: player.userId, account: player.account }))),
        }),
      );
    }
  }

  /**
   * Queues the finished game's result for the chain (inside the unit of work that records its end).
   * @param {any} applied
   */
  async #publishResult(applied) {
    if (this.#results === null) {
      return;
    }
    const last = applied.chained[applied.chained.length - 1];
    const accounts = SEATS.map((seat) => /** @type {{ account: string }} */ (this.#game.players.find((player) => player.seat === seat)).account);
    const payload = gameResultRecord({ gameId: this.id, mode: this.#game.mode, accounts, seq: last.event.i, head: last.head, winner: applied.winner, reason: applied.reason });
    await this.#results.enqueueResult({ network: this.#game.network, gameId: this.id, payload });
  }

  /** Tells both players what happened (each from their own perspective), and the result if the game ended. */
  #afterMove(applied) {
    this.#syncClock();
    for (const player of this.#game.players) {
      this.#notifier.send(player.userId, "game.events", { ...this.#viewFor(player.seat), events: redactEventsFor(applied.events, player.seat) });
      if (applied.over) {
        this.#notifier.send(player.userId, "game.over", { gameId: this.id, winner: applied.winner, reason: applied.reason, you: player.seat });
      }
    }
    this.#stream(applied);
  }

  /** Tells the spectators what the table now shows; lets them go when the game ends. */
  #stream(applied) {
    if (this.#spectators.size === 0) {
      return;
    }
    const update = { ...this.#spectatorView(), events: redactEventsFor(applied.events, SPECTATOR) };
    for (const userId of this.#spectators) {
      this.#notifier.send(userId, "watch.events", update);
      if (applied.over) {
        this.#notifier.send(userId, "watch.over", { gameId: this.id, winner: applied.winner, reason: applied.reason });
      }
    }
    if (applied.over) {
      this.#spectators.clear();
    }
  }

  #seats() {
    return Object.freeze(this.#game.players.map((player) => Object.freeze({ seat: player.seat, account: player.account })));
  }

  #spectatorView() {
    return Object.freeze({
      gameId: this.id,
      mode: this.#game.mode,
      status: this.#status,
      players: this.#seats(),
      version: this.#engine?.version ?? 0,
      lastSeq: this.#lastSeq,
      head: this.#recorder.head,
      snapshot: this.#engine === null ? null : this.#engine.getSnapshot(SPECTATOR),
      clock: this.#turnClock.view(),
      spectators: this.#spectators.size,
    });
  }

  /**
   * @param {string} seat
   * @param {string} entropy
   * @param {string} source
   */
  async #join(seat, entropy, source) {
    const joined = this.#recorder.joined({ seat, entropy, source, ms: this.#elapsed() });
    this.#entropies.set(seat, entropy);
    await this.#admit([joined], () => this.#repository.setEntropy(this.id, seat, entropy, source));
  }

  /**
   * Records a step of the game's setup (an entropy, a session key) and starts
   * the game in the same unit of work if that was the last thing it waited
   * for; otherwise tells both players where the setup stands.
   * @param {readonly import("@magic8/protocol").ChainedEvent[]} chained
   * @param {() => Promise<unknown>} alsoWrite
   */
  async #admit(chained, alsoWrite) {
    if (!this.#readyToStart()) {
      await this.#persist(chained, {}, alsoWrite);
      this.#announceSetup();
      return;
    }
    const started = this.#recorder.started({ ms: this.#elapsed() });
    const engine = this.#createEngine();
    const opening = engine.start();
    if (!opening.ok) {
      throw new Error(`game ${this.id}: the engine did not start (${opening.error.message})`);
    }
    const now = this.#clock.now();
    await this.#persist([...chained, started], { status: GameStatus.ACTIVE, version: engine.version, firstSeat: this.#recorder.firstSeat, startedAt: now }, alsoWrite);
    this.#engine = engine;
    this.#status = GameStatus.ACTIVE;
    this.#afterMove({ events: opening.value.events, over: false });
  }

  /** Every seat's entropy is in and, in v2, every seat has authorised a session key. */
  #readyToStart() {
    return this.#entropies.size === SEATS.length && this.#unauthorizedSeats().length === 0;
  }

  /** @returns {string[]} v2: the seats that have not authorised a session key yet (none in v1) */
  #unauthorizedSeats() {
    return this.signsMoves ? SEATS.filter((seat) => !this.#sessions.has(seat)) : [];
  }

  /** v2: while the game waits for its players, each one learns who has accepted it so far. */
  #announceSetup() {
    if (!this.signsMoves) {
      return;
    }
    for (const player of this.#game.players) {
      this.#notifier.send(player.userId, "game.state", this.#viewFor(player.seat));
    }
  }

  /**
   * Calls off a game that never started: the secret is revealed as the
   * protocol requires, nobody wins or loses, and both players are told which
   * seats did not accept it.
   * @param {string} reason an AbortReason
   * @param {readonly string[]} seats the seats that did not authorise their session key
   */
  async #abort(reason, seats) {
    const now = this.#clock.now();
    const chained = this.#recorder.aborted({ reason, started: false, clock: { turn: 0, ms: this.#elapsed() } });
    const results = Object.fromEntries(SEATS.map((seat) => [seat, "aborted"]));
    const summary = Object.freeze({ gameId: this.id, mode: this.#game.mode, reason, players: this.#game.players.map(({ seat, userId, account }) => Object.freeze({ seat, userId, account })) });
    await this.#persist([chained], { status: GameStatus.ABORTED, endReason: reason, finishedAt: now }, async () => {
      await this.#repository.setResults(this.id, results);
      await this.#onAborted(summary);
    });
    this.#status = GameStatus.ABORTED;
    this.#logger.info("game called off before it started", { game: this.id, reason, seats });
    for (const player of this.#game.players) {
      this.#notifier.send(player.userId, "game.aborted", { gameId: this.id, reason, seats: [...seats], you: player.seat });
    }
  }

  /**
   * @param {readonly import("@magic8/protocol").ChainedEvent[]} chained
   * @param {import("./ports.js").GameChanges} changes
   * @param {() => Promise<unknown>} alsoWrite
   */
  async #persist(chained, changes, alsoWrite) {
    try {
      await this.#unitOfWork(async () => {
        if (!(await this.#repository.appendEvents(this.id, this.#lastSeq, chained, changes))) {
          throw new Error(`game ${this.id}: another writer appended events`);
        }
        await alsoWrite();
      });
    } catch (error) {
      this.#broken = true;
      this.#onBroken(this.id);
      throw error;
    }
    this.#lastSeq = chained[chained.length - 1].event.i;
  }

  #createEngine() {
    const engine = createGameEngine({
      content: this.#content,
      accounts: this.#game.players.map((player) => player.account),
      decks: this.#game.players.map((player) => player.deck),
      firstSeat: this.#recorder.firstSeat,
      engineSeed: this.#recorder.engineSeed,
    });
    if (!engine.ok) {
      throw new Error(`game ${this.id}: the engine could not be built (${engine.error.message})`);
    }
    return engine.value;
  }

  /** Points the turn clock at whoever the engine now waits on. */
  #syncClock() {
    const snapshot = this.#engine?.getSnapshot(null);
    const awaiting = snapshot === undefined || snapshot.isOver ? null : snapshot.awaitingPlayerId;
    this.#turnClock.awaiting({ seat: awaiting, blocking: snapshot?.phase === GamePhase.COMBAT_BLOCKERS, now: this.#clock.now() });
  }

  /** @param {string} seat */
  #viewFor(seat) {
    const opponent = this.#game.players.find((player) => player.seat !== seat);
    return Object.freeze({
      gameId: this.id,
      seat,
      status: this.#status,
      opponent: Object.freeze({ account: opponent?.account ?? null }),
      seedCommit: this.#game.seedCommit,
      protocol: this.#recorder.version,
      entropyDeadline: this.#status === GameStatus.CREATED ? this.#entropyDeadline : null,
      ...this.#setupView(),
      version: this.#engine?.version ?? 0,
      lastSeq: this.#lastSeq,
      head: this.#recorder.head,
      snapshot: this.#engine === null ? null : this.#engine.getSnapshot(seat),
      clock: this.#turnClock.view(),
    });
  }

  /** v2: which seats have authorised a session key, and until when the other may (only while the game waits for its players). */
  #setupView() {
    if (!this.signsMoves) {
      return {};
    }
    const waiting = this.#status === GameStatus.CREATED;
    return {
      authorized: Object.freeze(Object.fromEntries(SEATS.map((seat) => [seat, this.#sessions.has(seat)]))),
      authorizeDeadline: waiting ? this.#authorizeDeadline : null,
    };
  }

  #elapsed() {
    return Math.max(0, this.#clock.now() - this.#game.createdAt);
  }

  /** @param {Ack} ack */
  #remember(ack) {
    this.#rejected.set(ack.commandId, ack);
    if (this.#rejected.size > REJECTED_ACK_CACHE) {
      this.#rejected.delete(/** @type {string} */ (this.#rejected.keys().next().value));
    }
    return ack;
  }

  /**
   * @template T
   * @param {() => Promise<T>} task
   * @returns {Promise<T>}
   */
  #enqueue(task) {
    const run = this.#mailbox.then(() => {
      if (this.#broken) {
        throw new Error(`game ${this.id}: actor is being rebuilt`);
      }
      return task();
    });
    this.#mailbox = run.catch(() => undefined);
    return run;
  }
}

/**
 * @param {string} code
 * @param {string} message
 */
function fail(code, message) {
  return Object.freeze({ ok: false, error: Object.freeze({ code, message }) });
}

/**
 * @param {string} commandId
 * @param {string} code
 * @param {string} message
 * @returns {Ack}
 */
function rejectedAck(commandId, code, message) {
  return Object.freeze({ commandId, ok: false, error: Object.freeze({ code, message }) });
}

/** @param {string | null} winner */
function resultsFor(winner) {
  const resultOf = (seat) => {
    if (winner === null) {
      return "draw";
    }
    return seat === winner ? "win" : "loss";
  };
  return Object.fromEntries(SEATS.map((seat) => [seat, resultOf(seat)]));
}

/**
 * The engine command a persisted event carries (MOVE: as the protocol version lays it out; FORCED_MOVE: its `cmd`), or null.
 * @param {import("@magic8/protocol").ProtocolEvent} event
 * @param {number} version game protocol version
 */
function commandOf(event, version) {
  if (event.k === "MOVE") {
    return commandOfMove(event.d, version);
  }
  return event.k === "FORCED_MOVE" ? /** @type {any} */ (event.d).cmd : null;
}

/** @param {unknown} value */
function safeJson(value) {
  try {
    return canonicalize(value);
  } catch {
    return "x".repeat(LIMITS.MAX_COMMAND_BYTES + 1);
  }
}
