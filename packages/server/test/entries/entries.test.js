/**
 * Ranked entries (docs/tcg/22-ingressi-ranked.md): bought in the shop with
 * one payment, taken from both players by each ranked game of a season with
 * an entry fee, given back when a game is called off before it starts;
 * casual games and seasons without a fee cost nothing.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { uuidV4 } from "../../src/kernel/random.js";
import { validateRankedSettings } from "../../src/modules/ranking/index.js";
import { buildTestApp, bundledContent, deterministicRandom, keyPair, listen } from "../helpers.js";
import { ApiClient } from "../support/apiClient.js";

const MINUTE = 60 * 1000;
const SEASON = "paid-season";

/**
 * The app with one ranked season running, charging `entryFee` entries a game (0: free), open to everyone.
 * @param {{ entryFee?: number, signedMoves?: boolean }} [options]
 */
async function world({ entryFee = 1, signedMoves = false } = {}) {
  const bundled = await bundledContent();
  const ranked = structuredClone(bundled.ranked);
  ranked.eligibility.minFinishedCasualGames = 0;
  ranked.seasons = [{ id: SEASON, name: "Paid season", startsAt: "2026-09-01T00:00:00Z", ...(entryFee === 0 ? {} : { entryFee }) }];
  const setup = await buildTestApp({ content: { ...bundled, ranked }, signedMoves, lobbyPolicy: { listCacheMs: 0 } });
  /** A signed-up player with a starter deck, connected. */
  const player = async (account, starterId = "precon_foundry") => {
    const user = await setup.users.findOrCreate({ network: "steem", account }, setup.clock.now(), uuidV4(deterministicRandom(`user:${account}`)));
    const { deck } = await setup.app.starters.claim({ userId: user.id, starterId, ip: "127.0.0.1" });
    const inbox = [];
    setup.app.hub.attach(user.id, { send: (message) => inbox.push(JSON.parse(message)), close: () => undefined });
    return { id: user.id, account, user: { id: user.id, account }, party: { userId: user.id, account }, deckId: deck.id, inbox };
  };
  const give = (who, count) => setup.app.entries.credit({ userId: who.id, kind: "ranked", count, orderId: `grant:${who.account}:${count}` });
  const balance = async (who) => (await setup.app.entries.view(who.id)).find((entry) => entry.kind === "ranked")?.balance;
  const queue = (who, mode = "ranked") => setup.app.matchmaking.join({ user: who.user, mode, deckId: who.deckId });
  const ledger = (gameId) => setup.database.rows("SELECT user_id, reason, delta, season FROM entry_ledger WHERE ref = $1 ORDER BY reason, user_id", [gameId]);
  return { setup, player, give, balance, queue, ledger };
}

const last = (inbox, type) => inbox.filter((message) => message.t === type).at(-1)?.d;

describe("ranked entries", () => {
  it("reads a season's entry fee from the ranked settings: absent is free, and it is a whole number of entries", async () => {
    const { ranked } = await bundledContent();
    const settings = validateRankedSettings(ranked);
    assert.deepEqual(settings.value.seasons.map((season) => [season.id, season.entryFee]), [["2026-s1", 0], ["season-1", 1]]);
    for (const bad of [-1, 1.5, "1", 101]) {
      const broken = structuredClone(ranked);
      broken.seasons[1].entryFee = bad;
      assert.equal(validateRankedSettings(broken).ok, false, String(bad));
    }
  });

  it("refuses ranked play without entries, and takes one from each player when their game is created", async () => {
    const { setup, player, give, balance, queue, ledger } = await world();
    const alice = await player("alice");
    const bob = await player("bob", "precon_shadow");
    await assert.rejects(queue(alice), (error) => error.code === "ENTRY_REQUIRED" && error.status === 402 && /a ranked game costs 1 ranked entry: buy them in the shop/.test(error.message));
    assert.deepEqual(await setup.app.matchmaking.status(alice.id), { state: "idle" });

    await give(alice, 3);
    await give(bob, 1);
    assert.deepEqual(await setup.app.entries.view(alice.id), [{ kind: "ranked", balance: 3, perGame: 1, season: SEASON }]);
    await queue(alice);
    setup.clock.advance(1000);
    await queue(bob);
    const found = last(alice.inbox, "match.found");
    assert.ok(found, "matched");
    assert.deepEqual([await balance(alice), await balance(bob)], [2, 0]);
    const charges = await ledger(found.gameId);
    assert.deepEqual(charges.map((row) => [row.reason, row.delta, row.season]), [["game", -1, SEASON], ["game", -1, SEASON]]);
    assert.deepEqual(new Set(charges.map((row) => row.user_id)), new Set([alice.id, bob.id]));
  });

  it("keeps casual games free", async () => {
    const { player, balance, queue } = await world();
    const carol = await player("carol");
    const dave = await player("dave", "precon_shadow");
    await queue(carol, "casual");
    await queue(dave, "casual");
    assert.ok(last(carol.inbox, "match.found"), "matched without entries");
    assert.deepEqual([await balance(carol), await balance(dave)], [0, 0]);
  });

  it("takes out of the queue a player whose entries ran out, instead of blocking it", async () => {
    const { setup, player, give, balance, queue } = await world();
    const alice = await player("alice");
    const bob = await player("bob", "precon_shadow");
    const carol = await player("carol");
    await give(alice, 1);
    await queue(alice);
    // Spent elsewhere while she waited (what a game started another way would do).
    assert.equal(await setup.app.entries.charge({ gameId: "elsewhere", mode: "ranked", userIds: [alice.id] }), 1);
    await give(bob, 1);
    setup.clock.advance(1000);
    await queue(bob);
    assert.deepEqual(last(alice.inbox, "queue.status"), { state: "idle", reason: "entries" }, "alice is told why she left the queue");
    assert.equal(last(bob.inbox, "match.found"), undefined);
    assert.equal((await setup.app.matchmaking.status(bob.id)).state, "searching", "bob keeps his place");

    await give(carol, 2);
    await queue(carol);
    assert.equal(last(bob.inbox, "match.found").gameId, last(carol.inbox, "match.found").gameId);
    assert.deepEqual([await balance(alice), await balance(bob), await balance(carol)], [0, 0, 1]);
  });

  it("refuses to charge more than a player holds, and changes nothing then", async () => {
    const { setup, player, give, balance } = await world({ entryFee: 2 });
    const alice = await player("alice");
    const bob = await player("bob");
    await give(alice, 2);
    await give(bob, 1);
    await assert.rejects(setup.app.entries.charge({ gameId: "g1", mode: "ranked", userIds: [alice.id, bob.id] }), (error) => error.code === "ENTRY_REQUIRED" && /costs 2 ranked entries/.test(error.message));
    assert.deepEqual([await balance(alice), await balance(bob)], [2, 1], "all or nothing");
    assert.equal((await setup.database.rows("SELECT count(*)::integer AS n FROM entry_ledger WHERE reason = 'game'"))[0].n, 0);
  });

  it("gives the entries back when a game is called off before it starts", async () => {
    const { setup, player, give, balance, queue, ledger } = await world({ signedMoves: true });
    const alice = await player("alice");
    const bob = await player("bob", "precon_shadow");
    await give(alice, 1);
    await give(bob, 1);
    await queue(alice);
    await queue(bob);
    const { gameId } = last(alice.inbox, "match.found");
    assert.deepEqual([await balance(alice), await balance(bob)], [0, 0]);

    assert.equal((await setup.app.games.decline(bob.id, gameId)).ok, true);
    assert.ok(last(alice.inbox, "game.aborted"));
    assert.deepEqual([await balance(alice), await balance(bob)], [1, 1], "nobody pays for a game that never started");
    assert.deepEqual((await ledger(gameId)).map((row) => [row.reason, row.delta]), [["game", -1], ["game", -1], ["refund", 1], ["refund", 1]]);
    assert.equal(await setup.app.entries.refundGame(gameId), 0, "once");
  });

  it("needs entries on both sides of a ranked challenge, and takes them when it is accepted", async () => {
    const { setup, player, give, balance } = await world();
    const lobby = setup.app.lobby;
    const alice = await player("alice");
    const bob = await player("bob", "precon_shadow");
    await assert.rejects(lobby.challenge({ user: alice.party, to: "bob", mode: "ranked", deckId: alice.deckId }), (error) => error.code === "ENTRY_REQUIRED");
    await give(alice, 1);
    await assert.rejects(lobby.challenge({ user: alice.party, to: "bob", mode: "ranked", deckId: alice.deckId }), /@bob has no ranked entries left/);
    await give(bob, 1);
    const sent = await lobby.challenge({ user: alice.party, to: "bob", mode: "ranked", deckId: alice.deckId });
    const { gameId } = await lobby.accept({ user: bob.party, challengeId: sent.id, deckId: bob.deckId });
    assert.equal(await setup.app.games.activeGameOf(alice.id), gameId);
    assert.deepEqual([await balance(alice), await balance(bob)], [0, 0]);
  });

  it("lets everyone play ranked for free in a season without an entry fee", async () => {
    const { setup, player, queue } = await world({ entryFee: 0 });
    const alice = await player("alice");
    const bob = await player("bob", "precon_shadow");
    assert.deepEqual(await setup.app.entries.view(alice.id), [{ kind: "ranked", balance: 0, perGame: 0, season: null }]);
    await queue(alice);
    await queue(bob);
    assert.ok(last(alice.inbox, "match.found"));
  });

  it("sells entries in the shop: many with one payment, credited once when the order is fulfilled", async () => {
    const { setup } = await world();
    const keys = keyPair(7);
    setup.chain.setAccount("alice", [keys.publicKey]);
    const server = await listen(setup.app);
    try {
      const client = new ApiClient(server.base);
      await client.signIn("alice", keys.privateKey);
      await setup.app.settlement.poll("steem");
      setup.clock.advance(2 * MINUTE);
      setup.ledger.time = setup.clock.now();
      assert.deepEqual((await client.get("/api/entries")).json, { entries: [{ kind: "ranked", balance: 0, perGame: 1, season: SEASON }] });
      const product = (await client.get("/api/products")).json.products.find((candidate) => candidate.id === "ranked_entry");
      assert.deepEqual([product.cards, product.contents, product.prices], [0, [{ type: "entry", ref: "ranked", count: 1 }], [{ asset: "STEEM", amount: "1.000" }]]);

      const created = await client.post("/api/orders", { productId: "ranked_entry", quantity: 5, asset: "STEEM" }, { "Idempotency-Key": "entries-order-0001" });
      assert.equal(created.status, 201, created.text);
      const { order } = created.json;
      assert.deepEqual([order.payment.to, order.payment.amount], [setup.config.shopAccounts.steem, "5.000"], "paid to the bank: one transfer for five games");
      setup.ledger.transfer({ from: order.payment.from, to: order.payment.to, amount: `${order.payment.amount} STEEM`, memo: order.payment.memo, time: setup.clock.now() });
      setup.ledger.finalize();
      await setup.app.settlement.runOnce();
      assert.equal(await setup.app.fulfilment.fulfilVerified(), 1);
      assert.equal(await setup.app.fulfilment.fulfilVerified(), 0);
      assert.equal((await client.get("/api/entries")).json.entries[0].balance, 5);

      const fulfilled = (await client.get(`/api/orders/${order.id}`)).json.order;
      assert.equal(fulfilled.status, "FULFILLED");
      assert.deepEqual([fulfilled.fulfilment.cards, fulfilled.fulfilment.packs, fulfilled.fulfilment.entries], [[], [], [{ kind: "ranked", count: 5 }]]);
      const [told] = (await client.get("/api/notifications")).json.notifications;
      assert.deepEqual([told.kind, told.data.total, told.data.entries], ["shop.fulfilled", 0, [{ kind: "ranked", count: 5 }]]);
    } finally {
      await server.close();
    }
  });
});
