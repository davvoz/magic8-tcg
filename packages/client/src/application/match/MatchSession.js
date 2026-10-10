/**
 * Owns a running match: the engine plus one controller per seat.
 *
 * - `submit(command)` is the entry point for the input layer (human seats).
 * - After every committed command the session looks at who the engine is
 *   waiting on; if that seat is non-human it asks the controller and submits
 *   its command, paced through the Scheduler port. This is the only loop in
 *   the application layer, and where a remote controller would plug in.
 * - Listeners receive `{ events, version }` after each command and fetch
 *   perspective snapshots through `snapshotFor`. The engine itself is never
 *   exposed.
 * - A session built with an `openingToss` shows it before the first turn:
 *   the match screen plays the toss, then calls `begin()`, so the AI never
 *   moves while the coin is still in the air.
 * - A session can set its own `pace` for the non-human seats (a replay's,
 *   whose speed the player picks), and with no human seat a `viewerId`: the
 *   seat whose side the board shows, though nobody plays it.
 */
import { fail, ok } from "@magic8/engine/shared/Result.js";
import { CommandError } from "@magic8/engine/domain/commands/CommandError.js";
import { concede } from "@magic8/engine/domain/commands/commandFactories.js";
import { redactEventsFor } from "@magic8/engine/domain/game/GameSnapshot.js";
import { ControllerKind } from "./PlayerController.contract.js";

/** Consecutive non-human decisions allowed before the session gives up on a misbehaving controller. */
const MAX_CONSECUTIVE_AI_DECISIONS = 200;

/**
 * @typedef {Readonly<{ events: readonly Readonly<Record<string, unknown>>[], version: number, playerId: string | null }>} SessionUpdate
 * @typedef {{ wait: () => Promise<void> }} MovePace what a non-human seat waits on before each move
 */

export class MatchSession {
  #engine;
  /** @type {Map<string, import("./PlayerController.contract.js").PlayerController>} */
  #controllers;
  #scheduler;
  #logger;
  #aiDelayMs;
  /** @type {MovePace | null} */
  #pace;
  /** @type {string | null} */
  #viewerId;
  /** @type {import("./CoinToss.js").CoinToss | null} */
  #openingToss;
  /** The STEEM account playing each seat that has one. @type {ReadonlyMap<string, string>} */
  #accounts;
  #started = false;
  /** @type {Set<(update: SessionUpdate) => void>} */
  #listeners = new Set();
  /** Serialises drive runs so a submit during a pending drive is never lost. @type {Promise<void>} */
  #drive = Promise.resolve();
  #stopped = false;

  /**
   * @param {{ engine: import("@magic8/engine/domain/game/GameEngine.js").GameEngine, controllers: ReadonlyMap<string, import("./PlayerController.contract.js").PlayerController>, scheduler: import("../ports/Scheduler.contract.js").Scheduler, logger: import("../ports/Logger.contract.js").Logger, aiDelayMs?: number, pace?: MovePace | null, viewerId?: string | null, openingToss?: import("./CoinToss.js").CoinToss | null, accounts?: ReadonlyMap<string, string> }} deps
   *   `pace`: what the non-human seats wait on before each move, instead of `aiDelayMs`;
   *   `viewerId`: with no human seat, the seat whose side the board shows (null: a spectator's board);
   *   `openingToss`: the toss that seated the engine's first player, to be shown before the match begins;
   *   `accounts`: the STEEM account playing each seat that has one (the signed-in player; never the AI)
   */
  constructor({ engine, controllers, scheduler, logger, aiDelayMs = 0, pace = null, viewerId = null, openingToss = null, accounts = new Map() }) {
    this.#engine = engine;
    this.#controllers = new Map(controllers);
    this.#scheduler = scheduler;
    this.#logger = logger;
    this.#aiDelayMs = aiDelayMs;
    this.#pace = pace;
    this.#viewerId = viewerId;
    this.#openingToss = openingToss;
    this.#accounts = new Map(accounts);
  }

  get isOver() {
    return this.#engine.isOver;
  }

  /** True once stop() was called: no further commands are accepted or driven. */
  get isStopped() {
    return this.#stopped;
  }

  get version() {
    return this.#engine.version;
  }

  /** The coin toss to show before the first turn; null once the match has begun (or when nobody tossed). */
  get openingToss() {
    return this.#started ? null : this.#openingToss;
  }

  /** No decision clock offline: practice and hot-seat matches are untimed. */
  get clock() {
    return null;
  }

  /** The pace the non-human seats keep, when the session was given one. */
  get pace() {
    return this.#pace;
  }

  /** With no human seat, the seat whose side the board shows; null for a spectator's board. */
  get viewerId() {
    return this.#viewerId;
  }

  /** Ids of seats driven by humans, in seating order. */
  get humanPlayerIds() {
    return Object.freeze([...this.#controllers].filter(([, controller]) => controller.kind === ControllerKind.HUMAN).map(([id]) => id));
  }

  /**
   * @param {(update: SessionUpdate) => void} listener
   * @returns {() => void} unsubscribe
   */
  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Starts the match and lets non-human seats act if they are up first. */
  start() {
    const result = this.#engine.start();
    if (result.ok) {
      this.#started = true;
      this.#publish(result.value.events, result.value.version, null);
      this.#scheduleDrive();
    }
    return result;
  }

  /**
   * Starts the match unless it already has: what the match screen calls once
   * the opening (the coin toss) has been shown.
   */
  begin() {
    return this.#started ? ok(undefined) : this.start();
  }

  /**
   * Abandons the match: drops listeners and halts the controller loop. The
   * engine state is left as is (nothing is persisted for it).
   */
  stop() {
    this.#stopped = true;
    this.#listeners.clear();
  }

  /**
   * Submits a command on behalf of a human seat.
   * @param {unknown} command
   */
  submit(command) {
    if (this.#stopped) {
      return fail(CommandError.GAME_OVER, "the match was abandoned");
    }
    const playerId = typeof command === "object" && command !== null ? /** @type {Record<string, unknown>} */ (command).playerId : null;
    const result = this.#engine.execute(command);
    if (result.ok) {
      this.#publish(result.value.events, result.value.version, typeof playerId === "string" ? playerId : null);
      this.#scheduleDrive();
    }
    return result;
  }

  /** Resolves once no non-human decision is pending. */
  whenIdle() {
    return this.#drive;
  }

  /** @param {string | null} perspectivePlayerId */
  snapshotFor(perspectivePlayerId) {
    return this.#engine.getSnapshot(perspectivePlayerId);
  }

  /**
   * @param {readonly Readonly<Record<string, unknown>>[]} events
   * @param {string | null} perspectivePlayerId
   */
  eventsFor(events, perspectivePlayerId) {
    return redactEventsFor(events, perspectivePlayerId);
  }

  /** @param {string} playerId */
  controllerKindOf(playerId) {
    return this.#controllers.get(playerId)?.kind ?? null;
  }

  /**
   * The STEEM account playing a seat, whose name and profile picture the board shows; null for none.
   * @param {string} playerId
   * @returns {string | null}
   */
  accountOf(playerId) {
    return this.#accounts.get(playerId) ?? null;
  }

  #scheduleDrive() {
    this.#drive = this.#drive.then(() => this.#driveNonHumanSeats());
  }

  async #driveNonHumanSeats() {
    let decisions = 0;
    let next = this.#pendingNonHumanSeat();
    while (next !== null && !this.#stopped) {
      if (decisions >= MAX_CONSECUTIVE_AI_DECISIONS) {
        this.#abandonSeat(next.playerId, "too many consecutive decisions");
        return;
      }
      await (this.#pace === null ? this.#scheduler.delay(this.#aiDelayMs) : this.#pace.wait());
      if (this.#stopped) {
        return;
      }
      this.#executeDecision(next);
      decisions += 1;
      next = this.#pendingNonHumanSeat();
    }
  }

  /** @returns {{ playerId: string, controller: import("./PlayerController.contract.js").PlayerController } | null} */
  #pendingNonHumanSeat() {
    const snapshot = this.#engine.getSnapshot(null);
    if (snapshot.isOver || snapshot.awaitingPlayerId === null) {
      return null;
    }
    const controller = this.#controllers.get(snapshot.awaitingPlayerId);
    if (controller === undefined || controller.kind === ControllerKind.HUMAN) {
      return null;
    }
    return { playerId: snapshot.awaitingPlayerId, controller };
  }

  /** @param {{ playerId: string, controller: import("./PlayerController.contract.js").PlayerController }} seat */
  #executeDecision({ playerId, controller }) {
    let command = null;
    try {
      command = controller.decide(this.#engine.getSnapshot(playerId));
    } catch (error) {
      this.#logger.error("controller threw while deciding", { playerId, error: error instanceof Error ? error.message : String(error) });
    }
    if (command === null) {
      this.#abandonSeat(playerId, "controller returned no command");
      return;
    }
    const result = this.#engine.execute(command);
    if (!result.ok) {
      this.#logger.error("controller produced an illegal command", { playerId, command, error: result.error });
      this.#abandonSeat(playerId, result.error.message);
      return;
    }
    this.#publish(result.value.events, result.value.version, playerId);
  }

  /**
   * A controller that cannot produce legal commands forfeits, so a bug can
   * never freeze the match.
   * @param {string} playerId
   * @param {string} reason
   */
  #abandonSeat(playerId, reason) {
    this.#logger.warn("seat abandoned; conceding", { playerId, reason });
    const result = this.#engine.execute(concede(playerId));
    if (result.ok) {
      this.#publish(result.value.events, result.value.version, playerId);
    }
  }

  /**
   * @param {readonly Readonly<Record<string, unknown>>[]} events
   * @param {number} version
   * @param {string | null} playerId
   */
  #publish(events, version, playerId) {
    const update = Object.freeze({ events, version, playerId });
    for (const listener of this.#listeners) {
      listener(update);
    }
  }
}
