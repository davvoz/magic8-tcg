/**
 * Replays a complete game history with the engine and checks that every
 * published checkpoint and the final outcome follow from the published moves
 * (docs/tcg/03-game-blockchain-protocol.md §14 steps 9–11).
 *
 * The history must already be structurally verified (assembleGameHistory →
 * COMPLETE). Content (rules and cards) is resolved by hash through an injected
 * resolver: the protocol does not know where content lives.
 */
import { EventKind, GameProtocol, SEATS } from "./constants.js";
import { deckCommitment, deriveEngineSeed, firstSeatFor, seedCommitment, stateCommitment, stateSalt } from "./commitments.js";
import { createGameEngine } from "./engineSetup.js";
import { HistoryStatus } from "./GameHistory.js";

export const ReplayStatus = Object.freeze({
  VALID: "VALID",
  NOT_REPLAYABLE: "NOT_REPLAYABLE",
  INVALID_REVEAL: "INVALID_REVEAL",
  UNKNOWN_CONTENT: "UNKNOWN_CONTENT",
  REPLAY_MISMATCH: "REPLAY_MISMATCH",
});

/**
 * @typedef {import("./engineSetup.js").GameContent} ReplayContent
 * @typedef {(contentHash: string, engineVersion: string) => ReplayContent | null} ContentResolver
 * @typedef {Readonly<{ status: string, message: string | null, eventSeq: number | null, outcome: Readonly<{ winner: string | null, reason: string | null }> | null, engineEvents: number }>} ReplayResult
 */

/**
 * @param {string} status
 * @param {string | null} message
 * @param {{ eventSeq?: number | null, outcome?: ReplayResult["outcome"], engineEvents?: number }} [extra]
 * @returns {ReplayResult}
 */
function result(status, message, { eventSeq = null, outcome = null, engineEvents = 0 } = {}) {
  return Object.freeze({ status, message, eventSeq, outcome, engineEvents });
}

/**
 * @param {readonly import("./EventChain.js").ChainedEvent[]} events
 * @param {string} kind
 */
function eventsOfKind(events, kind) {
  return events.map(({ event }) => event).filter((event) => event.k === kind);
}

/**
 * Checks the reveals of the terminal event against the commitments of GAME_CREATED.
 * @param {any} created GAME_CREATED payload
 * @param {any} terminal GAME_FINISHED / GAME_ABORTED payload
 * @param {boolean} started
 * @returns {string | null} problem
 */
function checkReveals(created, terminal, started) {
  if (seedCommitment(terminal.secret) !== created.seed_c) {
    return "the revealed secret does not match the seed commitment";
  }
  if (!started) {
    return null;
  }
  if (terminal.decks === undefined) {
    return "a started game must reveal both decks";
  }
  const mismatch = SEATS.findIndex((_, index) => deckCommitment(terminal.secret, index, terminal.decks[index]) !== created.deck_c[index]);
  return mismatch === -1 ? null : `the revealed deck of ${SEATS[mismatch]} does not match its commitment`;
}

/**
 * @param {import("./GameHistory.js").GameHistory} history
 * @param {ContentResolver} resolveContent
 * @returns {ReplayResult}
 */
export function replayGame(history, resolveContent) {
  if (history.status !== HistoryStatus.COMPLETE) {
    return result(ReplayStatus.NOT_REPLAYABLE, `history is ${history.status}`);
  }
  const events = history.events;
  const created = /** @type {any} */ (events[0].event.d);
  const terminal = events[events.length - 1].event;
  const reveal = checkReveals(created, terminal.d, history.started);
  if (reveal !== null) {
    return result(ReplayStatus.INVALID_REVEAL, reveal, { eventSeq: terminal.i });
  }
  if (!history.started) {
    return result(ReplayStatus.VALID, null);
  }
  const content = resolveContent(created.content, created.eng);
  if (content === null) {
    return result(ReplayStatus.UNKNOWN_CONTENT, `content ${created.content} for engine ${created.eng} is not available`);
  }
  return runReplay({ events, created, terminal, content, gameId: history.gameId, version: /** @type {number} */ (history.version) });
}

/**
 * @param {{ events: readonly import("./EventChain.js").ChainedEvent[], created: any, terminal: any, content: ReplayContent, gameId: string }} input
 * @returns {ReplayResult}
 */
function runReplay({ events, created, terminal, content, gameId, version }) {
  const entropies = SEATS.map((seat) => /** @type {any} */ (eventsOfKind(events, EventKind.PLAYER_JOINED).find((event) => event.a === seat)).d.ent);
  const secret = terminal.d.secret;
  const engineSeed = deriveEngineSeed({ secret, entropies, gameId });
  const started = /** @type {any} */ (eventsOfKind(events, EventKind.GAME_STARTED)[0]);
  const first = firstSeatFor(engineSeed);
  if (started.d.first !== first) {
    return result(ReplayStatus.INVALID_REVEAL, `the first player should be ${first}`, { eventSeq: started.i });
  }
  const setup = createGameEngine({ content, accounts: created.seats.map((/** @type {any} */ seat) => seat.acct), decks: terminal.d.decks, firstSeat: first, engineSeed });
  if (!setup.ok) {
    return result(ReplayStatus.REPLAY_MISMATCH, `the engine refused the revealed setup: ${setup.error.message}`, { eventSeq: started.i });
  }
  const engine = setup.value;
  const replayer = new Replayer(engine, stateSalt(secret), version);
  replayer.start();
  for (const { event } of events.slice(started.i + 1)) {
    const problem = replayer.apply(event);
    if (problem !== null) {
      return result(ReplayStatus.REPLAY_MISMATCH, problem, { eventSeq: event.i, engineEvents: replayer.engineEvents });
    }
  }
  const snapshot = engine.getSnapshot(null);
  return result(ReplayStatus.VALID, null, { outcome: Object.freeze({ winner: snapshot.winnerId, reason: snapshot.endReason }), engineEvents: replayer.engineEvents });
}

/** Applies protocol events to an engine and checks attestations. */
class Replayer {
  #engine;
  #salt;
  #version;
  #engineEvents = 0;

  /**
   * @param {import("@magic8/engine/domain/game/GameEngine.js").GameEngine} engine
   * @param {string} salt
   * @param {number} version game protocol version
   */
  constructor(engine, salt, version) {
    this.#engine = engine;
    this.#salt = salt;
    this.#version = version;
  }

  get engineEvents() {
    return this.#engineEvents;
  }

  start() {
    const started = this.#engine.start();
    this.#engineEvents += started.ok ? started.value.events.length : 0;
  }

  /**
   * @param {import("./EventChain.js").ProtocolEvent} event
   * @returns {string | null} problem
   */
  apply(event) {
    const data = /** @type {any} */ (event.d);
    switch (event.k) {
      case EventKind.MOVE:
        return this.#execute({ ...commandOfMove(data, this.#version), playerId: event.a });
      case EventKind.SESSION:
        return null;
      case EventKind.FORCED_MOVE:
        return this.#execute({ ...data.cmd, playerId: event.a });
      case EventKind.STATE_CHECKPOINT:
        return this.#checkState(data.ver, data.sc);
      case EventKind.GAME_FINISHED:
        return this.#checkOutcome(data);
      case EventKind.GAME_ABORTED:
        return null;
      default:
        return `unexpected ${event.k} after GAME_STARTED`;
    }
  }

  /** @param {Record<string, unknown>} command */
  #execute(command) {
    const executed = this.#engine.execute(command);
    if (!executed.ok) {
      return `the engine rejected the move: ${executed.error.code} ${executed.error.message}`;
    }
    this.#engineEvents += executed.value.events.length;
    return null;
  }

  /**
   * @param {number} version
   * @param {string} commitment
   */
  #checkState(version, commitment) {
    if (this.#engine.version !== version) {
      return `checkpoint at engine version ${version}, replay is at ${this.#engine.version}`;
    }
    return stateCommitment(this.#salt, this.#engine.getStateDigest()) === commitment ? null : "state commitment does not match the replayed state";
  }

  /** @param {any} data GAME_FINISHED payload */
  #checkOutcome(data) {
    const snapshot = this.#engine.getSnapshot(null);
    if (!snapshot.isOver) {
      return "GAME_FINISHED published but the replayed game is not over";
    }
    if (snapshot.winnerId !== data.win || snapshot.endReason !== data.why) {
      return `published outcome ${data.win}/${data.why}, replay gives ${snapshot.winnerId}/${snapshot.endReason}`;
    }
    return this.#checkState(data.ver, data.sc);
  }
}

/**
 * The engine command of a MOVE payload: the payload itself in v1, its `cmd` from v2 on.
 * @param {Readonly<Record<string, unknown>>} data
 * @param {number} version game protocol version
 * @returns {Readonly<Record<string, unknown>>}
 */
export function commandOfMove(data, version) {
  return version >= GameProtocol.V2 ? /** @type {Readonly<Record<string, unknown>>} */ (data.cmd) : data;
}
