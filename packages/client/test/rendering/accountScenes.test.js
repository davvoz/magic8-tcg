/**
 * The account screens driven end to end against real application services
 * and the in-memory game server: the main menu's account entries, taking
 * the starter deck, and browsing the collection.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AccountStatus } from "../../src/application/account/AccountService.js";
import { DeckSelectionService } from "../../src/application/decks/DeckSelectionService.js";
import { Viewport } from "../../src/rendering/canvas/Viewport.js";
import { CollectionScene } from "../../src/rendering/scenes/CollectionScene.js";
import { MainMenuScene } from "../../src/rendering/scenes/MainMenuScene.js";
import { SceneManager } from "../../src/rendering/scenes/SceneManager.js";
import { StarterScene } from "../../src/rendering/scenes/StarterScene.js";
import { registerScenes } from "../../src/rendering/scenes/registerScenes.js";
import { SceneId } from "../../src/rendering/scenes/sceneIds.js";
import { ALICE, accountWorld, settle } from "../application/accountWorld.js";
import { loadBundledContent } from "../application/fixtures.js";
import { FakeContext2D, loadTheme } from "./fakes.js";

const theme = loadTheme();
const content = await loadBundledContent();

function harness(options = {}) {
  const world = accountWorld(content, options);
  const viewport = new Viewport(theme.layout);
  viewport.resize({ cssWidth: 1600, cssHeight: 900 });
  const navigated = [];
  const app = {
    content,
    deckSelection: new DeckSelectionService({ content, repository: world.repository, logger: world.logger }),
    deckBuilding: world.builder,
    matchSetup: {},
    createSeed: () => "9f".repeat(32),
    logger: world.logger,
    environment: { version: "test", storage: "local" },
    identity: world.identity,
    account: world.account,
  };
  const services = { theme, viewport, logger: world.logger, requestRender: () => undefined, navigate: (id, params) => navigated.push({ id, params }), hasScene: () => true };
  return { ...world, app, services, navigated };
}

const byId = (scene, id) => scene.root.findById(id);
const click = (node) => {
  assert.ok(node, "node exists");
  assert.equal(node.isEffectivelyEnabled, true, `${node.id} is enabled`);
  node.activate();
};
function rendered(scene) {
  const context = new FakeContext2D();
  scene.render(context);
  return context.texts;
}
/** Every node in the tree, depth first. */
function nodes(scene) {
  const found = [];
  const visit = (node) => {
    found.push(node);
    node.children.forEach(visit);
  };
  visit(scene.root);
  return found;
}

describe("MainMenuScene — account", () => {
  it("offers the starter deck until it is taken, then the collection, and redraws as the account loads", async () => {
    const world = harness();
    const menu = new MainMenuScene(world.services, world.app);
    menu.enter({});
    assert.equal(byId(menu, "starter"), null);
    assert.equal(byId(menu, "collection"), null, "nothing to show while signed out");
    assert.ok(byId(menu, "signIn"), "signed out: sign in");

    world.identity.become(ALICE);
    assert.ok(rendered(menu).some((text) => text.includes("loading your collection")));
    await settle();
    assert.equal(byId(menu, "starter").text, "Free starter deck");
    click(byId(menu, "starter"));
    assert.equal(world.navigated.at(-1).id, SceneId.STARTER);

    await world.account.claimStarter("precon_foundry");
    assert.equal(byId(menu, "starter"), null);
    assert.equal(byId(menu, "collection").text, "Collection");
    assert.ok(rendered(menu).some((text) => text.includes("30 cards owned")));
    assert.ok(rendered(menu).some((text) => text === "1 custom deck saved to @alice's account"));
    menu.exit();
  });

  it("stays inside the screen with every account entry shown", async () => {
    const world = harness();
    world.identity.become(ALICE);
    await settle();
    const menu = new MainMenuScene(world.services, world.app);
    menu.enter({});
    for (const node of nodes(menu)) {
      assert.ok(node.bounds.y + node.bounds.height <= theme.layout.logicalHeight, `${node.id ?? node.text} overflows`);
    }
    const buttons = nodes(menu).filter((node) => node.interactive);
    for (let index = 1; index < buttons.length; index += 1) {
      assert.ok(buttons[index].bounds.y >= buttons[index - 1].bounds.y + buttons[index - 1].bounds.height, "buttons do not overlap");
    }
  });
});

describe("StarterScene", () => {
  async function starterScene(options) {
    const world = harness(options);
    world.identity.become(ALICE);
    await settle();
    const scene = new StarterScene(world.services, world.app);
    scene.enter({});
    return { ...world, scene };
  }

  it("lists one deck per faction striped with its mix, shows the selected one's cards and takes it after confirmation", async () => {
    const { scene, navigated, server, account } = await starterScene();
    const texts = rendered(scene);
    const offered = ["precon_ember", "precon_foundry", "precon_shadow", "precon_verdant", "precon_bastion"];
    for (const id of offered) {
      const deck = content.preconDecks.find((candidate) => candidate.id === id);
      assert.ok(texts.includes(deck.name), deck.name);
    }
    const foundry = byId(scene, "starter.choice.precon_foundry");
    assert.equal(foundry.subtitle, "30 cards · iron 26 · neutral 4");
    assert.deepEqual(foundry.stripe.map((band) => band.weight), [26, 4], "the stripe splits by faction, in proportion");
    assert.equal(byId(scene, "starter.choice.precon_bastion").stripe.length, 2, "a deck of two factions shows both");
    assert.equal(scene.focusedNode.id, "starter.choice.precon_ember", "the first deck is selected and focused");
    assert.ok(byId(scene, "starter.cards.precon_ember").contentHeight > 0, "its card list is filled");
    assert.equal(byId(scene, "starter.cards.precon_shadow"), null, "only the selected deck's cards are shown");

    click(byId(scene, "starter.choice.precon_shadow"));
    assert.equal(byId(scene, "starter.choice.precon_shadow").selected, true);
    assert.equal(byId(scene, "starter.choice.precon_ember").selected, false);
    assert.ok(byId(scene, "starter.cards.precon_shadow").contentHeight > 0);
    assert.equal(byId(scene, "starter.summary").text, "30 cards · 14 different · shadow 30");

    click(byId(scene, "starter.take.precon_shadow"));
    assert.ok(scene.modal, "taking a starter asks first");
    assert.equal(scene.focusedNode.id, "confirm.cancel", "the safe choice is focused");
    click(byId(scene, "confirm.cancel"));
    assert.equal(server.state.claimed, false);

    click(byId(scene, "starter.take.precon_shadow"));
    click(byId(scene, "confirm.ok"));
    assert.equal(byId(scene, "starter.take.precon_shadow").text, "Taking…");
    assert.equal(byId(scene, "starter.take.precon_shadow").enabled, false, "one claim at a time");
    await settle();
    assert.equal(server.state.claimed, true);
    assert.equal(account.needsStarter, false);
    assert.equal(navigated.at(-1).id, SceneId.COLLECTION);
    assert.match(navigated.at(-1).params.notice, /^Shadow Pact is yours: 30 cards/);
    assert.equal(navigated.at(-1).params.fresh.reduce((total, card) => total + card.count, 0), 30, "the deck's cards are lit in the collection");
    scene.exit();
  });

  it("explains a refused claim and keeps the offer open", async () => {
    const { scene, server } = await starterScene();
    server.fail("claimStarter", "RATE_LIMITED");
    click(byId(scene, "starter.choice.precon_verdant"));
    click(byId(scene, "starter.take.precon_verdant"));
    click(byId(scene, "confirm.ok"));
    await settle();
    assert.equal(byId(scene, "starter.status").text, "Too many attempts. Wait a minute and try again.");
    assert.equal(byId(scene, "starter.status").colorKey, "danger");
    assert.equal(byId(scene, "starter.take.precon_verdant").enabled, true);
  });

  it("disables the offer once taken, and Escape goes back to the menu", async () => {
    const { scene, navigated } = await starterScene({ claimed: true });
    assert.equal(byId(scene, "starter.take.precon_ember").enabled, false);
    assert.equal(byId(scene, "starter.status").text, "You already took your starter deck.");
    assert.equal(scene.focusedNode.id, "starter.back");
    scene.onKey({ type: "keydown", key: "Escape", repeat: false });
    assert.equal(navigated.at(-1).id, SceneId.MAIN_MENU);
  });
});

describe("CollectionScene", () => {
  async function collectionScene(params = {}) {
    const world = harness();
    world.identity.become(ALICE);
    await settle();
    await world.account.claimStarter("precon_foundry");
    const scene = new CollectionScene(world.services, world.app);
    scene.enter(params);
    return { ...world, scene };
  }

  it("lists owned cards with their copies and shows the selected card's serials", async () => {
    const { scene } = await collectionScene({ notice: "Iron Foundry is yours" });
    assert.equal(byId(scene, "collection.status").text, "Iron Foundry is yours");
    const foundry = content.preconDecks.find((deck) => deck.id === "precon_foundry");
    const views = nodes(scene).filter((node) => node.id?.startsWith("collection.view."));
    assert.equal(views.length, foundry.entries.length);
    assert.equal(views[0].variant, "primary", "the first card is selected");
    const second = views[1];
    const cardId = second.id.slice("collection.view.".length);
    click(second);
    assert.equal(byId(scene, second.id).variant, "primary");
    assert.equal(byId(scene, views[0].id).variant, "secondary");
    const count = foundry.entries.find((entry) => entry.cardId === cardId).count;
    assert.equal(byId(scene, "collection.owned").text, `You own ${count} (${count} playable)`);
    assert.equal(byId(scene, "collection.copies").children[0].children.length, count, "one line per copy");
    assert.ok(rendered(scene).some((text) => /^#\d+ · core-1$/.test(text)));
  });

  it("lights the cards a notification brought, lists them first and goes back to the notifications", async () => {
    const probe = await collectionScene();
    const owned = probe.scene.ownedCards();
    const [cheap, dear] = [owned[0], owned.at(-1)];
    const serial = dear.copies[0].serial;
    probe.scene.exit();
    probe.scene.enter({ fresh: [{ definitionId: dear.definitionId, count: 1, serial }, { definitionId: cheap.definitionId, count: 2 }, { definitionId: "not_owned", count: 1 }], from: SceneId.NOTIFICATIONS });
    const { scene, navigated } = probe;
    assert.deepEqual(scene.ownedCards().slice(0, 2).map((card) => card.definitionId), [cheap.definitionId, dear.definitionId], "the fresh cards come first");
    assert.equal(byId(scene, "collection.status").text, "3 new cards: lit at the top of the list.");
    const strips = nodes(scene).filter((node) => node.id?.startsWith("collection.strip."));
    assert.deepEqual(strips.filter((strip) => strip.fresh).map((strip) => strip.card.id), [cheap.definitionId, dear.definitionId]);
    assert.ok(!strips[2].fresh && strips[2].muted, "the others are as usual");
    assert.equal(byId(scene, `collection.view.${cheap.definitionId}`).variant, "primary", "the first fresh card is selected");
    assert.equal(byId(scene, "collection.fresh").text, "New: 2 copies just received");

    click(byId(scene, `collection.view.${dear.definitionId}`));
    assert.equal(byId(scene, "collection.fresh").text, "New: 1 copy just received");
    const firstCopy = byId(scene, "collection.copies").children[0].children[0];
    assert.equal(firstCopy.text, `#${serial} · ${dear.copies[0].edition} · new`, "the copy received comes first, lit");
    assert.equal(firstCopy.colorKey, "success");

    assert.equal(byId(scene, "collection.back").text, "Back");
    click(byId(scene, "collection.back"));
    assert.equal(navigated.at(-1).id, SceneId.NOTIFICATIONS);
    scene.exit();
  });

  it("filters by faction and type", async () => {
    const { scene } = await collectionScene();
    click(byId(scene, "collection.filter.faction.shadow"));
    assert.equal(byId(scene, "collection.filter.faction.shadow").variant, "primary");
    assert.ok(rendered(scene).includes("No shadow cards."));
    click(byId(scene, "collection.filter.faction.iron"));
    const shownIds = () => nodes(scene).filter((node) => node.id?.startsWith("collection.view.")).map((node) => node.id.slice("collection.view.".length));
    assert.ok(shownIds().length > 0);
    for (const id of shownIds()) {
      assert.equal(content.catalog.get(id).faction, "iron");
    }
    const ironCards = shownIds().length;
    click(byId(scene, "collection.filter.type.creature"));
    assert.equal(byId(scene, "collection.filter.faction.iron").variant, "primary", "the filters combine");
    assert.ok(shownIds().length > 0 && shownIds().length < ironCards);
    for (const id of shownIds()) {
      assert.deepEqual([content.catalog.get(id).faction, content.catalog.get(id).type], ["iron", "creature"]);
    }
    click(byId(scene, "collection.filter.faction.all"));
    click(byId(scene, "collection.filter.type.all"));
    assert.ok(shownIds().length > ironCards);
  });

  it("points a new player to the starter deck", async () => {
    const world = harness();
    world.identity.become(ALICE);
    await settle();
    const scene = new CollectionScene(world.services, world.app);
    scene.enter({});
    assert.ok(rendered(scene).includes("No cards yet."));
    assert.equal(scene.focusedNode.id, "collection.starter");
    click(byId(scene, "collection.starter"));
    assert.equal(world.navigated.at(-1).id, SceneId.STARTER);
  });

  it("says when the collection cannot be loaded", async () => {
    const world = harness();
    world.server.fail("collection", "UNAVAILABLE", "the game server is not available");
    world.identity.become(ALICE);
    await settle();
    assert.equal(world.account.state.status, AccountStatus.FAILED);
    const scene = new CollectionScene(world.services, world.app);
    scene.enter({});
    assert.equal(byId(scene, "collection.status").text, "Your collection could not be loaded: the game server is not available");
  });
});

describe("registerScenes — with a game server", () => {
  it("registers the account scenes", () => {
    const world = harness();
    const manager = new SceneManager({ theme, viewport: new Viewport(theme.layout), logger: world.logger, requestRender: () => undefined });
    registerScenes(manager, { ...world.app, shop: { subscribe: () => () => undefined }, online: { subscribe: () => () => undefined, canWatch: true }, ranking: { subscribe: () => () => undefined }, gameHistory: { played: async () => undefined }, trading: { subscribe: () => () => undefined }, sales: { subscribe: () => () => undefined }, notifications: { subscribe: () => () => undefined } });
    assert.ok(Object.values(SceneId).every((id) => manager.has(id)));
  });
});
