import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CardFaceProfile, paintCardFace } from "../../src/rendering/cards/CardFace.js";
import { CardStrip } from "../../src/rendering/cards/CardStrip.js";
import { buildCardInfoModal } from "../../src/rendering/cards/cardInfo.js";
import { drawRuns, keywordRuns, rulesTextFor, wrapRuns } from "../../src/rendering/text/keywordText.js";
import { loadBundledContent } from "../application/fixtures.js";
import { FakeContext2D, loadTheme } from "./fakes.js";

const theme = loadTheme();
const content = await loadBundledContent();

/** Remembers the colour and font each text is filled with. */
class StyledContext extends FakeContext2D {
  /** @type {{ text: string, color: unknown, font: string, x: number }[]} */
  styled = [];

  fillText(text, x, y) {
    super.fillText(text, x, y);
    this.styled.push({ text, color: this.fillStyle, font: this.font, x });
  }

  /** @param {string} text */
  colorOf(text) {
    return this.styled.find((entry) => entry.text === text)?.color;
  }
}

const style = Object.freeze({ font: "12px body", keywordFont: "bold 12px body", color: "#text", keywordColor: "#gold" });

describe("keywordText", () => {
  it("splits a text into runs, each keyword (whole word, any case) a run of its own", () => {
    assert.deepEqual(keywordRuns("Haste. Charges with haste.", ["haste"]), [
      { text: "Haste", keyword: true },
      { text: ". Charges with ", keyword: false },
      { text: "haste", keyword: true },
      { text: ".", keyword: false },
    ]);
    assert.deepEqual(keywordRuns("Hasted tramplers", ["haste", "trample"]), [{ text: "Hasted tramplers", keyword: false }], "only whole words");
    assert.deepEqual(keywordRuns("Haste.", []), [{ text: "Haste.", keyword: false }]);
  });

  it("names every keyword in the rules text, leading it with those the text does not mention", () => {
    assert.equal(rulesTextFor({ text: "Haste. Fast.", keywords: ["haste"] }), "Haste. Fast.");
    assert.equal(rulesTextFor({ text: "Fast.", keywords: ["haste", "trample"] }), "Haste. Trample. Fast.");
    assert.equal(rulesTextFor({ text: "", keywords: ["vigilance"] }), "Vigilance.");
    assert.equal(rulesTextFor({ text: "Plain." }), "Plain.");
  });

  it("wraps measuring the keywords in their own font and draws them in theirs, ellipsizing an overflowing line", () => {
    const context = new StyledContext();
    const lines = wrapRuns(context, "Haste. It is already there.", { keywords: ["haste"], width: 120, style });
    assert.deepEqual(lines.map((runs) => runs.map((run) => run.text).join("")), ["Haste. It is", "already there."]);
    drawRuns(context, lines[0], { x: 10, y: 0, width: 120, height: 20 }, style);
    assert.deepEqual(context.styled.map(({ text, color, font, x }) => ({ text, color, font, x })), [
      { text: "Haste", color: "#gold", font: "bold 12px body", x: 10 },
      { text: ". It is", color: "#text", font: "12px body", x: 50 },
    ]);
    const narrow = new StyledContext();
    drawRuns(narrow, keywordRuns("Creature · Trample", ["trample"]), { x: 0, y: 0, width: 110, height: 20 }, style);
    assert.deepEqual(narrow.texts, ["Creature · ", "T…"], "cut where it overflows, with an ellipsis");
    assert.ok(narrow.styled.reduce((width, entry) => Math.max(width, entry.x + entry.text.length * 8), 0) <= 110);
  });
});

describe("keywords in gold on every card surface", () => {
  const creature = content.catalog.all().find((card) => card.isCreature && card.keywords.length > 0);
  const keyword = creature.keywords[0];
  const named = `${keyword[0].toUpperCase()}${keyword.slice(1)}`;

  it("colours the keyword in the rules text of the board's and the inspect's faces, as on a phone's", () => {
    for (const [profile, frame] of [[CardFaceProfile.COMPACT, { x: 0, y: 0, width: 200, height: 280 }], [CardFaceProfile.FULL, { x: 0, y: 0, width: 380, height: 540 }], [CardFaceProfile.MINI, { x: 0, y: 0, width: 80, height: 112 }]]) {
      const context = new StyledContext();
      paintCardFace(context, theme, creature, { frame, profile });
      assert.equal(context.colorOf(named), theme.colors.accentLight, `${profile.id}: ${named} in gold`);
    }
  });

  it("colours the keywords in a list's strip and in the card's details", () => {
    const strip = new StyledContext();
    new CardStrip({ width: 600, height: 56, card: creature }).draw(strip, theme);
    assert.equal(strip.colorOf(named), theme.colors.accentLight, "strip subtitle");
    assert.equal(strip.colorOf("Creature · "), theme.colors.textMuted);
    const info = new StyledContext();
    buildCardInfoModal({ viewport: { logicalWidth: 1600, logicalHeight: 900 }, card: creature, rarity: null, onClose: () => undefined }).draw(info, theme);
    assert.ok(info.styled.filter((entry) => entry.text === named).length >= 2, "keywords line and rules text");
    assert.ok(info.styled.filter((entry) => entry.text === named).every((entry) => entry.color === theme.colors.accentLight));
  });
});
