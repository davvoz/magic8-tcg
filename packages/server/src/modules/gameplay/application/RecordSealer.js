/**
 * RecordSealer: closes a game's pending events into protocol records and
 * hands them to the outbox (docs/tcg/03-game-blockchain-protocol.md §9).
 *
 * A record closes at once for lifecycle events (the start, the end) and for
 * a turn's checkpoint, when 64 events are pending, or when the oldest
 * pending event is older than 20 seconds (a periodic job). Sealing locks the
 * game row, so it never interleaves with the actor appending events; it runs
 * after the events are committed and never fails a move: whatever it could
 * not seal now, the periodic job seals later. The chain stays off the game's
 * critical path.
 */
import { EventKind, MAX_RECORD_BYTES, genesisHead, sealRecords } from "@magic8/protocol";
import { assertImplements } from "../../../kernel/contracts.js";
import { RECORD_STORE_METHODS } from "./ports.js";

export const DEFAULT_SEALING_POLICY = Object.freeze({
  maxPendingEvents: 64,
  maxPendingAgeMs: 20_000,
  maxRecordBytes: MAX_RECORD_BYTES,
});

/** The game is over: nothing more to count. */
const TERMINAL_KINDS = Object.freeze(new Set([EventKind.GAME_FINISHED, EventKind.GAME_ABORTED]));

/** Events after which the pending run is sealed immediately. */
const CLOSING_KINDS = Object.freeze(new Set([EventKind.GAME_STARTED, EventKind.STATE_CHECKPOINT, EventKind.GAME_FINISHED, EventKind.GAME_ABORTED]));

export class RecordSealer {
  #store;
  #outbox;
  #clock;
  #unitOfWork;
  #logger;
  #policy;
  /** @type {Map<string, number>} game → events appended since its last record (counted once from the database, then in memory) */
  #pending = new Map();

  /**
   * @param {{
   *   store: import("./ports.js").RecordStore,
   *   outbox: import("./ports.js").RecordOutbox,
   *   clock: import("../../../kernel/time.js").Clock,
   *   unitOfWork: import("../../../kernel/unitOfWork.js").UnitOfWork,
   *   logger: import("../../../kernel/logger.js").Logger,
   *   policy?: Partial<typeof DEFAULT_SEALING_POLICY>,
   * }} deps
   */
  constructor({ store, outbox, clock, unitOfWork, logger, policy = {} }) {
    assertImplements(store, RECORD_STORE_METHODS, "RecordStore");
    this.#store = store;
    this.#outbox = outbox;
    this.#clock = clock;
    this.#unitOfWork = unitOfWork;
    this.#logger = logger;
    this.#policy = Object.freeze({ ...DEFAULT_SEALING_POLICY, ...policy });
  }

  /**
   * Called after the actor committed `chained`: seals if the policy says so.
   * Never throws.
   * @param {string} gameId
   * @param {readonly import("@magic8/protocol").ChainedEvent[]} chained
   */
  async afterAppend(gameId, chained) {
    try {
      const known = this.#pending.get(gameId);
      const pending = known === undefined ? await this.#store.countUnsealed(gameId) : known + chained.length;
      this.#pending.set(gameId, pending);
      const closing = chained.some(({ event }) => CLOSING_KINDS.has(event.k));
      if (closing || pending >= this.#policy.maxPendingEvents) {
        await this.seal(gameId);
      }
      if (chained.some(({ event }) => TERMINAL_KINDS.has(event.k))) {
        this.#pending.delete(gameId);
      }
    } catch (error) {
      this.#logger.error("sealing game records failed; the periodic job will retry", { game: gameId, error: error instanceof Error ? error.message : String(error) });
    }
  }

  /**
   * Seals every pending event of a game into as few records as fit.
   * @param {string} gameId
   * @returns {Promise<number>} records sealed
   */
  seal(gameId) {
    return this.#unitOfWork(async () => {
      const game = await this.#store.lockForSealing(gameId);
      if (game === null) {
        return 0;
      }
      const pending = await this.#store.listUnsealed(gameId);
      if (pending.length === 0) {
        this.#pending.delete(gameId);
        return 0;
      }
      const firstSeq = pending[0].event.i;
      const previousHead = firstSeq === 0 ? genesisHead(gameId) : await this.#store.headAt(gameId, firstSeq - 1);
      if (previousHead === null) {
        throw new Error(`game ${gameId}: event ${firstSeq - 1} is missing`);
      }
      const records = sealRecords({
        gameId,
        firstRecordSeq: await this.#store.nextRecordSeq(gameId),
        previousHead,
        chained: pending,
        ts: this.#clock.now(),
        maxRecordBytes: this.#policy.maxRecordBytes,
        version: game.protocolVersion,
      });
      for (const record of records) {
        await this.#store.markSealed(gameId, record.firstEventSeq, record.lastEventSeq, record.seq);
      }
      await this.#outbox.enqueueGameRecords({ network: game.network, records });
      this.#pending.set(gameId, 0);
      return records.length;
    });
  }

  /**
   * Seals the games whose oldest pending event waited too long.
   * @returns {Promise<number>} records sealed
   */
  async sealStale() {
    let sealed = 0;
    for (const gameId of await this.#store.gamesWithUnsealedBefore(this.#clock.now() - this.#policy.maxPendingAgeMs)) {
      try {
        sealed += await this.seal(gameId);
      } catch (error) {
        this.#logger.error("sealing game records failed", { game: gameId, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return sealed;
  }
}
