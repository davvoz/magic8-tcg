/**
 * Announced maintenance: from the announcement the server starts no new
 * payment or game (shop orders, purchases between players, queue entries;
 * whoever waits leaves the queue) while what is already under way goes on;
 * players connected hear it at once; it survives a restart, reaches every
 * process through the database, and ends from the admin page or the command
 * line, reopening everything.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { uuidV4 } from "../../src/kernel/random.js";
import { runMaintenanceCommand } from "../../src/maintenance/maintenanceNotice.js";
import { buildTestApp, deterministicRandom, keyPair, listen } from "../helpers.js";
import { ApiClient } from "../support/apiClient.js";

const MINUTE = 60 * 1000;
const SHOP = "verdu.green";

/** Lets an in-process NOTIFY, and the work it starts, run. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 30));
const last = (inbox, type) => inbox.filter((message) => message.t === type).at(-1)?.d;
const isMaintenance = (error) => error.code === "MAINTENANCE" && /closed for maintenance/.test(error.message);

/** A signed-up player with a claimed starter deck and an inbox. */
async function player(setup, account, starterId = "precon_foundry") {
  const user = await setup.users.findOrCreate({ network: "steem", account }, setup.clock.now(), uuidV4(deterministicRandom(`user:${account}`)));
  const { deck } = await setup.app.starters.claim({ userId: user.id, starterId, ip: "127.0.0.1" });
  const inbox = [];
  setup.app.hub.attach(user.id, { send: (message) => inbox.push(JSON.parse(message)), close: () => undefined });
  return { user: { id: user.id, account }, buyer: { id: user.id, account, network: "steem" }, deckId: deck.id, inbox };
}

/** @param {Awaited<ReturnType<typeof buildTestApp>>} setup */
function orderOf(setup, buyer, key) {
  return setup.app.marketplace.createOrder({ buyer, items: [{ productId: "core_booster", quantity: 1 }], asset: "STEEM", idempotencyKey: `maintenance-key-${key}-00000`, ip: "127.0.0.1" });
}

describe("maintenance", () => {
  it("closes new orders, purchases and queue entries, empties the queue, and reopens", async () => {
    const setup = await buildTestApp();
    const { app } = setup;
    const alice = await player(setup, "alice");
    const bob = await player(setup, "bob", "precon_shadow");
    const placed = await orderOf(setup, alice.buyer, "before");
    const [copy] = await app.inventory.mint({ ownerId: alice.user.id, items: [{ definitionId: "ember_imp", count: 1 }], edition: "core-1", origin: { kind: "purchase", ref: "test:maintenance" } });
    await app.matchmaking.join({ user: alice.user, mode: "casual", deckId: alice.deckId });

    const announced = await app.maintenance.announce({ userId: null }, { minutes: 15, message: " New cards! " });
    await settled();
    assert.deepEqual(announced, { at: new Date(setup.clock.now() + 15 * MINUTE).toISOString(), message: "New cards!" });
    assert.deepEqual(last(bob.inbox, "maintenance"), { maintenance: announced }, "every connected player hears it");
    assert.deepEqual(last(alice.inbox, "queue.status"), { state: "idle", reason: "maintenance" }, "whoever waited left the queue");
    assert.deepEqual(await app.matchmaking.status(alice.user.id), { state: "idle" });

    await assert.rejects(app.matchmaking.join({ user: bob.user, mode: "casual", deckId: bob.deckId }), isMaintenance);
    await assert.rejects(orderOf(setup, bob.buyer, "during"), isMaintenance);
    const { listing } = await app.sales.list({ seller: alice.buyer, copy: copy.id, price: "1.5", asset: "STEEM", idempotencyKey: "maintenance-listing-0001", ip: "x" });
    await assert.rejects(app.sales.reserve({ buyer: bob.buyer, listingId: listing.id, ip: "x" }), isMaintenance, "listing stays open, buying does not");
    assert.equal((await orderOf(setup, alice.buyer, "before")).order.id, placed.order.id, "an order already placed is still answered");
    assert.equal(await app.matchmaking.pair(), 0);

    assert.equal(await app.maintenance.end({ userId: null }), true);
    assert.deepEqual(last(bob.inbox, "maintenance"), { maintenance: null });
    assert.equal((await app.matchmaking.join({ user: bob.user, mode: "casual", deckId: bob.deckId })).state, "searching");
    assert.ok((await app.sales.reserve({ buyer: bob.buyer, listingId: listing.id, ip: "x" })).id);
    assert.equal(await app.maintenance.end({ userId: null }), false, "nothing left to end");
    const audited = await setup.database.rows("SELECT action FROM audit_logs WHERE action LIKE 'admin.maintenance%' ORDER BY seq");
    assert.deepEqual(audited.map((row) => row.action), ["admin.maintenance_announced", "admin.maintenance_ended"]);
  });

  it("refuses announcements out of range", async () => {
    const { app } = await buildTestApp();
    await assert.rejects(app.maintenance.announce({}, { minutes: -1, message: null }), /minutes must be an integer/);
    await assert.rejects(app.maintenance.announce({}, { minutes: 24 * 60 + 1, message: null }), /minutes must be an integer/);
    await assert.rejects(app.maintenance.announce({}, { minutes: 5, message: "x".repeat(201) }), /longer than 200/);
    assert.equal(app.maintenance.current(), null);
  });

  it("reaches every process through the database, survives a restart, and answers the command line", async () => {
    const first = await buildTestApp();
    const stopFirst = await first.app.maintenance.start();
    const alice = await player(first, "alice");
    const second = await buildTestApp({ database: first.database, clock: first.clock, random: deterministicRandom("second process") });

    const announced = await runMaintenanceCommand({ maintenance: second.app.maintenance }, ["announce", "10", "Back soon"]);
    assert.equal(announced.ok, true);
    await settled();
    assert.deepEqual(first.app.maintenance.current(), { at: new Date(first.clock.now() + 10 * MINUTE).toISOString(), message: "Back soon" });
    assert.equal(last(alice.inbox, "maintenance").maintenance.message, "Back soon", "pushed by the process the player is connected to");

    const restarted = await buildTestApp({ database: first.database, clock: first.clock, random: deterministicRandom("restart") });
    assert.equal(restarted.app.maintenance.isClosed(), false, "not read before start");
    const stopRestarted = await restarted.app.maintenance.start();
    assert.equal(restarted.app.maintenance.isClosed(), true, "read from the database at start");

    assert.deepEqual(await runMaintenanceCommand({ maintenance: second.app.maintenance }, ["end"]), { ok: true, result: { ended: true } });
    await settled();
    assert.equal(first.app.maintenance.current(), null);
    assert.equal(restarted.app.maintenance.current(), null);
    assert.equal((await runMaintenanceCommand({ maintenance: second.app.maintenance }, ["announce", "soon"])).ok, false);
    await stopFirst();
    await stopRestarted();
  });

  describe("over HTTP", () => {
    /** @type {Awaited<ReturnType<typeof buildTestApp>>} */
    let setup;
    /** @type {{ base: string, close: () => Promise<unknown> }} */
    let server;
    /** @type {ApiClient} */
    let operator;
    /** @type {ApiClient} */
    let alice;
    const operatorKeys = keyPair(7);
    const aliceKeys = keyPair(1);

    before(async () => {
      setup = await buildTestApp();
      server = await listen(setup.app);
      setup.chain.setAccount(SHOP, [operatorKeys.publicKey]);
      setup.chain.setAccount("alice", [aliceKeys.publicKey]);
      operator = new ApiClient(server.base);
      await operator.signIn(SHOP, operatorKeys.privateKey);
      alice = new ApiClient(server.base);
      await alice.signIn("alice", aliceKeys.privateKey);
    });

    after(() => server.close());

    it("lets anyone read it and only operators change it", async () => {
      const anonymous = new ApiClient(server.base);
      const nothing = await anonymous.get("/api/maintenance");
      assert.equal(nothing.status, 200);
      assert.deepEqual(nothing.json, { maintenance: null, build: null }, "no version named in development");

      assert.equal((await alice.post("/api/admin/maintenance", { minutes: 10 })).status, 403);
      assert.equal((await anonymous.post("/api/admin/maintenance", { minutes: 10 })).status, 401);
      assert.equal((await operator.post("/api/admin/maintenance", { minutes: -5 })).status, 400);
      assert.equal((await operator.post("/api/admin/maintenance", { minutes: 10, when: "now" })).status, 400);

      const announced = await operator.post("/api/admin/maintenance", { minutes: 10, message: "New cards" });
      assert.equal(announced.status, 200);
      assert.deepEqual((await anonymous.get("/api/maintenance")).json, { ...announced.json, build: null });
      const refused = await alice.post("/api/orders", { items: [{ productId: "core_booster", quantity: 1 }], asset: "STEEM" }, { "Idempotency-Key": "maintenance-http-000001" });
      assert.deepEqual([refused.status, refused.json.error.code], [503, "MAINTENANCE"]);

      assert.equal((await alice.delete("/api/admin/maintenance")).status, 403);
      assert.deepEqual((await operator.delete("/api/admin/maintenance")).json, { ended: true });
      assert.deepEqual((await anonymous.get("/api/maintenance")).json, { maintenance: null, build: null });
    });

    it("names the version being served, so tabs opened before a deploy can tell", async () => {
      const deployed = await buildTestApp({ env: { M8_BUILD: "96e1df5c1a2b" } });
      const deployedServer = await listen(deployed.app);
      try {
        const status = await new ApiClient(deployedServer.base).get("/api/maintenance");
        assert.deepEqual(status.json, { maintenance: null, build: "96e1df5c1a2b" });
        assert.equal(status.headers.get("cache-control"), "no-store");
      } finally {
        await deployedServer.close();
      }
    });
  });
});
