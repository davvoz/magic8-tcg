/**
 * A production server whose root account already published from another
 * database (tests run on the same account): its pack epochs start above the
 * numbers already taken on chain (M8_FIRST_EPOCH_ID), and its chain tracker
 * starts after the history it did not write (startChainTracking), so neither
 * a verifier nor the tracker mixes the two.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ConfigError, loadConfig } from "../../src/config.js";
import { startChainTracking } from "../../src/maintenance/startChainTracking.js";
import { buildTestApp } from "../helpers.js";

const DAY = 24 * 60 * 60 * 1000;

/** A history of `count` operations, served in pages like the chain does. */
function historyOf(count) {
  return {
    asked: 0,
    async publications(_account, after, limit) {
      this.asked += 1;
      const entries = [];
      for (let index = after + 1; index < count && entries.length < limit; index += 1) {
        entries.push({ index, operation: null });
      }
      return entries;
    },
  };
}

describe("a root account shared with another database", () => {
  it("numbers pack epochs from M8_FIRST_EPOCH_ID, then on", async () => {
    const setup = await buildTestApp({ env: { M8_FIRST_EPOCH_ID: "100" } });
    assert.equal((await setup.app.epochs.current()).id, 100);
    setup.clock.advance(30 * DAY);
    assert.equal((await setup.app.epochs.current()).id, 101, "the next one follows the database");
    assert.equal((await (await buildTestApp()).app.epochs.current()).id, 1, "1 by default");
  });

  it("refuses an M8_FIRST_EPOCH_ID that is not a positive integer", () => {
    for (const value of ["0", "-3", "1.5", "abc", "99999999999"]) {
      assert.throws(() => loadConfig({ M8_FIRST_EPOCH_ID: value }), ConfigError, value);
    }
    assert.equal(loadConfig({}).firstEpochId, 1);
  });

  it("starts the tracker at the end of the history it did not write, once", async () => {
    const setup = await buildTestApp();
    const deps = { database: setup.database, network: "steem", clock: setup.clock };
    const history = historyOf(2500);
    const started = await startChainTracking({ ...deps, reader: history }, "verdu.green");
    assert.deepEqual(started, { account: "verdu.green", started: true, index: 2499, problem: null });
    assert.equal(history.asked, 3, "read to the end, page by page");
    const cursor = await setup.database.rows("SELECT position FROM chain_cursors WHERE name = 'tracker:steem:verdu.green'");
    assert.deepEqual(cursor.map((row) => row.position), [{ index: 2499 }]);

    const again = await startChainTracking({ ...deps, reader: historyOf(3000) }, "verdu.green");
    assert.deepEqual([again.started, again.index, again.problem], [false, 2499, "the tracker already follows this account"]);
    assert.equal((await startChainTracking({ ...deps, reader: historyOf(0) }, "nobody")).problem, "the account has no history: nothing to skip");
  });

  it("leaves alone an account this database already published with", async () => {
    const setup = await buildTestApp();
    await setup.database.query(
      "INSERT INTO blockchain_transactions (id, network, tx_id, purpose, signer, status, expiration, signed_tx) VALUES ('00000000-0000-4000-8000-000000000001', 'steem', 'tx1', 'RECEIPT', 'verdu.green', 'BROADCAST', now(), '{}')",
    );
    const refused = await startChainTracking({ database: setup.database, network: "steem", clock: setup.clock, reader: historyOf(10) }, "verdu.green");
    assert.deepEqual([refused.started, refused.problem], [false, "this database already published with this account"]);
  });
});
