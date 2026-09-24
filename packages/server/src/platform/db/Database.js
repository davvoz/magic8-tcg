/**
 * The one way application code talks to PostgreSQL.
 *
 * Queries are always parameterised (`$1`, `$2` …): there is no API that
 * splices values into SQL text. `transaction(fn)` runs `fn` on a single
 * connection between BEGIN and COMMIT (ROLLBACK on any error); every query
 * issued while `fn` runs — also by other modules' services it calls — joins
 * that transaction, tracked with AsyncLocalStorage. That is the UnitOfWork:
 * a use case spanning several modules (e.g. grant a starter: mint cards,
 * create a deck, write the audit entry) commits or fails as a whole, and
 * each module still only calls the others' public services.
 *
 * Nested `transaction` calls join the outer one. A failure inside aborts the
 * whole transaction: callers must not catch a database error and carry on
 * inside the same unit of work.
 *
 * @typedef {Readonly<Record<string, any>>} Row
 * @typedef {{ rows: readonly Row[], rowCount: number }} QueryResult
 * @typedef {{
 *   query: (text: string, params: readonly unknown[]) => Promise<QueryResult>,
 *   exec: (text: string) => Promise<void>,
 * }} SqlSession
 * @typedef {SqlSession & {
 *   withSession: <T>(work: (session: SqlSession) => Promise<T>) => Promise<T>,
 *   close: () => Promise<void>,
 * }} SqlDriver
 */
import { AsyncLocalStorage } from "node:async_hooks";

import { DbError, DbErrorCode, toDbError } from "./DbError.js";

export class Database {
  #driver;
  /** @type {AsyncLocalStorage<SqlSession>} */
  #current = new AsyncLocalStorage();

  /** @param {SqlDriver} driver */
  constructor(driver) {
    this.#driver = driver;
  }

  /** True while running inside `transaction`. */
  get inTransaction() {
    return this.#current.getStore() !== undefined;
  }

  /**
   * @param {string} text SQL with $n placeholders
   * @param {readonly unknown[]} [params]
   * @returns {Promise<QueryResult>}
   */
  async query(text, params = []) {
    try {
      return await this.#session().query(text, params);
    } catch (error) {
      throw toDbError(error);
    }
  }

  /**
   * @param {string} text
   * @param {readonly unknown[]} [params]
   * @returns {Promise<readonly Row[]>}
   */
  async rows(text, params = []) {
    return (await this.query(text, params)).rows;
  }

  /**
   * The first row, or null when there is none.
   * @param {string} text
   * @param {readonly unknown[]} [params]
   * @returns {Promise<Row | null>}
   */
  async maybeOne(text, params = []) {
    return (await this.query(text, params)).rows[0] ?? null;
  }

  /**
   * Runs SQL without parameters, possibly several statements (migrations).
   * @param {string} text
   */
  async exec(text) {
    try {
      await this.#session().exec(text);
    } catch (error) {
      throw toDbError(error);
    }
  }

  /**
   * @template T
   * @param {() => Promise<T>} work
   * @returns {Promise<T>}
   */
  async transaction(work) {
    if (this.inTransaction) {
      return work();
    }
    return this.#driver.withSession(async (session) => {
      await session.exec("BEGIN");
      let result;
      try {
        result = await this.#current.run(session, work);
      } catch (error) {
        // The work's own error goes back unchanged (an AppError stays an AppError).
        await this.#rollback(session, error);
        throw error;
      }
      try {
        await session.exec("COMMIT");
      } catch (error) {
        throw toDbError(error);
      }
      return result;
    });
  }

  async close() {
    await this.#driver.close();
  }

  /**
   * @param {SqlSession} session
   * @param {unknown} cause the failure that aborted the work
   */
  async #rollback(session, cause) {
    try {
      await session.exec("ROLLBACK");
    } catch (rollbackError) {
      // The connection is unusable: report it so the driver discards it instead of pooling it.
      const broken = new DbError(DbErrorCode.UNKNOWN, "rollback failed after an aborted transaction", { cause });
      broken.brokenSession = true;
      broken.rollbackError = rollbackError;
      throw broken;
    }
  }

  #session() {
    return this.#current.getStore() ?? this.#driver;
  }
}

/**
 * Timestamps cross the boundary as epoch milliseconds in the domain and as
 * Date objects in SQL parameters and results.
 * @param {number} ms
 */
export const toTimestamp = (ms) => new Date(ms);

/**
 * @param {unknown} value a timestamptz column
 * @returns {number}
 */
export function fromTimestamp(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new TypeError("expected a timestamp column");
  }
  return value.getTime();
}

/**
 * @param {unknown} value a nullable timestamptz column
 * @returns {number | null}
 */
export const fromNullableTimestamp = (value) => (value === null || value === undefined ? null : fromTimestamp(value));
