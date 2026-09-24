import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Viewport } from "../../src/rendering/canvas/Viewport.js";
import { ErrorScene } from "../../src/rendering/scenes/ErrorScene.js";
import { MainMenuScene } from "../../src/rendering/scenes/MainMenuScene.js";
import { Scene } from "../../src/rendering/scenes/Scene.js";
import { SceneManager } from "../../src/rendering/scenes/SceneManager.js";
import { SceneId } from "../../src/rendering/scenes/sceneIds.js";
import { Button } from "../../src/rendering/ui/Button.js";
import { Label } from "../../src/rendering/ui/Label.js";
import { Panel } from "../../src/rendering/ui/Panel.js";
import { UiNode } from "../../src/rendering/ui/UiNode.js";
import { MemoryLogger } from "../../src/infrastructure/logging/MemoryLogger.js";
import { loadBundledContent } from "../application/fixtures.js";
import { FakeContext2D, loadTheme } from "./fakes.js";

const theme = loadTheme();

function services(overrides = {}) {
  const viewport = new Viewport(theme.layout);
  viewport.resize({ cssWidth: 1600, cssHeight: 900 });
  const renders = { count: 0 };
  return {
    theme,
    viewport,
    logger: new MemoryLogger(),
    requestRender: () => (renders.count += 1),
    navigate: () => undefined,
    hasScene: () => true,
    renders,
    ...overrides,
  };
}

const down = (x, y) => ({ type: "down", x, y, button: 0, pointerId: 1 });
const up = (x, y) => ({ type: "up", x, y, button: 0, pointerId: 1 });
const move = (x, y) => ({ type: "move", x, y, button: 0, pointerId: 1 });
const key = (name) => ({ type: "keydown", key: name, repeat: false });

describe("UiNode tree", () => {
  it("computes absolute bounds through parents and hit-tests topmost interactive nodes", () => {
    const root = new UiNode({ width: 1000, height: 1000 });
    const panel = root.add(new Panel({ x: 100, y: 100, width: 500, height: 500 }));
    const button = panel.add(new Button({ x: 50, y: 50, width: 200, height: 60, text: "A", onActivate: () => undefined }));
    const overlay = root.add(new Button({ x: 150, y: 150, width: 20, height: 20, text: "B", onActivate: () => undefined }));
    assert.deepEqual(button.bounds, { x: 150, y: 150, width: 200, height: 60 });
    assert.equal(root.hitTest({ x: 300, y: 180 }), button);
    assert.equal(root.hitTest({ x: 160, y: 160 }), overlay, "later sibling wins");
    assert.equal(root.hitTest({ x: 120, y: 120 }), null, "panel itself is not interactive");
    button.enabled = false;
    assert.equal(root.hitTest({ x: 300, y: 180 }), null);
    button.enabled = true;
    panel.visible = false;
    assert.equal(root.hitTest({ x: 300, y: 180 }), null);
    assert.equal(button.isEffectivelyVisible, false);
    panel.visible = true;
    panel.enabled = false;
    assert.equal(button.isEffectivelyEnabled, false);
    assert.deepEqual(root.focusableNodes(), [overlay], "disabled ancestors are skipped only via enabled flag on the node itself");
  });

  it("draws children in order and removes them", () => {
    const context = new FakeContext2D();
    const root = new UiNode({ width: 100, height: 100 });
    const first = root.add(new Label({ width: 100, height: 20, text: "first" }));
    root.add(new Label({ width: 100, height: 20, text: "second" }));
    root.draw(context, theme);
    assert.deepEqual(context.texts, ["first", "second"]);
    root.remove(first);
    assert.equal(first.parent, null);
    root.clear();
    assert.equal(root.children.length, 0);
  });
});

describe("Scene pointer and keyboard handling", () => {
  it("activates a button on press+release inside it, not when released elsewhere", () => {
    const scene = new Scene(services());
    let clicks = 0;
    const button = scene.root.add(new Button({ x: 100, y: 100, width: 200, height: 50, text: "Go", onActivate: () => (clicks += 1) }));
    scene.onPointer(down(150, 120));
    assert.equal(button.pressed, true);
    assert.equal(scene.focusedNode, button);
    scene.onPointer(up(150, 120));
    assert.equal(clicks, 1);
    assert.equal(button.pressed, false);
    scene.onPointer(down(150, 120));
    scene.onPointer(up(900, 900));
    assert.equal(clicks, 1, "released outside");
    scene.onPointer(move(150, 120));
    assert.equal(button.hovered, true);
    scene.onPointer(move(0, 0));
    assert.equal(button.hovered, false);
    button.enabled = false;
    scene.onPointer(down(150, 120));
    scene.onPointer(up(150, 120));
    assert.equal(clicks, 1, "disabled buttons ignore input");
  });

  it("moves focus with arrows/tab and activates with Enter or Space", () => {
    const scene = new Scene(services());
    const log = [];
    const a = scene.root.add(new Button({ x: 0, y: 0, width: 10, height: 10, text: "a", onActivate: () => log.push("a") }));
    const b = scene.root.add(new Button({ x: 0, y: 20, width: 10, height: 10, text: "b", onActivate: () => log.push("b") }));
    scene.onKey(key("ArrowDown"));
    assert.equal(scene.focusedNode, a);
    scene.onKey(key("Tab"));
    assert.equal(scene.focusedNode, b);
    scene.onKey(key("ArrowDown"));
    assert.equal(scene.focusedNode, a, "wraps");
    scene.onKey(key("ArrowUp"));
    assert.equal(scene.focusedNode, b);
    scene.onKey(key("Enter"));
    scene.onKey(key(" "));
    assert.deepEqual(log, ["b", "b"]);
    scene.onKey({ type: "keyup", key: "Enter", repeat: false });
    assert.deepEqual(log, ["b", "b"]);
  });
});

describe("SceneManager", () => {
  it("navigates between registered scenes with enter/exit lifecycle and rejects unknown ids", () => {
    const logger = new MemoryLogger();
    const viewport = new Viewport(theme.layout);
    let renders = 0;
    const manager = new SceneManager({ theme, viewport, logger, requestRender: () => (renders += 1) });
    const log = [];
    class Probe extends Scene {
      enter(params) {
        log.push(`enter:${params.name}`);
      }

      exit() {
        log.push("exit");
      }
    }
    manager.register("a", (svc) => new Probe(svc)).register("b", (svc) => new Probe(svc));
    assert.throws(() => manager.register("a", () => new Scene(services())), /already/);
    assert.equal(manager.navigate("a", { name: "A" }), true);
    assert.equal(manager.navigate("b", { name: "B" }), true);
    assert.deepEqual(log, ["enter:A", "exit", "enter:B"]);
    assert.equal(manager.currentId, "b");
    assert.equal(manager.navigate("zzz"), false);
    assert.equal(manager.currentId, "b");
    assert.equal(logger.entries.length, 1);
    assert.ok(renders >= 2);
    assert.equal(manager.has("a"), true);
    assert.equal(manager.update(16), false);
    manager.render(new FakeContext2D());
  });

  it("gives scenes navigate/hasScene services bound to itself", () => {
    const manager = new SceneManager({ theme, viewport: new Viewport(theme.layout), logger: new MemoryLogger(), requestRender: () => undefined });
    let captured = null;
    manager.register("a", (svc) => {
      captured = svc;
      return new Scene(svc);
    });
    manager.register("b", (svc) => new Scene(svc));
    manager.navigate("a");
    assert.equal(captured.hasScene("b"), true);
    assert.equal(captured.hasScene("c"), false);
    captured.navigate("b");
    assert.equal(manager.currentId, "b");
  });
});

const content = await loadBundledContent();

describe("MainMenuScene", () => {
  const app = (storage = "local") => ({
    content,
    deckSelection: { listDecks: () => [{ source: "preconstructed" }, { source: "custom" }] },
    deckBuilding: {},
    matchSetup: {},
    createSeed: () => 1,
    logger: new MemoryLogger(),
    environment: { version: "test", storage },
  });

  it("renders title, buttons and the content summary, and disables unregistered destinations", () => {
    const navigated = [];
    const svc = services({ hasScene: (id) => id === SceneId.DECK_SELECTION, navigate: (id) => navigated.push(id) });
    const scene = new MainMenuScene(svc, app());
    scene.enter({});
    const context = new FakeContext2D();
    scene.render(context);
    assert.ok(context.texts.includes("MAGIC8"));
    assert.ok(context.texts.some((text) => text.includes(`${content.catalog.size} cards · ${content.preconDecks.length} preconstructed decks`)));
    assert.ok(context.texts.some((text) => text.includes("1 custom deck saved in this browser")));
    const [play, builder] = scene.root.focusableNodes();
    assert.equal(play.text, "Play");
    assert.equal(play.enabled, true);
    assert.equal(scene.focusedNode, play, "Play is focused by default");
    assert.equal(builder, undefined, "disabled Deck Builder is not focusable");
    scene.onKey(key("Enter"));
    assert.deepEqual(navigated, [SceneId.DECK_SELECTION]);
    const { x, y, width, height } = play.bounds;
    scene.onPointer(down(x + width / 2, y + height / 2));
    scene.onPointer(up(x + width / 2, y + height / 2));
    assert.deepEqual(navigated, [SceneId.DECK_SELECTION, SceneId.DECK_SELECTION]);
  });

  it("reports memory-only storage and an open deck draft", () => {
    const scene = new MainMenuScene(services(), app("memory"));
    scene.enter({});
    const context = new FakeContext2D();
    scene.render(context);
    assert.ok(context.texts.some((text) => text.includes("kept in memory only")));
    assert.ok(!context.texts.some((text) => text.startsWith("Deck builder:")));

    const withDraft = app("memory");
    withDraft.deckBuilding = { draft: { name: "Wall Time" }, hasUnsavedChanges: true };
    const editing = new MainMenuScene(services(), withDraft);
    editing.enter({});
    const drafted = new FakeContext2D();
    editing.render(drafted);
    assert.ok(drafted.texts.includes('Deck builder: editing "Wall Time" (unsaved changes)'));
  });
});

describe("ErrorScene", () => {
  it("renders the title and message", () => {
    const scene = new ErrorScene(services());
    scene.enter({ title: "Boom", message: "details here" });
    const context = new FakeContext2D();
    scene.render(context);
    assert.ok(context.texts.includes("Boom"));
    assert.ok(context.texts.includes("details here"));
  });
});
