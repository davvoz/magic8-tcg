/**
 * The chain side of a game, for players and verifiers:
 * - `index`: where each of its records is (transaction, block) — a hint
 *   anyone can use to find the records without scanning the chain;
 * - `verify`: the server itself verifying the game from the chain alone,
 *   with the same code a player runs in the browser or the CLI. It reads
 *   only irreversible blocks and the root account's manifests; the database
 *   contributes nothing but the index of blocks to read.
 *
 * Verifying reads the chain, so it is bounded: at most `maxConcurrent` at
 * once (others are told to retry), a VALID result is kept (irreversible
 * blocks cannot change it), any other result for a minute.
 */
import { GAME_ID_PATTERN, HistoryStatus, verifyGameOnChain } from "@magic8/protocol";

export class VerificationBusyError extends Error {
  constructor() {
    super("too many verifications in progress");
    this.name = "VerificationBusyError";
  }
}

const FINAL_CACHE_SIZE = 1000;
const RETRY_CACHE_MS = 60_000;

export class GameVerification {
  #verifyMoveSignature;
  #recoverSigner;
  #repository;
  #reader;
  #rootAccount;
  #fetchContent;
  #clock;
  #maxConcurrent;
  #running = 0;
  /** @type {Map<string, { result: Readonly<Record<string, unknown>>, until: number }>} */
  #cache = new Map();

  /**
   * @param {{
   *   repository: import("../infrastructure/PgChainRepository.js").PgChainRepository,
   *   reader: import("./ports.js").PublicationReader | null,
   *   rootAccount: string,
   *   fetchContent: (hash: string) => Promise<string | null>,
   *   clock: import("../../../kernel/time.js").Clock,
   *   maxConcurrent?: number,
   *   verifyMoveSignature?: (message: string, signature: string, key: string) => boolean,
   *   recoverSigner?: (message: string, signature: string) => string | null,
   * }} deps the two signature checks are needed for games in protocol v2 (signed moves)
   */
  constructor({ repository, reader, rootAccount, fetchContent, clock, maxConcurrent = 2, verifyMoveSignature, recoverSigner }) {
    this.#verifyMoveSignature = verifyMoveSignature;
    this.#recoverSigner = recoverSigner;
    this.#repository = repository;
    this.#reader = reader;
    this.#rootAccount = rootAccount;
    this.#fetchContent = fetchContent;
    this.#clock = clock;
    this.#maxConcurrent = maxConcurrent;
  }

  get rootAccount() {
    return this.#rootAccount;
  }

  /**
   * @param {unknown} gameId
   * @returns {Promise<Readonly<{ gameId: string, rootAccount: string, records: readonly unknown[], blocks: readonly number[] }> | null>} null for an unknown game
   */
  async index(gameId) {
    if (typeof gameId !== "string" || !GAME_ID_PATTERN.test(gameId)) {
      return null;
    }
    const records = await this.#repository.gameIndex(gameId);
    if (records.length === 0) {
      return null;
    }
    const blocks = [...new Set(records.map((record) => record.blockNum).filter((blockNum) => blockNum !== null))].sort((left, right) => left - right);
    return Object.freeze({ gameId, rootAccount: this.#rootAccount, records, blocks: Object.freeze(blocks) });
  }

  /**
   * @param {unknown} gameId
   * @returns {Promise<Readonly<Record<string, unknown>> | null>} null for an unknown game
   */
  async verify(gameId) {
    const index = await this.index(gameId);
    if (index === null) {
      return null;
    }
    if (this.#reader === null) {
      throw new Error("no chain reader configured");
    }
    const cached = this.#cache.get(index.gameId);
    if (cached !== undefined && cached.until > this.#clock.now()) {
      return cached.result;
    }
    if (this.#running >= this.#maxConcurrent) {
      throw new VerificationBusyError();
    }
    this.#running += 1;
    try {
      const result = summarize(await verifyGameOnChain({ gameId: index.gameId, reader: this.#reader, rootAccount: this.#rootAccount, blocks: index.blocks, fetchContent: this.#fetchContent, verifyMoveSignature: this.#verifyMoveSignature, recoverSigner: this.#recoverSigner }));
      this.#remember(index.gameId, result);
      return result;
    } finally {
      this.#running -= 1;
    }
  }

  /**
   * @param {string} gameId
   * @param {Readonly<Record<string, unknown>>} result
   */
  #remember(gameId, result) {
    const final = result.verdict === "VALID";
    this.#cache.delete(gameId);
    this.#cache.set(gameId, { result, until: final ? Number.POSITIVE_INFINITY : this.#clock.now() + RETRY_CACHE_MS });
    while (this.#cache.size > FINAL_CACHE_SIZE) {
      this.#cache.delete(/** @type {string} */ (this.#cache.keys().next().value));
    }
  }
}

/**
 * What a player needs to read a verification: the verdict, the first
 * problem if any, and what was checked.
 * @param {Awaited<ReturnType<typeof verifyGameOnChain>>} result
 */
export function summarize(result) {
  const { history, replay } = result;
  return Object.freeze({
    verdict: result.verdict,
    history: Object.freeze({ status: history.status, problem: history.problem, records: history.records.length, events: history.events.length, duplicates: history.duplicates }),
    signatures: result.signatures,
    sessions: result.sessions,
    replay: replay === null ? null : Object.freeze({ status: replay.status, message: replay.message, eventSeq: replay.eventSeq, outcome: replay.outcome, engineEvents: replay.engineEvents }),
    rejected: result.rejected,
    broadcasters: result.broadcasters,
    content: result.content,
    irreversibleBlock: result.head.irreversibleBlock,
    pendingBlocks: result.pendingBlocks,
    missingBlocks: result.missingBlocks,
    complete: history.status === HistoryStatus.COMPLETE,
  });
}
