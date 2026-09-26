/**
 * Economy and marketplace data: exact money, accepted assets, rarities,
 * drop tables, the price list and products, validated against the real content.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildMarketCatalog, expandProduct } from "../../src/modules/marketplace/index.js";
import { formatAmount, parseAmount, validateAssets } from "../../src/modules/economy/index.js";
import { CatalogService, PgContentRepository } from "../../src/modules/catalog/index.js";
import { createCoreEffectRegistry } from "@magic8/engine/domain/effects/registerCoreEffects.js";
import { ENGINE_VERSION } from "@magic8/engine/version.js";
import { bundledContent } from "../helpers.js";
import { freshDatabase } from "../support/database.js";

const STEEM_ONLY = (network) => (network === "steem" ? [{ asset: "STEEM", precision: 3 }, { asset: "SBD", precision: 3 }] : []);
const bundle = await bundledContent();
const catalogService = new CatalogService({ repository: new PgContentRepository(await freshDatabase()) });
const { content } = await catalogService.publish({ raw: bundle.raw, effects: createCoreEffectRegistry(), engineVersion: ENGINE_VERSION });
const assets = validateAssets(bundle.assets, STEEM_ONLY);
assert.equal(assets.ok, true, JSON.stringify(assets));

/** A deep copy of the real market data, safe to break. */
function market() {
  return structuredClone(bundle.market);
}
const productNamed = (data, id) => data.products.find((product) => product.id === id);
const pricingOf = (data) => data.pricing;

describe("Money", () => {
  it("parses decimal strings exactly, in the asset's smallest unit", () => {
    assert.equal(parseAmount("12.5", 3), 12500);
    assert.equal(parseAmount("12.500", 3), 12500);
    assert.equal(parseAmount("0.001", 3), 1);
    assert.equal(parseAmount("7", 3), 7000);
    assert.equal(parseAmount("0.1", 3) + parseAmount("0.2", 3), parseAmount("0.3", 3), "no floating point");
    for (const bad of ["1.0001", "-1", "1e3", " 1", "01", "1.", ".5", "0x10", "", 1, null, "9999999999999999.000"]) {
      assert.equal(parseAmount(bad, 3), null, String(bad));
    }
    assert.equal(formatAmount(12500, 3), "12.500");
    assert.equal(formatAmount(1, 3), "0.001");
    assert.equal(formatAmount(0, 3), "0.000");
    assert.equal(formatAmount(42, 0), "42");
    assert.throws(() => formatAmount(1.5, 3), RangeError);
  });
});

describe("accepted assets", () => {
  it("accepts only assets a payment adapter can verify, once each", () => {
    assert.deepEqual(assets.value.list(), [{ network: "steem", asset: "STEEM", precision: 3 }]);
    const unsupported = validateAssets({ schemaVersion: 1, accepted: [{ network: "hive", asset: "HIVE", precision: 3 }] }, STEEM_ONLY);
    assert.match(unsupported.error.message, /no payment adapter verifies HIVE/);
    const wrongPrecision = validateAssets({ schemaVersion: 1, accepted: [{ network: "steem", asset: "STEEM", precision: 2 }] }, STEEM_ONLY);
    assert.equal(wrongPrecision.ok, false);
    const twice = validateAssets({ schemaVersion: 1, accepted: [{ network: "steem", asset: "STEEM", precision: 3 }, { network: "steem", asset: "STEEM", precision: 3 }] }, STEEM_ONLY);
    assert.equal(twice.ok, false);
  });
});

describe("market catalog", () => {
  it("builds from the bundled data", () => {
    const built = buildMarketCatalog(market(), content, assets.value);
    assert.equal(built.ok, true, JSON.stringify(built));
    const { products, dropTables, rarities } = built.value;
    assert.equal(rarities.of.size, content.catalog.size, "every card has a rarity");
    const booster = dropTables.get("core_booster");
    assert.equal(booster.size, 5);
    assert.match(booster.hash, /^[0-9a-f]{64}$/);
    assert.deepEqual(Object.keys(booster.table.pools), ["common", "epic", "legendary", "rare", "uncommon"]);
    assert.equal(products.get("core_booster").cardsPerUnit, 5);
    assert.equal(products.get("core_mini_booster").cardsPerUnit, 3);
    assert.equal(products.get("core_booster_box").cardsPerUnit, 60);
    assert.equal(products.get("deck_precon_arcane").cardsPerUnit, 30);
    assert.equal(products.get("core_booster").prices.get("STEEM"), 1000);
    assert.equal(products.get("single_pyre_drake_foil").contents[0].finish, "foil");
  });

  it("generates singles by rarity, fixed-price packs and decks at the sum of their cards", () => {
    const { products, rarities, decks, priceList } = buildMarketCatalog(market(), content, assets.value).value;
    const onSale = [...products.values()].filter((product) => product.active);
    assert.equal(priceList.asset, "STEEM");
    for (const [cardId, rarity] of rarities.of) {
      const { standard, foil } = priceList.singles.get(rarity);
      assert.equal(products.get(`single_${cardId}`).prices.get("STEEM"), standard, cardId);
      assert.equal(products.get(`single_${cardId}_foil`).prices.get("STEEM"), foil, cardId);
    }
    assert.equal(products.get("single_pyre_drake").prices.get("STEEM"), 500, "a rare");
    assert.deepEqual(
      onSale.filter((product) => product.kind === "pack").map((pack) => [pack.id, pack.cardsPerUnit, pack.prices.get("STEEM")]),
      [["core_booster", 5, 1000], ["core_mini_booster", 3, 500]],
    );
    for (const deck of decks.values()) {
      const sum = deck.entries.reduce((total, entry) => total + entry.count * priceList.singles.get(rarities.of.get(entry.cardId)).standard, 0);
      assert.equal(products.get(`deck_${deck.id}`).prices.get("STEEM"), sum, deck.id);
    }
    assert.equal(onSale.length, 2 + decks.size + 2 * rarities.of.size);
    assert.equal(products.get("deck_arcane_conclave").active, false, "retired products stay, so paid orders can be fulfilled");
  });

  it("follows the price list when prices change, and sells no foil for a rarity without a foil price", () => {
    const data = market();
    pricingOf(data).singles.prices.common = { standard: "0.100" };
    const { products, rarities, decks } = buildMarketCatalog(data, content, assets.value).value;
    assert.equal(products.get("single_ember_imp").prices.get("STEEM"), 100);
    assert.equal(products.has("single_ember_imp_foil"), false);
    assert.equal(products.has("single_pyre_drake_foil"), true);
    const commons = decks
      .get("precon_arcane")
      .entries.filter((entry) => rarities.of.get(entry.cardId) === "common")
      .reduce((total, entry) => total + entry.count, 0);
    assert.equal(products.get("deck_precon_arcane").prices.get("STEEM"), 10750 + 50 * commons);
  });

  it("refuses a broken price list", () => {
    const broken = {
      "rarity without price": (data) => delete pricingOf(data).singles.prices.epic,
      "price for an unknown rarity": (data) => (pricingOf(data).singles.prices.mythic = { standard: "9.000" }),
      "zero price": (data) => (pricingOf(data).singles.prices.common.standard = "0.000"),
      "too many decimals": (data) => (pricingOf(data).singles.prices.rare.foil = "2.5001"),
      "unaccepted asset": (data) => (pricingOf(data).asset = "SBD"),
      "unknown drop table": (data) => (pricingOf(data).packs[0].dropTable = "nope"),
      "bad pack id": (data) => (pricingOf(data).packs[0].id = "Core Booster"),
      "pack without price": (data) => delete pricingOf(data).packs[1].price,
      "no deck limit": (data) => delete pricingOf(data).decks.perOrder,
      "unknown field": (data) => (pricingOf(data).discount = "10%"),
      "id taken by a hand-written product": (data) => (productNamed(data, "core_booster_box").id = "core_booster"),
    };
    for (const [name, change] of Object.entries(broken)) {
      const data = market();
      change(data);
      assert.equal(buildMarketCatalog(data, content, assets.value).ok, false, name);
    }
  });

  it("expands bundles, decks and cards into what fulfilment mints", () => {
    const { products } = buildMarketCatalog(market(), content, assets.value).value;
    const box = expandProduct(products.get("core_booster_box"), 2, products);
    assert.equal(box.packs.length, 24);
    assert.deepEqual(box.cards, []);
    const foil = expandProduct(products.get("single_pyre_drake_foil"), 1, products);
    assert.deepEqual(foil.cards, [{ definitionId: "pyre_drake", count: 1, finish: "foil" }]);
    const deck = expandProduct(products.get("deck_precon_arcane"), 2, products);
    assert.deepEqual(deck.decks, [{ deckId: "precon_arcane", finish: "standard" }, { deckId: "precon_arcane", finish: "standard" }]);
  });

  it("refuses a card without rarity and a rarity for an unknown card", () => {
    const missing = market();
    delete missing.rarities.cards.ember_imp;
    assert.match(buildMarketCatalog(missing, content, assets.value).error.message, /ember_imp: missing/);
    const unknown = market();
    unknown.rarities.cards.ghost = "rare";
    assert.match(buildMarketCatalog(unknown, content, assets.value).error.message, /ghost: not a card/);
    const badRarity = market();
    badRarity.rarities.cards.ember_imp = "mythic";
    assert.equal(buildMarketCatalog(badRarity, content, assets.value).ok, false);
  });

  it("refuses broken products", () => {
    const broken = {
      "unknown card": (data) => (productNamed(data, "deck_arcane_conclave").contents[0] = { type: "card", ref: "ghost", count: 1 }),
      "unknown drop table": (data) => (productNamed(data, "core_booster_box").contents[0] = { type: "pack", ref: "nope", count: 1 }),
      "unknown deck": (data) => (productNamed(data, "deck_arcane_conclave").contents[0].ref = "precon_nope"),
      "unknown nested product": (data) => (productNamed(data, "core_booster_box").contents[0].ref = "nope"),
      "unaccepted asset": (data) => (productNamed(data, "core_booster_box").prices[0].asset = "SBD"),
      "zero price": (data) => (productNamed(data, "core_booster_box").prices[0].amount = "0.000"),
      "float price": (data) => (productNamed(data, "core_booster_box").prices[0].amount = 1),
      "too many decimals": (data) => (productNamed(data, "core_booster_box").prices[0].amount = "1.0001"),
      "finish on a pack": (data) => (productNamed(data, "core_booster_box").contents[0] = { type: "pack", ref: "core_booster", count: 1, finish: "foil" }),
      "unknown field": (data) => (productNamed(data, "core_booster_box").price = "free"),
      "cycle": (data) => productNamed(data, "deck_arcane_conclave").contents.push({ type: "product", ref: "deck_arcane_conclave", count: 1 }),
      "too many cards": (data) => (productNamed(data, "core_booster_box").contents[0].count = 1000),
      "bad window": (data) => Object.assign(productNamed(data, "core_booster_box").limits, { availableFrom: "2026-10-02T00:00:00Z", availableUntil: "2026-10-01T00:00:00Z" }),
      "duplicate id": (data) => data.products.push(structuredClone(productNamed(data, "core_booster_box"))),
    };
    for (const [name, change] of Object.entries(broken)) {
      const data = market();
      change(data);
      const built = buildMarketCatalog(data, content, assets.value);
      assert.equal(built.ok, false, name);
    }
  });

  it("refuses a drop table whose rarity has no card", () => {
    const data = market();
    data.dropTables[0].slots[0].weights = { mythic: 1 };
    assert.match(buildMarketCatalog(data, content, assets.value).error.message, /drop tables/);
  });
});
