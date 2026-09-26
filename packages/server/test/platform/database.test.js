import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { Database } from "../../src/platform/db/Database.js";
import { DbError, DbErrorCode, toDbError } from "../../src/platform/db/DbError.js";
import { PGliteDriver } from "../../src/platform/db/drivers.js";
import { MigrationError, migrate, readMigrations } from "../../src/platform/db/migrate.js";
import { freshDatabase } from "../support/database.js";

const USER = "INSERT INTO users (network, account) VALUES ('steem', $1) RETURNING id";

describe("Database transactions", () => {
  it("commits on success and rolls back everything on failure", async () => {
    const database = await freshDatabase();
    await database.transaction(async () => {
      await database.query(USER, ["alice"]);
      await database.query(USER, ["bob"]);
    });
    await assert.rejects(
      database.transaction(async () => {
        await database.query(USER, ["carol"]);
        await database.query(USER, ["alice"]);
      }),
      (error) => error instanceof DbError && error.isUniqueViolationOf("users_network_account_key"),
    );
    const accounts = (await database.rows("SELECT account FROM users ORDER BY account")).map((row) => row.account);
    assert.deepEqual(accounts, ["alice", "bob"], "carol went away with the failed transaction");
  });

  it("joins nested transactions, so a use case spanning services commits once", async () => {
    const database = await freshDatabase();
    const inner = () => database.transaction(async () => database.query(USER, ["dave"]));
    await assert.rejects(
      database.transaction(async () => {
        assert.equal(database.inTransaction, true);
        await inner();
        throw new Error("a later step failed");
      }),
      /a later step failed/,
    );
    assert.equal(database.inTransaction, false);
    assert.equal((await database.rows("SELECT id FROM users")).length, 0, "the inner write was rolled back with the outer one");
  });

  it("keeps concurrent statements out of an open transaction", async () => {
    const database = await freshDatabase();
    let release;
    const gate = new Promise((resolve) => (release = resolve));
    const transaction = database.transaction(async () => {
      await database.query(USER, ["erin"]);
      await gate;
      throw new Error("roll back");
    });
    const outside = database.query(USER, ["frank"]);
    release();
    await assert.rejects(transaction);
    await outside;
    const accounts = (await database.rows("SELECT account FROM users")).map((row) => row.account);
    assert.deepEqual(accounts, ["frank"], "frank's insert did not ride along with the rolled-back transaction");
  });

  it("returns BIGINT as numbers and refuses values beyond 2^53", async () => {
    const database = await freshDatabase();
    assert.equal((await database.maybeOne("SELECT 9007199254740991::bigint AS n")).n, 9_007_199_254_740_991);
    await assert.rejects(database.query("SELECT 9007199254740993::bigint AS n"), /safe integer/);
  });

  it("translates SQLSTATE codes", () => {
    assert.equal(toDbError({ code: "23505", constraint: "x", message: "dup" }).code, DbErrorCode.UNIQUE_VIOLATION);
    assert.equal(toDbError({ code: "23503" }).code, DbErrorCode.FOREIGN_KEY_VIOLATION);
    assert.equal(toDbError({ code: "40001" }).code, DbErrorCode.SERIALIZATION_FAILURE);
    assert.equal(toDbError({ code: "42501" }).code, DbErrorCode.FORBIDDEN_MUTATION);
    assert.equal(toDbError(new Error("socket hang up")).code, DbErrorCode.UNKNOWN);
    const original = new DbError(DbErrorCode.CHECK_VIOLATION, "c");
    assert.equal(toDbError(original), original);
  });
});

describe("migrations", () => {
  async function directoryWith(files) {
    const directory = await mkdtemp(join(tmpdir(), "m8-migrations-"));
    for (const [name, sql] of Object.entries(files)) {
      await writeFile(join(directory, name), sql);
    }
    return directory;
  }

  it("applies the repository's migrations once and is idempotent", async () => {
    const database = new Database(await PGliteDriver.open(undefined));
    try {
      assert.deepEqual(await migrate(database), ["001_initial.sql", "002_marketplace.sql", "003_gameplay.sql", "004_chain.sql", "005_operations.sql", "006_ranked.sql", "007_trading.sql", "008_sales.sql", "009_notifications.sql"]);
      assert.deepEqual(await migrate(database), [], "nothing left to apply");
      assert.ok((await database.rows("SELECT id FROM schema_migrations")).length === 9);
    } finally {
      await database.close();
    }
  });

  it("hashes CRLF and LF checkouts alike", async () => {
    const lf = readMigrations(await directoryWith({ "001_a.sql": "CREATE TABLE a (id INT);\nCREATE TABLE b (id INT);\n" }));
    const crlf = readMigrations(await directoryWith({ "001_a.sql": "CREATE TABLE a (id INT);\r\nCREATE TABLE b (id INT);\r\n" }));
    assert.equal(lf[0].checksum, crlf[0].checksum);
  });

  it("refuses gaps, edited migrations and migrations it does not know", async () => {
    const gapped = await directoryWith({ "001_a.sql": "", "003_c.sql": "" });
    assert.throws(() => readMigrations(gapped), MigrationError);
    const database = new Database(await PGliteDriver.open(undefined));
    try {
      await migrate(database, readMigrations(await directoryWith({ "001_a.sql": "CREATE TABLE a (id INT);" })));
      await assert.rejects(migrate(database, readMigrations(await directoryWith({ "001_a.sql": "CREATE TABLE a (id BIGINT);" }))), /changed after being applied/);
      await assert.rejects(migrate(database, []), /does not know/);
      await assert.rejects(
        migrate(database, readMigrations(await directoryWith({ "001_a.sql": "CREATE TABLE a (id INT);", "002_b.sql": "CREATE TABLE b (id INT); SELECT broken FROM nowhere;" }))),
        (error) => error instanceof DbError,
      );
      assert.equal((await database.rows("SELECT tablename FROM pg_tables WHERE tablename = 'b'")).length, 0, "a failing migration leaves no trace");
    } finally {
      await database.close();
    }
  });
});
