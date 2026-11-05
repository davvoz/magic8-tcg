/**
 * The season's news: the bundled file reads, a malformed one is refused
 * whole, and each account here is due to see a season's news once.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

import { NewsPageKind, buildSeasonNews } from "../../src/application/season/SeasonNews.js";
import { SeasonNewsService, parseSeen } from "../../src/application/season/SeasonNewsService.js";
import { MemoryLogger } from "../../src/infrastructure/logging/MemoryLogger.js";
import { InMemoryStore } from "../../src/infrastructure/persistence/InMemoryStore.js";
import { StoredSeasonNews } from "../../src/infrastructure/persistence/StoredSeasonNews.js";
import { loadBundledContent } from "./fixtures.js";

const content = await loadBundledContent();
const raw = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../../data/ui/season-news.json"), "utf8"));
const RARITIES = Object.freeze(["common", "uncommon", "rare", "epic", "legendary"]);
const known = Object.freeze({ catalog: content.catalog, factions: content.deckRules.factions, rarities: RARITIES });
/** A copy of the bundled file to break. */
const copy = () => structuredClone(raw);

describe("buildSeasonNews", () => {
  it("reads the bundled season: its name, and its pages in order", () => {
    const built = buildSeasonNews(raw, known);
    assert.equal(built.ok, true, JSON.stringify(built));
    assert.equal(built.value.id, "season-2");
    assert.equal(built.value.name, "Rites & Ruin");
    assert.deepEqual(
      built.value.pages.map((page) => page.kind),
      [NewsPageKind.INTRO, NewsPageKind.FEATURES, NewsPageKind.CARDS, NewsPageKind.CYCLE, NewsPageKind.CHANGES],
    );
    assert.ok(Object.isFrozen(built.value.pages[2]));
  });

  it("refuses the whole file over a card, faction, rarity or kind the game does not know", () => {
    const cases = [
      [["pages", 2, "cardIds", 0], "no_such_card", "pages[2].cardIds[0] must name a card"],
      [["pages", 3, "steps", 0, "faction"], "water", "pages[3].steps[0].faction must be one of"],
      [["pages", 4, "items", 0, "after", "rarity"], "mythic", "pages[4].items[0].after.rarity must be one of"],
      [["pages", 0, "kind"], "video", "pages[0].kind must be one of"],
      [["accent"], "water", "accent must be one of"],
      [["schemaVersion"], 2, "schemaVersion must be 1"],
      [["pages"], [], "pages must be a list of 1 to 8"],
      [["pages", 1, "items", 0, "text"], "", "pages[1].items[0].text must be text"],
      [["pages", 4, "items", 0, "before", "cost"], 1.5, "pages[4].items[0].before.cost must be a whole number"],
    ];
    for (const [path, value, problem] of cases) {
      const file = copy();
      const parent = path.slice(0, -1).reduce((node, key) => node[key], file);
      parent[path.at(-1)] = value;
      const built = buildSeasonNews(file, known);
      assert.equal(built.ok, false);
      assert.ok(built.message.includes(problem), `${built.message} ⊅ ${problem}`);
    }
    assert.equal(buildSeasonNews(null, known).ok, false);
  });
});

describe("SeasonNewsService", () => {
  const news = /** @type {any} */ (buildSeasonNews(raw, known)).value;
  const stored = (store = new InMemoryStore()) => new StoredSeasonNews({ store, logger: new MemoryLogger() });

  it("is due once per account, and remembers it across visits", () => {
    const store = new InMemoryStore();
    const service = new SeasonNewsService({ news, preferences: stored(store) });
    assert.equal(service.isDue("alice"), true);
    assert.equal(service.isDue(null), false, "nobody signed in");
    service.markSeen("alice");
    assert.equal(service.isDue("alice"), false);
    assert.equal(service.isDue("bob"), true, "each account sees it");
    assert.equal(new SeasonNewsService({ news, preferences: stored(store) }).isDue("alice"), false, "a new visit remembers");
  });

  it("is due again for the next season, and never without news", () => {
    const store = new InMemoryStore();
    new SeasonNewsService({ news, preferences: stored(store) }).markSeen("alice");
    assert.equal(new SeasonNewsService({ news: { ...news, id: "season-3" }, preferences: stored(store) }).isDue("alice"), true);
    const none = new SeasonNewsService({ news: null, preferences: stored(store) });
    assert.equal(none.isDue("carol"), false);
    none.markSeen("carol");
    assert.deepEqual(Object.keys(parseSeen(stored(store).load()).accounts), ["alice"]);
  });

  it("keeps the latest eight accounts, and reads back only what is well formed", () => {
    const service = new SeasonNewsService({ news, preferences: stored() });
    const names = Array.from({ length: 10 }, (_, index) => `player${index}`);
    names.forEach((name) => service.markSeen(name));
    assert.equal(service.isDue("player0"), true, "the oldest is forgotten");
    assert.equal(service.isDue("player9"), false);
    assert.deepEqual(parseSeen({ accounts: { alice: "season-2", "Bad Name": "season-2", bob: 3 } }).accounts, { alice: "season-2" });
    assert.deepEqual(parseSeen("nonsense").accounts, {});
  });
});
