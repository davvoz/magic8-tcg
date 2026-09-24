/**
 * The chain side of a game, for players and verifiers:
 * - `index`: where each of its records is (transaction, block) — a hint
 *   anyone can use to find the records without scanning the chain;
 * - `verify`: the server itself verifying the game from the chain alone,
 *   with the same code a player runs in the browser or the CLI. It reads
 *   only irreversible blocks and the root account's manifests; the database
 *   contributes nothing but the index of blocks to read.
 */
import { GAME_ID_PATTERN, HistoryStatus, verifyGameOnChain } from "@magic8/protocol";

export class GameVerification {
  #repository;
  #reader;
  #rootAccount;
  #fetchContent;

  /**
   * @param {{
   *   repository: import("../infrastructure/PgChainRepository.js").PgChainRepository,
   *   reader: import("./ports.js").PublicationReader | null,
   *   rootAccount: string,
   *   fetchContent: (hash: string) => Promise<string | null>,
   * }} deps
   */
  constructor({ repository, reader, rootAccount, fetchContent }) {
    this.#repository = repository;
    this.#reader = reader;
    this.#rootAccount = rootAccount;
    this.#fetchContent = fetchContent;
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
    const result = await verifyGameOnChain({ gameId: index.gameId, reader: this.#reader, rootAccount: this.#rootAccount, blocks: index.blocks, fetchContent: this.#fetchContent });
    return summarize(result);
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
