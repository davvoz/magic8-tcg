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
import { BalanceService } from "../../src/application/wallet/BalanceService.js";
import { EntryService } from "../../src/application/entries/EntryService.js";
import { Viewport } from "../../src/rendering/canvas/Viewport.js";
import { HomeScene } from "../../src/rendering/scenes/HomeScene.js";
import { ShopScene } from "../../src/rendering/scenes/ShopScene.js";
import { NOTICE_LIFETIME_MS } from "../../src/rendering/scenes/FadingNotices.js";
import { EntryTickets } from "../../src/rendering/scenes/entries/EntryTickets.js";
import { SceneId } from "../../src/rendering/scenes/sceneIds.js";
import { ALICE, accountWorld, settle } from "../application/accountWorld.js";
import { LISTING, LISTING_WITH_ENTRIES, fakeMarketApi } from "../application/fakeMarketApi.js";
import { loadBundledContent } from "../application/fixtures.js";
import { FakeContext2D, loadTheme } from "./fakes.js";

const theme = loadTheme();
const content = await loadBundledContent();

/**
 * @param {{ signedIn?: boolean, budget?: string, listing?: object, entries?: object, params?: object, now?: () => number, size?: { cssWidth: number, cssHeight: number } }} [options] `budget`: the STEEM the player's wallet holds (no balance service without it);
 *   `entries`: the entry service; `params`: what the scene is entered with; `now`: the scene's clock (the fake server's orders are due at 1)
 */
async function harness({ signedIn = true, budget, listing = LISTING, entries, params = {}, now, size = { cssWidth: 1600, cssHeight: 900 } } = {}) {
  const world = accountWorld(content);
  if (signedIn) {
    world.identity.become(ALICE);
    await settle();
  }
  const market = fakeMarketApi({ listing });
  const transfers = [];
  const wallet = { name: "Steem Keychain", isAvailable: () => true, signMessage: async () => ok(""), requestTransfer: async (request) => (transfers.push(request), ok("ef".repeat(20))) };
  const shop = new ShopService({ now: () => 0, api: market.api, wallet, account: world.account, scheduler: { delay: async () => undefined }, newKey: () => "key-000000000000001" });
  const viewport = new Viewport(theme.layout);
  viewport.resize(size);
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
    ...(budget === undefined ? {} : { balance: new BalanceService({ api: { balances: async () => ok([{ asset: "STEEM", amount: budget }]) } }) }),
    ...(entries === undefined ? {} : { entries }),
  };
  const services = { theme, viewport, logger: world.logger, requestRender: () => undefined, navigate: (id, sceneParams) => navigated.push({ id, params: sceneParams }), hasScene: () => true };
  const scene = new ShopScene(services, app, now);
  scene.enter(params);
  await settle();
  return { ...world, market, shop, scene, app, services, navigated, transfers };
}

const byId = (scene, id) => scene.findNode(id);
/** Every node of the scene, depth first. */
const nodes = (scene) => {
  const found = [];
  const visit = (node) => (found.push(node), node.children.forEach(visit));
  visit(scene.root);
  return found;
};
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
  it("on a phone, leaves out the reminder of how paying works, and keeps what the player must know", async () => {
    const phone = { cssWidth: 667, cssHeight: 375 };
    const { scene } = await harness({ budget: "0.700", size: phone });
    assert.equal(byId(scene, "shop.status"), null, "no reminder: its room goes to what the pack holds");
    click(byId(scene, "shop.more"));
    assert.equal(byId(scene, "shop.status").text, "Not enough STEEM: this costs 1 STEEM, your wallet holds 0.7 STEEM.");
    const wide = await harness({ budget: "0.700" });
    assert.match(byId(wide.scene, "shop.status").text, /before anything is paid/, "a wide screen keeps it");
  });

  it("shows the player's budget in STEEM and offers to pay only what it covers", async () => {
    const { scene, transfers } = await harness({ budget: "0.700" });
    assert.equal(byId(scene, "shop.budget").text, "Your budget: 0.7 STEEM");
    assert.equal(byId(scene, "shop.buy").isEffectivelyEnabled, true, "0.5 STEEM is within the budget");
    click(byId(scene, "shop.more"));
    assert.equal(byId(scene, "shop.buy").text, "Buy for 1 STEEM");
    assert.equal(byId(scene, "shop.buy").isEffectivelyEnabled, false, "two packs are not");
    assert.equal(byId(scene, "shop.status").text, "Not enough STEEM: this costs 1 STEEM, your wallet holds 0.7 STEEM.");
    click(byId(scene, "shop.addToCart"));
    click(byId(scene, "shop.cart"));
    const cart = (id) => scene.modal.findById(id);
    assert.equal(cart("cart.budget").text, "Your budget: 0.7 STEEM");
    assert.equal(cart("cart.pay").isEffectivelyEnabled, false);
    assert.match(cart("cart.status").text, /^Not enough STEEM/);
    click(cart("cart.less.core_mini_booster"));
    assert.equal(cart("cart.pay").isEffectivelyEnabled, true, "one pack fits the budget again");
    assert.equal(transfers.length, 0);
  });

  it("opens on the packs, cheapest first, each with its fixed price and odds", async () => {
    const { scene } = await harness();
    assert.equal(byId(scene, "shop.tab.packs").variant, "primary");
    assert.equal(byId(scene, "shop.tab.packs").text, "Packs (2)");
    const mini = byId(scene, "shop.product.core_mini_booster");
    assert.equal(mini.subtitle, "3 unknown cards · 0.5 STEEM");
    assert.equal(mini.selected, true, "the first pack is selected");
    assert.equal(byId(scene, "shop.buy").text, "Buy for 0.5 STEEM");

    click(byId(scene, "shop.product.core_booster"));
    const texts = rendered(scene);
    assert.ok(texts.includes("1 × pack of 5 unknown cards, drawn when your payment is final"));
    assert.ok(texts.includes("Pack odds"));
    assert.ok(texts.includes("Slot 3 (1 card): rare 88% · epic 10% · legendary 2%"), "odds commonest first");
    assert.equal(byId(scene, "shop.buy").text, "Buy for 1 STEEM");
  });

  it("sells complete decks at the sum of their cards as singles", async () => {
    const { scene } = await harness();
    click(byId(scene, "shop.tab.decks"));
    const deck = byId(scene, "shop.product.deck_precon_arcane");
    assert.equal(deck.subtitle, "30 cards · 49 STEEM · arcane 30");
    assert.deepEqual(deck.stripe.map((band) => band.weight), [30]);
    assert.equal(byId(scene, "shop.deckTotal").text, "Sum of the cards: 49 STEEM · Deck price: 49 STEEM");
    const apprentice = byId(scene, "shop.deckCard.arcane_apprentice");
    assert.deepEqual([apprentice.card.id, apprentice.caption, apprentice.rarity], ["arcane_apprentice", "2 × 0.500", "common"], "each card as a thumbnail: copies × price, and its rarity");
    assert.ok(rendered(scene).includes("Common"));
    click(apprentice);
    const info = (id) => scene.modal.findById(id);
    assert.equal(info("cardInfo.name").text, content.catalog.get("arcane_apprentice").name);
    assert.equal(info("cardInfo.rarity").text, "Common");
    assert.deepEqual([0, 1, 2].map((index) => info(`cardInfo.line.${index}`).text), ["In this deck: 2", "As a single: 0.5 STEEM each", "2 in the deck: 1 STEEM"]);
    click(info("cardInfo.close"));
    assert.equal(scene.modal, null);
    assert.equal(byId(scene, "shop.buy").text, "Buy for 49 STEEM");
  });

  it("sells every card by rarity, rarest first, filterable", async () => {
    const { scene, market } = await harness();
    click(byId(scene, "shop.tab.singles"));
    assert.equal(byId(scene, "shop.card.archmage_of_the_spire").variant, "primary", "a legendary comes first");
    click(byId(scene, "shop.filter.rarity.rare"));
    assert.equal(byId(scene, "shop.card.arcane_apprentice"), null, "commons are filtered out");
    click(byId(scene, "shop.filter.type.spell"));
    click(byId(scene, "shop.filter.faction.ember"));
    const singles = () => nodes(scene).filter((node) => node.id?.startsWith("shop.card.")).map((node) => content.catalog.get(node.id.slice("shop.card.".length)));
    for (const card of singles()) {
      assert.deepEqual([card.faction, card.type], ["ember", "spell"], "faction, rarity and type combine");
    }
    click(byId(scene, "shop.filter.type.creature"));
    assert.ok(singles().some((card) => card.id === "pyre_drake"));
    click(byId(scene, "shop.card.pyre_drake"));
    assert.equal(byId(scene, "shop.card.pyre_drake").text, "2.5 STEEM");
    assert.equal(byId(scene, "shop.rarity").text, "Rare");
    assert.ok(byId(scene, "shop.owned"), "a signed-in player sees how many they own");
    assert.ok(rendered(scene).includes("Single prices (STEEM)"));
    assert.equal(byId(scene, "shop.buy").text, "Buy for 2.5 STEEM");
    assert.equal(byId(scene, "shop.finish.foil"), null, "one kind of copy only");

    click(byId(scene, "shop.more"));
    assert.equal(byId(scene, "shop.buy").text, "Buy for 5 STEEM");
    click(byId(scene, "shop.buy"));
    await settle();
    assert.deepEqual(market.calls.find((call) => call.name === "createOrder").args[0], { items: [{ productId: "single_pyre_drake", quantity: 2 }], asset: "STEEM" });
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
    assert.equal(byId(scene, "shop.each").text, "3 × 1 STEEM");
    assert.equal(byId(scene, "shop.buy").text, "Buy for 3 STEEM");
    click(byId(scene, "shop.less"));
    assert.equal(byId(scene, "shop.buy").text, "Buy for 2 STEEM");
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
    assert.ok(texts.includes("#5"));
    assert.equal(scene.focusedNode.id, "reveal.collection");
    click(byId(scene, "reveal.collection"));
    const { id, params } = navigated.at(-1);
    assert.equal(id, SceneId.COLLECTION);
    assert.equal(params.back, SceneId.SHOP, "back leads to the shop");
    assert.equal(params.fresh.length, 5, "the cards received are lit in the collection");
    assert.ok(params.fresh.some((card) => card.serial === 5), "with their serials");
    assert.equal(shop.state.purchase.stage, PurchaseStage.NONE);
  });

  it("follows a purchase step by step in place of Buy, the blockchain's wait counting down", async () => {
    const world = await harness();
    let clock = 1000;
    /** @type {(value: unknown) => void} */
    let approve = () => undefined;
    world.app.shop = new ShopService({
      api: world.market.api,
      wallet: { name: "Steem Keychain", isAvailable: () => true, signMessage: async () => ok(""), requestTransfer: () => new Promise((resolve) => (approve = resolve)) },
      account: world.account,
      // One look at the order, then it waits: the chain has seen the payment, not made it final.
      scheduler: { delay: () => new Promise(() => undefined) },
      newKey: () => "key-000000000000003",
      now: () => clock,
    });
    const scene = new ShopScene(world.services, world.app, () => clock);
    scene.enter({});
    await settle();
    click(byId(scene, "shop.buy"));
    await settle();
    assert.equal(byId(scene, "shop.buy"), null, "the steps in its place");
    assert.equal(byId(scene, "shop.tracker.title").text, "Approve the transfer in Keychain");
    assert.match(byId(scene, "shop.tracker.note").text, /^1 STEEM to @verdu.green. Nothing is paid until you approve it.$/);
    approve(ok("ef".repeat(20)));
    await settle();
    assert.equal(byId(scene, "shop.tracker.title").text, "The blockchain has your payment: making it final");
    assert.equal(byId(scene, "shop.tracker.left").text, "about 1:00 left");
    assert.match(byId(scene, "shop.tracker.note").text, /keep playing/);
    clock += 15_000;
    assert.equal(scene.update(100), true, "it moves while the chain confirms");
    assert.equal(byId(scene, "shop.tracker.left").text, "about 0:45 left");
    assert.ok(rendered(scene).includes("Blockchain"), "the steps named");
  });

  it("on a phone, keeps a purchase's steps in one place on every shelf: under a single's card, to the panel's foot", async () => {
    const world = await harness({ listing: LISTING_WITH_ENTRIES, size: { cssWidth: 667, cssHeight: 375 } });
    world.app.shop = new ShopService({
      api: world.market.api,
      wallet: { name: "Steem Keychain", isAvailable: () => true, signMessage: async () => ok(""), requestTransfer: () => new Promise(() => undefined) },
      account: world.account,
      scheduler: { delay: () => new Promise(() => undefined) },
      newKey: () => "key-000000000000004",
      now: () => 0,
    });
    const scene = new ShopScene(world.services, world.app, () => 0);
    scene.enter({});
    await settle();
    click(byId(scene, "shop.buy"));
    await settle();
    const places = ["packs", "decks", "singles", "ranked", "offers"].map((shelf) => {
      click(byId(scene, `shop.tab.${shelf}`));
      const { x, y, width, height } = byId(scene, "shop.tracker").bounds;
      return [shelf, { x, y, width, height }];
    });
    const [, singles] = places[2];
    for (const [shelf, place] of places) {
      assert.deepEqual(place, singles, `${shelf}: where it is on the singles`);
    }
    click(byId(scene, "shop.tab.singles"));
    const card = byId(scene, "shop.cardDetail").bounds;
    assert.ok(card.y + card.height <= singles.y, "under the card");
  });

  it("sells ranked tickets on their own shelf, Tickets, many with one transfer, and says they go into the jackpot", async () => {
    const entries = new EntryService({ api: { entries: async () => ok([{ kind: "ranked", balance: 2, perGame: 1, season: "season-1" }]) } });
    await entries.refresh();
    const { scene, transfers, navigated, shop } = await harness({ listing: LISTING_WITH_ENTRIES, entries, params: { category: "ranked", back: SceneId.RANKED } });
    assert.equal(byId(scene, "shop.tab.ranked").text, "Tickets (1)", "the shelf of tickets");
    assert.equal(byId(scene, "shop.product.ranked_entry").subtitle, "1 ranked game · 1 STEEM · into the jackpot");
    const texts = rendered(scene);
    assert.ok(texts.includes("1 × ranked ticket: one game of ranked play"));
    assert.ok(texts.includes("Every ticket goes into the season's jackpot."));
    assert.ok(texts.includes("Every ranked game takes one ticket from each player."));
    assert.ok(texts.includes("You have 2 ranked tickets."));
    assert.equal(byId(scene, "shop.tickets").count, 2, "the tickets held, as a stack");
    assert.equal(byId(scene, "shop.tickets.added").text, "+1 ranked ticket");
    for (let more = 0; more < 4; more += 1) {
      click(byId(scene, "shop.more"));
    }
    assert.equal(byId(scene, "shop.tickets.added").text, "+5 ranked tickets");
    assert.equal(byId(scene, "shop.tickets.after").text, "You will hold 7 after this order.");
    assert.equal(byId(scene, "shop.buy").text, "Buy for 5 STEEM");
    click(byId(scene, "shop.buy"));
    await settle();
    assert.deepEqual(transfers.map((transfer) => transfer.amount), ["5.000"], "one wallet prompt for five games");
    assert.equal(shop.state.purchase.stage, PurchaseStage.DONE);
    assert.equal(scene.modal, null, "no cards to reveal");
    assert.equal(byId(scene, "shop.status").text, "Done: 5 ranked tickets are yours, and in the season's jackpot.");
    scene.update(0);
    scene.update(NOTICE_LIFETIME_MS);
    assert.equal(shop.state.purchase.stage, PurchaseStage.NONE, "said for a while, then the shelf as before");
    assert.match(byId(scene, "shop.status").text, /before anything is paid/);
    click(byId(scene, "shell.back"));
    assert.equal(navigated.at(-1).id, SceneId.RANKED, "back to the lobby that sent the player here");
  });

  it("shows ranked entries in the cart as their tickets, not card backs", async () => {
    const { scene } = await harness({ listing: LISTING_WITH_ENTRIES, params: { category: "ranked" } });
    click(byId(scene, "shop.more"));
    click(byId(scene, "shop.more"));
    click(byId(scene, "shop.addToCart"));
    click(byId(scene, "shop.cart"));
    const tickets = scene.modal.findById("cart.visual.ranked_entry");
    assert.ok(tickets instanceof EntryTickets, "a ticket, not a fan of card backs");
    assert.deepEqual([tickets.count, tickets.face], [3, "1 STEEM"], "the seal counts the entries in the cart");
    assert.ok(tickets.x + tickets.width <= scene.modal.findById("cart.remove.ranked_entry").x, "clear of ✕");
  });

  it("leaves the Ranked shelf out when nothing is on it", async () => {
    const { scene } = await harness({ params: { category: "ranked" } });
    assert.equal(byId(scene, "shop.tab.ranked"), null);
    assert.equal(byId(scene, "shop.tab.packs").variant, "primary");
  });

  it("reveals the cards of a second purchase made without leaving the shop", async () => {
    const { scene, shop } = await harness();
    click(byId(scene, "shop.buy"));
    await settle();
    assert.ok(scene.modal, "the first reveal opens");
    click(byId(scene, "reveal.close"));
    assert.equal(scene.modal, null);
    assert.equal(shop.state.purchase.stage, PurchaseStage.NONE);
    click(byId(scene, "shop.buy"));
    await settle();
    assert.ok(scene.modal, "the second reveal opens too");
    assert.ok(rendered(scene).some((text) => text.startsWith("You received")));
  });

  it("collects products from several shelves in the cart and pays for them with one transfer", async () => {
    const { scene, shop, market, transfers } = await harness();
    assert.equal(byId(scene, "shop.cart").text, "Cart");
    click(byId(scene, "shop.product.core_booster"));
    click(byId(scene, "shop.more"));
    click(byId(scene, "shop.addToCart"));
    assert.equal(byId(scene, "shop.status").text, "Added 2 × Core Booster to your cart.");
    assert.equal(byId(scene, "shop.quantity").text, "1", "ready for the next choice");
    assert.equal(byId(scene, "shop.cart").text, "Cart (2)");
    click(byId(scene, "shop.tab.singles"));
    click(byId(scene, "shop.card.pyre_drake"));
    click(byId(scene, "shop.addToCart"));
    assert.equal(byId(scene, "shop.cart").text, "Cart (3)");
    assert.equal(market.calls.filter((call) => call.name === "createOrder").length, 0, "nothing is ordered while shopping");

    click(byId(scene, "shop.cart"));
    const cart = (id) => scene.modal.findById(id);
    assert.equal(scene.modal.id, "cart");
    assert.equal(cart("cart.name.core_booster").text, "Core Booster");
    assert.equal(cart("cart.amount.single_pyre_drake").text, "2.5 STEEM");
    assert.equal(cart("cart.total").text, "Total: 4.5 STEEM");
    assert.equal(cart("cart.count").text, "3 items · 11 cards");
    const booster = cart("cart.visual.core_booster");
    assert.deepEqual([booster.cards.length, booster.backs, booster.badge], [0, 3, "×2"], "a pack shows card backs: its cards are unknown until opened");
    const drake = cart("cart.visual.single_pyre_drake");
    assert.deepEqual([drake.cards.map((face) => face.card.id), drake.badge], [["pyre_drake"], "×1"], "a single shows its card");
    assert.ok(rendered(scene).includes("×2"));
    scene.focus(cart("cart.more.core_booster"));
    click(cart("cart.more.core_booster"));
    assert.equal(scene.modal?.id, "cart", "the cart stays open while it changes");
    assert.equal(cart("cart.quantity.core_booster").text, "3");
    assert.equal(scene.focusedNode.id, "cart.more.core_booster", "focus stays where it was");
    click(cart("cart.more.single_pyre_drake"));
    click(cart("cart.remove.single_pyre_drake"));
    assert.equal(cart("cart.name.single_pyre_drake"), null);
    click(cart("cart.close"));
    assert.equal(scene.modal, null, "back to shopping");
    click(byId(scene, "shop.card.pyre_drake"));
    click(byId(scene, "shop.addToCart"));
    click(byId(scene, "shop.cart"));
    assert.equal(cart("cart.total").text, "Total: 5.5 STEEM");
    assert.equal(cart("cart.pay").text, "Pay 5.5 STEEM");

    click(cart("cart.pay"));
    await settle();
    const orders = market.calls.filter((call) => call.name === "createOrder");
    assert.equal(orders.length, 1, "one order for the whole cart");
    assert.deepEqual(orders[0].args[0], { items: [{ productId: "core_booster", quantity: 3 }, { productId: "single_pyre_drake", quantity: 1 }], asset: "STEEM" });
    assert.equal(transfers.length, 1, "one payment");
    assert.equal(shop.state.purchase.stage, PurchaseStage.DONE);
    assert.equal(scene.modal?.id, "reveal", "the cards of the whole cart are revealed");
    click(byId(scene, "reveal.close"));
    assert.equal(byId(scene, "shop.cart").text, "Cart");
    click(byId(scene, "shop.cart"));
    assert.ok(cart("cart.empty"));
    assert.equal(cart("cart.pay").isEffectivelyEnabled, false);
    click(cart("cart.close"));
    assert.equal(scene.modal, null);
  });

  it("lets anyone fill a cart, and asks to sign in to pay for it", async () => {
    const { scene, shop } = await harness({ signedIn: false });
    click(byId(scene, "shop.addToCart"));
    click(byId(scene, "shop.tab.decks"));
    click(byId(scene, "shop.addToCart"));
    click(byId(scene, "shop.cart"));
    const deck = scene.modal.findById("cart.visual.deck_precon_arcane");
    const rank = (face) => ["common", "uncommon", "rare", "epic", "legendary"].indexOf(face.rarity);
    assert.equal(deck.cards.length, 3, "a deck shows three of its cards");
    assert.equal(rank(deck.cards[2]), Math.max(...deck.cards.map(rank)), "its rarest card on top");
    assert.ok(rendered(scene).length > 0);
    assert.equal(scene.modal.findById("cart.status").text, "Sign in to pay.");
    assert.equal(scene.modal.findById("cart.pay").isEffectivelyEnabled, false);
    click(scene.modal.findById("cart.clear"));
    assert.deepEqual(shop.state.cart, []);
    scene.onKey({ type: "keydown", key: "Escape", repeat: false });
    assert.equal(scene.modal, null);
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
      now: () => 0,
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

  it("lists the unpaid orders behind Orders (n), each to pay or cancel", async () => {
    const { scene, market, shop, transfers } = await harness({ now: () => -10 * 60_000 });
    assert.equal(byId(scene, "shop.orders"), null, "no unpaid order: no button");
    const first = (await market.api.createOrder({ items: [{ productId: "core_booster", quantity: 1 }], asset: "STEEM" }, "k1")).value;
    const second = (await market.api.createOrder({ items: [{ productId: "core_mini_booster", quantity: 3 }], asset: "STEEM" }, "k2")).value;
    await shop.loadOrders();
    assert.equal(byId(scene, "shop.orders").text, "Orders (2)");
    click(byId(scene, "shop.orders"));
    await settle();
    assert.equal(scene.modal?.id, "orders");
    const inDialog = (id) => scene.modal.findById(id);
    assert.equal(inDialog(`orders.items.${second.id}`).text, "3 × core_mini_booster");
    assert.match(inDialog(`orders.detail.${second.id}`).text, /^3 STEEM · ordered just now · 11 min left to pay$/);
    assert.equal(scene.focusedNode?.id, `orders.pay.${second.id}`, "the newest first, ready to pay");

    click(inDialog(`orders.cancel.${first.id}`));
    await settle();
    assert.equal(scene.modal?.id, "orders", "stays open");
    assert.equal(inDialog(`orders.row.${first.id}`), null);
    assert.equal(byId(scene, "shop.orders").text, "Orders (1)");

    click(inDialog(`orders.pay.${second.id}`));
    await settle();
    assert.deepEqual(transfers.map((transfer) => transfer.amount), ["3.000"], "that order's own payment");
    assert.notEqual(scene.modal?.id, "orders", "closed to follow the payment");
    assert.equal(byId(scene, "shop.orders"), null, "nothing left unpaid");
  });

  it("offers no payment for an order whose time is up, only Cancel", async () => {
    const { scene, market, shop } = await harness();
    const order = (await market.api.createOrder({ items: [{ productId: "core_booster", quantity: 1 }], asset: "STEEM" }, "k1")).value;
    await shop.loadOrders();
    click(byId(scene, "shop.orders"));
    await settle();
    assert.equal(scene.modal.findById(`orders.pay.${order.id}`).isEffectivelyEnabled, false);
    assert.equal(scene.modal.findById(`orders.cancel.${order.id}`).isEffectivelyEnabled, true);
    assert.match(scene.modal.findById(`orders.detail.${order.id}`).text, /time to pay is over: it closes on its own$/);
  });

  it("is what Home's Market opens", async () => {
    const { app, services, navigated } = await harness();
    const home = new HomeScene(services, app);
    home.enter({});
    home.findNode("home.section.market").activate();
    assert.equal(navigated.at(-1).id ?? navigated.at(-1), SceneId.SHOP);
    home.exit();
  });
});
