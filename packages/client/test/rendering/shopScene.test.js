/**
 * The shop screen against a real ShopService, the account world and a
 * scripted marketplace server: listing, odds, quantity, buying and the
 * reveal of the cards received.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ok } from "@magic8/engine/shared/Result.js";
import { DeckSelectionService } from "../../src/application/decks/DeckSelectionService.js";
import { PurchaseStage, ShopService } from "../../src/application/shop/ShopService.js";
import { Viewport } from "../../src/rendering/canvas/Viewport.js";
import { MainMenuScene } from "../../src/rendering/scenes/MainMenuScene.js";
import { ShopScene } from "../../src/rendering/scenes/ShopScene.js";
import { SceneId } from "../../src/rendering/scenes/sceneIds.js";
import { ALICE, accountWorld, settle } from "../application/accountWorld.js";
import { fakeMarketApi } from "../application/fakeMarketApi.js";
import { loadBundledContent } from "../application/fixtures.js";
import { FakeContext2D, loadTheme } from "./fakes.js";

const theme = loadTheme();
const content = await loadBundledContent();

async function harness({ signedIn = true } = {}) {
  const world = accountWorld(content);
  if (signedIn) {
    world.identity.become(ALICE);
    await settle();
  }
  const market = fakeMarketApi();
  const transfers = [];
  const wallet = { name: "Steem Keychain", isAvailable: () => true, signMessage: async () => ok(""), requestTransfer: async (request) => (transfers.push(request), ok("ef".repeat(20))) };
  const shop = new ShopService({ api: market.api, wallet, account: world.account, scheduler: { delay: async () => undefined }, newKey: () => "key-000000000000001" });
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
    shop,
  };
  const services = { theme, viewport, logger: world.logger, requestRender: () => undefined, navigate: (id, params) => navigated.push({ id, params }), hasScene: () => true };
  const scene = new ShopScene(services, app);
  scene.enter({});
  await settle();
  return { ...world, market, shop, scene, app, services, navigated, transfers };
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

describe("ShopScene", () => {
  it("opens on the packs, cheapest first, each with its fixed price and odds", async () => {
    const { scene } = await harness();
    assert.equal(byId(scene, "shop.tab.packs").variant, "primary");
    assert.equal(byId(scene, "shop.tab.packs").text, "Packs (2)");
    const mini = byId(scene, "shop.product.core_mini_booster");
    assert.equal(mini.subtitle, "3 unknown cards · 0.500 STEEM");
    assert.equal(mini.selected, true, "the first pack is selected");
    assert.equal(byId(scene, "shop.buy").text, "Buy for 0.500 STEEM");

    click(byId(scene, "shop.product.core_booster"));
    const texts = rendered(scene);
    assert.ok(texts.includes("1 × pack of 5 unknown cards, drawn when your payment is final"));
    assert.ok(texts.includes("Pack odds"));
    assert.ok(texts.includes("Slot 3 (1 card): rare 88% · epic 10% · legendary 2%"), "odds commonest first");
    assert.equal(byId(scene, "shop.buy").text, "Buy for 1.000 STEEM");
  });

  it("sells complete decks at the sum of their cards as singles", async () => {
    const { scene } = await harness();
    click(byId(scene, "shop.tab.decks"));
    const deck = byId(scene, "shop.product.deck_precon_arcane");
    assert.equal(deck.subtitle, "30 cards · arcane · 10.750 STEEM");
    assert.equal(byId(scene, "shop.deckTotal").text, "Sum of the cards: 10.750 STEEM · Deck price: 10.750 STEEM");
    const texts = rendered(scene);
    assert.ok(texts.includes(`2 × ${content.catalog.get("arcane_apprentice").name} (0.050 each)`));
    assert.ok(texts.includes("0.100"));
    assert.equal(byId(scene, "shop.buy").text, "Buy for 10.750 STEEM");
  });

  it("sells every card by rarity, rarest first, filterable, in standard or foil", async () => {
    const { scene, market } = await harness();
    click(byId(scene, "shop.tab.singles"));
    assert.equal(byId(scene, "shop.card.archmage_of_the_spire").variant, "primary", "a legendary comes first");
    click(byId(scene, "shop.rarity.rare"));
    assert.equal(byId(scene, "shop.card.arcane_apprentice"), null, "commons are filtered out");
    click(byId(scene, "shop.card.pyre_drake"));
    assert.equal(byId(scene, "shop.card.pyre_drake").text, "0.500 STEEM");
    assert.equal(byId(scene, "shop.rarity").text, "rare");
    assert.ok(byId(scene, "shop.owned"), "a signed-in player sees how many they own");
    assert.ok(rendered(scene).includes("Single prices (STEEM)"));
    assert.equal(byId(scene, "shop.buy").text, "Buy for 0.500 STEEM");
    assert.equal(byId(scene, "shop.finish.foil").text, "Foil · 2.500");

    click(byId(scene, "shop.finish.foil"));
    click(byId(scene, "shop.more"));
    assert.equal(byId(scene, "shop.buy").text, "Buy for 5.000 STEEM");
    click(byId(scene, "shop.buy"));
    await settle();
    assert.deepEqual(market.calls.find((call) => call.name === "createOrder").args[0], { productId: "single_pyre_drake_foil", quantity: 2, asset: "STEEM" });
  });

  it("shows other offers on their own shelf", async () => {
    const { scene } = await harness();
    click(byId(scene, "shop.tab.offers"));
    click(byId(scene, "shop.product.core_booster_box"));
    assert.ok(rendered(scene).includes("12 × Core Booster"));
    assert.ok(rendered(scene).includes("Pack odds"), "a bundle shows the odds of the packs inside");
  });

  it("changes the quantity within the product's limit and shows the total", async () => {
    const { scene } = await harness();
    click(byId(scene, "shop.product.core_booster"));
    assert.equal(byId(scene, "shop.less").enabled, false);
    click(byId(scene, "shop.more"));
    click(byId(scene, "shop.more"));
    assert.equal(byId(scene, "shop.quantity").text, "3");
    assert.equal(byId(scene, "shop.each").text, "3 × 1.000 STEEM");
    assert.equal(byId(scene, "shop.buy").text, "Buy for 3.000 STEEM");
    click(byId(scene, "shop.less"));
    assert.equal(byId(scene, "shop.buy").text, "Buy for 2.000 STEEM");
  });

  it("asks to sign in before buying", async () => {
    const { scene } = await harness({ signedIn: false });
    assert.equal(byId(scene, "shop.buy").enabled, false);
    assert.equal(byId(scene, "shop.status").text, "Sign in to buy.");
    click(byId(scene, "shop.tab.singles"));
    assert.equal(byId(scene, "shop.owned"), null);
  });

  it("buys through the wallet and reveals the cards, pack by pack", async () => {
    const { scene, transfers, navigated, shop } = await harness();
    click(byId(scene, "shop.more"));
    click(byId(scene, "shop.buy"));
    await settle();
    assert.deepEqual(transfers.map((transfer) => transfer.amount), ["2.000"]);
    assert.equal(shop.state.purchase.stage, PurchaseStage.DONE);
    assert.ok(scene.modal, "the reveal opens");
    const texts = rendered(scene);
    assert.ok(texts.includes("You received 5 cards"));
    assert.ok(texts.includes("Pack 1"));
    assert.ok(texts.includes(content.catalog.get("pyre_drake").name));
    assert.ok(texts.includes("#5 · foil"));
    assert.equal(scene.focusedNode.id, "reveal.collection");
    click(byId(scene, "reveal.collection"));
    assert.deepEqual(navigated.at(-1), { id: SceneId.COLLECTION, params: undefined });
    assert.equal(shop.state.purchase.stage, PurchaseStage.NONE);
  });

  it("offers to pay again or cancel when the wallet refuses", async () => {
    const world = await harness();
    let refuse = true;
    world.app.shop = new ShopService({
      api: world.market.api,
      wallet: { name: "Steem Keychain", isAvailable: () => true, signMessage: async () => ok(""), requestTransfer: async () => (refuse ? { ok: false, error: { code: "WALLET_REJECTED", message: "The transfer was cancelled in Keychain." } } : ok("ef".repeat(20))) },
      account: world.account,
      scheduler: { delay: async () => undefined },
      newKey: () => "key-000000000000002",
    });
    const scene = new ShopScene(world.services, world.app);
    scene.enter({});
    await settle();
    click(byId(scene, "shop.buy"));
    await settle();
    assert.equal(byId(scene, "shop.status").text, "The transfer was cancelled in Keychain.");
    assert.ok(byId(scene, "shop.cancel"));
    refuse = false;
    click(byId(scene, "shop.payAgain"));
    await settle();
    assert.ok(scene.modal, "paid on the second try");
    scene.onKey({ type: "keydown", key: "Escape", repeat: false });
    assert.equal(scene.modal, null);
    assert.equal(world.app.shop.state.purchase.stage, PurchaseStage.NONE);
  });

  it("is reachable from the main menu", async () => {
    const { app, services } = await harness();
    const menu = new MainMenuScene(services, app);
    menu.enter({});
    assert.equal(menu.root.findById("shop").text, "Shop");
    menu.exit();
  });
});
