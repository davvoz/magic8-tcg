/**
 * Layout lint for phones: every screen, built for the compact profile on the
 * smallest supported phone (an iPhone SE) and a common one (an iPhone 14),
 * keeps each control on screen (or inside the list that scrolls it), tall
 * enough for a finger, and clear of the other controls.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ok } from "@magic8/engine/shared/Result.js";
import { DeckSelectionService } from "../../src/application/decks/DeckSelectionService.js";
import { NotificationService } from "../../src/application/notifications/NotificationService.js";
import { OnlineService } from "../../src/application/online/OnlineService.js";
import { ShopService } from "../../src/application/shop/ShopService.js";
import { MemoryLogger } from "../../src/infrastructure/logging/MemoryLogger.js";
import { Viewport } from "../../src/rendering/canvas/Viewport.js";
import { CollectionScene } from "../../src/rendering/scenes/CollectionScene.js";
import { DeckBuilderScene } from "../../src/rendering/scenes/DeckBuilderScene.js";
import { DeckSelectionScene } from "../../src/rendering/scenes/DeckSelectionScene.js";
import { ErrorScene } from "../../src/rendering/scenes/ErrorScene.js";
import { ActiveKeyPrompt } from "../../src/application/wallet/ActiveKeyPrompt.js";
import { LoginScene } from "../../src/rendering/scenes/LoginScene.js";
import { MainMenuScene } from "../../src/rendering/scenes/MainMenuScene.js";
import { NotificationsScene } from "../../src/rendering/scenes/NotificationsScene.js";
import { OnlineScene } from "../../src/rendering/scenes/OnlineScene.js";
import { ShopScene } from "../../src/rendering/scenes/ShopScene.js";
import { StarterScene } from "../../src/rendering/scenes/StarterScene.js";
import { ScrollList } from "../../src/rendering/ui/ScrollList.js";
import { ALICE, accountWorld, settle } from "../application/accountWorld.js";
import { fakeMarketApi } from "../application/fakeMarketApi.js";
import { loadBundledContent } from "../application/fixtures.js";
import { FakeContext2D, loadTheme } from "./fakes.js";

const theme = loadTheme();
const content = await loadBundledContent();
const PHONES = Object.freeze([
  Object.freeze({ name: "iPhone SE", cssWidth: 667, cssHeight: 375 }),
  Object.freeze({ name: "iPhone 14", cssWidth: 844, cssHeight: 390 }),
]);
/** The least a control may measure under a finger, in CSS pixels. */
const MIN_TOUCH = 40;
const EPSILON = 0.5;

/**
 * A signed-in player (starter taken, so the collection has cards) with every service a screen may ask for.
 * @param {{ cssWidth: number, cssHeight: number }} phone
 * @param {{ starter?: boolean }} [options]
 */
async function world(phone, { starter = true } = {}) {
  const account = accountWorld(content);
  account.identity.become(ALICE);
  await settle();
  if (starter) {
    await account.account.claimStarter("precon_ember");
    await settle();
  }
  const logger = new MemoryLogger();
  const connection = { connect: () => undefined, close: () => undefined, request: async (t) => ok(t === "hello" ? { t: "welcome", d: { user: {}, serverTime: 0, activeGame: null, queue: { state: "idle" } } } : { t: "ok", d: {} }), subscribe: () => () => undefined, onStatus: () => () => undefined };
  const feed = [{ id: 1, kind: "sale.sold", data: { account: "carol", card: { definitionId: "pyre_drake", serial: 7 }, price: "1.500", asset: "STEEM", listingId: "l" }, createdAt: 0, read: false }];
  const wallet = { name: "Steem Keychain", isAvailable: () => true, signMessage: async () => ok(""), requestTransfer: async () => ok("ef".repeat(20)) };
  const app = {
    content,
    deckSelection: new DeckSelectionService({ content, repository: account.repository, logger }),
    deckBuilding: account.builder,
    matchSetup: {},
    createSeed: () => "9f".repeat(32),
    logger,
    environment: { version: "test", release: "v0 test", storage: "local" },
    identity: account.identity,
    account: account.account,
    shop: new ShopService({ api: fakeMarketApi().api, wallet, account: account.account, scheduler: { delay: async () => undefined }, newKey: () => "key-000000000000001" }),
    online: new OnlineService({ connection, randomHex: (bytes) => "ab".repeat(bytes), newCommandId: () => "00000000-0000-4000-8000-000000000001", accountDecks: () => [{ id: "11111111-1111-4111-8111-111111111111", name: "Iron Foundry", mix: [{ faction: "iron", count: 30 }], totalCards: 30, playable: true, problem: null }], logger }),
    notifications: new NotificationService({ api: { list: async () => ok({ notifications: feed, unread: 1, more: false }), markRead: async () => ok({ unread: 0 }) }, connection, logger }),
  };
  app.notifications.start();
  await settle();
  const viewport = new Viewport(theme.layout);
  viewport.resize(phone);
  const services = { theme, viewport, logger, requestRender: () => undefined, navigate: () => undefined, hasScene: () => true, usingTouch: () => true };
  return { app, services, viewport };
}

/** Every node of a tree with the ScrollList that clips it, if any. */
function walk(root) {
  /** @type {{ node: import("../../src/rendering/ui/UiNode.js").UiNode, clip: ScrollList | null }[]} */
  const found = [];
  const visit = (node, clip) => {
    if (!node.visible) {
      return;
    }
    found.push({ node, clip });
    const inner = node instanceof ScrollList ? node : clip;
    node.children.forEach((child) => visit(child, inner));
  };
  visit(root, null);
  return found;
}

const within = (inner, outer) => inner.x >= outer.x - EPSILON && inner.y >= outer.y - EPSILON && inner.x + inner.width <= outer.x + outer.width + EPSILON && inner.y + inner.height <= outer.y + outer.height + EPSILON;
const overlap = (a, b) => Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 1 && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 1;

/**
 * @param {import("../../src/rendering/scenes/Scene.js").Scene} scene
 * @param {Viewport} viewport
 * @param {string} label
 */
function assertFitsPhone(scene, viewport, label) {
  scene.render(new FakeContext2D());
  const screen = { x: 0, y: 0, width: viewport.logicalWidth, height: viewport.logicalHeight };
  const layer = topLayer(scene);
  const controls = walk(layer).filter(({ node }) => node.interactive && node !== layer && node.width > 0);
  assert.ok(controls.length > 0, `${label}: has controls`);
  for (const { node, clip } of controls) {
    const bounds = node.bounds;
    const name = `${label}: ${node.id || node.constructor.name}`;
    if (clip === null) {
      assert.ok(within(bounds, screen), `${name} stays on screen (${JSON.stringify(bounds)})`);
    } else {
      const list = clip.bounds;
      assert.ok(bounds.x >= list.x - EPSILON && bounds.x + bounds.width <= list.x + list.width + EPSILON, `${name} stays within its list's width`);
    }
    assert.ok(bounds.height * viewport.scale >= MIN_TOUCH - EPSILON, `${name} is tall enough for a finger (${(bounds.height * viewport.scale).toFixed(1)} px)`);
  }
  // Controls laid out side by side never cover one another (a list's rows are compared within their list).
  const loose = controls.filter(({ clip }) => clip === null);
  for (let index = 0; index < loose.length; index += 1) {
    for (let other = index + 1; other < loose.length; other += 1) {
      const a = loose[index].node;
      const b = loose[other].node;
      if (isAncestor(a, b) || isAncestor(b, a)) {
        continue;
      }
      assert.ok(!overlap(a.bounds, b.bounds), `${label}: ${a.id || a.constructor.name} and ${b.id || b.constructor.name} overlap`);
    }
  }
}

/** What the player can touch: the overlay (the active key asked for), the scene's modal, or the scene. */
const topLayer = (scene) => scene.overlay ?? scene.modal ?? scene.root;

const isAncestor = (node, descendant) => {
  for (let parent = descendant.parent; parent !== null; parent = parent.parent) {
    if (parent === node) {
      return true;
    }
  }
  return false;
};

/**
 * A payment with the player's own keys waiting for the active key.
 * @param {any} app
 * @param {boolean} saved whether a key is saved under a PIN
 */
function askForActiveKey(app, saved) {
  const activeKeys = new ActiveKeyPrompt();
  Object.assign(app, { activeKeys });
  void activeKeys.ask({ account: "alice", saved });
}

/** Each screen: its scene, how to enter it, and what to do once there before checking. */
const SCREENS = Object.freeze([
  { name: "main menu", make: (s, app) => new MainMenuScene(s, app) },
  { name: "deck selection", make: (s, app) => new DeckSelectionScene(s, app) },
  { name: "deck builder library", make: (s, app) => new DeckBuilderScene(s, app) },
  { name: "deck builder editor", make: (s, app) => new DeckBuilderScene(s, app), before: (app) => app.deckBuilding.startNew() },
  { name: "collection", make: (s, app) => new CollectionScene(s, app) },
  { name: "shop", make: (s, app) => new ShopScene(s, app) },
  { name: "shop singles", make: (s, app) => new ShopScene(s, app), after: (scene) => scene.root.findById("shop.tab.singles")?.activate() },
  { name: "shop decks", make: (s, app) => new ShopScene(s, app), after: (scene) => scene.root.findById("shop.tab.decks")?.activate() },
  { name: "starter", make: (s, app) => new StarterScene(s, app), starter: false },
  { name: "notifications", make: (s, app) => new NotificationsScene(s, app) },
  { name: "online lobby", make: (s, app) => new OnlineScene(s, app) },
  { name: "sign in", make: (s, app) => new LoginScene(s, { ...app, identity: { ...app.identity, walletName: "Steem Keychain", walletAvailable: true, signIn: async () => ok(null) } }) },
  { name: "sign in with a posting key", make: (s, app) => new LoginScene(s, { ...app, identity: { ...app.identity, walletName: "Steem Keychain", walletAvailable: false, keysAvailable: true, signIn: async () => ok(null), signInWithKey: async () => ok(null) } }) },
  { name: "shop asking for the active key", make: (s, app) => new ShopScene(s, app), before: (app) => askForActiveKey(app, false), after: (scene) => assert.ok(scene.overlay?.findById("activeKey.key")) },
  { name: "shop unlocking the saved active key", make: (s, app) => new ShopScene(s, app), before: (app) => askForActiveKey(app, true), after: (scene) => assert.ok(scene.overlay?.findById("activeKey.forget")) },
  { name: "error", make: (s) => new ErrorScene(s), params: { title: "Something went wrong", message: "A long explanation of what went wrong." }, controls: false },
]);

for (const phone of PHONES) {
  describe(`Every screen on an ${phone.name}`, () => {
    for (const screen of SCREENS) {
      it(`fits the ${screen.name}`, async () => {
        const { app, services, viewport } = await world(phone, { starter: screen.starter ?? true });
        assert.equal(viewport.compact, true);
        screen.before?.(app);
        const scene = screen.make(services, app);
        scene.enter(screen.params ?? {});
        await settle();
        screen.after?.(scene);
        await settle();
        if (screen.controls === false) {
          scene.render(new FakeContext2D());
          return;
        }
        assertFitsPhone(scene, viewport, `${phone.name} ${screen.name}`);
      });
    }
  });
}
