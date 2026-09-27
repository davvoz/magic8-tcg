/**
 * The shop's shelves from the server's listing, a deck's price breakdown and
 * exact amount arithmetic for display.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { addAmounts, cartSummary, deckBreakdown, mainOfferOf, multiplyAmount, shelvesOf } from "../../src/application/shop/shopCatalog.js";
import { LISTING } from "./fakeMarketApi.js";

describe("shop shelves", () => {
  it("sorts the listing into packs, decks, singles and other offers", () => {
    const shelves = shelvesOf(LISTING);
    assert.deepEqual(shelves.packs.map((pack) => pack.id), ["core_mini_booster", "core_booster"], "cheapest first");
    assert.deepEqual(shelves.decks.map((deck) => deck.id), ["deck_precon_arcane"]);
    assert.deepEqual(shelves.offers.map((offer) => offer.id), ["core_booster_box"]);
    const drake = shelves.singles.find((offer) => offer.cardId === "pyre_drake");
    assert.equal(drake.rarity, "rare");
    assert.equal(drake.standard.id, "single_pyre_drake");
    assert.equal(drake.foil.id, "single_pyre_drake_foil");
    assert.equal(new Set(shelves.singles.map((offer) => offer.cardId)).size, shelves.singles.length, "one entry per card");
    const ranks = shelves.singles.map((offer) => LISTING.rarities.indexOf(offer.rarity));
    assert.deepEqual(ranks, [...ranks].sort((left, right) => right - left), "rarest first");
  });

  it("offers the foil when the standard is not sold", () => {
    const foilOnly = { ...LISTING, products: LISTING.products.filter((product) => product.id !== "single_pyre_drake") };
    const offer = shelvesOf(foilOnly).singles.find((candidate) => candidate.cardId === "pyre_drake");
    assert.equal(offer.standard, null);
    assert.equal(mainOfferOf(offer).id, "single_pyre_drake_foil");
  });

  it("prices a deck card by card, and gives no total when a card is not sold alone", () => {
    const { singles } = shelvesOf(LISTING);
    const entries = [{ cardId: "pyre_drake", count: 2 }, { cardId: "arcane_apprentice", count: 3 }];
    const breakdown = deckBreakdown(entries, singles);
    assert.deepEqual(breakdown.lines, [
      { cardId: "pyre_drake", count: 2, rarity: "rare", unit: "2.500", amount: "5.000" },
      { cardId: "arcane_apprentice", count: 3, rarity: "common", unit: "0.500", amount: "1.500" },
    ]);
    assert.equal(breakdown.total, "6.500");
    assert.equal(deckBreakdown([...entries, { cardId: "ghost", count: 1 }], singles).total, null);
  });

  it("prices a cart from the listing, and cannot pay for what is no longer on sale", () => {
    const summary = cartSummary([{ productId: "core_booster", quantity: 3 }, { productId: "single_pyre_drake", quantity: 2 }], LISTING.products);
    assert.deepEqual(summary.lines.map((line) => [line.productId, line.amount]), [["core_booster", "3.000"], ["single_pyre_drake", "5.000"]]);
    assert.deepEqual([summary.asset, summary.total, summary.quantity, summary.cards, summary.payable], ["STEEM", "8.000", 5, 17, true]);
    const retired = cartSummary([{ productId: "core_booster", quantity: 1 }, { productId: "gone", quantity: 1 }], LISTING.products);
    assert.deepEqual([retired.lines[1].product, retired.lines[1].amount, retired.total, retired.payable], [null, null, "1.000", false]);
    assert.deepEqual([cartSummary([], LISTING.products).payable, cartSummary([], LISTING.products).asset], [false, null]);
  });

  it("does exact decimal arithmetic", () => {
    assert.equal(multiplyAmount("2.500", 3), "7.500");
    assert.equal(multiplyAmount("0.001", 1000), "1.000");
    assert.equal(addAmounts("0.1", "0.2"), "0.3");
    assert.equal(addAmounts("0", "0.050"), "0.050");
    assert.equal(addAmounts("9.999", "0.001"), "10.000");
  });
});
