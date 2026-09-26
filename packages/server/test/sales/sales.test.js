/**
 * Selling copies between players (docs/tcg/14) on the real services, with
 * transfers on a fake STEEM chain read by the real STEEM adapter: the copy
 * goes into escrow when listed; a buyer reserves it and pays the seller
 * directly; the copy changes hands only once the transfer is irreversible,
 * and the sale is queued for the chain. Wrong, late and vanished payments
 * never hand a copy over; releases, cancels and expiry give it back.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseSaleRecord } from "@magic8/protocol";
import { uuidV4 } from "../../src/kernel/random.js";
import { buildTestApp, deterministicRandom, keyPair, listen } from "../helpers.js";
import { ApiClient } from "../support/apiClient.js";

const PRINTING = Object.freeze({ edition: "core-1", finish: "standard" });
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

async function world(salesPolicy = {}) {
  const setup = await buildTestApp({ salesPolicy });
  const { app } = setup;
  const inbox = new Map();
  const player = async (account) => {
    const user = await setup.users.findOrCreate({ network: "steem", account }, setup.clock.now(), uuidV4(deterministicRandom(`user:${account}`)));
    inbox.set(user.id, []);
    app.hub.attach(user.id, { send: (message) => inbox.get(user.id).push(JSON.parse(message)), close: () => undefined });
    return { id: user.id, account, network: "steem" };
  };
  let serial = 0;
  const owned = async (owner, definitionId = "ember_imp", kind = "purchase") => (await app.inventory.mint({ ownerId: owner.id, items: [{ definitionId, count: 1 }], ...PRINTING, origin: { kind, ref: `test:${owner.account}:${(serial += 1)}` } }))[0];
  let keys = 0;
  const list = (seller, copy, price = "1.5") => app.sales.list({ seller, copy: copy.id, price, asset: "STEEM", idempotencyKey: `list-key-${String((keys += 1)).padStart(8, "0")}`, ip: "x" });
  const reserve = (buyer, listing) => app.sales.reserve({ buyer, listingId: listing.id, ip: "x" });
  /** A transfer as Keychain would send it for these instructions, with overrides. */
  const pay = (purchase, overrides = {}) => setup.ledger.transfer({ from: purchase.payment.from, to: purchase.payment.to, amount: `${purchase.payment.amount} ${purchase.payment.asset}`, memo: purchase.payment.memo, time: setup.clock.now(), ...overrides });
  const settle = () => app.saleSettlement.runOnce();
  const copyOf = async (id) => (await setup.database.rows("SELECT owner_id, status FROM card_instances WHERE id = $1", [id])).map((row) => [row.owner_id, row.status])[0];
  const purchase = (buyer, id) => app.sales.purchaseView(buyer.id, id);
  return { setup, app, player, owned, list, reserve, pay, settle, copyOf, purchase, inbox };
}

describe("sales between players", () => {
  it("lists, reserves, detects the payment to the seller, and hands the copy over once it is irreversible", async () => {
    const w = await world();
    const alice = keyPair(1);
    const bob = keyPair(2);
    w.setup.chain.setAccount("alice", [alice.publicKey]);
    w.setup.chain.setAccount("bob", [bob.publicKey]);
    const server = await listen(w.app);
    try {
      const aliceClient = new ApiClient(server.base);
      const aliceUser = await aliceClient.signIn("alice", alice.privateKey);
      const bobClient = new ApiClient(server.base);
      const bobUser = await bobClient.signIn("bob", bob.privateKey);
      const [imp] = await w.app.inventory.mint({ ownerId: aliceUser.id, items: [{ definitionId: "ember_imp", count: 1 }], ...PRINTING, origin: { kind: "pack", ref: "test:alice:pack" } });
      // Earlier history of the seller: the watcher starts after it.
      w.setup.ledger.transfer({ from: "carol", to: "alice", amount: "9.000 STEEM", memo: "old" });

      const listed = await aliceClient.post("/api/listings", { copy: imp.id, price: "1.5", asset: "STEEM" }, { "Idempotency-Key": "listing-key-000000001" });
      assert.equal(listed.status, 201, listed.text);
      const { listing } = listed.json;
      assert.deepEqual([listing.status, listing.seller, listing.price, listing.card.serial, listing.reserved], ["ACTIVE", "alice", { asset: "STEEM", amount: "1.500" }, imp.serial, false]);
      assert.equal((await w.copyOf(imp.id))[1], "locked", "in escrow while on the board");
      assert.equal((await aliceClient.post("/api/listings", { copy: imp.id, price: "1.5", asset: "STEEM" }, { "Idempotency-Key": "listing-key-000000001" })).status, 200, "the same request answers with the same listing");

      const board = await new ApiClient(server.base).get("/api/listings?sort=cheapest");
      assert.equal(board.status, 200, "the board is public");
      assert.deepEqual([board.json.total, board.json.listings[0].id], [1, listing.id]);
      assert.equal((await new ApiClient(server.base).get("/api/listings?card=iron_watcher")).json.total, 0, "filtered by card");

      assert.equal((await aliceClient.post(`/api/listings/${listing.id}/buy`, {})).status, 400, "nobody buys their own card");
      const bought = await bobClient.post(`/api/listings/${listing.id}/buy`, {});
      assert.equal(bought.status, 200, bought.text);
      const { purchase } = bought.json;
      assert.deepEqual([purchase.status, purchase.payment.from, purchase.payment.to, purchase.payment.amount, purchase.payment.asset], ["PENDING", "bob", "alice", "1.500", "STEEM"]);
      assert.match(purchase.payment.memo, /^m8sale-[a-z2-7]{26}$/);
      assert.equal((await bobClient.post(`/api/listings/${listing.id}/buy`, {})).json.purchase.id, purchase.id, "asking again answers with the same reservation");
      assert.equal((await new ApiClient(server.base).get("/api/listings")).json.listings[0].reserved, true, "the board shows it is being bought");
      assert.equal((await aliceClient.post(`/api/listings/${listing.id}/cancel`, {})).status, 409, "the seller cannot withdraw it while bob pays");
      assert.equal((await aliceClient.get(`/api/purchases/${purchase.id}`)).status, 404, "a purchase is its buyer's alone");

      const { txId } = w.pay(purchase);
      const hinted = await bobClient.post(`/api/purchases/${purchase.id}/payment-hint`, { txId });
      assert.deepEqual([hinted.status, hinted.json.purchase.status, hinted.json.purchase.txId], [202, "DETECTED", txId]);
      assert.equal((await w.copyOf(imp.id))[0], aliceUser.id, "nothing moves before the payment is irreversible");
      w.setup.ledger.finalize();
      assert.deepEqual(await w.settle(), { detected: 0, completed: 1, expired: 0 });

      assert.deepEqual(await w.copyOf(imp.id), [bobUser.id, "active"], "bob owns the copy, free to use");
      const done = (await bobClient.get(`/api/purchases/${purchase.id}`)).json.purchase;
      assert.deepEqual([done.status, done.payment], ["COMPLETED", null]);
      const mine = (await aliceClient.get("/api/listings/mine")).json;
      assert.deepEqual([mine.listings[0].status, mine.listings[0].buyer], ["SOLD", "bob"]);
      assert.equal((await bobClient.get("/api/listings/mine")).json.purchases[0].id, purchase.id);
      assert.equal((await new ApiClient(server.base).get("/api/listings")).json.total, 0, "sold cards leave the board");
      const history = await w.setup.database.rows("SELECT kind, ref FROM card_instance_events WHERE card_instance_id = $1 ORDER BY id", [imp.id]);
      assert.deepEqual(history.map((row) => row.kind), ["MINTED", "LOCKED", "TRANSFERRED"]);

      const [queued] = await w.setup.database.rows("SELECT payload, status FROM blockchain_events WHERE kind = 'SALE'");
      const record = parseSaleRecord(queued.payload);
      assert.deepEqual([record.t, record.s, record.b, record.p, record.x, record.c[0], queued.status], [listing.id, "alice", "bob", "1.500 STEEM", txId, imp.id, "BUILT"]);
    } finally {
      await server.close();
    }
  });

  it("pays nothing for a transfer with the wrong amount, sender, asset or time, and tells the buyer why", async () => {
    const w = await world();
    const alice = await w.player("alice");
    const bob = await w.player("bob");
    const { listing } = await w.list(alice, await w.owned(alice), "2");
    const purchase = await w.reserve(bob, listing);

    for (const [overrides, problem] of [
      [{ amount: "1.999 STEEM" }, "WRONG_AMOUNT"],
      [{ amount: "2.000 SBD" }, "WRONG_ASSET"],
      [{ from: "carol" }, "WRONG_SENDER"],
      [{ time: purchase.payment.expiresAt + 1 }, "LATE"],
    ]) {
      w.pay(purchase, overrides);
      w.setup.ledger.finalize();
      await w.settle();
      const seen = await w.purchase(bob, purchase.id);
      assert.deepEqual([seen.status, seen.problem], ["PENDING", problem]);
    }
    w.setup.ledger.transfer({ from: "bob", to: "alice", amount: "2.000 STEEM", memo: "m8sale-aaaaaaaaaaaaaaaaaaaaaaaaaa" });
    w.setup.ledger.finalize();
    await w.settle();
    assert.equal((await w.purchase(bob, purchase.id)).status, "PENDING", "another memo pays nothing");

    w.pay(purchase);
    w.setup.ledger.finalize();
    assert.deepEqual(await w.settle(), { detected: 1, completed: 1, expired: 0 }, "the right transfer still pays");
  });

  it("frees the listing when the reservation runs out or is released, never while a payment is seen", async () => {
    const w = await world();
    const alice = await w.player("alice");
    const bob = await w.player("bob");
    const carol = await w.player("carol");
    const { listing } = await w.list(alice, await w.owned(alice));

    const first = await w.reserve(bob, listing);
    await assert.rejects(w.reserve(carol, listing), /someone is buying this card/);
    w.setup.clock.advance(15 * MINUTE);
    assert.equal((await w.settle()).expired, 0, "not before the grace period");
    w.setup.clock.advance(2 * MINUTE);
    assert.equal((await w.settle()).expired, 1);
    assert.equal((await w.purchase(bob, first.id)).status, "EXPIRED");
    assert.ok(w.inbox.get(alice.id).some((message) => message.t === "sale.updated"), "the seller is told");

    const second = await w.reserve(carol, listing);
    assert.equal((await w.app.saleSettlement.release({ userId: carol.id, purchaseId: second.id, ip: "x" })).status, "CANCELLED");
    await assert.rejects(w.app.saleSettlement.release({ userId: carol.id, purchaseId: second.id, ip: "x" }), /already cancelled/);

    const third = await w.reserve(bob, listing);
    w.pay(third);
    await assert.rejects(w.app.saleSettlement.release({ userId: bob.id, purchaseId: third.id, ip: "x" }), /on its way/, "a payment already made is never abandoned");
    await assert.rejects(w.app.saleSettlement.release({ userId: carol.id, purchaseId: third.id, ip: "x" }), /no such purchase/);
    w.setup.clock.advance(DAY);
    assert.equal((await w.settle()).expired, 0, "a detected payment waits for the chain, not the clock");
  });

  it("reads the seller's history again when a detected payment leaves the chain", async () => {
    const w = await world();
    const alice = await w.player("alice");
    const bob = await w.player("bob");
    const copy = await w.owned(alice);
    const { listing } = await w.list(alice, copy);
    const purchase = await w.reserve(bob, listing);
    const { txId } = w.pay(purchase);
    assert.equal((await w.settle()).detected, 1);
    w.setup.ledger.drop(txId);
    w.setup.ledger.finalize();
    await w.settle();
    const back = await w.purchase(bob, purchase.id);
    assert.deepEqual([back.status, back.txId], ["PENDING", null]);
    assert.equal((await w.copyOf(copy.id))[0], alice.id, "the copy stays with the seller");
    w.pay(purchase);
    w.setup.ledger.finalize();
    assert.equal((await w.settle()).completed, 1);
    assert.deepEqual(await w.copyOf(copy.id), [bob.id, "active"]);
  });

  it("checks what is listed and who buys, gives copies back on cancel and expiry, and limits listings and purchases", async () => {
    const w = await world({ maxActiveListings: 3, maxLivePurchases: 1 });
    const alice = await w.player("alice");
    const bob = await w.player("bob");
    const copy = await w.owned(alice);
    await assert.rejects(w.list(bob, copy), /no such card in your collection/);
    await assert.rejects(w.list(alice, await w.owned(alice, "ember_imp", "reward")), /not one of your tradeable copies/);
    for (const price of ["0", "1.0001", "-1", "abc", "100000.001"]) {
      await assert.rejects(w.list(alice, copy, price), /price/, price);
    }
    await assert.rejects(w.app.sales.list({ seller: alice, copy: copy.id, price: "1", asset: "SBD", idempotencyKey: "list-key-sbd-00000001", ip: "x" }), /asset: one of STEEM/);
    await assert.rejects(w.app.sales.list({ seller: alice, copy: copy.id, price: "1", asset: "STEEM", idempotencyKey: null, ip: "x" }), /Idempotency-Key/);

    const { listing } = await w.list(alice, copy, "0.001");
    await assert.rejects(w.list(alice, copy), /not one of your tradeable copies/, "already on the board");
    await assert.rejects(w.app.trading.propose({ proposer: alice, to: "bob", give: [copy.id], want: [], idempotencyKey: "trade-while-listed-01", ip: "x" }), /not one of your tradeable copies/, "nor in a trade");
    await assert.rejects(w.app.sales.cancelListing({ userId: bob.id, listingId: listing.id, ip: "x" }), /no such listing/);
    assert.equal((await w.app.sales.cancelListing({ userId: alice.id, listingId: listing.id, ip: "x" })).status, "CANCELLED");
    assert.deepEqual(await w.copyOf(copy.id), [alice.id, "active"], "back in the collection");
    await assert.rejects(w.reserve(bob, listing), /no longer on sale/);

    const expiring = (await w.list(alice, copy)).listing;
    const other = (await w.list(alice, await w.owned(alice, "iron_watcher"))).listing;
    await w.list(alice, await w.owned(alice, "arcane_apprentice"));
    await assert.rejects(w.list(alice, await w.owned(alice)), /at most 3 cards on the board/);
    await w.reserve(bob, other);
    await assert.rejects(w.reserve(bob, expiring), /at most 1 purchases at a time/);

    w.setup.clock.advance(30 * DAY);
    assert.equal(await w.app.sales.expireDue(), 2, "the listing bob is paying for stays until his reservation ends");
    assert.deepEqual(await w.copyOf(copy.id), [alice.id, "active"]);
    assert.equal((await w.app.sales.board({})).total, 0, "nothing past its time is shown");
    await w.settle();
    assert.equal(await w.app.sales.expireDue(), 1);
  });
});
