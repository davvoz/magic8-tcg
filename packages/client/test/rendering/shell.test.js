/**
 * The navigation shell: where it lays out its parts, the content frame it
 * gives a screen (and how the scene manager draws it and hands it the
 * pointer), the five sections and where each leads, the top bar's Back,
 * title and controls, and its dialogs.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ok } from "@magic8/engine/shared/Result.js";
import { BalanceService } from "../../src/application/wallet/BalanceService.js";
import { EntryService } from "../../src/application/entries/EntryService.js";
import { MemoryLogger } from "../../src/infrastructure/logging/MemoryLogger.js";
import { Viewport } from "../../src/rendering/canvas/Viewport.js";
import { SceneId } from "../../src/rendering/scenes/sceneIds.js";
import { SceneManager } from "../../src/rendering/scenes/SceneManager.js";
import { SectionScene } from "../../src/rendering/scenes/SectionScene.js";
import { ContentViewport } from "../../src/rendering/shell/ContentViewport.js";
import { backTarget, returnTo } from "../../src/rendering/shell/navigation.js";
import { SECTIONS, SectionId, sectionById } from "../../src/rendering/shell/sections.js";
import { shellLayout } from "../../src/rendering/shell/ShellLayout.js";
import { TopBar } from "../../src/rendering/shell/TopBar.js";
import { Button } from "../../src/rendering/ui/Button.js";
import { Modal } from "../../src/rendering/ui/Modal.js";
import { ALICE, accountWorld, settle } from "../application/accountWorld.js";
import { loadBundledContent } from "../application/fixtures.js";
import { FakeContext2D, loadTheme } from "./fakes.js";

const theme = loadTheme();
const content = await loadBundledContent();
const DESKTOP = Object.freeze({ cssWidth: 1600, cssHeight: 900 });
const IPHONE_SE = Object.freeze({ cssWidth: 667, cssHeight: 375 });

/** @param {{ cssWidth: number, cssHeight: number }} size */
function viewportOf(size) {
  const viewport = new Viewport(theme.layout);
  viewport.resize(size);
  return viewport;
}

/** A screen inside the shell with one button of its own at the content's top-left corner. */
class ProbeScene extends SectionScene {
  /** @type {Button | null} */
  button = null;
  pressed = 0;

  /** @param {{ scene?: string, title?: string, back?: (() => void) | null }} [heading] a screen of the Decks section by default (not one of its own) */
  constructor(services, app, { scene = SceneId.DECK_BUILDER, title = "Probe", back = null } = {}) {
    super(services, app, { scene, title });
    if (back !== null) {
      this.setHeading({ back });
    }
  }

  enter() {
    this.button = this.root.add(new Button({ id: "probe.button", x: 0, y: 0, width: 100, height: 50, text: "Press", onActivate: () => (this.pressed += 1) }));
  }
}

function world({ size = DESKTOP, scenes = null, app: extra = {} } = {}) {
  const account = accountWorld(content);
  const navigated = [];
  const app = {
    content,
    deckSelection: { listDecks: () => [] },
    deckBuilding: account.builder,
    environment: { version: "test", release: "v0 test", storage: "local" },
    identity: account.identity,
    account: account.account,
    ...extra,
  };
  const viewport = viewportOf(size);
  const services = { theme, viewport, logger: new MemoryLogger(), requestRender: () => undefined, navigate: (id, params) => navigated.push({ id, params }), hasScene: (id) => scenes === null || scenes.includes(id) };
  return { ...account, app: /** @type {any} */ (app), services, viewport, navigated };
}

const press = (scene, point) => {
  scene.onPointer({ type: "down", x: point.x, y: point.y, button: 0, pointerType: "mouse" });
  scene.onPointer({ type: "up", x: point.x, y: point.y, button: 0, pointerType: "mouse" });
};
const center = (node) => ({ x: node.bounds.x + node.bounds.width / 2, y: node.bounds.y + node.bounds.height / 2 });

describe("ShellLayout", () => {
  for (const [name, size] of [["a desktop", DESKTOP]]) {
    it(`leaves the screen the rest of ${name}: no rail, the bar across the top`, () => {
      const viewport = viewportOf(size);
      const layout = shellLayout(viewport);
      const shown = viewport.safeBounds;
      const near = (value, edge) => Math.abs(value - edge) <= 1;
      assert.equal(layout.compact, viewport.compact);
      assert.ok(near(layout.bar.x, shown.x) && near(layout.bar.y, shown.y) && near(layout.bar.x + layout.bar.width, shown.x + shown.width), "the bar from edge to edge, along the top");
      assert.deepEqual([layout.content.x, layout.content.y], [layout.bar.x, layout.bar.y + layout.bar.height]);
      assert.ok(near(layout.content.x + layout.content.width, shown.x + shown.width) && near(layout.content.y + layout.content.height, shown.y + shown.height), "the content takes the rest");
      assert.ok(layout.controls.y >= 0 && layout.controls.y + layout.controls.height <= layout.bar.height, "the bar's controls fit in it");
      assert.ok(layout.controls.height * viewport.scale >= 40, "and are tall enough for a finger");
    });
  }

  it("gives a phone a slimmer bar across the whole width, the content under it", () => {
    const wide = shellLayout(viewportOf(DESKTOP));
    const viewport = viewportOf(IPHONE_SE);
    const compact = shellLayout(viewport);
    const shown = viewport.safeBounds;
    const near = (value, edge) => Math.abs(value - edge) <= 1;
    assert.ok(compact.bar.height < wide.bar.height);
    assert.ok(near(compact.bar.x, shown.x) && near(compact.bar.x + compact.bar.width, shown.x + shown.width), "the bar from edge to edge");
    assert.deepEqual([compact.content.x, compact.content.y], [compact.bar.x, compact.bar.y + compact.bar.height]);
    assert.ok(compact.controls.height * viewport.scale >= 40, "the bar's controls tall enough for a finger");
  });
});

describe("ShellLayout on a window of another shape", () => {
  it("keeps to the window's edges, and gives the content the room the shape adds", () => {
    const wide = viewportOf({ cssWidth: 1920, cssHeight: 900 });
    const layout = shellLayout(wide);
    assert.ok(layout.bar.x < 0 && Math.abs(layout.bar.x - wide.bounds.x) <= 1, "the bar from the window's left edge, left of the design area");
    assert.ok(layout.content.width > shellLayout(viewportOf(DESKTOP)).content.width, "a wider content area");
    const huge = shellLayout(viewportOf({ cssWidth: 6000, cssHeight: 900 }));
    assert.equal(huge.content.width, 2200, "up to a limit");
    assert.ok(huge.content.x > huge.bar.x, "then centred in what is left");
  });
});

describe("ContentViewport", () => {
  it("is the content area as if it were the whole screen, from its own origin", () => {
    const screen = viewportOf({ cssWidth: 1800, cssHeight: 900 });
    const frame = new ContentViewport(screen);
    const { content: area } = shellLayout(screen);
    assert.deepEqual([frame.logicalWidth, frame.logicalHeight], [area.width, area.height]);
    assert.deepEqual(frame.origin, { x: area.x, y: area.y });
    assert.equal(frame.compact, false);
    assert.equal(frame.scale, screen.scale);
    assert.deepEqual(frame.bounds, { x: screen.bounds.x - area.x, y: screen.bounds.y - area.y, width: screen.bounds.width, height: screen.bounds.height }, "the canvas, in content coordinates");
    assert.deepEqual(frame.designArea, { x: -area.x, y: -area.y, width: screen.logicalWidth, height: screen.logicalHeight });
    const css = frame.toCss(10, 20);
    assert.deepEqual(css, screen.toCss(10 + area.x, 20 + area.y));
    const back = frame.toLogical(css.x, css.y);
    assert.ok(Math.abs(back.x - 10) < 1e-9 && Math.abs(back.y - 20) < 1e-9, "and back");
  });
});

describe("SceneManager and a scene in a frame", () => {
  it("draws it from its frame's origin and hands it the pointer in its own coordinates", () => {
    const { app, viewport } = world();
    const manager = new SceneManager({ theme, viewport, logger: new MemoryLogger(), requestRender: () => undefined });
    manager.register(SceneId.COLLECTION, (services) => new ProbeScene(services, app));
    manager.register(SceneId.HOME, (services) => new ProbeScene(services, app, { scene: SceneId.HOME, title: "Home" }));
    manager.navigate(SceneId.COLLECTION);
    const scene = /** @type {ProbeScene} */ (manager.current);
    const { content: area } = shellLayout(viewport);
    assert.deepEqual(manager.origin, { x: area.x, y: area.y });
    const context = new FakeContext2D();
    manager.render(context);
    assert.deepEqual(context.calls.find((call) => call.method === "translate")?.args, [area.x, area.y]);
    // The button sits at the content's corner: on the design area, that is the content's origin.
    manager.onPointer({ type: "down", x: area.x + 10, y: area.y + 10, button: 0, pointerType: "mouse" });
    manager.onPointer({ type: "up", x: area.x + 10, y: area.y + 10, button: 0, pointerType: "mouse" });
    assert.equal(scene.pressed, 1);
    // The bar is the scene's too: its settings, in their place on the design area, open.
    const settings = /** @type {import("../../src/rendering/ui/UiNode.js").UiNode} */ (scene.findNode("settings"));
    const at = center(settings);
    manager.onPointer({ type: "down", x: at.x + area.x, y: at.y + area.y, button: 0, pointerType: "mouse" });
    manager.onPointer({ type: "up", x: at.x + area.x, y: at.y + area.y, button: 0, pointerType: "mouse" });
    assert.equal(scene.overlay?.id, "settings");
  });
});

describe("Opening a section", () => {
  it("has no rail: Home lists the sections", () => {
    const { app, services } = world();
    const scene = new ProbeScene(services, app);
    scene.enter({});
    assert.equal(scene.findNode("shell.rail"), null);
    assert.ok(SECTIONS.every((section) => scene.findNode(`shell.nav.${section.id}`) === null));
  });

  it("opens each section's screen", () => {
    const { app, services, navigated } = world();
    const scene = new ProbeScene(services, app);
    for (const section of SECTIONS) {
      scene.openSection(section.id);
    }
    assert.deepEqual(navigated.map((entry) => entry.id), [SceneId.HOME, SceneId.PLAY, SceneId.DECKS, SceneId.SHOP, SceneId.SEASON]);
  });

  it("says why a section it cannot open is locked", () => {
    const { app, services, navigated } = world({ scenes: [SceneId.HOME, SceneId.DECK_SELECTION, SceneId.DECK_BUILDER] });
    const scene = new ProbeScene(services, app);
    scene.openSection(SectionId.MARKET);
    assert.deepEqual(navigated, [], "nothing opens");
    assert.equal(scene.overlay?.id, "shell.notice");
    assert.ok(rendered(scene).some((text) => text.includes("Not available offline")));
    scene.overlay.findById("shell.notice.close").activate();
    assert.equal(scene.overlay, null);
  });
});

describe("Sections", () => {
  const context = (app, scenes = Object.values(SceneId)) => ({ app, hasScene: (id) => scenes.includes(id) });

  it("lead to every way to play, and to the player's decks (where the starter deck is offered)", async () => {
    const { app, identity } = world({ app: { online: {} } });
    identity.become(ALICE);
    await settle();
    assert.deepEqual(sectionById(SectionId.PLAY).destination(context(app)), { scene: SceneId.PLAY });
    assert.deepEqual(sectionById(SectionId.PLAY).destination(context(app, Object.values(SceneId).filter((id) => id !== SceneId.PLAY))), { scene: SceneId.ONLINE }, "without that screen, online play");
    assert.deepEqual(sectionById(SectionId.DECKS).destination(context(app)), { scene: SceneId.DECKS });
    assert.deepEqual(sectionById(SectionId.DECKS).destination(context(app, [SceneId.DECK_BUILDER])), { scene: SceneId.DECK_BUILDER }, "without it, the Deck Builder");
  });

  it("fall back on what there is, and are locked only with nothing at all", () => {
    const { app } = world();
    assert.deepEqual(sectionById(SectionId.MARKET).destination(context(app, [SceneId.MARKET])), { scene: SceneId.MARKET });
    assert.ok("locked" in sectionById(SectionId.SEASON).destination(context(app, [])));
  });
});

describe("The top bar", () => {
  it("starts with the game's logo, shows Back only when the screen has somewhere to go back to, and no title", () => {
    const { app, services } = world();
    const scene = new ProbeScene(services, app);
    scene.enter({});
    assert.equal(scene.findNode("shell.title"), null, "the bar names no screen");
    assert.ok(!rendered(scene).includes("Probe"));
    assert.equal(scene.backButton, null);
    let backs = 0;
    scene.setHeading({ back: () => (backs += 1) });
    assert.equal(scene.backButton?.caption, "Back");
    press(scene, center(scene.backButton));
    assert.equal(backs, 1);
    const logo = scene.findNode("shell.logo");
    const bar = scene.findNode("shell.bar");
    assert.ok(logo.bounds.x < bar.bounds.x + 30 && logo.bounds.x + logo.bounds.width <= scene.backButton.bounds.x, "the logo first, at the bar's left end");
    assert.ok(rendered(scene).includes("KIJAM"), "its letters until the painted logo is ready");
  });

  it("offers Sign in while signed out, and the player's account once signed in", async () => {
    const { app, services, identity, navigated } = world();
    const scene = new ProbeScene(services, app);
    scene.findNode("signIn").activate();
    assert.equal(navigated.at(-1).id, SceneId.LOGIN);
    identity.become(ALICE);
    await settle();
    assert.equal(scene.findNode("signIn"), null);
    assert.equal(scene.findNode("profile").account, "alice");
    scene.findNode("profile").activate();
    assert.equal(scene.overlay?.id, "account");
  });

  it("keeps the wallet and the ranked entries in sight, read once, and counts what is unread", async () => {
    let reads = 0;
    const balance = new BalanceService({ api: { balances: async () => ((reads += 1), ok([{ asset: "STEEM", amount: "12.500" }])) } });
    const entries = new EntryService({ api: { entries: async () => ok([{ kind: "ranked", balance: 3, perGame: 1, season: "s" }]) } });
    const listeners = new Set();
    const notifications = { state: { unread: 120 }, subscribe: (listener) => (listeners.add(listener), () => listeners.delete(listener)) };
    const { app, services, identity } = world({ app: { balance, entries, notifications } });
    const scene = new ProbeScene(services, app);
    assert.equal(scene.findNode("shell.wallet"), null, "nothing of the player's before sign-in");
    identity.become(ALICE);
    await settle();
    await settle();
    assert.equal(scene.findNode("shell.wallet").value, "12.500 STEEM");
    assert.equal(scene.findNode("shell.entries").value, "3");
    assert.equal(scene.findNode("notifications").badge, "99+");
    new ProbeScene(services, app);
    await settle();
    assert.equal(reads, 1, "a known wallet is not read again by the next screen");
  });

  it("fits everything on the smallest phone, the player's picture without the name", async () => {
    const balance = new BalanceService({ api: { balances: async () => ok([{ asset: "STEEM", amount: "12.500" }]) } });
    const entries = new EntryService({ api: { entries: async () => ok([{ kind: "ranked", balance: 3, perGame: 1, season: "s" }]) } });
    const notifications = { state: { unread: 0 }, subscribe: () => () => undefined };
    const { app, services, identity } = world({ size: IPHONE_SE, app: { balance, entries, notifications } });
    const scene = new ProbeScene(services, app, { title: "Collection", back: () => undefined });
    identity.become(ALICE);
    await settle();
    await settle();
    assert.ok(scene.findNode("shell.logo") && scene.backButton, "the logo and Back");
    assert.ok(scene.findNode("notifications") && scene.findNode("settings") && scene.findNode("profile"), "the bell, the settings and the account stay");
    assert.equal(scene.findNode("profile").named, false, "a phone shows the player's picture alone");
    assert.ok(scene.findNode("shell.wallet") && scene.findNode("shell.entries"), "the wallet and the entries too");
  });

  it("lets the controls that matter least give way first when there is not room for all", () => {
    const layout = shellLayout(viewportOf(IPHONE_SE));
    const made = [];
    const control = (id, drop) => ({ id, width: 160, drop, make: (box) => (made.push(id), new Button({ id, ...box, text: id, onActivate: () => undefined })) });
    const bar = new TopBar({ layout, origin: { x: 0, y: 0 }, screen: () => layout.bar, heading: { title: "A long title", back: null }, controls: [control("wallet", 2), control("entries", 1), control("bell", Infinity), control("account", Infinity)] });
    assert.deepEqual(made.sort(), ["account", "bell", "wallet"], "the entries went first, the wallet stayed while there was room");
    const logo = bar.findById("shell.logo");
    assert.ok(bar.children.filter((node) => node !== logo).every((node) => node.x >= logo.x + logo.width), "all clear of the logo");
  });

  it("opens the settings: the sound, Info, and the game's details", () => {
    const { app, services } = world();
    const scene = new ProbeScene(services, app);
    scene.findNode("settings").activate();
    assert.equal(scene.overlay?.id, "settings");
    const texts = rendered(scene);
    assert.ok(texts.includes("Settings"));
    assert.ok(texts.some((text) => text.startsWith(`${content.catalog.size} cards`)), "what the game holds");
    assert.ok(texts.includes("KIJAM v0 test · engine test"), "the release");
    scene.onKey({ type: "keydown", key: "Escape", repeat: false });
    assert.equal(scene.overlay, null, "Escape closes them");
  });
});

describe("A scene in the shell", () => {
  it("tabs through its own controls, then the shell's", () => {
    const { app, services } = world();
    const scene = new ProbeScene(services, app);
    scene.enter({});
    scene.onKey({ type: "keydown", key: "Tab", repeat: false });
    assert.equal(scene.focusedNode?.id, "probe.button");
    scene.onKey({ type: "keydown", key: "Tab", repeat: false });
    const next = scene.focusedNode;
    assert.ok(next !== null && next.id !== "probe.button" && scene.chrome.findById(next.id) === next, `then the bar's (${next?.id})`);
  });

  it("keeps the shell under a dialog: it is drawn over, and out of reach", () => {
    const { app, services } = world();
    const scene = new ProbeScene(services, app);
    scene.enter({});
    const viewport = scene.services.viewport;
    const modal = new Modal({ id: "dialog", width: viewport.logicalWidth, height: viewport.logicalHeight, panelWidth: 400, panelHeight: 200, onDismiss: () => scene.closeModal() });
    scene.openModal(modal);
    const panel = modal.panel.bounds;
    const area = /** @type {import("../../src/rendering/shell/ContentViewport.js").ContentViewport} */ (viewport).designArea;
    assert.ok(Math.abs(panel.x + panel.width / 2 - (area.x + area.width / 2)) <= 1 && Math.abs(panel.y + panel.height / 2 - (area.y + area.height / 2)) <= 1, "centred on the whole screen, shell included");
    press(scene, center(scene.findNode("settings")));
    assert.equal(scene.modal, null, "a press on the bar lands on the dialog's backdrop, which closes it");
    assert.equal(scene.overlay, null, "and opens nothing");
  });
});

/** @param {import("../../src/rendering/scenes/Scene.js").Scene} scene */
function rendered(scene) {
  const context = new FakeContext2D();
  scene.render(context);
  return context.texts;
}

describe("Back, by one rule", () => {
  const context = (app, scenes = Object.values(SceneId)) => ({ app, hasScene: (id) => scenes.includes(id) });

  it("leads a screen to its section's own", () => {
    const { app } = world();
    assert.deepEqual(backTarget(SceneId.DAILY, {}, context(app)), { scene: SceneId.PLAY, params: {} });
    assert.deepEqual(backTarget(SceneId.DECK_BUILDER, {}, context(app)), { scene: SceneId.DECKS, params: {} });
    assert.deepEqual(backTarget(SceneId.NOTIFICATIONS, {}, context(app)), { scene: SceneId.HOME, params: {} }, "a screen of no section goes Home");
  });

  it("leads a section's own screens Home, where the sections are; Home has none", () => {
    const { app } = world();
    for (const own of [SceneId.PLAY, SceneId.DECKS, SceneId.COLLECTION, SceneId.SHOP, SceneId.MARKET, SceneId.TRADES, SceneId.SEASON]) {
      assert.deepEqual(backTarget(own, {}, context(app)), { scene: SceneId.HOME, params: {} }, `${own} goes Home`);
    }
    assert.equal(backTarget(SceneId.HOME, {}, context(app)), null, "Home has no Back");
    assert.equal(backTarget(SceneId.PLAY, {}, context(app, [SceneId.PLAY])), null, "nor a section's screen without a Home to go to");
  });

  it("leads back to the screen that opened it, when that one said so, opened as it was", () => {
    const { app } = world();
    assert.deepEqual(backTarget(SceneId.COLLECTION, { back: SceneId.DAILY }, context(app)), { scene: SceneId.DAILY, params: {} }, "even a tab, when it was opened from elsewhere");
    assert.deepEqual(backTarget(SceneId.REPLAY, { back: SceneId.GAME_HISTORY, backParams: { account: "dave" } }, context(app)), { scene: SceneId.GAME_HISTORY, params: { account: "dave" } });
    assert.deepEqual(backTarget(SceneId.DAILY, { back: SceneId.DAILY }, context(app)), { scene: SceneId.PLAY, params: {} }, "never to itself");
    assert.deepEqual(backTarget(SceneId.DAILY, { back: SceneId.SHOP }, context(app, [SceneId.PLAY, SceneId.DAILY])), { scene: SceneId.PLAY, params: {} }, "nor to a screen that is not there");
  });

  it("hands the next screen the way back here, with this screen's own Back, the trail kept short", () => {
    assert.deepEqual(returnTo(SceneId.GAME_HISTORY, { account: "dave" }), { back: SceneId.GAME_HISTORY, backParams: { account: "dave" } });
    assert.deepEqual(returnTo(SceneId.COLLECTION, {}, { scene: SceneId.DAILY, params: {} }), { back: SceneId.COLLECTION, backParams: { back: SceneId.DAILY, backParams: {} } });
    let trail = returnTo(SceneId.DAILY);
    for (let step = 0; step < 20; step += 1) {
      trail = returnTo(SceneId.INFO, {}, { scene: trail.back, params: trail.backParams });
    }
    let depth = 0;
    for (let at = trail; typeof at?.back === "string"; at = at.backParams) {
      depth += 1;
    }
    assert.ok(depth <= 6, `the trail stays short (${depth})`);
  });

  it("is what the bar's Back and Escape follow, and what the bell hands the notifications", () => {
    const { app, services, navigated } = world({ app: { notifications: { state: { unread: 2 }, subscribe: () => () => undefined } } });
    const scene = new ProbeScene(services, app, { scene: SceneId.DAILY });
    scene.routeBack({});
    assert.equal(scene.backButton?.caption, "Back");
    scene.onKey({ type: "keydown", key: "Escape", repeat: false });
    assert.deepEqual(navigated.at(-1), { id: SceneId.PLAY, params: {} });
    scene.routeBack({ back: SceneId.HOME });
    assert.deepEqual(scene.backHere({ stage: 1 }), { back: SceneId.DAILY, backParams: { stage: 1, back: SceneId.HOME, backParams: {} } });
  });
});

describe("A section's tabs", () => {
  it("name the section's own screens in the bar, the one on show lit, and open the others", () => {
    const { app, services, navigated } = world();
    const scene = new ProbeScene(services, app, { scene: SceneId.SHOP, title: "Shop" });
    assert.deepEqual(["shop", "market", "trades"].map((id) => scene.findNode(`shell.tab.${id}`)?.label), ["Shop", "Player market", "Trades"]);
    assert.equal(scene.findNode("shell.tab.shop").selected, true);
    assert.equal(scene.findNode("shell.title"), null, "no name before them: the lit tab says where");
    scene.findNode("shell.tab.market").activate();
    assert.deepEqual(navigated, [{ id: SceneId.MARKET, params: {} }]);
    scene.findNode("shell.tab.shop").activate();
    assert.equal(navigated.length, 1, "the tab on show opens nothing");
  });

  it("keep a tab that cannot be opened in its place, locked, and say why", () => {
    const { app, services, navigated } = world({ scenes: [SceneId.SHOP, SceneId.TRADES] });
    const scene = new ProbeScene(services, app, { scene: SceneId.SHOP, title: "Shop" });
    assert.equal(scene.findNode("shell.tab.trades").locked, true, "signed out");
    assert.equal(scene.findNode("shell.tab.market").locked, true, "not here");
    scene.findNode("shell.tab.trades").activate();
    assert.deepEqual(navigated, []);
    assert.ok(rendered(scene).some((text) => text.includes("Sign in to trade cards with other players.")));
  });

  it("unlock once the player signs in", async () => {
    const { app, services, identity } = world();
    const scene = new ProbeScene(services, app, { scene: SceneId.SHOP, title: "Shop" });
    identity.become(ALICE);
    await settle();
    assert.equal(scene.findNode("shell.tab.trades").locked, false);
  });

  it("fit a phone's bar, without the section's name, tall enough for a finger", () => {
    const { app, services } = world({ size: IPHONE_SE });
    const scene = new ProbeScene(services, app, { scene: SceneId.MARKET, title: "Player market" });
    assert.equal(scene.findNode("shell.title"), null);
    assert.deepEqual(["shop", "market", "trades"].map((id) => scene.findNode(`shell.tab.${id}`)?.label), ["Shop", "Market", "Trades"], "their short names");
    const tabs = scene.findNode("shell.tabs");
    assert.ok(tabs.height >= 46);
    assert.ok(scene.findNode("settings").bounds.x >= tabs.bounds.x + tabs.bounds.width, "the controls after them");
  });
});
