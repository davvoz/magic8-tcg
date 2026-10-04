import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { JOIN_URL } from "../../src/application/info/infoTopics.js";
import { MemoryLogger } from "../../src/infrastructure/logging/MemoryLogger.js";
import { Viewport } from "../../src/rendering/canvas/Viewport.js";
import { InfoScene } from "../../src/rendering/scenes/InfoScene.js";
import { MainMenuScene } from "../../src/rendering/scenes/MainMenuScene.js";
import { SceneId } from "../../src/rendering/scenes/sceneIds.js";
import { loadBundledContent } from "../application/fixtures.js";
import { FakeContext2D, loadTheme } from "./fakes.js";

const theme = loadTheme();
const content = await loadBundledContent();

function services(overrides = {}) {
  const viewport = new Viewport(theme.layout);
  viewport.resize({ cssWidth: 1600, cssHeight: 900 });
  const navigated = [];
  return {
    theme,
    viewport,
    logger: new MemoryLogger(),
    requestRender: () => undefined,
    navigate: (id, params) => navigated.push({ id, params }),
    hasScene: () => true,
    navigated,
    ...overrides,
  };
}

const app = () => /** @type {any} */ ({
  content,
  deckSelection: { listDecks: () => [] },
  deckBuilding: { draft: null },
  environment: { version: "test", storage: "local" },
});

const rendered = (scene) => {
  const context = new FakeContext2D();
  scene.render(context);
  return context.texts;
};
const key = (name) => ({ type: "keydown", key: name, repeat: false });

describe("InfoScene", () => {
  it("opens on how to play, with every topic as a tab", () => {
    const scene = new InfoScene(services(), app());
    scene.enter({});
    const texts = rendered(scene);
    assert.ok(texts.includes("Info"));
    assert.ok(texts.includes("The goal"), "the article starts with the goal");
    assert.ok(texts.some((text) => text.startsWith("Each player starts with 20 life")));
    const tabs = ["mechanics", "purchases", "account", "ranked", "shop"].map((id) => scene.root.findById(`info.tab.${id}`));
    assert.deepEqual(tabs.map((tab) => tab.text), ["How to play", "Purchases", "Account & sign in", "Ranked games", "Shop & cards"]);
    assert.equal(tabs[0].variant, "primary", "the topic on show is marked");
    assert.equal(scene.focusedNode, tabs[0]);
    assert.equal(scene.root.findById("info.link"), null, "no link under the rules");
  });

  it("switches topic from its tab, and the account topic opens join.cur8.fun", () => {
    const opened = [];
    const scene = new InfoScene(services({ openLink: (url) => opened.push(url) }), app());
    scene.enter({});
    scene.root.findById("info.tab.account").activate();
    const texts = rendered(scene);
    assert.ok(texts.includes("Your account is a Steem wallet"));
    assert.equal(scene.root.findById("info.title").text, "Account & sign in");
    assert.equal(scene.root.findById("info.tab.account").variant, "primary");
    const link = scene.root.findById("info.link");
    assert.equal(link.enabled, true);
    link.activate();
    assert.deepEqual(opened, [JOIN_URL]);
  });

  it("disables the link where no page can be opened", () => {
    const scene = new InfoScene(services(), app());
    scene.enter({ topic: "account" });
    assert.equal(scene.root.findById("info.link").enabled, false);
    assert.ok(scene.root.findById("info.link").text.includes("join.cur8.fun"), "the address is still there to read");
  });

  it("scrolls the article with the page keys and keeps each topic's place", () => {
    const scene = new InfoScene(services(), app());
    scene.enter({});
    rendered(scene);
    const article = () => scene.root.findById("info.article");
    assert.ok(article().maxScrollY > 0, "the rules are longer than a screen");
    scene.onKey(key("PageDown"));
    const read = article().scrollY;
    assert.ok(read > 0);
    scene.onKey(key("End"));
    assert.equal(article().scrollY, article().maxScrollY);
    scene.onKey(key("Home"));
    assert.equal(article().scrollY, 0);
    scene.onKey(key("PageDown"));

    scene.root.findById("info.tab.shop").activate();
    rendered(scene);
    assert.equal(article().scrollY, 0, "another topic starts at the top");
    scene.root.findById("info.tab.mechanics").activate();
    rendered(scene);
    assert.equal(article().scrollY, read, "back where the reader was");
  });

  it("goes back to the menu, or where it was opened from", () => {
    const svc = services();
    const scene = new InfoScene(svc, app());
    scene.enter({});
    assert.equal(scene.root.findById("info.back").text, "Back to menu");
    scene.onKey(key("Escape"));
    scene.enter({ back: SceneId.ONLINE });
    scene.root.findById("info.back").activate();
    assert.deepEqual(svc.navigated.map((entry) => entry.id), [SceneId.MAIN_MENU, SceneId.ONLINE]);
  });
});

describe("MainMenuScene — Info", () => {
  it("opens Info from the header", () => {
    const svc = services();
    const menu = new MainMenuScene(svc, app());
    menu.enter({});
    const info = menu.root.findById("info");
    assert.equal(info.text, "Info");
    assert.equal(info.enabled, true);
    info.activate();
    assert.deepEqual(svc.navigated.map((entry) => entry.id), [SceneId.INFO]);
  });

  it("disables it when the screen is not there", () => {
    const menu = new MainMenuScene(services({ hasScene: () => false }), app());
    menu.enter({});
    assert.equal(menu.root.findById("info").enabled, false);
  });
});
