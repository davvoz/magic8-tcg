/**
 * Fulfilment end to end: pay on the fake chain, settle, fulfil; check the
 * minted cards, the saved decks, the receipt in the outbox, atomicity and
 * idempotency — and that a player can recompute every pack from public data
 * once its epoch is revealed.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { drawPack, packSeed, parseCanonical, utf8Length } from "@magic8/protocol";
import { buildTestApp, keyPair, listen } from "../helpers.js";
import { ApiClient } from "../support/apiClient.js";

const alice = keyPair(1);
const bob = keyPair(2);
const MINUTE = 60 * 1000;
let keys = 0;
const newKey = () => `fulfil-key-${String((keys += 1)).padStart(8, "0")}`;

describe("fulfilment", () => {
  /** @type {Awaited<ReturnType<typeof buildTestApp>>} */
  let setup;
  /** @type {{ base: string, close: () => Promise<unknown> }} */
  let server;
  /** @type {ApiClient} */
  let aliceClient;
  /** @type {ApiClient} */
  let bobClient;

  /** Places an order, pays it exactly, and settles it up to PAYMENT_VERIFIED. */
  const buyAndPay = async (client, productId, quantity = 1) => {
    const created = await client.post("/api/orders", { productId, quantity, asset: "STEEM" }, { "Idempotency-Key": newKey() });
    assert.equal(created.status, 201, created.text);
    const { order } = created.json;
    setup.ledger.transfer({ from: order.payment.from, to: order.payment.to, amount: `${order.payment.amount} STEEM`, memo: order.payment.memo, time: setup.clock.now() });
    setup.ledger.finalize();
    await setup.app.settlement.runOnce();
    assert.equal((await client.get(`/api/orders/${order.id}`)).json.order.status, "PAYMENT_VERIFIED");
    return order;
  };
  const orderOf = async (client, id) => (await client.get(`/api/orders/${id}`)).json.order;
  const ownedCopies = async (client) => (await client.get("/api/collection")).json.cards.reduce((sum, entry) => sum + entry.copies.length, 0);
  const receipts = (orderId) => setup.database.rows("SELECT payload, status FROM blockchain_events WHERE order_id = $1 AND kind = 'RECEIPT' ORDER BY id", [orderId]);

  before(async () => {
    setup = await buildTestApp({ marketplacePolicy: { epochMaxAgeMs: 60 * MINUTE } });
    setup.chain.setAccount("alice", [alice.publicKey]);
    setup.chain.setAccount("bob", [bob.publicKey]);
    server = await listen(setup.app);
    aliceClient = new ApiClient(server.base);
    await aliceClient.signIn("alice", alice.privateKey);
    bobClient = new ApiClient(server.base);
    await bobClient.signIn("bob", bob.privateKey);
    await setup.app.settlement.poll("steem");
  });

  after(() => server.close());

  beforeEach(() => {
    setup.clock.advance(2 * MINUTE);
    setup.ledger.time = setup.clock.now();
  });

  it("opens paid boosters: five cards per pack, by slot, minted to the buyer, with a receipt", async () => {
    const order = await buyAndPay(aliceClient, "core_booster", 2);
    const ownedBefore = await ownedCopies(aliceClient);
    assert.equal(await setup.app.fulfilment.fulfilVerified(), 1);
    const fulfilled = await orderOf(aliceClient, order.id);
    assert.equal(fulfilled.status, "FULFILLED");
    const feed = (await aliceClient.get("/api/notifications")).json;
    const [told] = feed.notifications;
    assert.deepEqual([told.kind, told.data.orderId, told.data.total, told.data.items[0].quantity, told.read], ["shop.fulfilled", order.id, 10, 2, false], "the buyer is told the cards are in");
    assert.equal(told.data.cards.reduce((sum, entry) => sum + entry.count, 0), 10);
    assert.equal((await bobClient.get("/api/notifications")).json.notifications.length, 0);
    assert.deepEqual((await aliceClient.post("/api/notifications/read", { ids: [told.id] })).json, { unread: feed.unread - 1 });
    const { fulfilment } = fulfilled;
    assert.match(fulfilment.txId, /^[0-9a-f]{40}$/);
    assert.equal(fulfilment.packs.length, 2);
    const listing = (await new ApiClient(server.base).get("/api/products")).json;
    const table = listing.dropTables.find((candidate) => candidate.id === "core_booster");
    for (const pack of fulfilment.packs) {
      assert.equal(pack.cards.length, 5);
      assert.equal(pack.table, table.hash);
      assert.equal(pack.epoch, fulfilled.rngEpochId);
      const rarityOf = (card) => Object.keys(table.pools).find((rarity) => table.pools[rarity].includes(card.definitionId));
      const counts = pack.cards.map(rarityOf).reduce((tally, rarity) => ({ ...tally, [rarity]: (tally[rarity] ?? 0) + 1 }), {});
      assert.equal(counts.common, 3, JSON.stringify(counts));
      assert.equal(counts.uncommon, 1, JSON.stringify(counts));
      assert.equal((counts.rare ?? 0) + (counts.epic ?? 0) + (counts.legendary ?? 0), 1, JSON.stringify(counts));
      assert.ok(pack.cards.every((card) => card.edition === "core-1"));
    }
    assert.equal(await ownedCopies(aliceClient), ownedBefore + 10);

    const [receipt] = await receipts(order.id);
    assert.equal(receipt.status, "BUILT", "waiting for the broadcaster (M5)");
    const parsed = parseCanonical(receipt.payload);
    assert.equal(parsed.o, order.id);
    assert.equal(parsed.u, "alice");
    assert.deepEqual(parsed.pay, { net: "steem", tx: fulfilment.txId });
    assert.deepEqual(parsed.items, [{ p: "core_booster", q: 2 }]);
    assert.deepEqual(parsed.packs.map((pack) => pack.idx), [0, 1]);
    assert.deepEqual(parsed.cards.map((card) => card[0]).sort(), fulfilment.packs.flatMap((pack) => pack.cards.map((card) => card.id)).sort());
    const audit = await setup.database.rows("SELECT action FROM audit_logs WHERE target_id = $1 ORDER BY seq", [order.id]);
    assert.deepEqual(audit.map((row) => row.action), ["marketplace.order_created", "marketplace.payment_verified", "marketplace.order_fulfilled"]);
  });

  it("fulfils a cart: every line's cards, its packs numbered across the order, one receipt", async () => {
    const created = await aliceClient.post("/api/orders", { items: [{ productId: "core_mini_booster", quantity: 1 }, { productId: "single_pyre_drake", quantity: 2 }, { productId: "core_booster", quantity: 1 }], asset: "STEEM" }, { "Idempotency-Key": newKey() });
    assert.equal(created.status, 201, created.text);
    const { order } = created.json;
    setup.ledger.transfer({ from: order.payment.from, to: order.payment.to, amount: `${order.payment.amount} STEEM`, memo: order.payment.memo, time: setup.clock.now() });
    setup.ledger.finalize();
    await setup.app.settlement.runOnce();
    assert.equal(await setup.app.fulfilment.fulfilVerified(), 1);
    const { fulfilment, status } = await orderOf(aliceClient, order.id);
    assert.equal(status, "FULFILLED");
    assert.deepEqual(fulfilment.cards.map((card) => card.definitionId), ["pyre_drake", "pyre_drake"]);
    assert.deepEqual(fulfilment.packs.map((pack) => [pack.index, pack.cards.length]), [[0, 3], [1, 5]], "the mini booster, then the booster");
    const [receipt] = await receipts(order.id);
    assert.deepEqual(parseCanonical(receipt.payload).items, [{ p: "core_mini_booster", q: 1 }, { p: "single_pyre_drake", q: 2 }, { p: "core_booster", q: 1 }]);
    const [told] = (await aliceClient.get("/api/notifications")).json.notifications;
    assert.deepEqual([told.data.orderId, told.data.total, told.data.items.length], [order.id, 10, 3]);
  });

  it("mints bought decks and saves them to the account, and prints singles", async () => {
    const deckOrder = await buyAndPay(bobClient, "deck_precon_arcane");
    const singleOrder = await buyAndPay(bobClient, "single_pyre_drake");
    assert.equal(await setup.app.fulfilment.fulfilVerified(), 2);
    const deck = (await orderOf(bobClient, deckOrder.id)).fulfilment;
    assert.equal(deck.cards.length, 30);
    assert.deepEqual(deck.packs, []);
    const decks = (await bobClient.get("/api/decks")).json.decks;
    const saved = decks.find((candidate) => candidate.name === "Arcane Conclave");
    assert.ok(saved, "saved to the account");
    assert.equal(saved.playable, true, JSON.stringify(saved.problems));
    const single = (await orderOf(bobClient, singleOrder.id)).fulfilment;
    assert.deepEqual(single.cards.map((card) => Object.keys(card).sort()), [["definitionId", "edition", "id", "serial"]]);
    assert.deepEqual(parseCanonical((await receipts(singleOrder.id))[0].payload).cards[0].slice(1), ["pyre_drake", single.cards[0].serial]);
  });

  it("fulfils an order once, even with concurrent workers", async () => {
    const order = await buyAndPay(aliceClient, "core_booster");
    const ownedBefore = await ownedCopies(aliceClient);
    const results = await Promise.all([setup.app.fulfilment.fulfil(order.id), setup.app.fulfilment.fulfil(order.id), setup.app.fulfilment.fulfil(order.id)]);
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal(await setup.app.fulfilment.fulfil(order.id), false, "already fulfilled");
    assert.equal(await ownedCopies(aliceClient), ownedBefore + 5);
    assert.equal((await receipts(order.id)).length, 1);
  });

  it("rolls everything back when fulfilment fails, and succeeds on retry", async () => {
    const order = await buyAndPay(aliceClient, "core_booster");
    const ownedBefore = await ownedCopies(aliceClient);
    const secretOf = setup.app.epochs.secretOf.bind(setup.app.epochs);
    setup.app.epochs.secretOf = async () => {
      throw new Error("key service unavailable");
    };
    try {
      assert.equal(await setup.app.fulfilment.fulfilVerified(), 0);
    } finally {
      delete setup.app.epochs.secretOf;
    }
    assert.equal((await orderOf(aliceClient, order.id)).status, "PAYMENT_VERIFIED", "still verified, nothing lost");
    assert.equal(await ownedCopies(aliceClient), ownedBefore, "nothing minted");
    assert.equal((await receipts(order.id)).length, 0, "no receipt");
    assert.equal(typeof secretOf, "function");
    assert.equal(await setup.app.fulfilment.fulfilVerified(), 1);
    assert.equal(await ownedCopies(aliceClient), ownedBefore + 5);
  });

  it("splits a big order's receipt into operations of at most 8 KB", async () => {
    const created = await bobClient.post("/api/orders", { items: [{ productId: "core_booster", quantity: 20 }, { productId: "core_mini_booster", quantity: 20 }], asset: "STEEM" }, { "Idempotency-Key": newKey() });
    const { order } = created.json;
    setup.ledger.transfer({ from: order.payment.from, to: order.payment.to, amount: `${order.payment.amount} STEEM`, memo: order.payment.memo, time: setup.clock.now() });
    setup.ledger.finalize();
    await setup.app.settlement.runOnce();
    assert.equal(await setup.app.fulfilment.fulfilVerified(), 1);
    const parts = await receipts(order.id);
    assert.ok(parts.length > 1, `${parts.length} parts`);
    const cards = parts.flatMap((part) => {
      assert.ok(utf8Length(part.payload) <= 8192);
      return parseCanonical(part.payload).cards;
    });
    assert.equal(cards.length, 160);
    assert.equal((await orderOf(bobClient, order.id)).fulfilment.packs.length, 40);
  });

  it("lets a player recompute every pack from public data once the epoch is revealed", async () => {
    const order = await buyAndPay(aliceClient, "core_booster", 3);
    await setup.app.fulfilment.fulfilVerified();
    const { fulfilment, rngEpochId } = await orderOf(aliceClient, order.id);

    // Close the epoch (it ages out when the next order opens a new one), settle its orders, reveal.
    setup.clock.advance(61 * MINUTE);
    const next = await bobClient.post("/api/orders", { productId: "core_booster", quantity: 1, asset: "STEEM" }, { "Idempotency-Key": newKey() });
    assert.notEqual(next.json.order.rngEpochId, rngEpochId);
    setup.clock.advance(45 * MINUTE);
    await setup.app.marketplace.expireDue();
    assert.ok((await setup.app.epochs.revealSettled()).includes(rngEpochId));

    const publicApi = new ApiClient(server.base);
    const epoch = (await publicApi.get("/api/pack-epochs")).json.epochs.find((candidate) => candidate.id === rngEpochId);
    const table = (await publicApi.get("/api/products")).json.dropTables.find((candidate) => candidate.id === "core_booster");
    const resolved = { v: 1, id: table.id, edition: table.edition, slots: table.odds.map((slot) => ({ count: slot.count, weights: Object.fromEntries(Object.entries(slot.odds).map(([rarity, odds]) => [rarity, odds.numerator])) })), pools: table.pools };
    for (const pack of fulfilment.packs) {
      const expected = drawPack(resolved, packSeed({ secret: epoch.secret, orderId: order.id, txId: fulfilment.txId, index: pack.index }));
      assert.deepEqual(
        pack.cards.map((card) => card.definitionId).sort(),
        expected.map((card) => card.cardId).sort(),
        `pack ${pack.index} is exactly what its seed draws`,
      );
    }
  });
});
