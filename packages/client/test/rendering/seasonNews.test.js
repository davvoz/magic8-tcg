/**
 * The season's news on screen: every page draws, wide and on a phone, at
 * any point of its entrance; sounds play as things land; the dialog's
 * buttons turn the pages and close it.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

import { SoundCue } from "../../src/application/audio/SoundCue.js";
import { buildSeasonNews } from "../../src/application/season/SeasonNews.js";
import { buildSeasonNewsDialog } from "../../src/rendering/scenes/season/SeasonNewsDialog.js";
import { SeasonNewsShow } from "../../src/rendering/scenes/season/SeasonNewsShow.js";
import { loadBundledContent } from "../application/fixtures.js";
import { FakeContext2D, loadTheme } from "./fakes.js";

const theme = loadTheme();
const content = await loadBundledContent();
const raw = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../../data/ui/season-news.json"), "utf8"));
const RARITIES = { epic: "epic", legendary: "legendary" };
const news = /** @type {any} */ (buildSeasonNews(raw, { catalog: content.catalog, factions: content.deckRules.factions, rarities: ["common", "uncommon", "rare", "epic", "legendary"] })).value;
const cardOf = (cardId) => content.catalog.get(cardId) ?? null;
const rarityOf = (cardId) => ({ wake_the_dead: RARITIES.epic, thunderhoof_mammoth: RARITIES.legendary })[cardId] ?? "rare";

/** @param {Partial<ConstructorParameters<typeof SeasonNewsShow>[0]>} [options] */
function show(options = {}) {
  return new SeasonNewsShow({ width: 1388, height: 808, news, cardOf, rarityOf, ...options });
}

/** @param {SeasonNewsShow} node */
function drawn(node) {
  const context = new FakeContext2D();
  node.draw(context, theme);
  return context.texts;
}

describe("SeasonNewsShow", () => {
  it("draws every page, wide and compact, at the start of its entrance, halfway and settled", () => {
    for (const compact of [false, true]) {
      for (let page = 0; page < news.pages.length; page += 1) {
        const node = show({ compact, startPage: page, width: compact ? 828 : 1388, height: compact ? 376 : 808 });
        assert.doesNotThrow(() => drawn(node));
        node.tick(900);
        assert.doesNotThrow(() => drawn(node));
        node.tick(5000);
        assert.ok(drawn(node).length > 0, `page ${page} draws text`);
      }
    }
  });

  it("names the season on its first page and each change's old and new values on the last", () => {
    const intro = drawn(show({ settled: true }));
    assert.ok(intro.includes("Rites & Ruin"));
    assert.ok(intro.includes("S") && intro.includes("2"), "the eyebrow, letter by letter");
    const changes = drawn(show({ settled: true, startPage: 4 }));
    for (const text of ["Balance changes", "Thunderhoof Mammoth", "6", "8", "Rare", "Legendary", "NERF"]) {
      assert.ok(changes.includes(text), `${text} drawn`);
    }
    const wheel = drawn(show({ settled: true, startPage: 3 }));
    for (const faction of ["EMBER", "VERDANT", "IRON", "ARCANE", "SHADOW"]) {
      assert.ok(wheel.includes(faction), `the arrow into ${faction} names it`);
    }
  });

  it("plays its sounds as things land: a flip for each card, a chime for an epic one", () => {
    /** @type {string[]} */
    const heard = [];
    const node = show({ startPage: 2, play: (cue) => heard.push(cue) });
    node.tick(100);
    assert.deepEqual(heard, [], "nothing has turned yet");
    node.tick(10_000);
    assert.equal(heard.filter((cue) => cue === SoundCue.CARD_FLIP).length, 13);
    assert.deepEqual(heard.filter((cue) => cue === SoundCue.RARE_REVEAL), [SoundCue.RARE_REVEAL], "Wake the Dead is the one epic card");
    node.tick(10_000);
    assert.equal(heard.length, 14, "each only once");
  });

  it("is silent when settled, and stays within its pages", () => {
    /** @type {string[]} */
    const heard = [];
    const node = show({ settled: true, play: (cue) => heard.push(cue), startPage: 99 });
    assert.equal(node.page, news.pages.length - 1);
    assert.equal(node.isLast, true);
    node.go(0);
    node.go(-1);
    node.tick(10_000);
    assert.equal(node.page, 0);
    assert.deepEqual(heard, []);
  });
});

describe("buildSeasonNewsDialog", () => {
  const viewport = { logicalWidth: 1600, logicalHeight: 900 };

  it("turns the pages with Next and Back, then closes on Let's play", () => {
    let closed = 0;
    const { modal, show: node } = buildSeasonNewsDialog({ viewport, news, cardOf, rarityOf, onClose: () => (closed += 1) });
    const find = (id) => modal.findById(id);
    assert.equal(find("news.next").text, "Next");
    assert.equal(find("news.back").visible, false, "nothing to go back to");
    assert.equal(find("news.skip").visible, true);
    assert.equal(modal.focusableNodes()[0].id, "news.next", "the keyboard starts on Next");
    find("news.next").activate();
    find("news.next").activate();
    assert.equal(node.page, 2);
    find("news.back").activate();
    assert.equal(node.page, 1);
    while (!node.isLast) {
      find("news.next").activate();
    }
    assert.equal(find("news.next").text, "Let's play");
    assert.equal(find("news.skip").visible, false);
    assert.equal(find("news.back").x, find("news.skip").x, "Back takes Skip's place");
    assert.equal(closed, 0);
    find("news.next").activate();
    assert.equal(closed, 1);
  });

  it("closes on Skip, and on a click outside the panel", () => {
    let closed = 0;
    const { modal } = buildSeasonNewsDialog({ viewport, news, cardOf, rarityOf, onClose: () => (closed += 1) });
    modal.findById("news.skip").activate();
    modal.activate();
    assert.equal(closed, 2);
  });

  it("fills a phone's screen but for a margin", () => {
    const { modal } = buildSeasonNewsDialog({ viewport: { logicalWidth: 844, logicalHeight: 400, compact: true }, news, cardOf, rarityOf, onClose: () => undefined });
    assert.deepEqual([modal.panel.width, modal.panel.height], [828, 384]);
  });
});
