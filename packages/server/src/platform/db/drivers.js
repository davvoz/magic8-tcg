/**
 * SQL drivers behind Database:
 * - PgDriver: a connection pool to a PostgreSQL server (production);
 * - PGliteDriver: PostgreSQL compiled to WebAssembly, in process (local
 *   development and tests). It has a single session, so every statement and
 *   every transaction runs under one mutex: a query from another request can
 *   never land inside someone else's open transaction.
 *
 * Both return BIGINT columns as JS numbers and refuse values beyond 2^53
 * (a silent rounding there would corrupt money or serials).
 */
import { mkdir } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import pg from "pg";

const INT8_OID = 20;

/** @param {string} text */
function parseInt8(text) {
  const value = Number(text);
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`BIGINT value ${text} is beyond the safe integer range`);
  }
  return value;
}

/** @typedef {import("./Database.js").SqlDriver} SqlDriver */

/** @implements {SqlDriver} */
export class PgDriver {
  #pool;
  #connectionString;
  #onError;

  /**
   * @param {{ connectionString: string, maxConnections?: number, onError: (error: Error) => void }} options
   */
  constructor({ connectionString, maxConnections = 10, onError }) {
    this.#connectionString = connectionString;
    this.#onError = onError;
    this.#pool = new pg.Pool({
      connectionString,
      max: maxConnections,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      statement_timeout: 15_000,
      application_name: "magic8-tcg",
      types: { getTypeParser: (oid, format) => (oid === INT8_OID && format !== "binary" ? parseInt8 : pg.types.getTypeParser(oid, format)) },
    });
    // An idle client can fail (server restart); without a listener that would crash the process.
    this.#pool.on("error", onError);
  }

  /** @param {string} text @param {readonly unknown[]} params */
  async query(text, params) {
    const result = await this.#pool.query(text, /** @type {unknown[]} */ ([...params]));
    return { rows: result.rows, rowCount: result.rowCount ?? 0 };
  }

  /** @param {string} text */
  async exec(text) {
    await this.#pool.query(text);
  }

  /**
   * @template T
   * @param {(session: import("./Database.js").SqlSession) => Promise<T>} work
   */
  async withSession(work) {
    const client = await this.#pool.connect();
    let broken = false;
    try {
      return await work({
        query: async (text, params) => {
          const result = await client.query(text, /** @type {unknown[]} */ ([...params]));
          return { rows: result.rows, rowCount: result.rowCount ?? 0 };
        },
        exec: async (text) => {
          await client.query(text);
        },
      });
    } catch (error) {
      broken = /** @type {{ brokenSession?: boolean }} */ (error).brokenSession === true;
      throw error;
    } finally {
      client.release(broken);
    }
  }

  /**
   * LISTEN on a connection of its own (a pooled one would be handed to
   * queries). A lost connection is reopened with backoff; `onReconnect`
   * then tells the caller that notifications may have been missed.
   * @param {string} channel checked by Database
   * @param {(payload: string) => void} onPayload
   * @param {import("./Database.js").ListenOptions} options
   */
  async listen(channel, onPayload, { onReconnect = () => undefined } = {}) {
    let stopped = false;
    let attempt = 0;
    /** @type {pg.Client | null} */
    let client = null;
    /** @type {ReturnType<typeof setTimeout> | null} */
    let retry = null;
    const open = async () => {
      const next = new pg.Client({ connectionString: this.#connectionString, application_name: "magic8-tcg-listen" });
      next.on("notification", (message) => {
        if (message.channel === channel) {
          onPayload(message.payload ?? "");
        }
      });
      next.on("error", (error) => lost(next, error));
      next.on("end", () => lost(next, new Error("listening connection ended")));
      await next.connect();
      await next.query(listenStatement(channel));
      client = next;
      attempt = 0;
    };
    const lost = (which, error) => {
      if (stopped || client !== which) {
        return;
      }
      client = null;
      which.end().catch(() => undefined);
      this.#onError(error);
      schedule();
    };
    const schedule = () => {
      const delay = LISTEN_BACKOFF_MS[Math.min(attempt, LISTEN_BACKOFF_MS.length - 1)];
      attempt += 1;
      retry = setTimeout(() => {
        retry = null;
        open().then(
          () => (stopped ? undefined : onReconnect()),
          (error) => {
            this.#onError(error);
            if (!stopped) {
              schedule();
            }
          },
        );
      }, delay);
      retry.unref?.();
    };
    await open();
    return async () => {
      stopped = true;
      if (retry !== null) {
        clearTimeout(retry);
      }
      const current = client;
      client = null;
      await current?.end().catch(() => undefined);
    };
  }

  async close() {
    await this.#pool.end();
  }
}

/**
 * LISTEN takes no parameters: the channel is quoted as an identifier
 * (Database.listen already admits only lowercase letters, digits and _).
 * @param {string} channel
 */
const listenStatement = (channel) => "LISTEN ".concat(pg.escapeIdentifier(channel));

/** Waits before reopening a lost listening connection. */
const LISTEN_BACKOFF_MS = Object.freeze([500, 1000, 2000, 5000, 10_000]);

/** @implements {SqlDriver} */
export class PGliteDriver {
  #db;
  /** @type {Promise<unknown>} */
  #queue = Promise.resolve();

  /** @param {PGlite} db an open instance; the driver owns it from now on */
  constructor(db) {
    this.#db = db;
  }

  /**
   * @param {string | undefined} dataDir a directory, or undefined for memory only
   */
  static async open(dataDir) {
    if (dataDir !== undefined) {
      await mkdir(dataDir, { recursive: true });
    }
    return new PGliteDriver(await PGlite.create({ ...(dataDir === undefined ? {} : { dataDir }), parsers: { [INT8_OID]: parseInt8 } }));
  }

  /** An independent copy (tests clone a migrated template instead of migrating again). */
  async clone() {
    return new PGliteDriver(/** @type {PGlite} */ (await this.#exclusive(() => this.#db.clone())));
  }

  /** @param {string} text @param {readonly unknown[]} params */
  query(text, params) {
    return this.#exclusive(() => this.#run(text, params));
  }

  /** @param {string} text */
  exec(text) {
    return this.#exclusive(() => this.#execRaw(text));
  }

  /**
   * @template T
   * @param {(session: import("./Database.js").SqlSession) => Promise<T>} work
   * @returns {Promise<T>}
   */
  withSession(work) {
    return this.#exclusive(() => work({ query: (text, params) => this.#run(text, params), exec: (text) => this.#execRaw(text) }));
  }

  /**
   * In process: nothing to reconnect. NOTIFY is delivered after the commit
   * of the transaction that sent it.
   * @param {string} channel checked by Database
   * @param {(payload: string) => void} onPayload
   */
  async listen(channel, onPayload) {
    const unlisten = await this.#exclusive(() => this.#db.listen(channel, onPayload));
    return () => this.#exclusive(() => unlisten());
  }

  close() {
    return this.#exclusive(() => this.#db.close());
  }

  /** @param {string} text @param {readonly unknown[]} params */
  async #run(text, params) {
    const result = await this.#db.query(text, /** @type {any[]} */ ([...params]));
    return { rows: /** @type {any[]} */ (result.rows), rowCount: result.affectedRows ?? result.rows.length };
  }

  /** @param {string} text */
  async #execRaw(text) {
    await this.#db.exec(text);
  }

  /**
   * @template T
   * @param {() => Promise<T>} task
   * @returns {Promise<T>}
   */
  #exclusive(task) {
    const run = this.#queue.then(task);
    this.#queue = run.catch(() => undefined);
    return run;
  }
}
