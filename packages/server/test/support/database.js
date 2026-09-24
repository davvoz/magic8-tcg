/**
 * Test database: real PostgreSQL (PGlite, in process), migrated once per
 * test process. An in-memory PGlite instance costs hundreds of megabytes,
 * so each test file shares one and `freshDatabase()` empties every table
 * (TRUNCATE bypasses the append-only row triggers) before a test. Tests in a
 * file run one after another, so they never see each other's rows. The
 * instance holds no handles, so the test process exits without closing it.
 */
import { Database } from "../../src/platform/db/Database.js";
import { PGliteDriver } from "../../src/platform/db/drivers.js";
import { migrate } from "../../src/platform/db/migrate.js";

/** @type {Promise<{ database: Database, truncate: string }> | null} */
let shared = null;

function open() {
  shared ??= (async () => {
    const database = new Database(await PGliteDriver.open(undefined));
    await migrate(database);
    const tables = await database.rows("SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'schema_migrations' ORDER BY tablename");
    return { database, truncate: `TRUNCATE TABLE ${tables.map((row) => `"${row.tablename}"`).join(", ")} RESTART IDENTITY CASCADE` };
  })();
  return shared;
}

/** The process's migrated database, with every table empty. */
export async function freshDatabase() {
  const { database, truncate } = await open();
  await database.exec(truncate);
  return database;
}
