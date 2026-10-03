/**
 * Ranked entries end to end (docs/tcg/22): two real clients on a real
 * server, a person at each Keychain. Without entries the ranked queue says
 * no; entries are bought in the shop with a single Keychain transfer, however
 * many; each ranked game takes one from both players when it is created, and
 * a game refused in Keychain gives them back.
 */
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { bundledContent } from "../helpers.js";
import { onlineWorld, until } from "./onlineHarness.js";

const SEASON = "paid-season";

/** The bundled data with one ranked season running, charging an entry a game, open to everyone. */
async function paidSeason() {
  const bundled = await bundledContent();
  const ranked = structuredClone(bundled.ranked);
  ranked.eligibility.minFinishedCasualGames = 0;
  ranked.seasons = [{ id: SEASON, name: "Paid season", startsAt: "2026-09-01T00:00:00Z", entryFee: 1 }];
  return { ...bundled, ranked };
}

describe("ranked entries (two real clients, real server)", () => {
  /** @type {Awaited<ReturnType<typeof onlineWorld>> | null} */
  let world = null;
  after(() => world?.close());

  /**
   * A player buys `quantity` entries from the shop: one Keychain prompt, for all of them.
   * @param {Awaited<ReturnType<Awaited<ReturnType<typeof onlineWorld>>["player"]>>} player
   * @param {number} quantity
   */
  const buyEntries = async (player, quantity) => {
    await player.shop.load();
    const buying = player.shop.buy({ productId: "ranked_entry", quantity, asset: "STEEM" });
    await until(() => player.keychain.open.length === 1, `${player.account} is asked to pay`);
    assert.equal(player.keychain.open[0].message, `transfer ${quantity}.000 STEEM to ${world?.setup.config.shopAccounts.steem}`, "one transfer for every entry, to the bank");
    player.keychain.approve();
    const bought = await buying;
    assert.equal(bought.ok, true, JSON.stringify(bought));
    assert.deepEqual(player.shop.state.purchase.order?.fulfilment?.entries, [{ kind: "ranked", count: quantity }]);
  };
  /** @param {Awaited<ReturnType<Awaited<ReturnType<typeof onlineWorld>>["player"]>>[]} players */
  const balances = async (...players) => {
    for (const player of players) {
      await player.entries.refresh();
    }
    return players.map((player) => player.entries.ranked?.balance);
  };

  it("buys entries with one Keychain transfer, takes one per player per game, and gives them back when a game is refused", async () => {
    world = await onlineWorld({ content: await paidSeason() });
    const w = world;
    const alice = await w.player("alice");
    const bob = await w.player("bob");
    await w.setup.app.settlement.poll("steem"); // the shop's watcher starts reading the bank

    await alice.entries.refresh();
    assert.deepEqual(alice.entries.ranked, { kind: "ranked", balance: 0, perGame: 1, season: SEASON });
    assert.equal((await alice.online.queue(alice.deckId, "ranked")).ok, false);
    assert.equal(alice.online.state.error?.code, "ENTRY_REQUIRED");
    assert.match(alice.online.state.error?.message ?? "", /a ranked game costs 1 ranked entry: buy them in the shop/);
    assert.equal(alice.online.state.status, "idle");

    await buyEntries(alice, 3);
    await buyEntries(bob, 1);
    assert.deepEqual(await balances(alice, bob), [3, 1]);
    assert.deepEqual([alice.keychain.shown, bob.keychain.shown], [1, 1], "one Keychain prompt each, whatever the number of entries");

    // A game is found: each pays one entry; bob refuses it in Keychain, and both get theirs back.
    await alice.online.queue(alice.deckId, "ranked");
    await bob.online.queue(bob.deckId, "ranked");
    await until(() => alice.keychain.open.length === 1 && bob.keychain.open.length === 1, "each is asked to sign the game");
    assert.deepEqual(await balances(alice, bob), [2, 0]);
    bob.keychain.refuse();
    await until(() => alice.online.state.status === "cancelled" && bob.online.state.status === "cancelled", "the game is called off");
    assert.deepEqual(await balances(alice, bob), [3, 1], "nobody pays for a game that never started");
    alice.keychain.approve(); // her prompt was still open: an answer for a game that is gone changes nothing

    // Again, and both sign: the game starts, with its entries taken.
    await alice.online.queue(alice.deckId, "ranked");
    await bob.online.queue(bob.deckId, "ranked");
    await until(() => alice.keychain.open.length === 1 && bob.keychain.open.length === 1, "each is asked to sign again");
    alice.keychain.approve();
    bob.keychain.approve();
    await until(() => alice.online.state.status === "playing" && bob.online.state.status === "playing", "the ranked game starts");
    assert.deepEqual(await balances(alice, bob), [2, 0]);
    assert.deepEqual([alice.keychain.shown, bob.keychain.shown], [3, 3], "the purchase, then one signature per game");

    // Bob has none left: the ranked queue tells him, and the next game must wait for his next purchase.
    assert.equal((await bob.online.queue(bob.deckId, "ranked")).ok, false);
  });
});
