/**
 * Deck builder scene driven end to end against a real DeckBuildingService
 * and an in-memory repository: create, browse, add/remove, rename, inspect,
 * save, copy a preconstructed deck, discard, delete.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DeckBuildingService } from "../../src/application/decks/DeckBuildingService.js";
import { DeckSelectionService } from "../../src/application/decks/DeckSelectionService.js";
import { MemoryLogger } from "../../src/infrastructure/logging/MemoryLogger.js";
import { InMemoryStore } from "../../src/infrastructure/persistence/InMemoryStore.js";
import { StoredDeckRepository } from "../../src/infrastructure/persistence/StoredDeckRepository.js";
import { Viewport } from "../../src/rendering/canvas/Viewport.js";
import { DeckBuilderScene } from "../../src/rendering/scenes/DeckBuilderScene.js";
import { SceneId } from "../../src/rendering/scenes/sceneIds.js";
import { ScrollList } from "../../src/rendering/ui/ScrollList.js";
import { TextField } from "../../src/rendering/ui/TextField.js";
import { loadBundledContent } from "../application/fixtures.js";
import { FakeContext2D, loadTheme } from "./fakes.js";

const theme = loadTheme();
const content = await loadBundledContent();

function harness(overrides = {}) {
  const viewport = new Viewport(theme.layout);
  viewport.resize({ cssWidth: 1600, cssHeight: 900 });
  const logger = new MemoryLogger();
  const repository = new StoredDeckRepository({ store: new InMemoryStore(), logger });
  const navigated = [];
  const app = {
    content,
    deckSelection: new DeckSelectionService({ content, repository, logger }),
    deckBuilding: new DeckBuildingService({ content, repository }),
    matchSetup: {},
    createSeed: () => "9f".repeat(32),
    logger,
    environment: { version: "test", storage: "memory" },
  };
  const services = { theme, viewport, logger, requestRender: () => undefined, navigate: (id) => navigated.push(id), hasScene: () => true, ...overrides };
  const scene = new DeckBuilderScene(services, app);
  scene.enter({});
  return { scene, app, repository, navigated };
}

const byId = (scene, id) => scene.root.findById(id);
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

describe("DeckBuilderScene — library", () => {
  it("lists the bundled decks with Copy, offers a single new deck, and goes back to the menu", () => {
    const { scene, navigated } = harness();
    assert.equal(scene.isEditing, false);
    const texts = rendered(scene);
    assert.ok(texts.includes("Your decks"));
    assert.ok(texts.some((text) => text.includes("preconstructed")));
    assert.equal(byId(scene, "library.new").text, "New deck");
    for (const faction of content.deckRules.factions) {
      assert.equal(byId(scene, `library.new.${faction}`), null, "no faction to pick when any card may go in");
    }
    assert.ok(rendered(scene).some((text) => text.includes("Any card may go in; the coloured band shows the deck's mix of factions.")));
    const bastion = byId(scene, "library.deck.precon_bastion");
    assert.equal(bastion.subtitle, "30 cards · preconstructed · iron 11 · arcane 19");
    assert.deepEqual(bastion.stripe.map((band) => band.weight), [11, 19], "one band per faction, in proportion to its cards");
    for (const deck of content.preconDecks) {
      assert.equal(byId(scene, `library.edit.${deck.id}`).text, "Copy");
      assert.equal(byId(scene, `library.delete.${deck.id}`), null, "bundled decks cannot be deleted");
    }
    assert.equal(scene.focusedNode, byId(scene, "library.new"));
    click(byId(scene, "builder.back"));
    assert.deepEqual(navigated, [SceneId.MAIN_MENU]);
  });
});

describe("DeckBuilderScene — editor", () => {
  it("creates a deck, adds and removes cards through the catalog and the deck list, and reports rule problems", () => {
    const { scene, app } = harness();
    click(byId(scene, "library.new"));
    assert.equal(scene.isEditing, true);
    assert.ok(rendered(scene).includes("Deck Builder · editing"));
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
    const { scene } = harness();
    click(byId(scene, "library.new"));
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
    const { scene } = harness();
    click(byId(scene, "library.new"));
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

  it("renames through the text field, refuses empty names without losing the typed text, and saves", async () => {
    const { scene, app, repository } = harness();
    click(byId(scene, "library.new"));
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
    assert.equal(scene.isEditing, false, "closing a saved deck needs no confirmation");
    assert.equal(byId(scene, "library.edit.custom_1").text, "Edit");
    assert.ok(byId(scene, "library.delete.custom_1"));
  });

  it("inspects a card in a modal with add/remove, confined focus and Escape to close", () => {
    const { scene, app } = harness();
    click(byId(scene, "library.new"));
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
    assert.equal(scene.isEditing, true);
  });

  it("copies a preconstructed deck, asks before discarding changes, and deletes custom decks after confirmation", async () => {
    const { scene, app, repository } = harness();
    const precon = content.preconDecks[0];
    click(byId(scene, `library.edit.${precon.id}`));
    assert.equal(scene.isEditing, true);
    assert.equal(app.deckBuilding.draft.preconstructed, false);
    assert.equal(app.deckBuilding.draft.totalCards, precon.totalCards);
    assert.ok(byId(scene, "editor.name").value.endsWith("(copy)"));

    click(byId(scene, "editor.close"));
    assert.ok(scene.modal, "unsaved copy asks for confirmation");
    assert.equal(scene.focusedNode.id, "confirm.cancel", "safe default");
    click(byId(scene, "confirm.cancel"));
    assert.equal(scene.modal, null);
    assert.equal(scene.isEditing, true, "still editing");
    click(byId(scene, "editor.close"));
    click(byId(scene, "confirm.ok"));
    assert.equal(scene.isEditing, false);
    assert.equal(repository.list().value.length, 0, "nothing was saved");

    click(byId(scene, `library.edit.${precon.id}`));
    click(byId(scene, "editor.save"));
    await settle();
    click(byId(scene, "editor.close"));
    assert.equal(repository.list().value.length, 1);
    click(byId(scene, "library.delete.custom_1"));
    assert.ok(rendered(scene).some((text) => text.startsWith("Delete ")));
    scene.onKey(key("Escape"));
    assert.equal(repository.list().value.length, 1, "Escape cancels");
    click(byId(scene, "library.delete.custom_1"));
    click(byId(scene, "confirm.ok"));
    await settle();
    assert.equal(repository.list().value.length, 0);
    assert.equal(byId(scene, "library.delete.custom_1"), null);
  });

  it("resumes an open draft when re-entered and surfaces refused saves", async () => {
    const { scene, app } = harness();
    click(byId(scene, "library.new"));
    click(byId(scene, "catalog.add.iron_watcher"));
    const again = new DeckBuilderScene({ theme, viewport: new Viewport(theme.layout), logger: new MemoryLogger(), requestRender: () => undefined, navigate: () => undefined, hasScene: () => true }, app);
    again.enter({});
    assert.equal(again.isEditing, true, "draft lives in the service");
    assert.equal(app.deckBuilding.draft.countOf("iron_watcher"), 1);

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
    assert.equal(scene.isEditing, true);
  });
});
