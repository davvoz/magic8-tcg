/**
 * The card filter every card list offers: its options come from the
 * content, the fields combine, unknown cards pass only when nothing is
 * filtered, and the board asks the server for the ids that pass.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ANY, NO_CARD_FILTER, cardFilterOptions, cardIdsMatching, describeCardFilter, isFiltering, matchesCardFilter, withCardFilter } from "../../src/application/content/CardFilter.js";
import { buildCardRarities } from "../../src/application/content/CardRarities.js";
import { loadBundledContent } from "./fixtures.js";

const content = await loadBundledContent();
const rarities = /** @type {{ ok: true, value: import("../../src/application/content/CardRarities.js").CardRarities }} */ (buildCardRarities({ rarities: ["common", "rare"], cards: { ember_imp: "common", pyre_drake: "rare", iron_watcher: "common" } }, content.catalog)).value;
const app = { content, rarities };

describe("card filter", () => {
  it("offers every faction, rarity and type, 'all' first", () => {
    const options = cardFilterOptions(app);
    assert.deepEqual(options.faction, [ANY, ...content.deckRules.factions]);
    assert.deepEqual(options.rarity, [ANY, "common", "rare"]);
    assert.deepEqual(options.type, [ANY, "creature", "spell"]);
    assert.deepEqual(cardFilterOptions({ content }).rarity, [ANY], "no rarities file, no rarity choice");
  });

  it("combines faction, rarity and type", () => {
    const imp = content.catalog.get("ember_imp");
    const emberCreature = withCardFilter(withCardFilter(NO_CARD_FILTER, "faction", "ember"), "type", "creature");
    assert.equal(matchesCardFilter(emberCreature, imp, "common"), true);
    assert.equal(matchesCardFilter(withCardFilter(emberCreature, "rarity", "rare"), imp, "common"), false);
    assert.equal(matchesCardFilter(withCardFilter(emberCreature, "type", "spell"), imp, "common"), false);
    assert.equal(matchesCardFilter(withCardFilter(NO_CARD_FILTER, "rarity", "rare"), imp, null), false, "an unknown rarity is no rarity");
    assert.equal(matchesCardFilter(NO_CARD_FILTER, undefined, null), true, "a card the game does not know shows unfiltered");
    assert.equal(matchesCardFilter(withCardFilter(NO_CARD_FILTER, "faction", "ember"), undefined, null), false);
    assert.equal(describeCardFilter(withCardFilter(emberCreature, "rarity", "rare")), "ember rare creature");
    assert.deepEqual([isFiltering(NO_CARD_FILTER), isFiltering(emberCreature)], [false, true]);
  });

  it("lists the catalog's cards that pass, or null for every card", () => {
    assert.equal(cardIdsMatching(NO_CARD_FILTER, app), null);
    assert.deepEqual([...cardIdsMatching(withCardFilter(NO_CARD_FILTER, "rarity", "rare"), app)], ["pyre_drake"]);
    const spells = cardIdsMatching(withCardFilter(NO_CARD_FILTER, "type", "spell"), app);
    assert.ok(spells.length > 0 && spells.every((id) => content.catalog.get(id).type === "spell"));
  });
});
