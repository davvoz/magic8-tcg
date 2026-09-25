/**
 * Rebuilds one game's event history from records observed on the chain and
 * checks everything that does not need the engine
 * (docs/tcg/03-game-blockchain-protocol.md §14 steps 4–8, §15):
 *
 * - duplicates: same (game, record seq) with identical bytes → kept once;
 * - forks: same (game, record seq) with different bytes → FORK;
 * - gaps: missing record sequence numbers → INCOMPLETE;
 * - out-of-order inclusion: irrelevant, records are ordered by `s`;
 * - chaining: every `p` equals the previous `h`, every event hash is
 *   recomputed and must end at `h` → TAMPERED otherwise;
 * - lifecycle: event kinds appear in a legal order → MALFORMED otherwise;
 * - a history without a terminal event is IN_PROGRESS.
 */
import { EventKind } from "./constants.js";
import { genesisHead, nextHead } from "./EventChain.js";
import { Lifecycle } from "./Lifecycle.js";

export const HistoryStatus = Object.freeze({
  COMPLETE: "COMPLETE",
  IN_PROGRESS: "IN_PROGRESS",
  EMPTY: "EMPTY",
  INCOMPLETE: "INCOMPLETE",
  FORK: "FORK",
  TAMPERED: "TAMPERED",
  MALFORMED: "MALFORMED",
});

/**
 * @typedef {Readonly<{ record: Readonly<Record<string, any>>, json: string, source?: Readonly<Record<string, unknown>> }>} ObservedRecord
 * @typedef {Readonly<{ code: string, message: string, recordSeq: number | null, eventSeq: number | null }>} HistoryProblem
 * @typedef {Readonly<{
 *   gameId: string,
 *   status: string,
 *   problem: HistoryProblem | null,
 *   events: readonly import("./EventChain.js").ChainedEvent[],
 *   records: readonly ObservedRecord[],
 *   duplicates: number,
 *   terminal: string | null,
 *   started: boolean,
 *   version: number | null,
 * }>} GameHistory version: the game protocol version its records share
 */

/**
 * @param {string} code
 * @param {string} message
 * @param {{ recordSeq?: number | null, eventSeq?: number | null }} [where]
 * @returns {HistoryProblem}
 */
function problem(code, message, { recordSeq = null, eventSeq = null } = {}) {
  return Object.freeze({ code, message, recordSeq, eventSeq });
}

/**
 * Groups observations by record sequence, dropping identical duplicates.
 * @param {readonly ObservedRecord[]} observed
 * @returns {{ bySeq: Map<number, ObservedRecord>, duplicates: number, fork: HistoryProblem | null }}
 */
function deduplicate(observed) {
  const bySeq = new Map();
  let duplicates = 0;
  for (const item of observed) {
    const seq = item.record.s;
    const existing = bySeq.get(seq);
    if (existing === undefined) {
      bySeq.set(seq, item);
    } else if (existing.json === item.json) {
      duplicates += 1;
    } else {
      return { bySeq, duplicates, fork: problem(HistoryStatus.FORK, `two different records with sequence ${seq}`, { recordSeq: seq }) };
    }
  }
  return { bySeq, duplicates, fork: null };
}

/**
 * @param {string} gameId
 * @param {readonly ObservedRecord[]} observed records of this game, in any order
 * @returns {GameHistory}
 */
export function assembleGameHistory(gameId, observed) {
  const mine = observed.filter((item) => item.record.g === gameId);
  const { bySeq, duplicates, fork } = deduplicate(mine);
  const base = { gameId, duplicates };
  if (fork !== null) {
    return finish(base, { status: HistoryStatus.FORK, problem: fork });
  }
  if (bySeq.size === 0) {
    return finish(base, { status: HistoryStatus.EMPTY, problem: null });
  }
  const ordered = [...bySeq.keys()].sort((left, right) => left - right);
  const missing = ordered.findIndex((seq, index) => seq !== index);
  if (missing !== -1) {
    return finish(base, {
      status: HistoryStatus.INCOMPLETE,
      problem: problem(HistoryStatus.INCOMPLETE, `record ${missing} is missing`, { recordSeq: missing }),
      records: ordered.slice(0, missing).map((seq) => /** @type {ObservedRecord} */ (bySeq.get(seq))),
    });
  }
  return walk(base, gameId, ordered.map((seq) => /** @type {ObservedRecord} */ (bySeq.get(seq))));
}

/**
 * Recomputes the chain and the lifecycle over contiguous records.
 * @param {{ gameId: string, duplicates: number }} base
 * @param {string} gameId
 * @param {readonly ObservedRecord[]} records
 * @returns {GameHistory}
 */
function walk(base, gameId, records) {
  const lifecycle = new Lifecycle();
  /** @type {import("./EventChain.js").ChainedEvent[]} */
  const events = [];
  let head = genesisHead(gameId);
  const version = records[0].record.v;
  for (const { record } of records) {
    if (record.v !== version) {
      const mixed = problem(HistoryStatus.MALFORMED, `record ${record.s} is protocol v${record.v}, the game is v${version}`, { recordSeq: record.s });
      return finish(base, { status: mixed.code, problem: mixed, records, events, lifecycle });
    }
    const outcome = walkRecord({ record, head, events, lifecycle, gameId });
    if (outcome.problem !== null) {
      return finish(base, { status: outcome.problem.code, problem: outcome.problem, records, events, lifecycle });
    }
    head = outcome.head;
  }
  const status = lifecycle.isTerminal ? HistoryStatus.COMPLETE : HistoryStatus.IN_PROGRESS;
  return finish(base, { status, problem: null, records, events, lifecycle });
}

/**
 * Events of the record are appended to `events` only if the whole record checks out.
 * @param {{ record: Readonly<Record<string, any>>, head: string, events: import("./EventChain.js").ChainedEvent[], lifecycle: Lifecycle, gameId: string }} input
 * @returns {{ head: string, problem: HistoryProblem | null }}
 */
function walkRecord({ record, head, events, lifecycle, gameId }) {
  const recordSeq = record.s;
  if (record.p !== head) {
    return { head, problem: problem(HistoryStatus.TAMPERED, `record ${recordSeq} does not continue the chain`, { recordSeq }) };
  }
  let current = head;
  /** @type {import("./EventChain.js").ChainedEvent[]} */
  const accepted = [];
  for (const event of record.e) {
    const expected = events.length + accepted.length;
    if (event.i !== expected) {
      return { head, problem: problem(HistoryStatus.MALFORMED, `expected event ${expected}, found ${event.i}`, { recordSeq, eventSeq: event.i }) };
    }
    if (lifecycle.isTerminal) {
      return { head, problem: problem(HistoryStatus.MALFORMED, "events after the end of the game", { recordSeq, eventSeq: event.i }) };
    }
    const lifecycleProblem = lifecycle.accept(event);
    if (lifecycleProblem !== null) {
      return { head, problem: problem(HistoryStatus.MALFORMED, lifecycleProblem, { recordSeq, eventSeq: event.i }) };
    }
    current = nextHead(current, gameId, event, record.v);
    accepted.push(Object.freeze({ event, head: current }));
  }
  if (current !== record.h) {
    return { head, problem: problem(HistoryStatus.TAMPERED, `record ${recordSeq} declares a head its events do not produce`, { recordSeq }) };
  }
  events.push(...accepted);
  return { head: current, problem: null };
}

/**
 * @param {{ gameId: string, duplicates: number }} base
 * @param {{ status: string, problem: HistoryProblem | null, records?: readonly ObservedRecord[], events?: readonly import("./EventChain.js").ChainedEvent[], lifecycle?: Lifecycle }} outcome
 * @returns {GameHistory}
 */
function finish(base, { status, problem: found, records = [], events = [], lifecycle }) {
  const last = events.length > 0 ? events[events.length - 1].event.k : null;
  const terminal = last === EventKind.GAME_FINISHED || last === EventKind.GAME_ABORTED ? last : null;
  return Object.freeze({
    ...base,
    status,
    problem: found,
    records: Object.freeze([...records]),
    events: Object.freeze([...events]),
    terminal,
    started: lifecycle?.hasStarted ?? false,
    version: records.length > 0 ? records[0].record.v : null,
  });
}
