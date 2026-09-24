/**
 * GameActor: the authoritative owner of one game (docs/tcg/01-architettura.md §7.3).
 *
 * Every input — a player's entropy or command, a timer tick, a connection
 * coming or going — goes through one mailbox and runs alone, so the game
 * state has no race conditions (T15). For each accepted input the protocol
 * events (GameRecorder: hash-chained, docs/tcg/03 §6.4) are persisted in one
 * unit of work with a compare-and-set on the last event sequence; only then
 * are the players told. If persisting fails, the actor reports itself broken
 * and the service rebuilds it from the database by replay.
 *
 * Players never choose their seat or player id: the seat comes from the
 * authenticated user (T1), the engine validates every command, and a
 * command must name the version it was decided on (STALE_VERSION otherwise).
 */
import { redactEventsFor } from "@magic8/engine/domain/game/GameSnapshot.js";
import { GamePhase } from "@magic8/engine/domain/game/GamePhase.js";
import { EntropySource, ForcedMoveReason, LIMITS, SEATS, bytesToHex, canonicalize, createGameEngine, utf8Length } from "@magic8/protocol";
import { CONCEDE_COMMAND, forcedCommandFor } from "../domain/forcedCommand.js";
import { TurnClock } from "../domain/TurnClock.js";

export const GameStatus = Object.freeze({ CREATED: "CREATED", ACTIVE: "ACTIVE", FINISHED: "FINISHED", ABORTED: "ABORTED" });

export const GameError = Object.freeze({
  NOT_IN_GAME: "NOT_IN_GAME",
  GAME_NOT_ACTIVE: "GAME_NOT_ACTIVE",
  STALE_VERSION: "STALE_VERSION",
  INVALID_COMMAND: "INVALID_COMMAND",
  INVALID_ENTROPY: "INVALID_ENTROPY",
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ENTROPY_PATTERN = /^[0-9a-f]{32}$/;
/** Forced moves one tick may make (a seat's whole turn is a handful of phases). */
const MAX_FORCED_PER_TICK = 20;
/** Acks of rejected commands kept in memory for idempotent re-sends (accepted ones are in the database). */
const REJECTED_ACK_CACHE = 64;

/**
 * @typedef {import("./ports.js").StoredGame} StoredGame
 * @typedef {Readonly<{ commandId: string, ok: boolean, version?: number, head?: string, error?: Readonly<{ code: string, message: string }> }>} Ack
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
  #sealer;
  #turnClock;
  #status;
  #lastSeq;
  #entropyDeadline;
  /** @type {Map<string, string>} seat → entropy */
  #entropies = new Map();
  /** @type {Map<string, Ack>} */
  #rejected = new Map();
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
   *   sealer: { afterAppend: (gameId: string, chained: readonly import("@magic8/protocol").ChainedEvent[]) => Promise<void> },
   * }} deps
   */
  constructor({ game, recorder, content, repository, notifier, clock, random, unitOfWork, logger, timePolicy, onBroken, onFinished, sealer }) {
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
    this.#sealer = sealer;
    this.#status = game.status;
    this.#lastSeq = game.lastEventSeq;
    this.#turnClock = new TurnClock(timePolicy, SEATS);
    this.#entropyDeadline = game.createdAt + timePolicy.entropyMs;
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

  /** @param {string} userId */
  seatOf(userId) {
    return this.#game.players.find((player) => player.userId === userId)?.seat ?? null;
  }

  /**
   * Rebuilds a started game from its persisted moves (restart, or after a failed write).
   * @param {readonly import("@magic8/protocol").ProtocolEvent[]} events
   */
  replay(events) {
    if (this.#status !== GameStatus.ACTIVE) {
      return;
    }
    this.#engine = this.#createEngine();
    this.#engine.start();
    for (const event of events) {
      const command = commandOf(event);
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
        return { ok: true };
      }
      await this.#join(seat, entropy, EntropySource.CLIENT);
      return { ok: true };
    });
  }

  /**
   * @param {string} userId
   * @param {{ commandId: unknown, expectedVersion: unknown, command: unknown }} request
   * @returns {Promise<Ack>}
   */
  command(userId, request) {
    return this.#enqueue(() => this.#handleCommand(userId, request));
  }

  /**
   * @param {string} userId
   * @param {{ commandId: unknown, expectedVersion: unknown, command: unknown }} request
   * @returns {Promise<Ack>}
   */
  async #handleCommand(userId, { commandId, expectedVersion, command }) {
    if (typeof commandId !== "string" || !UUID_PATTERN.test(commandId)) {
      return rejectedAck(String(commandId).slice(0, 36), GameError.INVALID_COMMAND, "commandId must be a UUID");
    }
    const earlier = this.#rejected.get(commandId) ?? (await this.#repository.findAck(this.id, commandId));
    if (earlier !== null && earlier !== undefined) {
      return /** @type {Ack} */ (earlier);
    }
    const refused = this.#refuse(userId, expectedVersion, command);
    if (refused !== null) {
      return this.#remember(rejectedAck(commandId, refused.code, refused.message));
    }
    const seat = /** @type {string} */ (this.seatOf(userId));
    const applied = this.#apply(seat, /** @type {Record<string, unknown>} */ (command), null);
    if (!applied.ok) {
      return this.#remember(rejectedAck(commandId, applied.error.code, applied.error.message));
    }
    /** @type {Ack} */
    const ack = Object.freeze({ commandId, ok: true, version: applied.version, head: applied.chained[applied.chained.length - 1].head });
    await this.#commit(applied, { commandId, seat, expectedVersion: /** @type {number} */ (expectedVersion), payload: command, ack });
    this.#turnClock.acted(seat, this.#clock.now());
    this.#afterMove(applied);
    return ack;
  }

  /**
   * Forfeit, at whatever version the game is: read inside the mailbox, so conceding never goes stale.
   * @param {string} userId
   * @param {unknown} commandId
   * @returns {Promise<Ack>}
   */
  concede(userId, commandId) {
    return this.#enqueue(() => this.#handleCommand(userId, { commandId, expectedVersion: this.#engine?.version ?? 0, command: { type: "CONCEDE" } }));
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

  /** Timers: missing entropy, decisions that ran out of time, abandonment. */
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
   * Runs a command in the engine and builds its protocol events (not yet persisted).
   * @param {string} seat
   * @param {Readonly<Record<string, unknown>>} command
   * @param {string | null} forcedWhy
   */
  #apply(seat, command, forcedWhy) {
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
    const chained = [forcedWhy === null ? this.#recorder.move({ seat, command: accepted, clock }) : this.#recorder.forcedMove({ seat, command: accepted, reason: forcedWhy, clock })];
    if (after.isOver) {
      chained.push(this.#recorder.finished({ winner: after.winnerId, reason: after.endReason, engineVersion: engine.version, digest: engine.getStateDigest(), clock }));
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

  /** Tells both players what happened (each from their own perspective), and the result if the game ended. */
  #afterMove(applied) {
    this.#syncClock();
    for (const player of this.#game.players) {
      this.#notifier.send(player.userId, "game.events", { ...this.#viewFor(player.seat), events: redactEventsFor(applied.events, player.seat) });
      if (applied.over) {
        this.#notifier.send(player.userId, "game.over", { gameId: this.id, winner: applied.winner, reason: applied.reason, you: player.seat });
      }
    }
  }

  /**
   * @param {string} seat
   * @param {string} entropy
   * @param {string} source
   */
  async #join(seat, entropy, source) {
    const joined = this.#recorder.joined({ seat, entropy, source, ms: this.#elapsed() });
    this.#entropies.set(seat, entropy);
    if (this.#entropies.size < SEATS.length) {
      await this.#persist([joined], {}, () => this.#repository.setEntropy(this.id, seat, entropy, source));
      return;
    }
    const started = this.#recorder.started({ ms: this.#elapsed() });
    const engine = this.#createEngine();
    const opening = engine.start();
    if (!opening.ok) {
      throw new Error(`game ${this.id}: the engine did not start (${opening.error.message})`);
    }
    const now = this.#clock.now();
    await this.#persist([joined, started], { status: GameStatus.ACTIVE, version: engine.version, firstSeat: this.#recorder.firstSeat, startedAt: now }, () => this.#repository.setEntropy(this.id, seat, entropy, source));
    this.#engine = engine;
    this.#status = GameStatus.ACTIVE;
    this.#afterMove({ events: opening.value.events, over: false });
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
    await this.#sealer.afterAppend(this.id, chained);
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
      entropyDeadline: this.#status === GameStatus.CREATED ? this.#entropyDeadline : null,
      version: this.#engine?.version ?? 0,
      lastSeq: this.#lastSeq,
      head: this.#recorder.head,
      snapshot: this.#engine === null ? null : this.#engine.getSnapshot(seat),
      clock: this.#turnClock.view(),
    });
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
 * The engine command a persisted event carries (MOVE: the payload; FORCED_MOVE: its `cmd`), or null.
 * @param {import("@magic8/protocol").ProtocolEvent} event
 */
function commandOf(event) {
  if (event.k === "MOVE") {
    return event.d;
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
