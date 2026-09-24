/**
 * Opens the database named by configuration and brings its schema up to
 * date before the server accepts requests.
 *
 *   postgres://user:pass@host:5432/db?sslmode=require   a PostgreSQL server
 *   pglite:/absolute/or/relative/dir                     embedded, persisted in that directory
 *   pglite:memory                                        embedded, lost on exit
 */
import { resolve } from "node:path";

import { Database } from "./Database.js";
import { PgDriver, PGliteDriver } from "./drivers.js";
import { migrate } from "./migrate.js";

export const PGLITE_SCHEME = "pglite:";
const PGLITE_MEMORY = "memory";

/**
 * @param {{ url: string, baseDirectory: string, logger: import("../../kernel/logger.js").Logger }} options
 * @returns {Promise<Database>}
 */
export async function openDatabase({ url, baseDirectory, logger }) {
  const driver = await createDriver(url, baseDirectory, logger);
  const database = new Database(driver);
  try {
    const applied = await migrate(database);
    if (applied.length > 0) {
      logger.info("database migrated", { applied });
    }
  } catch (error) {
    await database.close();
    throw error;
  }
  return database;
}

/**
 * @param {string} url
 * @param {string} baseDirectory
 * @param {import("../../kernel/logger.js").Logger} logger
 * @returns {Promise<import("./Database.js").SqlDriver>}
 */
async function createDriver(url, baseDirectory, logger) {
  if (url.startsWith(PGLITE_SCHEME)) {
    const location = url.slice(PGLITE_SCHEME.length);
    return PGliteDriver.open(location === PGLITE_MEMORY ? undefined : resolve(baseDirectory, location));
  }
  return new PgDriver({ connectionString: url, onError: (error) => logger.error("idle database connection failed", { error }) });
}
