/**
 * The player's decks (DecksScene) and the deck builder, driven end to end
 * against a real DeckBuildingService and an in-memory repository: list,
 * pick the deck played with, create, browse, add/remove, rename, inspect,
 * save, copy a preconstructed deck, discard, delete — moving between the
 * two screens as the game does.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DeckBuildingService } from "../../src/application/decks/DeckBuildingService.js";
import { DeckSelectionService } from "../../src/application/decks/DeckSelectionService.js";
import { SelectedDeck } from "../../src/application/decks/SelectedDeck.js";
import { MemoryLogger } from "../../src/infrastructure/logging/MemoryLogger.js";
import { InMemoryStore } from "../../src/infrastructure/persistence/InMemoryStore.js";
import { StoredDeckRepository } from "../../src/infrastructure/persistence/StoredDeckRepository.js";
import { StoredSelectedDeck } from "../../src/infrastructure/persistence/StoredSelectedDeck.js";
import { Viewport } from "../../src/rendering/canvas/Viewport.js";
import { DeckBuilderScene } from "../../src/rendering/scenes/DeckBuilderScene.js";
import { DecksScene } from "../../src/rendering/scenes/DecksScene.js";
import { SceneId } from "../../src/rendering/scenes/sceneIds.js";
import { ScrollList } from "../../src/rendering/ui/ScrollList.js";
import { TextField } from "../../src/rendering/ui/TextField.js";
import { loadBundledContent } from "../application/fixtures.js";
import { FakeContext2D, loadTheme } from "./fakes.js";

const theme = loadTheme();
const content = await loadBundledContent();

/**
 * The two screens over one app; navigating between them opens the other, as the scene manager does.
 * @param {string} [start] the screen to open first
 */
function harness(start = SceneId.DECKS) {
  const viewport = new Viewport(theme.layout);
  viewport.resize({ cssWidth: 1600, cssHeight: 900 });
  const logger = new MemoryLogger();
  const repository = new StoredDeckRepository({ store: new InMemoryStore(), logger });
  const navigated = [];
  const app = {
    content,
    deckSelection: new DeckSelectionService({ content, repository, logger }),
    deckBuilding: new DeckBuildingService({ content, repository }),
    selectedDeck: new SelectedDeck({ preferences: new StoredSelectedDeck({ store: new InMemoryStore(), logger }) }),
    matchSetup: {},
    createSeed: () => "9f".repeat(32),
    logger,
    environment: { version: "test", storage: "memory" },
  };
  const screens = { [SceneId.DECKS]: DecksScene, [SceneId.DECK_BUILDER]: DeckBuilderScene };
  const world = { app, repository, navigated, scene: /** @type {any} */ (null) };
  const services = {
    theme,
    viewport,
    logger,
    requestRender: () => undefined,
    hasScene: () => true,
    navigate: (id, params = {}) => {
      navigated.push(id);
      const Screen = screens[id];
      if (Screen !== undefined) {
        world.scene?.exit();
        world.scene = new Screen(services, /** @type {any} */ (app));
        world.scene.enter(params);
      }
    },
  };
  services.navigate(start);
  navigated.length = 0;
  return world;
}

/** The deck builder, opened on a new deck. */
const builder = () => harness(SceneId.DECK_BUILDER);

const byId = (scene, id) => scene.findNode(id);
const click = (node) => {
  assert.ok(node, "node exists");
  assert.equal(node.isEffectivelyEnabled, true, `${node.id} is enabled`);
  node.activate();
};
/** Lets a save or delete started by a click reach storage and redraw. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const key = (name) => ({ type: "keydown", key: name, repeat: false });
function rendered(scene) {
  const context = new FakeContext2D();
  scene.render(context);
  return context.texts;
}

describe("DecksScene — the player's decks", () => {
  it("lists the bundled decks with Copy, the one played with lit, and New deck as its gold button", () => {
    const world = harness();
    const { scene } = world;
    assert.ok(rendered(scene).includes("Your decks"));
    assert.equal(byId(scene, "shell.tab.decks").selected, true, "a tab of the Decks section");
    assert.equal(byId(scene, "decks.new").text, "New deck");
    assert.equal(byId(scene, "decks.new").variant, "primary");
    assert.equal(scene.focusedNode, byId(scene, "decks.new"));
    assert.ok(rendered(scene).some((text) => text.startsWith("30–40 cards, at most 3 copies of a card.")));
    const bastion = byId(scene, "decks.deck.precon_bastion");
    assert.ok(bastion.subtitle.startsWith("30 cards · preconstructed · iron 11 · arcane 19"));
    assert.deepEqual(bastion.stripe.map((band) => band.weight), [11, 19], "one band per faction, in proportion to its cards");
    for (const deck of content.preconDecks) {
      assert.equal(byId(scene, `decks.edit.${deck.id}`).text, "Copy");
      assert.equal(byId(scene, `decks.delete.${deck.id}`), null, "bundled decks cannot be deleted");
    }
    const [first, second] = world.app.deckSelection.listPlayableDecks();
    assert.equal(byId(scene, `decks.deck.${first.deck.id}`).selected, true, "nothing chosen yet: the first deck is played with");
    assert.ok(byId(scene, `decks.deck.${first.deck.id}`).subtitle.includes("you play with it"));
    click(byId(scene, `decks.deck.${second.deck.id}`));
    assert.equal(world.app.selectedDeck.deckId, second.deck.id, "a click makes it the deck played with");
    assert.equal(byId(world.scene, `decks.deck.${second.deck.id}`).selected, true);
    world.scene.onKey(key("Escape"));
    assert.deepEqual(world.navigated, [SceneId.HOME], "the section's own screen goes Back Home");
  });

  it("opens the Deck Builder on a new deck, whose Back comes back to the decks", () => {
    const world = harness();
    click(byId(world.scene, "decks.new"));
    assert.deepEqual(world.navigated, [SceneId.DECK_BUILDER]);
    assert.ok(world.scene instanceof DeckBuilderScene);
    assert.equal(world.app.deckBuilding.draft.name, "New Deck");
    click(byId(world.scene, "shell.back"));
    assert.deepEqual(world.navigated, [SceneId.DECK_BUILDER, SceneId.DECKS]);
    assert.equal(byId(world.scene, "decks.resume").text, 'Continue editing "New Deck"', "the deck left open is one click away");
  });

  it("asks before dropping a deck's unsaved changes for another", () => {
    const world = harness();
    click(byId(world.scene, "decks.new"));
    click(byId(world.scene, "catalog.add.iron_watcher"));
    click(byId(world.scene, "shell.back"));
    click(byId(world.scene, `decks.edit.${content.preconDecks[0].id}`));
    assert.equal(world.scene.modal?.id, "confirm");
    assert.ok(rendered(world.scene).includes("Discard unsaved changes?"));
    click(byId(world.scene, "confirm.cancel"));
    assert.ok(world.scene instanceof DecksScene, "still on the decks");
    assert.equal(world.app.deckBuilding.draft.countOf("iron_watcher"), 1, "nothing dropped");
    click(byId(world.scene, `decks.edit.${content.preconDecks[0].id}`));
    click(byId(world.scene, "confirm.ok"));
    assert.ok(world.scene instanceof DeckBuilderScene);
    assert.ok(world.app.deckBuilding.draft.name.endsWith("(copy)"));
  });
});

describe("DeckBuilderScene — editor", () => {
  it("creates a deck, adds and removes cards through the catalog and the deck list, and reports rule problems", () => {
    const { scene, app } = builder();
    assert.notEqual(app.deckBuilding.draft, null, "opened with no deck, it starts a new one");
    assert.ok(rendered(scene).some((text) => text.startsWith("deck has 0 cards; minimum is 30")));
    assert.ok(rendered(scene).includes("Empty deck — add cards from the list on the right."));
    assert.equal(scene.focusedNode, byId(scene, "editor.name"), "name field focused first");

    const catalog = byId(scene, "editor.catalog");
    assert.ok(catalog instanceof ScrollList);
    const rows = app.deckBuilding.browse();
    assert.equal(rows.length, content.catalog.size, "every card is offered, whatever its faction");
    assert.ok(rows.every((row, index) => index === 0 || rows[index - 1].card.cost <= row.card.cost), "sorted by cost");
    assert.ok(rendered(scene).includes("Cards"));
    assert.equal(byId(scene, "editor.meta").text, "0 / 30–40 cards · unsaved changes");

    click(byId(scene, "catalog.add.iron_watcher"));
    assert.equal(app.deckBuilding.draft.countOf("iron_watcher"), 1);
    click(byId(scene, "catalog.add.ember_imp"));
    assert.equal(byId(scene, "editor.meta").text, "2 / 30–40 cards · unsaved changes · ember 1 · iron 1", "the mix follows the cards");
    click(byId(scene, "deck.remove.ember_imp"));
    click(byId(scene, "deck.add.iron_watcher"));
    click(byId(scene, "deck.add.iron_watcher"));
    assert.equal(app.deckBuilding.draft.countOf("iron_watcher"), 3);
    assert.equal(byId(scene, "catalog.add.iron_watcher").enabled, false, "at max copies");
    assert.equal(byId(scene, "catalog.add.iron_watcher").text, "+ (3/3)");
    assert.equal(byId(scene, "deck.add.iron_watcher").enabled, false);
    click(byId(scene, "deck.remove.iron_watcher"));
    assert.equal(app.deckBuilding.draft.countOf("iron_watcher"), 2);
    assert.equal(byId(scene, "catalog.add.iron_watcher").enabled, true);
    assert.ok(rendered(scene).some((text) => text.startsWith("deck has 2 cards; minimum is 30")));
    assert.equal(byId(scene, "editor.save").enabled, true, "work in progress can be saved");
  });

  it("filters the catalog by faction and type, from the top", () => {
    const { scene } = builder();
    byId(scene, "editor.catalog").scrollTo(byId(scene, "editor.catalog").maxScrollY);
    const offered = () => byId(scene, "editor.catalog").content.children.filter((node) => node.id?.startsWith("catalog.add.")).map((node) => content.catalog.get(node.id.slice("catalog.add.".length)));
    click(byId(scene, "catalog.filter.faction.arcane"));
    click(byId(scene, "catalog.filter.type.spell"));
    assert.equal(byId(scene, "catalog.filter.type.spell").variant, "primary");
    assert.ok(offered().length > 0);
    for (const card of offered()) {
      assert.deepEqual([card.faction, card.type], ["arcane", "spell"]);
    }
    assert.equal(byId(scene, "editor.catalog").scrollY, 0, "a new filter shows its first cards");
    click(byId(scene, "catalog.filter.type.all"));
    click(byId(scene, "catalog.filter.faction.all"));
    assert.equal(offered().length, content.catalog.size);
  });

  it("keeps the scroll offset and focus across rebuilds", () => {
    const { scene } = builder();
    const catalog = byId(scene, "editor.catalog");
    catalog.scrollTo(catalog.maxScrollY);
    assert.ok(catalog.scrollY > 0);
    const lastRow = catalog.content.children.at(-1);
    const addButton = byId(scene, lastRow.id.replace("catalog.info.", "catalog.add."));
    scene.focus(addButton);
    click(addButton);
    const after = byId(scene, "editor.catalog");
    assert.notEqual(after, catalog, "tree was rebuilt");
    assert.equal(after.scrollY, catalog.scrollY, "scroll offset kept");
    assert.equal(scene.focusedNode.id, addButton.id, "focus restored by id");
  });

  it("renames through the text field, refuses empty names without losing the typed text, saves, and closes back to the decks", async () => {
    const world = builder();
    const { scene, app, repository } = world;
    const field = byId(scene, "editor.name");
    assert.ok(field instanceof TextField);
    assert.equal(field.value, "New Deck");
    scene.focus(field);
    for (let index = 0; index < "New Deck".length; index += 1) {
      scene.onKey(key("Backspace"));
    }
    assert.equal(app.deckBuilding.draft.name, "N", "the service keeps the last valid name");
    assert.equal(byId(scene, "editor.name").value, "", "the field shows what was typed");
    assert.ok(rendered(scene).some((text) => text.startsWith("Name must be 1–30 characters")));
    for (const character of "Wall Time") {
      scene.onKey(key(character));
    }
    assert.equal(app.deckBuilding.draft.name, "Wall Time");
    assert.equal(byId(scene, "editor.name").value, "Wall Time");
    assert.equal(scene.focusedNode, byId(scene, "editor.name"), "typing keeps the field focused");

    for (const row of app.deckBuilding.browse().slice(0, 10)) {
      for (let copy = 0; copy < 3; copy += 1) {
        click(byId(scene, `catalog.add.${row.card.id}`));
      }
    }
    assert.ok(rendered(scene).includes("Legal deck"));
    click(byId(scene, "editor.save"));
    assert.equal(byId(scene, "editor.save").text, "Saving…");
    assert.equal(byId(scene, "editor.save").enabled, false, "one save at a time");
    await settle();
    assert.equal(byId(scene, "editor.save").enabled, false, "nothing left to save");
    assert.ok(rendered(scene).some((text) => text.startsWith("30 / 30–40 cards · saved · ")));
    assert.equal(repository.list().value[0].name, "Wall Time");
    assert.equal(repository.list().value[0].entries.length, 10);

    click(byId(scene, "editor.close"));
    assert.equal(app.deckBuilding.draft, null, "closing a saved deck needs no confirmation");
    assert.deepEqual(world.navigated, [SceneId.DECKS], "and comes back to the decks");
    assert.equal(byId(world.scene, "decks.edit.custom_1").text, "Edit");
    assert.ok(byId(world.scene, "decks.delete.custom_1"));
  });

  it("inspects a card in a modal with add/remove, confined focus and Escape to close", () => {
    const { scene, app } = builder();
    click(byId(scene, "catalog.info.ember_imp"));
    assert.ok(scene.modal, "inspect modal open");
    const imp = content.catalog.get("ember_imp");
    const texts = rendered(scene);
    assert.ok(texts.includes(imp.name));
    assert.ok(texts.includes("In deck: 0 / 3"));
    assert.ok(texts.includes(String(imp.attack)) && texts.includes(String(imp.health)), "attack and health gems");
    assert.equal(byId(scene, "inspect.remove").enabled, false);
    assert.equal(scene.focusedNode.id, "inspect.add");
    click(byId(scene, "inspect.add"));
    assert.equal(app.deckBuilding.draft.countOf("ember_imp"), 1);
    assert.ok(scene.modal, "modal stays open after adding");
    assert.ok(rendered(scene).includes("In deck: 1 / 3"));
    assert.equal(scene.focusedNode.id, "inspect.add", "focus kept inside the reopened modal");
    scene.onKey(key("Tab"));
    scene.onKey(key("Tab"));
    scene.onKey(key("Tab"));
    assert.equal(scene.focusedNode.id, "inspect.add", "Tab cycles inside the modal only");
    click(byId(scene, "inspect.remove"));
    assert.equal(app.deckBuilding.draft.countOf("ember_imp"), 0);
    scene.onKey(key("Escape"));
    assert.equal(scene.modal, null);
    assert.equal(byId(scene, "inspect.add"), null);
    assert.notEqual(app.deckBuilding.draft, null, "still editing");
  });

  it("copies a preconstructed deck, asks before discarding changes, and deletes custom decks after confirmation", async () => {
    const world = harness();
    const { app, repository } = world;
    const precon = content.preconDecks[0];
    click(byId(world.scene, `decks.edit.${precon.id}`));
    assert.equal(app.deckBuilding.draft.preconstructed, false);
    assert.equal(app.deckBuilding.draft.totalCards, precon.totalCards);
    assert.ok(byId(world.scene, "editor.name").value.endsWith("(copy)"));

    click(byId(world.scene, "editor.close"));
    assert.ok(world.scene.modal, "unsaved copy asks for confirmation");
    assert.equal(world.scene.focusedNode.id, "confirm.cancel", "safe default");
    click(byId(world.scene, "confirm.cancel"));
    assert.equal(world.scene.modal, null);
    assert.ok(world.scene instanceof DeckBuilderScene, "still editing");
    click(byId(world.scene, "editor.close"));
    click(byId(world.scene, "confirm.ok"));
    assert.ok(world.scene instanceof DecksScene);
    assert.equal(app.deckBuilding.draft, null);
    assert.equal(repository.list().value.length, 0, "nothing was saved");

    click(byId(world.scene, `decks.edit.${precon.id}`));
    click(byId(world.scene, "editor.save"));
    await settle();
    click(byId(world.scene, "editor.close"));
    assert.equal(repository.list().value.length, 1);
    click(byId(world.scene, "decks.delete.custom_1"));
    assert.ok(rendered(world.scene).some((text) => text.startsWith("Delete ")));
    world.scene.onKey(key("Escape"));
    assert.equal(repository.list().value.length, 1, "Escape cancels");
    click(byId(world.scene, "decks.delete.custom_1"));
    click(byId(world.scene, "confirm.ok"));
    await settle();
    assert.equal(repository.list().value.length, 0);
    assert.equal(byId(world.scene, "decks.delete.custom_1"), null);
  });

  it("resumes an open draft when re-entered and surfaces refused saves", async () => {
    const { scene, app } = builder();
    click(byId(scene, "catalog.add.iron_watcher"));
    const again = new DeckBuilderScene({ theme, viewport: new Viewport(theme.layout), logger: new MemoryLogger(), requestRender: () => undefined, navigate: () => undefined, hasScene: () => true }, /** @type {any} */ (app));
    again.enter({});
    assert.equal(app.deckBuilding.draft.countOf("iron_watcher"), 1, "draft lives in the service");

    for (let index = 0; index < content.deckRules.maxSavedDecks; index += 1) {
      app.deckBuilding.startNew(`Filler ${index}`);
      assert.equal((await app.deckBuilding.save()).ok, true);
    }
    app.deckBuilding.startNew("One too many");
    scene.enter({});
    click(byId(scene, "editor.save"));
    await settle();
    assert.ok(rendered(scene).some((text) => text.includes("at most 50 saved decks")));
    assert.equal(byId(scene, "editor.notice").text, "at most 50 saved decks");
    assert.notEqual(app.deckBuilding.draft, null);
  });
});
