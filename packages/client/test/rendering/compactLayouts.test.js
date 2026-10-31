/**
 * Layout lint for phones: every screen, built for the compact profile on the
 * smallest supported phone (an iPhone SE) and a common one (an iPhone 14),
 * keeps each control on screen (or inside the list that scrolls it), tall
 * enough for a finger, and clear of the other controls. A screen inside the
 * navigation shell keeps its controls in the content area the shell leaves
 * it, and the shell's own (the rail, the top bar) on screen and clear of them.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ok } from "@magic8/engine/shared/Result.js";
import { DeckSelectionService } from "../../src/application/decks/DeckSelectionService.js";
import { AutoListService } from "../../src/application/auto/AutoListService.js";
import { EntryService } from "../../src/application/entries/EntryService.js";
import { NotificationService } from "../../src/application/notifications/NotificationService.js";
import { OnlineService } from "../../src/application/online/OnlineService.js";
import { RankingService } from "../../src/application/ranking/RankingService.js";
import { ShopService } from "../../src/application/shop/ShopService.js";
import { MemoryLogger } from "../../src/infrastructure/logging/MemoryLogger.js";
import { Viewport } from "../../src/rendering/canvas/Viewport.js";
import { CollectionScene } from "../../src/rendering/scenes/CollectionScene.js";
import { DeckBuilderScene } from "../../src/rendering/scenes/DeckBuilderScene.js";
import { DecksScene } from "../../src/rendering/scenes/DecksScene.js";
import { DeckSelectionScene } from "../../src/rendering/scenes/DeckSelectionScene.js";
import { ErrorScene } from "../../src/rendering/scenes/ErrorScene.js";
import { ActiveKeyPrompt } from "../../src/application/wallet/ActiveKeyPrompt.js";
import { LoginScene } from "../../src/rendering/scenes/LoginScene.js";
import { GoogleNameScene } from "../../src/rendering/scenes/GoogleNameScene.js";
import { WalletExport } from "../../src/application/wallet/WalletExport.js";
import { InfoScene } from "../../src/rendering/scenes/InfoScene.js";
import { HomeScene } from "../../src/rendering/scenes/HomeScene.js";
import { PlayScene } from "../../src/rendering/scenes/PlayScene.js";
import { OnboardingProgress } from "../../src/application/onboarding/OnboardingProgress.js";
import { LobbyService } from "../../src/application/lobby/LobbyService.js";
import { InMemoryStore } from "../../src/infrastructure/persistence/InMemoryStore.js";
import { StoredOnboarding } from "../../src/infrastructure/persistence/StoredOnboarding.js";
import { DailyScene } from "../../src/rendering/scenes/DailyScene.js";
import { DailyService } from "../../src/application/daily/DailyService.js";
import { DAY } from "../application/dailyFixtures.js";
import { NotificationsScene } from "../../src/rendering/scenes/NotificationsScene.js";
import { SeasonScene } from "../../src/rendering/scenes/SeasonScene.js";
import { CasualScene } from "../../src/rendering/scenes/CasualScene.js";
import { RankedScene } from "../../src/rendering/scenes/RankedScene.js";
import { ShopScene } from "../../src/rendering/scenes/ShopScene.js";
import { StarterScene } from "../../src/rendering/scenes/StarterScene.js";
import { Button } from "../../src/rendering/ui/Button.js";
import { Label } from "../../src/rendering/ui/Label.js";
import { Panel, PANEL_INSET, PanelCorners, SMALL_PANEL_INSET } from "../../src/rendering/ui/Panel.js";
import { ScrollList } from "../../src/rendering/ui/ScrollList.js";
import { TextBlock } from "../../src/rendering/ui/TextBlock.js";
import { ALICE, accountWorld, settle } from "../application/accountWorld.js";
import { LISTING_WITH_ENTRIES, fakeMarketApi } from "../application/fakeMarketApi.js";
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
    shop: new ShopService({ now: () => 0, api: fakeMarketApi().api, wallet, account: account.account, scheduler: { delay: async () => undefined }, newKey: () => "key-000000000000001" }),
    online: new OnlineService({ connection, randomHex: (bytes) => "ab".repeat(bytes), newCommandId: () => "00000000-0000-4000-8000-000000000001", accountDecks: () => [{ id: "11111111-1111-4111-8111-111111111111", name: "Iron Foundry", mix: [{ faction: "iron", count: 30 }], totalCards: 30, playable: true, problem: null }], logger }),
    notifications: new NotificationService({ api: { list: async () => ok({ notifications: feed, unread: 1, more: false }), markRead: async () => ok({ unread: 0 }) }, connection, logger }),
    daily: dailyService(DAY),
  };
  await app.daily.refresh();
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
  // The scene's own frame (the shell's content area, for a screen inside it), in the scene's coordinates.
  const frame = scene.services.viewport;
  const ownArea = { x: 0, y: 0, width: frame.logicalWidth, height: frame.logicalHeight };
  // A dialog, and the shell around the content, may use all the window shows (a screen without the shell, its design area).
  const whole = "designArea" in frame ? frame.bounds : ownArea;
  const layer = topLayer(scene);
  const chrome = layer === scene.root && scene.chrome !== null ? controlsOf(scene.chrome, scene.chrome) : [];
  const own = controlsOf(layer, layer);
  assert.ok(own.length + chrome.length > 0, `${label}: has controls`);
  own.forEach((control) => assertReachable(control, { screen: layer === scene.root ? ownArea : whole, scale: viewport.scale, label }));
  chrome.forEach((control) => assertReachable(control, { screen: whole, scale: viewport.scale, label }));
  // Controls laid out side by side never cover one another (a list's rows are compared within their list).
  const loose = [...own, ...chrome].filter(({ clip }) => clip === null);
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

/**
 * A control stays on its screen (or within the list that scrolls it) and is tall enough for a finger.
 * @param {{ node: import("../../src/rendering/ui/UiNode.js").UiNode, clip: ScrollList | null }} control
 * @param {{ screen: { x: number, y: number, width: number, height: number }, scale: number, label: string }} where
 */
function assertReachable({ node, clip }, { screen, scale, label }) {
  const bounds = node.bounds;
  const name = `${label}: ${node.id || node.constructor.name}`;
  if (clip === null) {
    assert.ok(within(bounds, screen), `${name} stays on screen (${JSON.stringify(bounds)})`);
  } else {
    const list = clip.bounds;
    assert.ok(bounds.x >= list.x - EPSILON && bounds.x + bounds.width <= list.x + list.width + EPSILON, `${name} stays within its list's width`);
  }
  assert.ok(bounds.height * scale >= MIN_TOUCH - EPSILON, `${name} is tall enough for a finger (${(bounds.height * scale).toFixed(1)} px)`);
}

/** What the player can touch: the overlay (the active key asked for, the shell's dialogs), the scene's modal, or the scene. */
const topLayer = (scene) => scene.overlay ?? scene.modal ?? scene.root;
/** The controls of a tree that have a size, with the list clipping each. */
const controlsOf = (tree, layer) => walk(tree).filter(({ node }) => node.interactive && node !== layer && node.width > 0);

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

/**
 * A shop whose server holds three unpaid orders (the fake server's are due at 1: the scene's clock is set before that).
 * @param {any} app
 */
function withUnpaidOrders(app) {
  const market = fakeMarketApi();
  for (const [productId, quantity] of [["core_booster", 1], ["core_mini_booster", 3], ["core_booster_box", 1]]) {
    void market.api.createOrder({ items: [{ productId, quantity }], asset: "STEEM" }, `key-${productId}`);
  }
  Object.assign(app, { shop: new ShopService({ now: () => 0, api: market.api, wallet: { name: "Steem Keychain", isAvailable: () => true, signMessage: async () => ok(""), requestTransfer: async () => ok("ef".repeat(20)) }, account: app.account, scheduler: { delay: async () => undefined }, newKey: () => "key-000000000000002" }) });
}
const BEFORE_DUE = () => -10 * 60_000;

/**
 * A shop whose purchases stay on the blockchain's wait: the wallet pays, the server sees the payment, it is never final.
 * @param {any} app
 */
function withPendingPurchase(app) {
  const market = fakeMarketApi({ listing: LISTING_WITH_ENTRIES, progression: ["PAYMENT_DETECTED"] });
  Object.assign(app, { shop: new ShopService({ now: () => 0, api: market.api, wallet: { name: "Steem Keychain", isAvailable: () => true, signMessage: async () => ok(""), requestTransfer: async () => ok("ef".repeat(20)) }, account: app.account, scheduler: { delay: () => new Promise(() => undefined) }, newKey: () => "key-000000000000003" }) });
}

/**
 * Ranked play in a running season: the player's standing, three ranked entries, and (with `auto`) the auto list.
 * @param {any} app
 * @param {{ eligible?: boolean, auto?: boolean }} [options]
 */
function withRankedPlay(app, { eligible = true, auto = false } = {}) {
  const season = { id: "season-1", name: "Season 1" };
  const standing = { season, rating: 1612, deviation: 80, provisional: false, rank: 4, games: 12, wins: 8, losses: 4, draws: 0, eligible, casualGamesNeeded: eligible ? 0 : 3, practiceGamesNeeded: eligible ? 0 : 3 };
  const ranking = new RankingService({ api: { standing: async () => ok(standing), leaderboard: async () => ok({ season, entries: [] }) } });
  const entries = new EntryService({ api: { entries: async () => ok([{ kind: "ranked", balance: 3, perGame: 1, season: season.id }]) } });
  const connection = { connect: () => undefined, close: () => undefined, status: "open", request: async () => ok({ t: "auto.status", d: { state: "idle", waiting: 2 } }), subscribe: () => () => undefined, onStatus: () => () => undefined };
  Object.assign(app, { ranking, entries, autoList: auto ? new AutoListService({ connection, randomHex: (bytes) => "cd".repeat(bytes), logger: new MemoryLogger() }) : undefined });
}

/** The season's jackpot, three places paying, the season ending in three weeks. @param {any} app */
function withJackpot(app) {
  const now = Date.now();
  const places = [65, 25, 10].map((percent, index) => ({ place: index + 1, percent, amount: "100.000", account: index === 2 ? null : "alice", rating: null, paid: null }));
  const jackpot = { season: { id: "season-1", name: "Season 1", startsAt: now - 86_400_000, endsAt: now + 21 * 86_400_000, status: "running" }, bank: "bank", asset: "STEEM", share: { numerator: 2, denominator: 3 }, jackpot: "866.666", opening: "666.666", readAt: now, places };
  Object.assign(app, { jackpot: { state: { loading: false, loaded: true, jackpot, error: null }, subscribe: () => () => undefined, watch: () => () => undefined, now: () => Date.now() } });
}

/**
 * A challenge received from another player, open, in this mode.
 * @param {"casual" | "ranked"} mode
 */
const withChallenge = (mode) => (/** @type {any} */ app) => {
  const challenge = { id: "c1", from: "carol", to: "alice", mode, expiresAt: 0, expiresInMs: 42_000 };
  const players = [{ account: "carol", status: "idle" }, { account: "bob", status: "searching" }];
  const statusListeners = new Set();
  const replies = { hello: { t: "welcome", d: { user: {}, serverTime: 0, activeGame: null, queue: { state: "idle" } } }, "lobby.list": { t: "lobby.players", d: { players, challenges: { incoming: [challenge], outgoing: null } } } };
  // Connected, so that the player is free to answer.
  const connection = {
    status: "open",
    connect: () => statusListeners.forEach((listener) => listener("open", { code: null })),
    close: () => undefined,
    request: async (/** @type {string} */ t) => ok(replies[/** @type {keyof typeof replies} */ (t)] ?? { t: "ok", d: {} }),
    subscribe: () => () => undefined,
    onStatus: (/** @type {any} */ listener) => (statusListeners.add(listener), () => statusListeners.delete(listener)),
  };
  const logger = new MemoryLogger();
  const lobby = new LobbyService({ connection, scheduler: { delay: () => new Promise(() => undefined) }, now: () => 0, logger });
  const online = new OnlineService({ connection, randomHex: (bytes) => "ab".repeat(bytes), newCommandId: () => "00000000-0000-4000-8000-000000000001", accountDecks: app.online.decks.bind(app.online), logger });
  lobby.start();
  Object.assign(app, { lobby, online });
};

/** The first-time guide, nothing done in this browser. @param {any} app */
/** A Google player whose exported wallet is on its way to the screen. */
function withExportedWallet(app) {
  const wallet = { account: "alice", masterPassword: `P5${"K".repeat(50)}`, owner: `5${"J".repeat(50)}`, active: `5${"H".repeat(50)}`, posting: `5${"G".repeat(50)}`, memo: `5${"F".repeat(50)}` };
  const walletExport = new WalletExport({ api: { exportWallet: async () => ok(wallet) }, reauthenticate: () => undefined, clipboard: { write: async () => ok(undefined) }, files: { save: () => ok(undefined) } });
  Object.assign(app, { walletExport });
  void walletExport.open();
}

/** The sign-in screen where the server offers Google, on a phone without Keychain. */
const GOOGLE_SIGN_IN = Object.freeze({ offered: true, take: () => null, start: () => undefined });

function withGuide(app) {
  const onboarding = new OnboardingProgress({ preferences: new StoredOnboarding({ store: new InMemoryStore(), logger: new MemoryLogger() }) });
  Object.assign(app, { onboarding });
  return onboarding;
}

/** Sound settings that only remember what they are told. */
function fakeAudio() {
  let settings = { music: 0.5, effects: 0.5, muted: false };
  return { get settings() { return settings; }, step: () => undefined, toggleMute: () => (settings = { ...settings, muted: !settings.muted }), play: () => undefined, subscribe: () => () => undefined };
}

/** The daily challenges over a server that always answers with `day`. */
function dailyService(day) {
  return new DailyService({ api: { today: async () => ok(day), chooseTrack: async () => ok(day), play: async () => ok({ gameId: "g" }) } });
}
const RUN = Object.freeze({ track: "hard", stage: 1, gameId: null, attempts: 2, rewarded: false, last: { gameId: "g-1", stage: 0, opponent: "kael", result: "win" }, reward: null });
const WON = Object.freeze({ ...RUN, stage: 3, rewarded: true, reward: { pack: "core_booster", cards: [{ id: "c1", definitionId: "ember_imp", serial: 4 }, { id: "c2", definitionId: "pyre_drake", serial: 9 }] } });
/** @param {any} run */
const withDailyRun = (run) => (app) => Object.assign(app, { daily: dailyService({ ...DAY, run }) });

/** Each screen: its scene, how to enter it, and what to do once there before checking. */
const SCREENS = Object.freeze([
  { name: "play", make: (s, app) => new PlayScene(s, app), before: (app) => withRankedPlay(app, { eligible: false }), after: (scene) => assert.ok(scene.root.findById("play.daily.play")) },
  { name: "play, casual or ranked", make: (s, app) => new PlayScene(s, app), before: (app) => withRankedPlay(app, { eligible: false }), after: (scene) => (scene.root.findById("play.online.play")?.activate(), assert.ok(scene.modal?.findById("choice.ranked.play"))) },
  { name: "home, with the guide", make: (s, app) => new HomeScene(s, app), before: (app) => withGuide(app), after: (scene) => assert.ok(scene.root.findById("home.next")) },
  { name: "home, without the guide", make: (s, app) => new HomeScene(s, app), before: (app) => (withRankedPlay(app), withGuide(app).dismiss()), after: (scene) => assert.equal(scene.root.findById("home.next"), null) },
  { name: "home, a purchase on its way", make: (s, app) => new HomeScene(s, app), before: (app) => (withPendingPurchase(app), void app.shop.load().then(() => app.shop.buy({ productId: "core_booster", quantity: 1, asset: "STEEM" }))), shows: "shell.arrival" },
  { name: "home, account dialog", make: (s, app) => new HomeScene(s, app), after: (scene) => (scene.findNode("profile")?.activate(), assert.ok(scene.overlay?.findById("signOut"))) },
  { name: "home, settings", make: (s, app) => new HomeScene(s, app), before: (app) => Object.assign(app, { audio: fakeAudio() }), after: (scene) => (scene.findNode("settings")?.activate(), assert.ok(scene.overlay?.findById("audio.music.up")), assert.ok(scene.overlay?.findById("settings.about.3"))) },
  { name: "deck selection", make: (s, app) => new DeckSelectionScene(s, app) },
  { name: "my decks", make: (s, app) => new DecksScene(s, app), after: (scene) => assert.ok(scene.findNode("shell.tab.collection")) },
  { name: "my decks, the starter to take", make: (s, app) => new DecksScene(s, app), starter: false, after: (scene) => assert.ok(scene.root.findById("decks.starter")) },
  { name: "my decks, a deck left open", make: (s, app) => new DecksScene(s, app), before: (app) => app.deckBuilding.startNew(), after: (scene) => assert.ok(scene.root.findById("decks.resume")) },
  { name: "deck builder, a new deck", make: (s, app) => new DeckBuilderScene(s, app) },
  { name: "deck builder editor", make: (s, app) => new DeckBuilderScene(s, app), before: (app) => app.deckBuilding.startNew() },
  { name: "collection", make: (s, app) => new CollectionScene(s, app) },
  { name: "shop", make: (s, app) => new ShopScene(s, app) },
  { name: "shop singles", make: (s, app) => new ShopScene(s, app), after: (scene) => scene.root.findById("shop.tab.singles")?.activate() },
  { name: "shop decks", make: (s, app) => new ShopScene(s, app), after: (scene) => scene.root.findById("shop.tab.decks")?.activate() },
  { name: "shop, a purchase under way", make: (s, app) => new ShopScene(s, app, () => 20_000), before: withPendingPurchase, after: (scene) => scene.root.findById("shop.buy")?.activate(), shows: "shop.tracker" },
  { name: "shop singles, a purchase under way", make: (s, app) => new ShopScene(s, app, () => 20_000), before: (app) => (withPendingPurchase(app), void app.shop.load().then(() => app.shop.buy({ productId: "core_booster", quantity: 1, asset: "STEEM" }))), after: (scene) => scene.root.findById("shop.tab.singles")?.activate(), shows: "shop.tracker", apart: ["shop.tracker", "shop.cardDetail"] },
  { name: "shop with unpaid orders", make: (s, app) => new ShopScene(s, app, BEFORE_DUE), before: withUnpaidOrders, after: (scene) => assert.ok(scene.root.findById("shop.orders")) },
  { name: "shop's unpaid orders", make: (s, app) => new ShopScene(s, app, BEFORE_DUE), before: withUnpaidOrders, after: (scene) => scene.root.findById("shop.orders")?.activate() },
  { name: "starter", make: (s, app) => new StarterScene(s, app), starter: false },
  { name: "notifications", make: (s, app) => new NotificationsScene(s, app) },
  { name: "season", make: (s, app) => new SeasonScene(s, app), before: (app) => (withRankedPlay(app), withJackpot(app)), after: (scene) => (assert.ok(scene.root.findById("season.jackpot")), assert.equal(scene.root.findById("season.play")?.isEffectivelyEnabled, true)) },
  { name: "season, ranked locked", make: (s, app) => new SeasonScene(s, app), before: (app) => withRankedPlay(app, { eligible: false }), after: (scene) => assert.ok(scene.root.findById("season.play.note")) },
  { name: "season, how ranked works", make: (s, app) => new SeasonScene(s, app), before: (app) => (withRankedPlay(app), withJackpot(app)), after: (scene) => assert.ok(scene.root.findById("season.guide.steps"), "told on the screen itself, a phone's too") },
  { name: "casual lobby", make: (s, app) => new CasualScene(s, app), after: (scene) => assert.ok(scene.root.findById("casual.steps")) },
  { name: "casual lobby, a challenge received", make: (s, app) => new CasualScene(s, app), before: withChallenge("casual"), after: (scene) => assert.ok(scene.root.findById("online.answer.accept")) },
  { name: "ranked lobby, a challenge received", make: (s, app) => new RankedScene(s, app), before: (app) => (withRankedPlay(app), withChallenge("ranked")(app)), after: (scene) => assert.ok(scene.root.findById("online.answer.accept")) },
  { name: "notifications, a challenge open", make: (s, app) => new NotificationsScene(s, app), before: withChallenge("casual"), after: (scene) => assert.ok(scene.root.findById("notifications.challenge.answer.c1")) },
  { name: "casual lobby, ranked locked", make: (s, app) => new CasualScene(s, app), before: (app) => withRankedPlay(app, { eligible: false }), after: (scene) => assert.equal(scene.root.findById("online.unlockHint"), null, "nothing of ranked play in the casual lobby") },
  { name: "ranked lobby", make: (s, app) => new RankedScene(s, app), before: (app) => withRankedPlay(app), after: (scene) => (assert.ok(scene.root.findById("online.tickets")), assert.ok(scene.root.findById("ranked.buy"))) },
  { name: "ranked lobby, the season's prize", make: (s, app) => new RankedScene(s, app), before: (app) => (withRankedPlay(app), withJackpot(app)), after: (scene) => assertInside(scene.root.findById("ranked.prize")) },
  { name: "ranked lobby, locked", make: (s, app) => new RankedScene(s, app), before: (app) => withRankedPlay(app, { eligible: false }), after: (scene) => assert.ok(scene.root.findById("online.unlock")) },
  { name: "ranked lobby, live", make: (s, app) => new RankedScene(s, app), before: (app) => withRankedPlay(app, { auto: true }), after: (scene) => assert.ok(scene.root.findById("online.mode.live")) },
  { name: "ranked lobby, auto list", make: (s, app) => new RankedScene(s, app), before: (app) => withRankedPlay(app, { auto: true }), after: (scene) => (scene.root.findById("online.mode.auto")?.activate(), assert.ok(scene.root.findById("online.style.balanced"))) },
  { name: "ranked lobby, how ranked works", make: (s, app) => new RankedScene(s, app), before: (app) => withRankedPlay(app, { auto: true }), after: (scene) => assert.ok(scene.findNode("ranked.guide"), "in the bar: the Info screen's Ranked topic") },
  { name: "ranked lobby, tickets on their way", make: (s, app) => new RankedScene(s, app, () => 20_000), before: (app) => (withRankedPlay(app), withPendingPurchase(app)), params: { buy: true }, after: (scene) => scene.modal?.findById("tickets.buy")?.activate(), shows: "tickets.tracker" },
  { name: "ranked lobby, getting entries", make: (s, app) => new RankedScene(s, app), before: (app) => withRankedPlay(app), params: { buy: true }, after: (scene) => assert.ok(scene.modal?.findById("tickets.buy")) },
  { name: "sign in", make: (s, app) => new LoginScene(s, { ...app, identity: { ...app.identity, walletName: "Steem Keychain", walletAvailable: true, signIn: async () => ok(null) } }) },
  { name: "sign in with Google", make: (s, app) => new LoginScene(s, { ...app, google: GOOGLE_SIGN_IN, identity: { ...app.identity, walletName: "Steem Keychain", walletAvailable: false, keysAvailable: true, signIn: async () => ok(null), signInWithKey: async () => ok(null) } }), after: (scene) => assert.ok(scene.root.findById("login.mode.google")) },
  { name: "sign in, back from Google with an account", make: (s, app) => new LoginScene(s, { ...app, google: { ...GOOGLE_SIGN_IN, take: () => ({ kind: "existing", account: "bobby", ownKeys: false }) }, identity: { ...app.identity, walletName: "Steem Keychain", walletAvailable: false, keysAvailable: true, signIn: async () => ok(null), signInWithKey: async () => ok(null) } }) },
  { name: "choose your name", make: (s, app) => new GoogleNameScene(s, { ...app, google: { take: () => null, nameStatus: async () => ok({ name: "x", available: true, reason: null }), createAccount: async () => ok(null) } }), before: (app) => Object.assign(app, { identity: { ...app.identity, state: { ...app.identity.state, status: "signed-out" } } }), after: (scene) => assert.ok(scene.root.findById("googleName.create")) },
  { name: "home, wallet exported", make: (s, app) => new HomeScene(s, app), before: withExportedWallet, after: (scene) => assert.ok(scene.overlay?.findById("exportWallet.download")) },
  { name: "sign in with a posting key", make: (s, app) => new LoginScene(s, { ...app, identity: { ...app.identity, walletName: "Steem Keychain", walletAvailable: false, keysAvailable: true, signIn: async () => ok(null), signInWithKey: async () => ok(null) } }) },
  { name: "shop asking for the active key", make: (s, app) => new ShopScene(s, app), before: (app) => askForActiveKey(app, false), after: (scene) => assert.ok(scene.overlay?.findById("activeKey.key")) },
  { name: "shop unlocking the saved active key", make: (s, app) => new ShopScene(s, app), before: (app) => askForActiveKey(app, true), after: (scene) => assert.ok(scene.overlay?.findById("activeKey.forget")) },
  { name: "daily challenges, track choice", make: (s, app) => new DailyScene(s, app) },
  { name: "daily challenges, next fight", make: (s, app) => new DailyScene(s, app), before: withDailyRun(RUN), after: (scene) => assert.ok(scene.root.findById("daily.fight")) },
  { name: "daily challenges, pack won", make: (s, app) => new DailyScene(s, app), before: withDailyRun(WON), after: (scene) => assert.ok(scene.root.findById("daily.pack")) },
  { name: "info", make: (s, app) => new InfoScene(s, app) },
  { name: "info on signing in", make: (s, app) => new InfoScene({ ...s, openLink: () => undefined }, app), params: { topic: "account" }, after: (scene) => assert.ok(scene.root.findById("info.link")) },
  { name: "error", make: (s) => new ErrorScene(s), params: { title: "Something went wrong", message: "A long explanation of what went wrong." }, controls: false },
]);

/**
 * Everything a card holds stays inside it (the podium of the season's prize, its portraits and the crown's room).
 * @param {import("../../src/rendering/ui/UiNode.js").UiNode | null} card
 */
function assertInside(card) {
  assert.ok(card !== null, "the card is there");
  const outside = walk(card).filter(({ node }) => node !== card && !within(node.bounds, card.bounds));
  assert.deepEqual(outside.map(({ node }) => node.id || node.constructor.name), [], "inside its card");
}

/** Panels smaller than this (either side) are too small for painted corners worth keeping clear. */
const CORNERED = 120;

/**
 * The painted corners of every panel on show (its top ones and its foot's, or its foot's only), as the zones words and
 * buttons keep off: as wide as the panel's title inset (where the scroll curls), as tall as its content inset.
 * @param {import("../../src/rendering/ui/UiNode.js").UiNode} layer
 */
function cornerZones(layer) {
  return walk(layer).flatMap(({ node, clip }) => {
    if (!(node instanceof Panel) || clip !== null || node.style.textured || node.width < CORNERED || node.height < CORNERED) {
      return [];
    }
    const { x, y, width, height } = node.bounds;
    const zone = { width: node.titleInset - 6, height: (node.style.smallCorners ? SMALL_PANEL_INSET : PANEL_INSET) - 4 };
    const foot = [{ x, y: y + height - zone.height }, { x: x + width - zone.width, y: y + height - zone.height }];
    const top = [{ x, y }, { x: x + width - zone.width, y }];
    return (node.style.corners === PanelCorners.FOOT ? foot : [...top, ...foot]).map((at) => ({ panel: node, ...at, ...zone }));
  });
}

/**
 * What would sit on a painted corner: words (a label or a paragraph with something to say) and buttons, outside the
 * scrolling lists (their rows pass under the corners as they scroll).
 * @param {import("../../src/rendering/ui/UiNode.js").UiNode} layer
 */
function wordsAndButtons(layer) {
  return walk(layer)
    .filter(({ node, clip }) => clip === null && ((node instanceof Label && node.text !== "") || (node instanceof TextBlock && node.text !== "") || node instanceof Button))
    .map(({ node }) => ({ node, area: node instanceof Label ? wordsOf(node) : node.bounds }));
}

/** A glyph's width in its font's size, about (the body face's average). */
const GLYPH = 0.55;

/**
 * Where a label's words are, about: its box is often wider than they are (a title's runs across the panel).
 * @param {Label} label
 */
function wordsOf(label) {
  const box = label.bounds;
  const width = Math.min(box.width, label.text.length * theme.fonts.sizes[label.size] * GLYPH);
  const offset = { left: 0, center: (box.width - width) / 2, right: box.width - width }[label.align] ?? 0;
  return { x: box.x + offset, y: box.y, width, height: box.height };
}

/**
 * Two nodes a screen keeps from overlapping (`apart`), when it names them.
 * @param {any} scene
 * @param {readonly [string, string] | undefined} apart
 * @param {string} label
 */
function assertApart(scene, apart, label) {
  if (apart === undefined) {
    return;
  }
  const [first, second] = apart.map((id) => scene.findNode(id));
  assert.ok(first && second && !overlap(first.bounds, second.bounds), `${label}: ${apart.join(" clear of ")}`);
}

/** Screens checked for words on the painted corners: the phones, and a desktop's window. */
const SCREENS_FOR_CORNERS = Object.freeze([...PHONES, Object.freeze({ name: "desktop", cssWidth: 1600, cssHeight: 900 })]);

for (const size of SCREENS_FOR_CORNERS) {
  describe(`No words on the painted corners, on a ${size.name}`, () => {
    for (const screen of SCREENS.filter((candidate) => candidate.controls !== false && !(candidate.phoneOnly === true && size.cssHeight > 600))) {
      it(`keeps the ${screen.name}'s words and buttons off the corners`, async () => {
        const { app, services } = await world(size, { starter: screen.starter ?? true });
        screen.before?.(app);
        const scene = screen.make(services, app);
        scene.enter(screen.params ?? {});
        await settle();
        screen.after?.(scene);
        await settle();
        scene.render(new FakeContext2D());
        const layer = scene.overlay ?? scene.modal ?? scene.root;
        const zones = cornerZones(layer);
        const crossing = wordsAndButtons(layer).flatMap(({ node, area }) => zones.filter((zone) => zone.panel !== node && isAncestor(zone.panel, node) && overlap(area, zone)).map(() => node.id || `${node.constructor.name} "${node.text ?? ""}"`));
        assert.deepEqual([...new Set(crossing)], [], `${size.name} ${screen.name}: on a painted corner`);
        assertApart(scene, screen.apart, `${size.name} ${screen.name}`);
      });
    }
  });
}

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
        if (screen.shows !== undefined) {
          assert.ok(scene.findNode(screen.shows) ?? scene.modal?.findById(screen.shows), `${screen.name}: ${screen.shows} on show`);
        }
        assertApart(scene, screen.apart, `${phone.name} ${screen.name}`);
        assertFitsPhone(scene, viewport, `${phone.name} ${screen.name}`);
      });
    }
  });
}
