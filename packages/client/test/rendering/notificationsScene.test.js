/**
 * Notifications and rarity on screen: the feed (new markers, cards that open
 * their details, the way to the follow-up screen, marking read), the toasts
 * over any scene, the main menu's button, and a card's rarity shown on its
 * face, on its strip and in the details of every screen that lists cards.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ok } from "@magic8/engine/shared/Result.js";
import { buildCardRarities } from "../../src/application/content/CardRarities.js";
import { NotificationService } from "../../src/application/notifications/NotificationService.js";
import { MemoryLogger } from "../../src/infrastructure/logging/MemoryLogger.js";
import { Viewport } from "../../src/rendering/canvas/Viewport.js";
import { CardDetail } from "../../src/rendering/cards/CardDetail.js";
import { CardStrip } from "../../src/rendering/cards/CardStrip.js";
import { CardThumb } from "../../src/rendering/cards/CardThumb.js";
import { MainMenuScene } from "../../src/rendering/scenes/MainMenuScene.js";
import { NotificationsScene, timeAgo } from "../../src/rendering/scenes/NotificationsScene.js";
import { SceneManager } from "../../src/rendering/scenes/SceneManager.js";
import { SceneId } from "../../src/rendering/scenes/sceneIds.js";
import { StarterScene } from "../../src/rendering/scenes/StarterScene.js";
import { ToastLayer } from "../../src/rendering/ui/ToastLayer.js";
import { ALICE, accountWorld, settle } from "../application/accountWorld.js";
import { loadBundledContent } from "../application/fixtures.js";
import { FakeContext2D, loadTheme } from "./fakes.js";

const theme = loadTheme();
const content = await loadBundledContent();
const rarities = /** @type {{ ok: true, value: import("../../src/application/content/CardRarities.js").CardRarities }} */ (buildCardRarities({ rarities: ["common", "uncommon", "rare"], cards: { ember_imp: "common", iron_watcher: "uncommon", pyre_drake: "rare" } }, content.catalog)).value;
const NOW = 10 * 24 * 60 * 60 * 1000;

const feed = [
  { id: 3, kind: "sale.sold", data: { account: "carol", card: { definitionId: "pyre_drake", serial: 7 }, price: "1.500", asset: "STEEM", listingId: "l" }, createdAt: NOW - 5 * 60 * 1000, read: false },
  { id: 2, kind: "trade.offered", data: { account: "bob", tradeId: "t", give: [{ definitionId: "ember_imp", count: 2 }], wants: [{ definitionId: "iron_watcher", count: 1 }] }, createdAt: NOW - 3 * 60 * 60 * 1000, read: false },
  { id: 1, kind: "trade.expired", data: { account: "bob", tradeId: "u", give: [] }, createdAt: NOW - 2 * 24 * 60 * 60 * 1000, read: true },
];

function harness() {
  const world = accountWorld(content);
  const api = {
    marked: [],
    list: async () => ok({ notifications: feed.map((item) => ({ ...item, read: item.read || api.marked.length > 0 })), unread: api.marked.length > 0 ? 0 : 2, more: false }),
    markRead: async (request) => (api.marked.push(request), ok({ unread: 0 })),
  };
  const connection = { connect: () => undefined, close: () => undefined, request: async () => ok({ t: "ok", d: {} }), subscribe: () => () => undefined, onStatus: () => () => undefined };
  const notifications = new NotificationService({ api, connection, logger: new MemoryLogger() });
  const viewport = new Viewport(theme.layout);
  viewport.resize({ cssWidth: 1600, cssHeight: 900 });
  const navigated = [];
  const app = { content, deckSelection: { listDecks: () => [] }, deckBuilding: world.builder, matchSetup: {}, createSeed: () => "00", logger: world.logger, environment: { version: "test", storage: "local" }, identity: world.identity, account: world.account, notifications, rarities };
  const services = { theme, viewport, logger: world.logger, requestRender: () => undefined, navigate: (id, params) => navigated.push({ id, params }), hasScene: () => true };
  return { ...world, api, notifications, app, services, navigated, viewport };
}

/** Every node in the tree, depth first. */
function nodes(root) {
  const found = [];
  const visit = (node) => {
    found.push(node);
    node.children.forEach(visit);
  };
  visit(root);
  return found;
}
const byId = (scene, id) => scene.root.findById(id) ?? (scene.modal === null ? null : scene.modal.findById(id));
function rendered(scene) {
  const context = new FakeContext2D();
  scene.render(context);
  return context.texts;
}

describe("NotificationsScene", () => {
  it("lists the feed with what is new, shows the cards with their rarity, opens them, and marks everything read", async () => {
    const h = harness();
    h.notifications.start();
    await settle();
    const scene = new NotificationsScene(h.services, h.app, () => NOW);
    scene.enter({});
    await settle();
    assert.equal(byId(scene, "notifications.title.3").text, "New · Card sold");
    assert.equal(byId(scene, "notifications.title.2").text, "New · New trade offer");
    assert.equal(byId(scene, "notifications.title.1").text, "Trade expired", "what was already read is not new");
    assert.equal(byId(scene, "notifications.body.2").text, "@bob offers you 2× Ember Imp for Iron Watcher.");
    assert.ok(rendered(scene).includes("5 min ago"));
    assert.deepEqual(h.api.marked, [{ all: true }], "opening the feed marks it read");
    assert.equal(h.notifications.state.unread, 0);

    const thumbs = nodes(scene.root).filter((node) => node instanceof CardThumb);
    assert.deepEqual(thumbs.map((thumb) => [thumb.card.id, thumb.rarity, thumb.caption]), [["pyre_drake", "rare", "#7"], ["ember_imp", "common", "2× offered"], ["iron_watcher", "uncommon", "asked"]]);
    thumbs[0].activate();
    assert.equal(byId(scene, "cardInfo.name").text, "Pyre Drake");
    assert.equal(byId(scene, "cardInfo.rarity").text, "Rare");
    assert.equal(byId(scene, "cardInfo.line.0").text, "Serial #7");
    assert.ok(nodes(scene.modal).some((node) => node instanceof CardDetail && node.rarity === "rare"), "the full card shows its rarity too");
    byId(scene, "cardInfo.close").activate();
    assert.equal(scene.modal, null);

    byId(scene, "notifications.open.2").activate();
    assert.deepEqual(h.navigated.map((entry) => entry.id), [SceneId.TRADES]);
    scene.exit();
  });

  it("says so when there is nothing yet", async () => {
    const h = harness();
    h.api.list = async () => ok({ notifications: [], unread: 0, more: false });
    h.notifications.start();
    await settle();
    const scene = new NotificationsScene(h.services, h.app, () => NOW);
    scene.enter({});
    await settle();
    assert.match(byId(scene, "notifications.empty").text, /Nothing yet/);
  });

  it("words elapsed time", () => {
    assert.deepEqual([timeAgo(NOW - 1000, NOW), timeAgo(NOW - 90 * 60 * 1000, NOW), timeAgo(NOW - 24 * 60 * 60 * 1000, NOW), timeAgo(NOW - 3 * 24 * 60 * 60 * 1000, NOW)], ["just now", "1 h ago", "1 day ago", "3 days ago"]);
  });
});

describe("main menu notifications button", () => {
  it("appears once the account is loaded and counts the unread notifications", async () => {
    const h = harness();
    const menu = new MainMenuScene(h.services, h.app);
    menu.enter({});
    assert.equal(byId(menu, "notifications"), null, "not before sign-in");
    h.identity.become(ALICE);
    await settle();
    h.notifications.start();
    await settle();
    assert.equal(byId(menu, "notifications").text, "Notifications (2)");
    byId(menu, "notifications").activate();
    assert.equal(h.navigated.at(-1).id, SceneId.NOTIFICATIONS);
    menu.exit();
  });
});

describe("ToastLayer", () => {
  it("stacks the newest toasts over the scene, fades them out, and opens the feed on a click", () => {
    const opened = [];
    const toasts = new ToastLayer({ viewport: { bounds: { x: 0, y: 0, width: 1600, height: 900 } }, onOpen: (message) => opened.push(message.title), requestRender: () => undefined });
    for (const title of ["one", "two", "three", "four"]) {
      toasts.show({ title, body: "A long enough body to wrap over a couple of lines in the toast, and then some more words.", tone: "good" });
    }
    assert.deepEqual(toasts.messages.map((message) => message.title), ["four", "three", "two"], "at most three, newest on top");
    const context = new FakeContext2D();
    toasts.render(context, theme);
    assert.ok(context.texts.includes("four"));
    assert.equal(toasts.onPointer({ type: "down", x: 100, y: 40 }), false, "clicks elsewhere reach the scene");
    assert.equal(toasts.onPointer({ type: "down", x: 1500, y: 40 }), true);
    assert.equal(toasts.onPointer({ type: "up", x: 1500, y: 40 }), true);
    assert.deepEqual(opened, ["four"]);
    assert.equal(toasts.update(3000), false, "nothing to redraw while they rest");
    assert.equal(toasts.update(3000), true, "they leave after a few seconds");
    assert.deepEqual(toasts.messages, []);
  });

  it("is drawn above every scene and sees clicks first", () => {
    const manager = new SceneManager({ theme, viewport: new Viewport(theme.layout), logger: new MemoryLogger(), requestRender: () => undefined });
    const seen = [];
    manager.register("plain", () => ({ enter: () => undefined, exit: () => undefined, update: () => false, render: () => seen.push("scene"), onPointer: () => seen.push("scene click"), onKey: () => undefined }));
    manager.navigate("plain");
    manager.setOverlay({ update: () => true, render: () => seen.push("overlay"), onPointer: (input) => input.x > 800 });
    assert.equal(manager.update(16), true);
    manager.render(new FakeContext2D());
    manager.onPointer({ type: "down", x: 900, y: 10 });
    manager.onPointer({ type: "down", x: 10, y: 10 });
    assert.deepEqual(seen, ["scene", "overlay", "scene click"]);
  });
});

describe("rarity on cards", () => {
  it("names the rarity on the strip, and on the face at inspect size", () => {
    const card = content.catalog.get("pyre_drake");
    const strip = new CardStrip({ width: 600, height: 56, card, rarity: "rare" });
    const context = new FakeContext2D();
    strip.draw(context, theme);
    assert.ok(context.texts.includes("Rare · "));
    const detail = new CardDetail({ width: 380, height: 560, card, rarity: "rare" });
    const face = new FakeContext2D();
    detail.draw(face, theme);
    assert.ok(face.texts.some((text) => text.endsWith("· Rare")));
    const plain = new FakeContext2D();
    new CardStrip({ width: 600, height: 56, card }).draw(plain, theme);
    assert.ok(!plain.texts.some((text) => text.includes("Rare")), "no rarity, no label");
  });

  it("gives every card of the starter offer its rarity and its details", async () => {
    const h = harness();
    const everyCard = Object.fromEntries(content.catalog.all().map((card) => [card.id, "uncommon"]));
    const app = { ...h.app, rarities: /** @type {any} */ (buildCardRarities({ rarities: ["uncommon"], cards: everyCard }, content.catalog)).value };
    h.identity.become(ALICE);
    await settle();
    const scene = new StarterScene(h.services, app);
    scene.enter({});
    const strips = nodes(scene.root).filter((node) => node instanceof CardStrip);
    assert.ok(strips.length > 0);
    assert.ok(strips.every((strip) => strip.rarity === "uncommon"), "every card shows its rarity");
    const first = strips[0].card;
    const info = nodes(scene.root).find((node) => typeof node.id === "string" && node.id.startsWith("starter.info.") && node.id.endsWith(`.${first.id}`));
    info.activate();
    assert.equal(byId(scene, "cardInfo.name").text, first.name);
    assert.equal(byId(scene, "cardInfo.rarity").text, "Uncommon");
    assert.match(byId(scene, "cardInfo.line.0").text, /^In this deck: \d+$/);
    scene.exit();
  });
});
