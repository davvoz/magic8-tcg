/**
 * Schema migrations: `NNN_name.sql` files applied in order, all pending ones
 * in a single transaction (PostgreSQL DDL is transactional: a failure leaves
 * the schema untouched), recorded in `schema_migrations` with the SHA-256 of
 * the file. Line endings are normalised first, so a checkout with CRLF
 * (Windows) and one with LF hash the same.
 * An applied migration whose file has since changed stops the server: the
 * schema in production must be exactly what the repository says it is.
 * Concurrent starts are serialised by an advisory lock.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const MIGRATIONS_DIRECTORY = join(import.meta.dirname, "../../../migrations");
const FILE_PATTERN = /^(\d{3})_[a-z0-9_]+\.sql$/;
/** Arbitrary constant naming the migration lock. */
const MIGRATION_LOCK = 7_310_428;

export class MigrationError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "MigrationError";
  }
}

/**
 * @param {string} directory
 * @returns {readonly { id: string, sql: string, checksum: string }[]}
 */
export function readMigrations(directory = MIGRATIONS_DIRECTORY) {
  const names = readdirSync(directory).filter((name) => name.endsWith(".sql")).sort();
  return names.map((name, index) => {
    const match = FILE_PATTERN.exec(name);
    if (match === null || Number(match[1]) !== index + 1) {
      throw new MigrationError(`migration files must be numbered 001, 002 … without gaps: ${name}`);
    }
    const sql = readFileSync(join(directory, name), "utf8").replaceAll("\r\n", "\n");
    return Object.freeze({ id: name, sql, checksum: createHash("sha256").update(sql).digest("hex") });
  });
}

/**
 * @param {import("./Database.js").Database} database
 * @param {readonly { id: string, sql: string, checksum: string }[]} [migrations]
 * @returns {Promise<readonly string[]>} ids applied by this call
 */
export async function migrate(database, migrations = readMigrations()) {
  return database.transaction(async () => {
    await database.query("SELECT pg_advisory_xact_lock($1)", [MIGRATION_LOCK]);
    await database.exec("CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, checksum CHAR(64) NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())");
    const applied = new Map((await database.rows("SELECT id, checksum FROM schema_migrations")).map((row) => [row.id, row.checksum]));
    for (const id of applied.keys()) {
      if (!migrations.some((migration) => migration.id === id)) {
        throw new MigrationError(`the database has migration ${id}, which this version does not know`);
      }
    }
    const done = [];
    for (const migration of migrations) {
      const checksum = applied.get(migration.id);
      if (checksum === undefined) {
        await database.exec(migration.sql);
        await database.query("INSERT INTO schema_migrations (id, checksum) VALUES ($1, $2)", [migration.id, migration.checksum]);
        done.push(migration.id);
      } else if (checksum !== migration.checksum) {
        throw new MigrationError(`migration ${migration.id} was changed after being applied`);
      }
    }
    return Object.freeze(done);
  });
}
