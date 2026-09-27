/**
 * Orders over real HTTP: server-side prices, idempotency (also under
 * concurrency), limits, ownership, cancel, expiry, and pack epochs.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { packEpochAnnouncement, packEpochCommitment, packEpochReveal } from "@magic8/protocol";
import { SecretBox } from "../../src/kernel/crypto/SecretBox.js";
import { buildTestApp, deterministicRandom, keyPair, listen } from "../helpers.js";
import { ApiClient } from "../support/apiClient.js";

const alice = keyPair(1);
const bob = keyPair(2);
const MINUTE = 60 * 1000;
let keys = 0;
/** A fresh, valid Idempotency-Key. */
const newKey = () => `test-key-${String((keys += 1)).padStart(8, "0")}`;

describe("marketplace orders over HTTP", () => {
  /** @type {Awaited<ReturnType<typeof buildTestApp>>} */
  let setup;
  /** @type {{ base: string, close: () => Promise<unknown> }} */
  let server;
  /** @type {ApiClient} */
  let aliceClient;
  /** @type {ApiClient} */
  let bobClient;

  const order = (client, body, key = newKey()) => client.post("/api/orders", body, { "Idempotency-Key": key });

  before(async () => {
    // Short pack epochs, so rollover happens within the sessions' lifetime.
    setup = await buildTestApp({ marketplacePolicy: { epochMaxAgeMs: 60 * MINUTE } });
    setup.chain.setAccount("alice", [alice.publicKey]);
    setup.chain.setAccount("bob", [bob.publicKey]);
    server = await listen(setup.app);
    aliceClient = new ApiClient(server.base);
    await aliceClient.signIn("alice", alice.privateKey);
    bobClient = new ApiClient(server.base);
    await bobClient.signIn("bob", bob.privateKey);
  });

  after(() => server.close());

  // Each test starts with a full order-rate budget (10 orders a minute per player).
  beforeEach(() => setup.clock.advance(2 * MINUTE));

  it("lists products, prices and pack odds publicly", async () => {
    const listing = await new ApiClient(server.base).get("/api/products");
    assert.equal(listing.status, 200);
    const booster = listing.json.products.find((product) => product.id === "core_booster");
    assert.deepEqual(booster.prices, [{ asset: "STEEM", amount: "1.000" }]);
    assert.equal(booster.cards, 5);
    const table = listing.json.dropTables.find((candidate) => candidate.id === "core_booster");
    assert.match(table.hash, /^[0-9a-f]{64}$/);
    assert.deepEqual(table.odds[2].odds.legendary, { numerator: 2, denominator: 100 });
    assert.deepEqual(listing.json.rarities, ["common", "uncommon", "rare", "epic", "legendary"]);
    assert.equal(booster.rarity, null);
  });

  it("sells every card by rarity, packs at a fixed price and decks at the sum of their cards", async () => {
    const { json } = await new ApiClient(server.base).get("/api/products");
    const byId = new Map(json.products.map((product) => [product.id, product]));
    const common = json.priceList.singles.find((price) => price.rarity === "common");
    assert.equal(json.priceList.asset, "STEEM");
    assert.deepEqual(common, { rarity: "common", price: "0.500" });
    const drake = byId.get("single_pyre_drake");
    assert.equal(drake.rarity, "rare");
    assert.deepEqual(drake.prices, [{ asset: "STEEM", amount: "2.500" }]);
    assert.equal(json.products.filter((product) => product.kind === "single").length, setup.app.marketplace.catalog.rarities.of.size, "every card is on sale");
    assert.deepEqual(json.products.filter((product) => product.kind === "pack").map((pack) => [pack.id, pack.cards, pack.prices[0].amount]), [["core_booster", 5, "1.000"], ["core_mini_booster", 3, "0.500"]]);
    const deck = byId.get("deck_precon_arcane");
    assert.equal(deck.cards, 30);
    assert.equal(deck.prices[0].amount, "49.000", "the sum of its 30 cards as singles");
    assert.equal(byId.has("core_booster_box"), false, "retired products are not listed");
    assert.equal((await order(aliceClient, { productId: "core_booster_box", quantity: 1, asset: "STEEM" })).status, 409, "nor sold");
  });

  it("prices the order on the server and returns payment instructions", async () => {
    const created = await order(aliceClient, { productId: "core_booster", quantity: 3, asset: "STEEM" });
    assert.equal(created.status, 201, created.text);
    const { order: placed } = created.json;
    assert.equal(placed.status, "PAYMENT_PENDING");
    assert.deepEqual(placed.total, { asset: "STEEM", amount: "3.000" });
    assert.deepEqual(placed.items, [{ productId: "core_booster", name: "Core Booster", quantity: 3, unitAmount: "1.000" }]);
    assert.equal(placed.payment.to, "verdu.green");
    assert.equal(placed.payment.from, "alice");
    assert.equal(placed.payment.amount, "3.000");
    assert.match(placed.payment.memo, /^m8tcg-[a-z2-7]{26}$/);
    assert.equal(placed.payment.expiresAt, setup.clock.now() + 30 * MINUTE);
    assert.equal(placed.rngEpochId, 1, "packs bind the order to the open epoch");

    const single = await order(aliceClient, { productId: "single_pyre_drake", quantity: 1, asset: "STEEM" });
    assert.equal(single.json.order.rngEpochId, null, "no packs, no epoch");
    await aliceClient.post(`/api/orders/${placed.id}/cancel`, {});
    await aliceClient.post(`/api/orders/${single.json.order.id}/cancel`, {});
  });

  it("never takes a price from the client and refuses what is not for sale", async () => {
    const withPrice = await order(aliceClient, { productId: "core_booster", quantity: 1, asset: "STEEM", price: "0.001" });
    assert.equal(withPrice.status, 400, "unknown fields are refused");
    assert.equal((await order(aliceClient, { productId: "nope", quantity: 1, asset: "STEEM" })).status, 404);
    assert.equal((await order(aliceClient, { productId: "core_booster", quantity: 21, asset: "STEEM" })).status, 400, "above the product's per-order limit");
    assert.equal((await order(aliceClient, { productId: "core_booster", quantity: 0, asset: "STEEM" })).status, 400);
    assert.equal((await order(aliceClient, { productId: "core_booster", quantity: 1, asset: "SBD" })).status, 400, "SBD is not accepted");
    assert.equal((await order(aliceClient, { productId: "core_booster", quantity: 1.5, asset: "STEEM" })).status, 400);
    assert.equal((await new ApiClient(server.base).post("/api/orders", { productId: "core_booster", quantity: 1, asset: "STEEM" }, { "Idempotency-Key": newKey() })).status, 401);
  });

  it("requires an Idempotency-Key and replays the same order for the same request", async () => {
    const body = { productId: "single_pyre_drake", quantity: 1, asset: "STEEM" };
    const missing = await aliceClient.post("/api/orders", body);
    assert.equal(missing.status, 428);
    assert.equal((await order(aliceClient, body, "short")).status, 428, "keys have at least 16 characters");

    const key = newKey();
    const first = await order(aliceClient, body, key);
    const again = await order(aliceClient, body, key);
    assert.equal(first.status, 201);
    assert.equal(again.status, 200);
    assert.equal(again.json.order.id, first.json.order.id);
    assert.equal(again.json.order.payment.memo, first.json.order.payment.memo);
    const different = await order(aliceClient, { ...body, quantity: 2 }, key);
    assert.equal(different.status, 409, "same key, different request");
    const bobSameKey = await order(bobClient, body, key);
    assert.equal(bobSameKey.status, 201, "keys are per user");
    await aliceClient.post(`/api/orders/${first.json.order.id}/cancel`, {});
    await bobClient.post(`/api/orders/${bobSameKey.json.order.id}/cancel`, {});
  });

  it("creates one order for concurrent requests with the same key", async () => {
    const key = newKey();
    const body = { productId: "single_pyre_drake", quantity: 1, asset: "STEEM" };
    const responses = await Promise.all(Array.from({ length: 6 }, () => order(bobClient, body, key)));
    assert.ok(responses.every((response) => response.status === 200 || response.status === 201), responses.map((response) => response.status).join());
    assert.equal(new Set(responses.map((response) => response.json.order.id)).size, 1);
    assert.equal(responses.filter((response) => response.status === 201).length, 1);
    const rows = await setup.database.rows("SELECT count(*)::integer AS n FROM orders WHERE idempotency_key = $1", [key]);
    assert.equal(rows[0].n, 1);
    await bobClient.post(`/api/orders/${responses[0].json.order.id}/cancel`, {});
  });

  it("limits unpaid orders per player", async () => {
    const created = [];
    for (let index = 0; index < 5; index += 1) {
      const response = await order(bobClient, { productId: "single_pyre_drake", quantity: 1, asset: "STEEM" });
      assert.equal(response.status, 201, response.text);
      created.push(response.json.order.id);
    }
    const sixth = await order(bobClient, { productId: "single_pyre_drake", quantity: 1, asset: "STEEM" });
    assert.equal(sixth.status, 409);
    assert.equal(sixth.json.error.code, "LIMIT_REACHED");
    for (const id of created) {
      assert.equal((await bobClient.post(`/api/orders/${id}/cancel`, {})).status, 200);
    }
  });

  it("shows an order only to its buyer, and cancels it once", async () => {
    const created = await order(aliceClient, { productId: "deck_precon_arcane", quantity: 1, asset: "STEEM" });
    const id = created.json.order.id;
    assert.equal((await bobClient.get(`/api/orders/${id}`)).status, 404, "someone else's order does not exist");
    assert.equal((await bobClient.post(`/api/orders/${id}/cancel`, {})).status, 404);
    assert.equal((await aliceClient.get("/api/orders/not-a-uuid")).status, 404);
    const mine = await aliceClient.get(`/api/orders/${id}`);
    assert.equal(mine.json.order.status, "PAYMENT_PENDING");

    const cancelled = await aliceClient.post(`/api/orders/${id}/cancel`, {});
    assert.equal(cancelled.json.order.status, "CANCELLED");
    assert.equal(cancelled.json.order.payment, null, "no instructions for a cancelled order");
    assert.equal((await aliceClient.post(`/api/orders/${id}/cancel`, {})).status, 409);
    const history = await aliceClient.get("/api/orders");
    assert.equal(history.json.orders[0].id, id, "newest first");
    const audit = await setup.database.rows("SELECT action FROM audit_logs WHERE target_id = $1 ORDER BY seq", [id]);
    assert.deepEqual(audit.map((row) => row.action), ["marketplace.order_created", "marketplace.order_cancelled"]);
  });

  it("expires unpaid orders after the deadline and a grace period", async () => {
    const created = await order(aliceClient, { productId: "core_booster", quantity: 1, asset: "STEEM" });
    const id = created.json.order.id;
    setup.clock.advance(35 * MINUTE);
    assert.equal(await setup.app.marketplace.expireDue(), 0, "still inside the grace period");
    setup.clock.advance(10 * MINUTE);
    assert.equal(await setup.app.marketplace.expireDue(), 1);
    const expired = await aliceClient.get(`/api/orders/${id}`);
    assert.equal(expired.json.order.status, "EXPIRED");
    assert.equal((await aliceClient.post(`/api/orders/${id}/cancel`, {})).status, 409);
  });

  it("rolls pack epochs over and reveals a secret only once its orders are settled", async () => {
    const pending = await order(aliceClient, { productId: "core_booster", quantity: 1, asset: "STEEM" });
    assert.equal(pending.json.order.rngEpochId, 1);
    setup.clock.advance(61 * MINUTE);
    const next = await order(bobClient, { productId: "core_booster", quantity: 1, asset: "STEEM" });
    assert.equal(next.json.order.rngEpochId, 2, "epoch 1 was too old: closed, epoch 2 opened");

    const epochs = (await new ApiClient(server.base).get("/api/pack-epochs")).json.epochs;
    assert.deepEqual(epochs.map((epoch) => [epoch.id, epoch.closedAt !== null, epoch.secret]), [[2, false, null], [1, true, null]]);

    // Alice's epoch-1 order expired with the clock jump, but the job has not run yet: it still counts as open.
    assert.deepEqual(await setup.app.epochs.revealSettled(), []);
    await setup.app.marketplace.expireDue();
    assert.deepEqual(await setup.app.epochs.revealSettled(), [1]);
    const revealed = (await new ApiClient(server.base).get("/api/pack-epochs")).json.epochs.find((epoch) => epoch.id === 1);
    assert.match(revealed.secret, /^[0-9a-f]{64}$/);
    assert.equal(packEpochCommitment(revealed.secret), revealed.commit, "the revealed secret matches the commitment published before the sale");
    const published = await setup.database.rows("SELECT payload, priority, status FROM blockchain_events WHERE kind = 'EPOCH' ORDER BY id");
    assert.deepEqual(
      published.map((row) => row.payload),
      [packEpochAnnouncement(1, epochs[1].commit), packEpochAnnouncement(2, epochs[0].commit), packEpochReveal(1, revealed.secret)],
      "each commitment is published when its epoch opens, the secret when it is revealed",
    );
    assert.ok(published.every((row) => row.priority === 0 && row.status === "BUILT"), "queued, first come first served");
    assert.deepEqual(await setup.app.epochs.revealSettled(), [], "revealed once");
    const sealed = await setup.database.rows("SELECT secret_encrypted FROM rng_epochs WHERE id = 1");
    assert.ok(!Buffer.from(sealed[0].secret_encrypted).toString("hex").includes(revealed.secret), "stored encrypted");
    await bobClient.post(`/api/orders/${next.json.order.id}/cancel`, {});
  });

  it("prices a cart as one order with one payment", async () => {
    const created = await order(aliceClient, { items: [{ productId: "core_booster", quantity: 2 }, { productId: "single_pyre_drake", quantity: 1 }, { productId: "single_ember_imp", quantity: 1 }], asset: "STEEM" });
    assert.equal(created.status, 201, created.text);
    const { order: placed } = created.json;
    assert.deepEqual(
      placed.items.map((item) => [item.productId, item.quantity, item.unitAmount]),
      [["core_booster", 2, "1.000"], ["single_pyre_drake", 1, "2.500"], ["single_ember_imp", 1, "0.500"]],
    );
    assert.deepEqual(placed.total, { asset: "STEEM", amount: "5.000" });
    assert.equal(placed.payment.amount, "5.000", "one transfer pays the whole cart");
    assert.notEqual(placed.rngEpochId, null, "a cart with packs is bound to the open epoch");
    await aliceClient.post(`/api/orders/${placed.id}/cancel`, {});
  });

  it("refuses malformed carts", async () => {
    const line = { productId: "core_booster", quantity: 1 };
    assert.equal((await order(aliceClient, { items: [], asset: "STEEM" })).status, 400, "no lines");
    assert.equal((await order(aliceClient, { items: [line, line], asset: "STEEM" })).status, 400, "a product appears once");
    assert.equal((await order(aliceClient, { items: [line], productId: "core_booster", quantity: 1, asset: "STEEM" })).status, 400, "items or a single line, not both");
    assert.equal((await order(aliceClient, { items: [{ ...line, price: "0.001" }], asset: "STEEM" })).status, 400, "unknown fields in a line");
    assert.equal((await order(aliceClient, { items: [line, { productId: "core_booster_box", quantity: 1 }], asset: "STEEM" })).status, 409, "every line must be on sale");
    assert.equal((await order(aliceClient, { items: [line, { productId: "core_mini_booster", quantity: 21 }], asset: "STEEM" })).status, 400, "each line within its product's limit");
    const tooMany = Array.from({ length: 21 }, (_, index) => ({ productId: `product_${index}`, quantity: 1 }));
    assert.equal((await order(aliceClient, { items: tooMany, asset: "STEEM" })).status, 400, "at most 20 lines");
    const listing = (await new ApiClient(server.base).get("/api/products")).json;
    const singles = listing.products.filter((product) => product.kind === "single").slice(0, 20);
    const bulky = await order(aliceClient, { items: singles.map((product) => ({ productId: product.id, quantity: 100 })), asset: "STEEM" });
    assert.equal(bulky.status, 400, "at most 1000 cards across the lines");
  });
});

describe("SecretBox", () => {
  const key = (byte) => new Uint8Array(32).fill(byte);

  it("opens what it sealed, only with the same context and a known key", () => {
    const box = new SecretBox({ keys: new Map([[1, key(1)]]), currentKeyId: 1, random: deterministicRandom("box") });
    const secret = new Uint8Array([1, 2, 3, 4]);
    const sealed = box.seal(secret, "rng_epoch:1");
    assert.deepEqual(box.open(sealed, "rng_epoch:1"), secret);
    assert.notDeepEqual(box.seal(secret, "rng_epoch:1"), sealed, "a fresh IV every time");
    assert.throws(() => box.open(sealed, "rng_epoch:2"), "bound to its row");
    const tampered = new Uint8Array(sealed);
    tampered[tampered.length - 1] ^= 1;
    assert.throws(() => box.open(tampered, "rng_epoch:1"), "authenticated");
    assert.throws(() => new SecretBox({ keys: new Map([[1, key(1)]]), currentKeyId: 2, random: deterministicRandom() }), TypeError);
  });

  it("rotates keys: new secrets use the new key, old ones still open", () => {
    const random = deterministicRandom("rotation");
    const original = new SecretBox({ keys: new Map([[1, key(1)]]), currentKeyId: 1, random });
    const old = original.seal(new Uint8Array([9]), "x");
    const rotated = new SecretBox({ keys: new Map([[1, key(1)], [2, key(2)]]), currentKeyId: 2, random });
    assert.deepEqual(rotated.open(old, "x"), new Uint8Array([9]));
    assert.equal(rotated.seal(new Uint8Array([9]), "x")[1], 2);
    assert.throws(() => new SecretBox({ keys: new Map([[2, key(2)]]), currentKeyId: 2, random }).open(old, "x"), /no key with id 1/);
  });
});
