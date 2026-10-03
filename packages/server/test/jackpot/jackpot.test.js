/**
 * Season jackpots on the real services: the live jackpot (two thirds of the
 * bank, 65/25/10 to the first three settled ratings), its growth since the
 * season opened, the settlement once the season is over (once), and prizes
 * closed only by the exact transfer on the chain.
 */
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { uuidV4 } from "../../src/kernel/random.js";
import { NotificationKind } from "../../src/modules/notifications/index.js";
import { buildTestApp, bundledContent, deterministicRandom } from "../helpers.js";

const BANK = "verdu.green";
const SEASON = "s1";
const ENDS_AT = Date.UTC(2026, 8, 25);

describe("season jackpot", () => {
  /** @type {Awaited<ReturnType<typeof buildTestApp>>} */
  let setup;
  /** @type {Record<string, string>} account → user id */
  const ids = {};

  before(async () => {
    const bundled = await bundledContent();
    const ranked = structuredClone(bundled.ranked);
    ranked.seasons = [
      { id: "beta", name: "Beta season", startsAt: "2026-09-01T00:00:00Z" },
      { id: SEASON, name: "Season 1", startsAt: "2026-09-20T00:00:00Z", endsAt: new Date(ENDS_AT).toISOString().replace(".000", ""), prizePool: "bank-jackpot" },
    ];
    setup = await buildTestApp({ content: { ...bundled, ranked } });
    setup.chain.setAccount(BANK, ["STM-bank"]);
    setup.chain.balances.set(BANK, { STEEM: 1_000_000, SBD: 0 });
    // Settled ratings win; carol's is still provisional.
    for (const [account, rating, games] of [["alice", 1700, 10], ["bob", 1600, 10], ["carol", 1650, 2], ["dave", 1500, 3]]) {
      const user = await setup.users.findOrCreate({ network: "steem", account }, setup.clock.now(), uuidV4(deterministicRandom(`user:${account}`)));
      ids[account] = user.id;
      await setup.database.query("INSERT INTO ratings (season, user_id, account, rating, rd, volatility, games, updated_at) VALUES ($1, $2, $3, $4, 60, 0.06, $5, now())", [SEASON, user.id, account, rating, games]);
    }
  });

  it("shows two thirds of the bank split 65/25/10 among the current leaders, growing with the bank", async () => {
    await setup.app.jackpot.runOnce(); // the season is running: its opening balance is kept
    setup.chain.balances.set(BANK, { STEEM: 1_300_000, SBD: 0 });
    setup.clock.advance(61_000); // the public view reads the bank at most once a minute

    const view = await setup.app.jackpot.view();
    assert.deepEqual([view.season.id, view.season.status, view.season.endsAt, view.bank, view.asset], [SEASON, "running", ENDS_AT, BANK, "STEEM"]);
    assert.equal(view.opening, "666.666", "two thirds of 1000.000 when the season opened");
    assert.equal(view.jackpot, "866.666", "two thirds of 1300.000 now");
    assert.deepEqual(
      view.places.map((place) => [place.place, place.percent, place.amount, place.account]),
      [[1, 65, "563.332", "alice"], [2, 25, "216.666", "bob"], [3, 10, "86.668", "dave"]],
      "the last place takes what rounding leaves",
    );
  });

  it("settles once after the season and its grace period, and tells the winners", async () => {
    setup.clock.advance(ENDS_AT - setup.clock.now() + 10 * 60_000);
    await setup.app.jackpot.runOnce();
    assert.equal((await setup.app.jackpot.view()).season.status, "settling", "within the grace period, late games may still be rated");

    setup.clock.advance(30 * 60_000);
    await setup.app.jackpot.runOnce();
    await setup.app.jackpot.runOnce();
    const prizes = await setup.database.rows("SELECT place, account, amount::integer AS amount, status FROM season_prizes ORDER BY place");
    assert.deepEqual(prizes, [
      { place: 1, account: "alice", amount: 563_332, status: "PENDING" },
      { place: 2, account: "bob", amount: 216_666, status: "PENDING" },
      { place: 3, account: "dave", amount: 86_668, status: "PENDING" },
    ]);
    const [notification] = await setup.database.rows("SELECT kind, data FROM notifications WHERE user_id = $1", [ids.alice]);
    assert.deepEqual([notification.kind, notification.data], [NotificationKind.SEASON_PRIZE, { season: "Season 1", place: 1, amount: "563.332", asset: "STEEM" }]);

    setup.chain.balances.set(BANK, { STEEM: 5_000_000, SBD: 0 });
    const view = await setup.app.jackpot.view();
    assert.deepEqual([view.season.status, view.jackpot, view.places[0].paid], ["settled", "866.666", "PENDING"], "frozen at the settlement");
  });

  it("closes a prize only with the exact transfer from the bank", async () => {
    await setup.app.prizePayouts.runOnce(); // the watcher reads the bank's history from now on
    const memo = (place) => `m8tcg prize ${SEASON} ${place}`;
    setup.ledger.transfer({ from: BANK, to: "alice", amount: "563.332 STEEM", memo: memo(1), time: setup.clock.now() });
    setup.ledger.transfer({ from: BANK, to: "bob", amount: "200.000 STEEM", memo: memo(2), time: setup.clock.now() });
    await setup.app.prizePayouts.runOnce();
    setup.ledger.finalize();
    await setup.app.prizePayouts.runOnce();

    const statuses = await setup.database.rows("SELECT place, status FROM season_prizes ORDER BY place");
    assert.deepEqual(statuses.map((row) => row.status), ["CONFIRMED", "PENDING", "PENDING"]);
    const flagged = await setup.database.rows("SELECT action, target_id FROM audit_logs WHERE action LIKE 'jackpot.prize_%' ORDER BY seq");
    assert.deepEqual(flagged.map((row) => [row.action, row.target_id]), [["jackpot.prize_sent", `${SEASON}:1`], ["jackpot.prize_mismatch", `${SEASON}:2`], ["jackpot.prize_confirmed", `${SEASON}:1`]]);
  });
});
