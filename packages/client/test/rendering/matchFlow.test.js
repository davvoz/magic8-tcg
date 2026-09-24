/**
 * Presentation flow tests against real application services: scene
 * registration and deck selection starting a real MatchSession.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MatchSession } from "../../src/application/match/MatchSession.js";
import { MatchSetupService } from "../../src/application/match/MatchSetupService.js";
import { DeckBuildingService } from "../../src/application/decks/DeckBuildingService.js";
import { DeckSelectionService } from "../../src/application/decks/DeckSelectionService.js";
import { MemoryLogger } from "../../src/infrastructure/logging/MemoryLogger.js";
import { InMemoryStore } from "../../src/infrastructure/persistence/InMemoryStore.js";
import { StoredDeckRepository } from "../../src/infrastructure/persistence/StoredDeckRepository.js";
import { immediateScheduler } from "../../src/infrastructure/time/ImmediateScheduler.js";
import { Viewport } from "../../src/rendering/canvas/Viewport.js";
import { DeckSelectionScene } from "../../src/rendering/scenes/DeckSelectionScene.js";
import { SceneManager } from "../../src/rendering/scenes/SceneManager.js";
import { registerScenes } from "../../src/rendering/scenes/registerScenes.js";
import { SceneId } from "../../src/rendering/scenes/sceneIds.js";
import { ScrollList } from "../../src/rendering/ui/ScrollList.js";
import { effects, loadBundledContent } from "../application/fixtures.js";
import { FakeContext2D, loadTheme } from "./fakes.js";

const theme = loadTheme();
const content = await loadBundledContent();

function services(overrides = {}) {
  const viewport = new Viewport(theme.layout);
  viewport.resize({ cssWidth: 1600, cssHeight: 900 });
  return { theme, viewport, logger: new MemoryLogger(), requestRender: () => undefined, navigate: () => undefined, hasScene: () => true, ...overrides };
}

function appContext() {
  const logger = new MemoryLogger();
  const repository = new StoredDeckRepository({ store: new InMemoryStore(), logger });
  return {
    content,
    repository,
    deckSelection: new DeckSelectionService({ content, repository, logger }),
    deckBuilding: new DeckBuildingService({ content, repository }),
    matchSetup: new MatchSetupService({ content, effects, scheduler: immediateScheduler, logger }),
    createSeed: () => 42,
    logger,
    environment: { version: "test", storage: "memory" },
  };
}

/** Every button in the tree, enabled or not (focusableNodes() would hide disabled ones). */
function buttons(scene) {
  const found = [];
  const visit = (node) => {
    if (node.interactive) {
      found.push(node);
    }
    node.children.forEach(visit);
  };
  visit(scene.root);
  return found;
}
const buttonNamed = (scene, text) => buttons(scene).find((node) => node.text === text);
const rendered = (scene) => {
  const context = new FakeContext2D();
  scene.render(context);
  return context.texts;
};

describe("registerScenes", () => {
  it("registers every scene and the menu can reach them all", () => {
    const manager = new SceneManager({ theme, viewport: new Viewport(theme.layout), logger: new MemoryLogger(), requestRender: () => undefined });
    registerScenes(manager, appContext());
    assert.deepEqual(Object.values(SceneId).map((id) => manager.has(id)), Object.values(SceneId).map(() => true));
    assert.equal(manager.navigate(SceneId.MAIN_MENU), true);
    assert.equal(buttonNamed(manager.current, "Deck Builder").enabled, true);
    assert.equal(buttonNamed(manager.current, "Play").enabled, true);
    buttonNamed(manager.current, "Deck Builder").activate();
    assert.equal(manager.currentId, SceneId.DECK_BUILDER);
    buttonNamed(manager.current, "Back to menu").activate();
    assert.equal(manager.currentId, SceneId.MAIN_MENU);
  });
});

describe("DeckSelectionScene", () => {
  it("lists playable decks, shows the selection, and starts a real match", () => {
    const navigated = [];
    const scene = new DeckSelectionScene(services({ navigate: (id, params) => navigated.push({ id, params }) }), appContext());
    scene.enter({});
    assert.ok(rendered(scene).includes("Choose your deck"));
    const decks = buttons(scene).filter((node) => node.id?.startsWith("deck-"));
    assert.equal(decks.length, content.preconDecks.length);
    assert.equal(decks[0].selected, true, "first deck preselected");
    assert.equal(decks[0].text, content.preconDecks[0].name, "the row is titled with the deck name");
    decks[1].activate();
    const after = buttons(scene).filter((node) => node.id?.startsWith("deck-"));
    assert.ok(!after[0].selected && after[1].selected, "selection feedback updates");
    assert.equal(buttonNamed(scene, "Start match").enabled, true);
    buttonNamed(scene, "Start match").activate();
    assert.equal(navigated.length, 1);
    assert.equal(navigated[0].id, SceneId.MATCH);
    assert.ok(navigated[0].params.session instanceof MatchSession);
    assert.deepEqual(navigated[0].params.session.humanPlayerIds, ["player"]);
  });

  it("shows unplayable decks disabled with the reason, and disables start when nothing is playable", () => {
    const app = appContext();
    app.deckSelection = { listDecks: () => [], listPlayableDecks: () => [] };
    const empty = new DeckSelectionScene(services(), app);
    empty.enter({});
    assert.equal(buttonNamed(empty, "Start match").enabled, false);
    assert.ok(rendered(empty).includes("No decks are available."));
    const panel = empty.root.children[0];
    for (const node of buttons(empty)) {
      assert.ok(node.bounds.y + node.bounds.height <= panel.bounds.y + panel.bounds.height, `${node.text} overflows the panel`);
    }

    const real = appContext();
    const builder = new DeckBuildingService({ content, repository: real.repository });
    builder.startNew("iron", "Work in progress");
    builder.addCard("iron_watcher");
    assert.equal(builder.save().ok, true);
    const scene = new DeckSelectionScene(services({ hasScene: (id) => id === SceneId.DECK_BUILDER }), real);
    scene.enter({});
    const wip = buttons(scene).find((node) => node.id === "deck-custom_1");
    assert.equal(wip.enabled, false);
    assert.match(wip.subtitle, /not playable: deck has 1 cards; minimum is 30/);
    assert.equal(buttonNamed(scene, "Deck builder").enabled, true);
  });

  it("scrolls a long deck list with the wheel and keeps the selection reachable", () => {
    const real = appContext();
    const builder = new DeckBuildingService({ content, repository: real.repository });
    for (let index = 0; index < 20; index += 1) {
      builder.edit(content.preconDecks[0]);
      assert.equal(builder.save().ok, true);
    }
    const scene = new DeckSelectionScene(services(), real);
    scene.enter({});
    const list = scene.root.findById("decks");
    assert.ok(list instanceof ScrollList);
    assert.ok(list.maxScrollY > 0, "22 rows do not fit");
    const last = buttons(scene).find((node) => node.id === "deck-custom_20");
    assert.equal(scene.root.hitTest({ x: last.bounds.x + 10, y: last.bounds.y + 10 }), null, "hidden below the fold");
    const { x, y } = list.bounds;
    scene.onPointer({ type: "wheel", x: x + 10, y: y + 10, deltaY: 100000 });
    assert.equal(list.scrollY, list.maxScrollY, "clamped");
    assert.equal(scene.root.hitTest({ x: last.bounds.x + 10, y: last.bounds.y + 10 }), last, "now visible");
    scene.onPointer({ type: "wheel", x: 0, y: 0, deltaY: -100000 });
    assert.equal(list.scrollY, list.maxScrollY, "wheel outside the list does nothing");
  });
});
