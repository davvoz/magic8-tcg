import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { parseTradeRecord, sha256Hex, utf8 } from "@magic8/protocol";
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
      assert.deepEqual(await migrate(database), ["001_initial.sql", "002_marketplace.sql", "003_gameplay.sql", "004_chain.sql", "005_operations.sql", "006_ranked.sql", "007_trading.sql", "008_sales.sql", "009_notifications.sql", "010_games_off_chain.sql", "011_game_results.sql", "012_no_foil.sql"]);
      assert.deepEqual(await migrate(database), [], "nothing left to apply");
      assert.ok((await database.rows("SELECT id FROM schema_migrations")).length === 12);
    } finally {
      await database.close();
    }
  });

  it("drops the game records still waiting to be published, and keeps everything else", async () => {
    const database = new Database(await PGliteDriver.open(undefined));
    try {
      const all = readMigrations();
      await migrate(database, all.filter((migration) => migration.id < "010"));
      const through010 = all.filter((migration) => migration.id < "011");
      const tx = "11111111-1111-4111-8111-111111111111";
      await database.query("INSERT INTO blockchain_transactions (id, network, tx_id, purpose, signer, status, expiration, signed_tx) VALUES ($1, 'steem', 'aa', 'GAME_RECORDS', 'b1', 'BROADCAST', now(), '{}')", [tx]);
      const insert = ({ gameId, seq, status, transaction = null }) =>
        database.query("INSERT INTO blockchain_events (network, kind, game_id, record_seq, payload, payload_hash, status, transaction_id) VALUES ('steem', 'GAME_RECORD', $1, $2, $3, $4, $5, $6)", [gameId, seq, `{"n":${seq}}`, String(seq).padStart(64, "0"), status, transaction]);
      await insert({ gameId: "g1", seq: 0, status: "BUILT" });
      await insert({ gameId: "g1", seq: 1, status: "BROADCAST", transaction: tx });
      await insert({ gameId: "g0", seq: 0, status: "IRREVERSIBLE" });
      await database.query("INSERT INTO blockchain_events (network, kind, payload, payload_hash, status) VALUES ('steem', 'EPOCH', '{}', $1, 'BUILT')", ["e".repeat(64)]);
      await database.query("INSERT INTO chain_alerts (network, kind, details, fingerprint) VALUES ('steem', 'REPEATED_REBROADCAST', $1, 'x'), ('steem', 'RC_CRITICAL', '{}', 'y')", [JSON.stringify({ gameId: "g1" })]);

      assert.deepEqual(await migrate(database, through010), ["010_games_off_chain.sql"]);
      const left = await database.rows("SELECT kind, game_id, status FROM blockchain_events ORDER BY id");
      assert.deepEqual(left.map((row) => [row.kind, row.game_id, row.status]), [["GAME_RECORD", "g0", "IRREVERSIBLE"], ["EPOCH", null, "BUILT"]]);
      assert.equal((await database.rows("SELECT status FROM blockchain_transactions"))[0].status, "EXPIRED");
      assert.deepEqual((await database.rows("SELECT kind FROM chain_alerts WHERE resolved_at IS NULL")).map((row) => row.kind), ["RC_CRITICAL"]);
      await assert.rejects(database.query("DELETE FROM blockchain_events"), "records may still never be deleted");
    } finally {
      await database.close();
    }
  });

  it("removes foil: cancels unpaid foil orders, maps the others to the standard single, strips copies, pending records and notifications", async () => {
    const database = new Database(await PGliteDriver.open(undefined));
    try {
      const all = readMigrations();
      await migrate(database, all.filter((migration) => migration.id < "012"));
      const [{ id: user }] = await database.rows(USER, ["alice"]);
      await database.query("INSERT INTO content_versions (hash, engine_version, payload) VALUES ($1, '1', '{}')", ["c".repeat(64)]);
      await database.query("INSERT INTO card_definitions (id, first_content_hash, data) VALUES ('pyre_drake', $1, '{}')", ["c".repeat(64)]);
      for (const id of ["single_pyre_drake", "single_pyre_drake_foil"]) {
        await database.query("INSERT INTO products (id, kind, name, active) VALUES ($1, 'single', $1, true)", [id]);
        await database.query("INSERT INTO product_prices (product_id, asset, amount) VALUES ($1, 'STEEM', 2500)", [id]);
        await database.query("INSERT INTO product_items (product_id, position, item_type, ref, count, finish) VALUES ($1, 0, 'card', 'pyre_drake', 1, $2)", [id, id.endsWith("_foil") ? "foil" : null]);
      }
      const order = async (n, status, productId) => {
        const id = `00000000-0000-4000-8000-00000000000${n}`;
        await database.query(
          "INSERT INTO orders (id, user_id, status, network, asset, total_amount, receiver, memo, expires_at, idempotency_key, request_hash, payer) VALUES ($1, $2, $3, 'steem', 'STEEM', 5000, 'shop', $4, now(), $4, $5, 'alice')",
          [id, user, status, `memo${n}`, "a".repeat(64)],
        );
        await database.query("INSERT INTO order_items (order_id, position, product_id, quantity, unit_amount) VALUES ($1, 0, $2, 1, 5000)", [id, productId]);
      };
      await order(1, "PAYMENT_PENDING", "single_pyre_drake_foil");
      await order(2, "FULFILLED", "single_pyre_drake_foil");
      await order(3, "PAYMENT_PENDING", "single_pyre_drake");
      await database.query(
        "INSERT INTO card_instances (id, definition_id, edition, serial, finish, owner_id, origin_kind, origin_ref) VALUES ('00000000-0000-4000-8000-0000000000c1', 'pyre_drake', 'core-1', 1, 'foil', $1, 'purchase', 'o2'), ('00000000-0000-4000-8000-0000000000c2', 'pyre_drake', 'core-1', 2, 'standard', $1, 'grant', 'g')",
        [user],
      );
      const card = (serial, code) => `["00000000-0000-4000-8000-00000000000${serial}","pyre_drake",${serial},"${code}"]`;
      const pending = `{"a":{"cards":[${card(1, "f")},${card(2, "s")}],"u":"alice"},"b":{"cards":[${card(3, "s")}],"u":"bob"},"t":"0000000a-0000-4000-8000-000000000001","v":1}`;
      const published = `{"b":"bob","c":${card(4, "f")},"p":"1.000 STEEM","s":"alice","t":"0000000a-0000-4000-8000-000000000002","v":1,"x":"${"ab".repeat(20)}"}`;
      await database.query("INSERT INTO blockchain_events (network, kind, payload, payload_hash, status) VALUES ('steem', 'TRADE', $1, $2, 'BUILT'), ('steem', 'SALE', $3, $4, 'IRREVERSIBLE')", [pending, "1".repeat(64), published, "2".repeat(64)]);
      await database.query("INSERT INTO notifications (user_id, kind, data, created_at) VALUES ($1, 'sale.sold', $2, now())", [user, JSON.stringify({ card: { definitionId: "pyre_drake", serial: 7, finish: "foil" }, price: "1.000" })]);

      assert.deepEqual(await migrate(database, all), ["012_no_foil.sql"]);
      const orders = await database.rows("SELECT o.id, o.status, i.product_id, i.unit_amount FROM orders o JOIN order_items i ON i.order_id = o.id ORDER BY o.id");
      assert.deepEqual(
        orders.map((row) => [row.id.slice(-1), row.status, row.product_id, Number(row.unit_amount)]),
        [["1", "CANCELLED", "single_pyre_drake", 5000], ["2", "FULFILLED", "single_pyre_drake", 5000], ["3", "PAYMENT_PENDING", "single_pyre_drake", 5000]],
        "unpaid foil orders are cancelled, history keeps the price paid",
      );
      assert.deepEqual((await database.rows("SELECT id FROM products")).map((row) => row.id), ["single_pyre_drake"]);
      assert.deepEqual((await database.rows("SELECT definition_id, serial FROM card_instances ORDER BY serial")).map((row) => [row.definition_id, row.serial]), [["pyre_drake", 1], ["pyre_drake", 2]]);
      assert.deepEqual(await database.rows("SELECT definition_id, copies FROM collections"), [{ definition_id: "pyre_drake", copies: 2 }]);
      const events = await database.rows("SELECT kind, payload, payload_hash FROM blockchain_events ORDER BY id");
      assert.equal(events[0].payload, `{"a":{"cards":[["00000000-0000-4000-8000-000000000001","pyre_drake",1],["00000000-0000-4000-8000-000000000002","pyre_drake",2]],"u":"alice"},"b":{"cards":[["00000000-0000-4000-8000-000000000003","pyre_drake",3]],"u":"bob"},"t":"0000000a-0000-4000-8000-000000000001","v":1}`);
      assert.ok(parseTradeRecord(events[0].payload), "a pending record becomes a valid record");
      assert.equal(events[0].payload_hash, sha256Hex(utf8(events[0].payload)));
      assert.deepEqual([events[1].payload, events[1].payload_hash], [published, "2".repeat(64)], "a record on chain is history");
      assert.deepEqual((await database.rows("SELECT data FROM notifications"))[0].data, { card: { definitionId: "pyre_drake", serial: 7 }, price: "1.000" });
      await assert.rejects(database.query("UPDATE blockchain_events SET payload = '{}'"), "records are immutable again");
    } finally {
      await database.close();
    }
  });

  it("refuses to remove foil while a paid foil order waits for its cards", async () => {
    const database = new Database(await PGliteDriver.open(undefined));
    try {
      const all = readMigrations();
      await migrate(database, all.filter((migration) => migration.id < "012"));
      const [{ id: user }] = await database.rows(USER, ["alice"]);
      await database.query("INSERT INTO products (id, kind, name) VALUES ('single_pyre_drake_foil', 'single', 'x')");
      await database.query(
        "INSERT INTO orders (id, user_id, status, network, asset, total_amount, receiver, memo, expires_at, idempotency_key, request_hash, payer) VALUES ('00000000-0000-4000-8000-000000000001', $1, 'PAYMENT_VERIFIED', 'steem', 'STEEM', 5000, 'shop', 'm', now(), 'k', $2, 'alice')",
        [user, "a".repeat(64)],
      );
      await database.query("INSERT INTO order_items (order_id, position, product_id, quantity, unit_amount) VALUES ('00000000-0000-4000-8000-000000000001', 0, 'single_pyre_drake_foil', 1, 5000)");
      await assert.rejects(migrate(database, all), /paid order of a foil single is not fulfilled yet/);
      assert.equal((await database.rows("SELECT column_name FROM information_schema.columns WHERE table_name = 'card_instances' AND column_name = 'finish'")).length, 1, "nothing changed");
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
