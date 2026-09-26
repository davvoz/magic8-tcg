/**
 * Notifications (docs/tcg/15-notifiche.md) on the real services and
 * database: a notification exists exactly when the change it reports
 * committed, the relay pushes it only after the commit and only to a
 * player connected to this process, the feed pages and marks read, old
 * rows are purged — and trades and sales tell the right player, with the
 * cards involved.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { uuidV4 } from "../../src/kernel/random.js";
import { NotificationKind } from "../../src/modules/notifications/index.js";
import { buildTestApp, deterministicRandom } from "../helpers.js";

const PRINTING = Object.freeze({ edition: "core-1", finish: "standard" });
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Lets the in-process NOTIFY reach the relay and the relay read its row. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 20));

async function world(options = {}) {
  const setup = await buildTestApp(options);
  const { app } = setup;
  const inbox = new Map();
  const player = async (account, { connected = true } = {}) => {
    const user = await setup.users.findOrCreate({ network: "steem", account }, setup.clock.now(), uuidV4(deterministicRandom(`user:${account}`)));
    inbox.set(user.id, []);
    if (connected) {
      app.hub.attach(user.id, { send: (message) => inbox.get(user.id).push(JSON.parse(message)), close: () => undefined });
    }
    return { id: user.id, account, network: "steem" };
  };
  const pushed = (user) => inbox.get(user.id).filter((message) => message.t === "notification").map((message) => message.d);
  const feed = async (user) => (await app.notifications.list(user.id)).notifications;
  const stop = await app.notificationRelay.start();
  return { setup, app, player, pushed, feed, inbox, stop };
}

describe("notifications", () => {
  it("records and pushes a notification only when the change it reports commits", async () => {
    const w = await world();
    try {
      const alice = await w.player("alice");
      await assert.rejects(
        w.setup.database.transaction(async () => {
          await w.app.notifications.notify(alice.id, NotificationKind.TRADE_EXPIRED, { tradeId: "t1" });
          throw new Error("the change failed");
        }),
        /the change failed/,
      );
      await settled();
      assert.deepEqual(await w.feed(alice), [], "a rolled back change leaves no notification");
      assert.deepEqual(w.pushed(alice), [], "and pushes nothing");

      await w.setup.database.transaction(async () => {
        await w.app.notifications.notify(alice.id, NotificationKind.TRADE_EXPIRED, { tradeId: "t2" });
        await settled();
        assert.deepEqual(w.pushed(alice), [], "nothing is pushed before the commit");
      });
      await settled();
      const [notification] = w.pushed(alice);
      assert.deepEqual([notification.kind, notification.data, notification.read], [NotificationKind.TRADE_EXPIRED, { tradeId: "t2" }, false]);
      assert.deepEqual((await w.feed(alice)).map((entry) => entry.id), [notification.id]);

      await assert.rejects(w.app.notifications.notify(alice.id, "shop.unheard_of", {}), /unknown notification kind/);
      await assert.rejects(w.app.notifications.notify(alice.id, NotificationKind.TRADE_EXPIRED, { blob: "x".repeat(5000) }), /larger than/);
    } finally {
      await w.stop();
    }
  });

  it("pushes to the player concerned only, and keeps the feed for players who are away", async () => {
    const w = await world();
    try {
      const alice = await w.player("alice");
      const bob = await w.player("bob", { connected: false });
      await w.app.notifications.notify(bob.id, NotificationKind.TRADE_CANCELLED, { tradeId: "t" });
      await settled();
      assert.deepEqual(w.pushed(alice), [], "alice hears nothing of bob's notifications");
      assert.equal((await w.app.notifications.list(bob.id)).unread, 1, "bob finds it when he comes back");
    } finally {
      await w.stop();
    }
  });

  it("pages the feed newest first, marks read, and purges old rows", async () => {
    const w = await world();
    try {
      const alice = await w.player("alice", { connected: false });
      const bob = await w.player("bob", { connected: false });
      for (let index = 0; index < 35; index += 1) {
        await w.app.notifications.notify(alice.id, NotificationKind.TRADE_EXPIRED, { tradeId: `t${index}` });
      }
      const first = await w.app.notifications.list(alice.id);
      assert.deepEqual([first.notifications.length, first.unread, first.more, first.notifications[0].data.tradeId], [30, 35, true, "t34"]);
      const second = await w.app.notifications.list(alice.id, String(first.notifications.at(-1).id));
      assert.deepEqual([second.notifications.length, second.more, second.notifications.at(-1).data.tradeId], [5, false, "t0"]);
      await assert.rejects(w.app.notifications.list(alice.id, "abc"), /before must be a notification id/);

      assert.deepEqual(await w.app.notifications.markRead(alice.id, { ids: [first.notifications[0].id, first.notifications[1].id] }), { unread: 33 });
      assert.deepEqual(await w.app.notifications.markRead(bob.id, { ids: [first.notifications[2].id] }), { unread: 0 }, "nobody marks another player's feed");
      assert.equal((await w.app.notifications.list(alice.id)).unread, 33);
      for (const bad of [{}, { ids: [] }, { ids: ["1"] }, { all: true, ids: [1] }, { all: false }]) {
        await assert.rejects(w.app.notifications.markRead(alice.id, bad), /send/);
      }
      assert.deepEqual(await w.app.notifications.markRead(alice.id, { all: true }), { unread: 0 });

      await w.app.notifications.notify(alice.id, NotificationKind.TRADE_EXPIRED, { tradeId: "unread" });
      w.setup.clock.advance(31 * DAY);
      assert.equal(await w.app.notifications.purge(), 35, "read notifications go after 30 days");
      assert.deepEqual((await w.feed(alice)).map((entry) => entry.data.tradeId), ["unread"]);
      w.setup.clock.advance(150 * DAY);
      assert.equal(await w.app.notifications.purge(), 1, "unread ones after 180 days");
    } finally {
      await w.stop();
    }
  });

  it("tells the other side of every step of a trade, with the cards involved", async () => {
    const w = await world();
    try {
      const alice = await w.player("alice");
      const bob = await w.player("bob");
      const imps = await w.app.inventory.mint({ ownerId: alice.id, items: [{ definitionId: "ember_imp", count: 2 }], ...PRINTING, origin: { kind: "purchase", ref: "test:alice" } });
      await w.app.inventory.mint({ ownerId: bob.id, items: [{ definitionId: "iron_watcher", count: 3 }], ...PRINTING, origin: { kind: "purchase", ref: "test:bob" } });
      let keys = 0;
      const offer = (give, want) => w.app.trading.propose({ proposer: alice, to: "bob", give, want, idempotencyKey: `notify-key-${String((keys += 1)).padStart(8, "0")}`, ip: "x" });

      const { trade } = await offer([imps[0].id], [{ definitionId: "iron_watcher", count: 1 }]);
      await settled();
      const [offered] = w.pushed(bob);
      assert.deepEqual([offered.kind, offered.data], [NotificationKind.TRADE_OFFERED, { tradeId: trade.id, account: "alice", give: [{ definitionId: "ember_imp", count: 1 }], wants: [{ definitionId: "iron_watcher", count: 1 }] }]);
      assert.deepEqual(w.pushed(alice), [], "the proposer is not told of their own offer");

      await w.app.trading.accept({ userId: bob.id, tradeId: trade.id, ip: "x" });
      await settled();
      const [accepted] = w.pushed(alice);
      assert.deepEqual([accepted.kind, accepted.data.account, accepted.data.received, accepted.data.gave], [NotificationKind.TRADE_ACCEPTED, "bob", [{ definitionId: "iron_watcher", count: 1 }], [{ definitionId: "ember_imp", count: 1 }]]);

      const declined = (await offer([imps[1].id], [])).trade;
      await w.app.trading.decline({ userId: bob.id, tradeId: declined.id, ip: "x" });
      const cancelled = (await offer([imps[1].id], [])).trade;
      await w.app.trading.cancel({ userId: alice.id, tradeId: cancelled.id, ip: "x" });
      const expiring = (await offer([imps[1].id], [])).trade;
      w.setup.clock.advance(73 * HOUR);
      assert.equal(await w.app.trading.expireDue(), 1);
      await settled();
      const labels = new Map([[trade.id, "first"], [declined.id, "declined"], [cancelled.id, "cancelled"], [expiring.id, "expiring"]]);
      const kinds = (user) => w.pushed(user).map((entry) => `${entry.kind}:${labels.get(entry.data.tradeId)}`);
      assert.deepEqual(kinds(alice), ["trade.accepted:first", "trade.declined:declined", "trade.expired:expiring"]);
      assert.deepEqual(kinds(bob), ["trade.offered:first", "trade.offered:declined", "trade.offered:cancelled", "trade.cancelled:cancelled", "trade.offered:expiring", "trade.expired:expiring"]);
      assert.deepEqual(w.pushed(bob).at(-1).data.give, [{ definitionId: "ember_imp", count: 1 }]);
    } finally {
      await w.stop();
    }
  });

  it("tells the seller and the buyer when a sale completes, and the seller when a listing expires", async () => {
    const w = await world();
    try {
      const alice = await w.player("alice");
      const bob = await w.player("bob");
      const [imp, drake] = await w.app.inventory.mint({ ownerId: alice.id, items: [{ definitionId: "ember_imp", count: 1 }, { definitionId: "pyre_drake", count: 1 }], ...PRINTING, origin: { kind: "purchase", ref: "test:alice" } });
      const list = (copy, key) => w.app.sales.list({ seller: alice, copy: copy.id, price: "1.5", asset: "STEEM", idempotencyKey: `notify-list-${key}-000000`, ip: "x" });
      const { listing } = await list(imp, "a");
      await list(drake, "b");
      const purchase = await w.app.sales.reserve({ buyer: bob, listingId: listing.id, ip: "x" });
      w.setup.ledger.transfer({ from: purchase.payment.from, to: purchase.payment.to, amount: `${purchase.payment.amount} ${purchase.payment.asset}`, memo: purchase.payment.memo, time: w.setup.clock.now() });
      w.setup.ledger.finalize();
      assert.equal((await w.app.saleSettlement.runOnce()).completed, 1);
      await settled();
      const [sold] = w.pushed(alice);
      assert.deepEqual([sold.kind, sold.data.account, sold.data.price, sold.data.asset, sold.data.card.definitionId, sold.data.card.serial], [NotificationKind.SALE_SOLD, "bob", "1.500", "STEEM", "ember_imp", imp.serial]);
      const [bought] = w.pushed(bob);
      assert.deepEqual([bought.kind, bought.data.account, bought.data.card.definitionId], [NotificationKind.SALE_BOUGHT, "alice", "ember_imp"]);

      w.setup.clock.advance(400 * DAY);
      assert.equal(await w.app.sales.expireDue(), 1);
      await settled();
      const expired = w.pushed(alice).at(-1);
      assert.deepEqual([expired.kind, expired.data.card.definitionId], [NotificationKind.SALE_LISTING_EXPIRED, "pyre_drake"]);
    } finally {
      await w.stop();
    }
  });

  it("asks connected players to re-read their feed when the relay's channel came back", async () => {
    const setup = await buildTestApp();
    /** @type {() => void} */
    let reconnect = () => undefined;
    const { NotificationRelay } = await import("../../src/modules/notifications/index.js");
    const relay = new NotificationRelay({
      notifications: setup.app.notifications,
      listen: async (_channel, _onPayload, { onReconnect }) => {
        reconnect = onReconnect;
        return async () => undefined;
      },
      hub: setup.app.hub,
      logger: setup.logger,
    });
    const messages = [];
    setup.app.hub.attach("user-1", { send: (message) => messages.push(JSON.parse(message)), close: () => undefined });
    await relay.start();
    reconnect();
    assert.deepEqual(messages, [{ t: "notifications.resync", d: {} }]);
  });
});
