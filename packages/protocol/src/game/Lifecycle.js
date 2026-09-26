/**
 * Order in which event kinds may appear in a game
 * (docs/tcg/03-game-blockchain-protocol.md §14, step 8):
 *
 *   GAME_CREATED (i = 0)
 *   → PLAYER_JOINED once per seat, any order
 *   → GAME_STARTED
 *   → MOVE | FORCED_MOVE | STATE_CHECKPOINT …
 *   → GAME_FINISHED
 * GAME_ABORTED may end the game at any point after GAME_CREATED.
 * SESSION (v2) may come from a seat at any point before the end: a player
 * authorises a session key when joining, and a new one after losing theirs.
 * Nothing may follow a terminal event.
 */
import { EventKind, SEATS } from "./constants.js";

export const LifecyclePhase = Object.freeze({
  EMPTY: "EMPTY",
  JOINING: "JOINING",
  READY: "READY",
  PLAYING: "PLAYING",
  FINISHED: "FINISHED",
  ABORTED: "ABORTED",
});

/** @typedef {typeof LifecyclePhase[keyof typeof LifecyclePhase]} Phase */

/** Kinds allowed in each phase and the phase they lead to. */
const TRANSITIONS = Object.freeze({
  [LifecyclePhase.EMPTY]: { [EventKind.GAME_CREATED]: LifecyclePhase.JOINING },
  [LifecyclePhase.JOINING]: { [EventKind.PLAYER_JOINED]: LifecyclePhase.JOINING, [EventKind.SESSION]: LifecyclePhase.JOINING, [EventKind.GAME_ABORTED]: LifecyclePhase.ABORTED },
  [LifecyclePhase.READY]: { [EventKind.GAME_STARTED]: LifecyclePhase.PLAYING, [EventKind.SESSION]: LifecyclePhase.READY, [EventKind.GAME_ABORTED]: LifecyclePhase.ABORTED },
  [LifecyclePhase.PLAYING]: {
    [EventKind.SESSION]: LifecyclePhase.PLAYING,
    [EventKind.MOVE]: LifecyclePhase.PLAYING,
    [EventKind.FORCED_MOVE]: LifecyclePhase.PLAYING,
    [EventKind.STATE_CHECKPOINT]: LifecyclePhase.PLAYING,
    [EventKind.GAME_FINISHED]: LifecyclePhase.FINISHED,
    [EventKind.GAME_ABORTED]: LifecyclePhase.ABORTED,
  },
  [LifecyclePhase.FINISHED]: {},
  [LifecyclePhase.ABORTED]: {},
});

export class Lifecycle {
  /** @type {Phase} */
  #phase = LifecyclePhase.EMPTY;
  /** @type {Set<string>} */
  #joined = new Set();
  #startedBeforeAbort = false;

  get phase() {
    return this.#phase;
  }

  get isTerminal() {
    return this.#phase === LifecyclePhase.FINISHED || this.#phase === LifecyclePhase.ABORTED;
  }

  /** True once GAME_STARTED was accepted (moves may exist and decks must be revealed). */
  get hasStarted() {
    return this.#phase === LifecyclePhase.PLAYING || this.#phase === LifecyclePhase.FINISHED || (this.#phase === LifecyclePhase.ABORTED && this.#startedBeforeAbort);
  }

  /**
   * @param {import("./EventChain.js").ProtocolEvent} event
   * @returns {string | null} a problem description, or null when the event is allowed
   */
  accept(event) {
    const next = TRANSITIONS[this.#phase][event.k];
    if (next === undefined) {
      return `${event.k} is not allowed while the game is ${this.#phase}`;
    }
    if (event.k === EventKind.GAME_CREATED && event.i !== 0) {
      return "GAME_CREATED must be the first event";
    }
    if (event.k === EventKind.PLAYER_JOINED) {
      return this.#join(/** @type {string} */ (event.a));
    }
    if (event.k === EventKind.GAME_ABORTED) {
      this.#startedBeforeAbort = this.#phase === LifecyclePhase.PLAYING;
    }
    this.#phase = next;
    return null;
  }

  /**
   * @param {string} seat
   * @returns {string | null}
   */
  #join(seat) {
    if (this.#joined.has(seat)) {
      return `seat ${seat} joined twice`;
    }
    this.#joined.add(seat);
    this.#phase = this.#joined.size === SEATS.length ? LifecyclePhase.READY : LifecyclePhase.JOINING;
    return null;
  }
}
