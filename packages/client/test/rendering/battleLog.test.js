/**
 * The battle log wraps every entry in full, tints it by kind, and scrolls:
 * it rests on the newest entries and keeps a scrolled-up position across
 * rebuilds.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BattleLogNode, createLogScroll } from "../../src/rendering/board/BattleLogNode.js";
import { LogKind } from "../../src/rendering/board/eventLog.js";
import { FakeContext2D, loadTheme } from "./fakes.js";

const theme = loadTheme();

/** Draws the log and returns each drawn line with the colour it was drawn in. */
const draw = (node) => {
  const context = new FakeContext2D();
  /** @type {{ text: string, color: string }[]} */
  const drawn = [];
  const fillText = context.fillText.bind(context);
  context.fillText = (text, ...rest) => {
    drawn.push({ text, color: context.fillStyle });
    fillText(text, ...rest);
  };
  node.draw(/** @type {any} */ (context), theme);
  return drawn;
};
const logOf = (entries, options = {}) => new BattleLogNode({ width: 220, height: 400, entries, ...options });
const numbered = (count) => Array.from({ length: count }, (_, index) => ({ text: `Entry ${index}`, kind: LogKind.PLAY }));

describe("BattleLogNode", () => {
  it("wraps a long entry over several lines instead of cutting it", () => {
    const text = "Opponent played Grove Sprite on Gravelord, Mind Sifter";
    const drawn = draw(logOf([{ text, kind: LogKind.PLAY }]));
    assert.ok(drawn.length > 1, "more than one line");
    assert.equal(drawn.map((line) => line.text).join(" "), text, "every word is drawn");
    assert.ok(drawn.every((line) => !line.text.includes("…")));
  });

  it("tells kinds apart by colour", () => {
    const drawn = draw(
      logOf([
        { text: "Turn 3: Opponent", kind: LogKind.TURN },
        { text: "Rat attacks", kind: LogKind.COMBAT },
        { text: "Rat deals 1 to You", kind: LogKind.DAMAGE },
        { text: "Rat died", kind: LogKind.LOSS },
        { text: "You healed 2", kind: LogKind.HEAL },
      ]),
    );
    assert.deepEqual(
      drawn.map((line) => line.color),
      [theme.colors.accent, theme.colors.focus, theme.colors.attack, theme.colors.danger, theme.colors.health],
    );
  });

  it("opens on the newest entries when they do not all fit, and scrolls back to the oldest", () => {
    const log = logOf(numbered(30), { height: 100 });
    draw(log);
    assert.ok(log.maxScrollY > 0, "more than fits");
    assert.equal(log.scrollY, log.maxScrollY, "resting at the bottom");
    assert.ok(log.scrollBy(-log.maxScrollY));
    assert.equal(log.scrollY, 0, "scrolled to the top");
  });

  it("follows new entries at the bottom, but stays put once scrolled up", () => {
    const view = createLogScroll();
    const first = logOf(numbered(30), { height: 100, view });
    draw(first);
    const grown = logOf(numbered(34), { height: 100, view });
    draw(grown);
    assert.equal(grown.scrollY, grown.maxScrollY, "still at the bottom after new entries");

    grown.scrollTo(40);
    const later = logOf(numbered(38), { height: 100, view });
    draw(later);
    assert.equal(later.scrollY, 40, "the scrolled-up position survives a rebuild");
    assert.ok(later.scrollY < later.maxScrollY);
  });
});
