/**
 * Notifications on the client (docs/tcg/15-notifiche.md): the service reads
 * the feed when the connection opens, adds and announces what is pushed
 * (once), reads again when asked, pages and marks read; the texts name the
 * cards and lead to the right screen; card rarities come from their file.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fail, ok } from "@magic8/engine/shared/Result.js";
import { NO_RARITIES, buildCardRarities } from "../../src/application/content/CardRarities.js";
import { COLLECTION_CHANGING_KINDS, NotificationTarget, describeNotification } from "../../src/application/notifications/describeNotification.js";
import { NotificationService, NotificationStatus } from "../../src/application/notifications/NotificationService.js";
import { OnlineService, OnlineStatus } from "../../src/application/online/OnlineService.js";
import { MemoryLogger } from "../../src/infrastructure/logging/MemoryLogger.js";
import { loadBundledContent } from "./fixtures.js";

const content = await loadBundledContent();
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** @param {number} id @param {Partial<{ kind: string, data: object, read: boolean }>} [fields] */
const notification = (id, fields = {}) => Object.freeze({ id, kind: "trade.expired", data: { tradeId: `t${id}`, account: "bob", give: [] }, createdAt: 1000 + id, read: false, ...fields });

/** A connection the test opens and pushes on. */
function fakeConnection() {
  const listeners = new Set();
  const statusListeners = new Set();
  const connection = {
    status: "closed",
    connects: 0,
    requests: [],
    connect: () => {
      connection.connects += 1;
    },
    close: () => undefined,
    request: async (type, data) => {
      connection.requests.push({ type, data });
      return type === "hello" ? ok({ t: "welcome", d: { user: { account: "alice" }, activeGame: null, queue: { state: "idle" }, ackKey: null } }) : ok({ t: "ok", d: {} });
    },
    subscribe: (listener) => (listeners.add(listener), () => listeners.delete(listener)),
    onStatus: (listener) => (statusListeners.add(listener), () => statusListeners.delete(listener)),
    open: () => {
      connection.status = "open";
      statusListeners.forEach((listener) => listener("open", { code: null }));
    },
    push: (t, d) => listeners.forEach((listener) => listener({ t, d })),
  };
  return connection;
}

/** A feed the test fills; `list` answers from it a page of 2 at a time. */
function fakeApi(initial = []) {
  const api = {
    feed: [...initial],
    failing: false,
    marked: [],
    list: async (before) => {
      if (api.failing) {
        return fail("NETWORK", "the game server cannot be reached");
      }
      const older = api.feed.filter((item) => before === undefined || item.id < before).sort((left, right) => right.id - left.id);
      return ok({ notifications: older.slice(0, 2), unread: api.feed.filter((item) => !item.read).length, more: older.length > 2 });
    },
    markRead: async (request) => {
      api.marked.push(request);
      api.feed = api.feed.map((item) => ({ ...item, read: true }));
      return ok({ unread: 0 });
    },
  };
  return api;
}

function world(initial) {
  const api = fakeApi(initial);
  const connection = fakeConnection();
  const service = new NotificationService({ api, connection, logger: new MemoryLogger() });
  const arrived = [];
  service.onArrival((item) => arrived.push(item.id));
  return { api, connection, service, arrived };
}

describe("NotificationService", () => {
  it("reads the feed on start without announcing the backlog, then adds and announces each push once", async () => {
    const w = world([notification(1), notification(2, { read: true })]);
    w.service.start();
    w.service.start();
    assert.equal(w.connection.connects, 1, "connects once");
    await flush();
    assert.deepEqual([w.service.state.status, w.service.state.items.map((item) => item.id), w.service.state.unread], [NotificationStatus.READY, [2, 1], 1]);
    assert.deepEqual(w.arrived, [], "the backlog is not announced");

    w.connection.push("notification", notification(3));
    w.connection.push("notification", notification(3));
    w.connection.push("notification", { id: "x" });
    assert.deepEqual([w.service.state.items.map((item) => item.id), w.service.state.unread, w.arrived], [[3, 2, 1], 2, [3]]);
  });

  it("reads again on reconnection and on resync, announcing only what is new", async () => {
    const w = world([notification(1)]);
    w.service.start();
    await flush();
    w.api.feed.push(notification(2), notification(3));
    w.connection.open();
    await flush();
    assert.deepEqual([w.service.state.items.map((item) => item.id), w.arrived], [[3, 2], [2, 3]]);
    w.api.feed.push(notification(4));
    w.connection.push("notifications.resync", {});
    await flush();
    assert.deepEqual([w.service.state.items[0].id, w.arrived], [4, [2, 3, 4]]);
  });

  it("pages older notifications, marks all read, and forgets everything on stop", async () => {
    const w = world([notification(1), notification(2), notification(3)]);
    w.service.start();
    await flush();
    assert.equal(w.service.state.more, true);
    await w.service.loadMore();
    assert.deepEqual([w.service.state.items.map((item) => item.id), w.service.state.more], [[3, 2, 1], false]);
    await w.service.markAllRead();
    assert.deepEqual([w.service.state.unread, w.service.state.items.every((item) => item.read), w.api.marked], [0, true, [{ all: true }]]);
    await w.service.markAllRead();
    assert.equal(w.api.marked.length, 1, "nothing to mark: no request");

    w.service.stop();
    assert.deepEqual([w.service.state.status, w.service.state.items], [NotificationStatus.IDLE, []]);
    w.connection.push("notification", notification(9));
    assert.deepEqual(w.service.state.items, [], "a stopped service hears nothing");
  });

  it("keeps what arrived unread lit after marking all read, until each one is opened", async () => {
    const w = world([notification(1), notification(2, { read: true })]);
    w.service.start();
    await flush();
    w.connection.push("notification", notification(3));
    const unopened = () => [...w.service.state.unopened].sort();
    assert.deepEqual(unopened(), [1, 3], "what reached the player unread");
    await w.service.markAllRead();
    assert.deepEqual([w.service.state.unread, unopened()], [0, [1, 3]], "read, but not yet opened");
    await w.service.refresh();
    assert.deepEqual(unopened(), [1, 3], "a read feed does not unlight them");
    w.service.markOpened(3);
    w.service.markOpened(42);
    assert.deepEqual(unopened(), [1]);
    w.service.stop();
    assert.deepEqual(unopened(), []);
  });

  it("reports a feed that cannot be read", async () => {
    const w = world();
    w.api.failing = true;
    w.service.start();
    await flush();
    assert.deepEqual([w.service.state.status, w.service.state.error], [NotificationStatus.FAILED, "the game server cannot be reached"]);
  });
});

describe("OnlineService on a shared connection", () => {
  it("says hello at once when the notifications already opened the connection", async () => {
    const connection = fakeConnection();
    connection.open();
    const online = new OnlineService({ connection, randomHex: () => "00", newCommandId: () => "c", accountDecks: () => [], logger: new MemoryLogger() });
    online.start();
    await flush();
    assert.equal(connection.requests[0].type, "hello");
    assert.equal(online.state.status, OnlineStatus.IDLE);
  });
});

describe("describeNotification", () => {
  const describe_ = (kind, data) => describeNotification({ id: 1, kind, data, createdAt: 0, read: false }, content.catalog);

  it("names the cards, the other player and where to follow it up", () => {
    const offered = describe_("trade.offered", { account: "bob", give: [{ definitionId: "ember_imp", count: 2 }], wants: [{ definitionId: "iron_watcher", count: 1 }] });
    assert.equal(offered.title, "New trade offer");
    assert.equal(offered.body, "@bob offers you 2× Ember Imp for Iron Watcher.");
    assert.deepEqual(offered.cards.map((card) => [card.definitionId, card.caption]), [["ember_imp", "2× offered"], ["iron_watcher", "asked"]]);
    assert.equal(offered.target, NotificationTarget.TRADES);
    assert.equal(offered.account, "bob", "the other player, for their portrait");

    const fulfilled = describe_("shop.fulfilled", { orderId: "o", items: [{ productId: "core_booster", name: "Core Booster", quantity: 2 }], cards: [{ definitionId: "ember_imp", count: 1 }], total: 10 });
    assert.deepEqual([fulfilled.title, fulfilled.body, fulfilled.target, fulfilled.tone], ["Your cards have arrived", "2× Core Booster: 10 cards added to your collection.", NotificationTarget.COLLECTION, "good"]);
    assert.equal(fulfilled.account, undefined, "no other player, no portrait");

    const sold = describe_("sale.sold", { account: "carol", card: { definitionId: "pyre_drake", serial: 7 }, price: "1.500", asset: "STEEM" });
    assert.equal(sold.body, "@carol bought your Pyre Drake #7 for 1.500 STEEM.");
    assert.deepEqual([sold.cards[0].caption, sold.cards[0].serial], ["#7", 7]);

    const gift = describe_("trade.offered", { account: "bob", give: [{ definitionId: "ember_imp", count: 1 }], wants: [] });
    assert.equal(gift.body, "@bob offers you Ember Imp as a gift.");
    const many = describe_("trade.expired", { account: "bob", give: ["ember_imp", "iron_watcher", "pyre_drake", "ash_raider"].map((definitionId) => ({ definitionId, count: 1 })) });
    assert.match(many.body, /Ember Imp, Iron Watcher, Pyre Drake and 1 more/);
    assert.match(describe_("sale.payment_problem", { account: "dan", card: { definitionId: "ember_imp" }, problem: "WRONG_AMOUNT" }).body, /the amount was wrong/);
    assert.deepEqual(describe_("shop.mystery", {}).target, null, "an unknown kind still says something");
    assert.ok(COLLECTION_CHANGING_KINDS.includes("sale.bought") && !COLLECTION_CHANGING_KINDS.includes("trade.offered"));
  });
});

describe("CardRarities", () => {
  it("reads the rarities file, ignoring cards the game does not know", () => {
    const built = buildCardRarities({ rarities: ["common", "rare"], cards: { ember_imp: "common", pyre_drake: "rare", ghost_card: "rare" } }, content.catalog);
    assert.equal(built.ok, true);
    assert.deepEqual([built.value.of("ember_imp"), built.value.of("pyre_drake"), built.value.of("ghost_card"), built.value.of("iron_watcher")], ["common", "rare", null, null]);
    assert.deepEqual(built.value.order, ["common", "rare"]);
    assert.equal(NO_RARITIES.of("ember_imp"), null);
  });

  it("refuses a malformed file", () => {
    for (const raw of [null, { rarities: [] }, { rarities: ["common", "common"], cards: {} }, { rarities: ["Common"], cards: {} }, { rarities: ["common"], cards: [] }, { rarities: ["common"], cards: { ember_imp: "mythic" } }]) {
      assert.equal(buildCardRarities(raw, content.catalog).ok, false, JSON.stringify(raw));
    }
  });
});
