/**
 * The game's name on the main menu: cast gold in its own face, with rules
 * on either side when there is room; a sheen sweeps it soon after the menu
 * opens, sparks wink on it and its 8 kindles, now and then; frames asked
 * for only while its light moves on a screen that draws it.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { TitleLogo } from "../../src/rendering/scenes/mainMenu/TitleLogo.js";
import { FakeContext2D, loadTheme } from "./fakes.js";

const theme = loadTheme();
const span = (min, max) => Object.freeze({ min, max });
const TIMING = Object.freeze({
  sweep: Object.freeze({ firstMs: span(100, 100), pauseMs: span(3000, 3000), durationMs: 600 }),
  spark: Object.freeze({ firstMs: span(1000, 1500), pauseMs: span(500, 900), durationMs: 400 }),
  kindle: Object.freeze({ firstMs: span(2000, 2000), pauseMs: span(4000, 4000), durationMs: 800 }),
  frameMs: 40,
});
const FRAME_MS = 16;
const WIDE = Object.freeze({ x: 0, y: 150, width: 1600, height: 110 });

/** A frame drawn as the loop does: time moves on, then the screen showing it is drawn. */
function frame(title, dtMs = FRAME_MS) {
  const wanted = title.update(dtMs);
  const context = new FakeContext2D();
  title.draw(context, theme);
  return { wanted, context };
}

/** Runs frames until `done` holds. */
function until(title, done) {
  for (let elapsed = 0; !done(); elapsed += FRAME_MS) {
    assert.ok(elapsed < 60_000, "it comes");
    frame(title);
  }
}

describe("TitleLogo", () => {
  it("draws the name in the title face, carved, gilded and flanked by rules", () => {
    const title = new TitleLogo({ text: "DOMIN8", timing: TIMING, ...WIDE });
    const { context } = frame(title, 0);
    assert.ok(context.texts.includes("DOMIN8"));
    const fills = context.calls.filter((call) => call.method === "fillText" && call.args[0] === "DOMIN8");
    assert.ok(fills.length >= 5, "a shadow, its carved depth and its gold face");
    assert.ok(context.calls.some((call) => call.method === "strokeText"), "outlined and bevelled");
    assert.ok(context.calls.filter((call) => call.method === "stroke").length >= 4, "a rule on either side");
    assert.equal(context.globalCompositeOperation, "source-over", "blend restored");
    assert.equal(context.calls.filter((call) => call.method === "save").length, context.calls.filter((call) => call.method === "restore").length);
  });

  it("sets the name in theme.fonts.titleFamily", () => {
    const title = new TitleLogo({ text: "DOMIN8", timing: TIMING, ...WIDE });
    const fonts = [];
    const context = new FakeContext2D();
    const fillText = context.fillText.bind(context);
    context.fillText = (...args) => (fonts.push(context.font), fillText(...args));
    title.draw(context, theme);
    assert.ok(fonts.every((font) => font.includes(theme.fonts.titleFamily)), fonts.join(" | "));
    assert.match(theme.fonts.titleFamily, /New Rocker/);
  });

  it("drops the rules when the word fills its room", () => {
    const title = new TitleLogo({ text: "DOMIN8", timing: TIMING, x: 0, y: 0, width: 60, height: 84 });
    const { context } = frame(title, 0);
    assert.ok(context.texts.includes("DOMIN8"));
    assert.equal(context.calls.filter((call) => call.method === "stroke").length, 0, "no rules");
  });

  it("a sheen sweeps the gold soon after it appears, then it rests and asks for no frames", () => {
    const title = new TitleLogo({ text: "DOMIN8", timing: TIMING, ...WIDE });
    frame(title, 0);
    until(title, () => title.sweeping);
    const during = frame(title, TIMING.sweep.durationMs / 2);
    assert.ok(during.context.calls.filter((call) => call.method === "fillText" && call.args[0] === "DOMIN8").length > fillsAtRest(), "the sheen laid over the letters");
    const out = frame(title, TIMING.sweep.durationMs);
    assert.equal(out.wanted, true, "the frame where it ends is asked for");
    assert.equal(title.sweeping, false);
    assert.equal(frame(title).wanted, false, "nothing moves: no frame");
  });

  it("sparks wink on the letters and the 8 kindles, each in its own time", () => {
    const title = new TitleLogo({ text: "DOMIN8", seed: "sparks", timing: TIMING, ...WIDE });
    frame(title, 0);
    until(title, () => title.sparking > 0);
    const spark = frame(title, TIMING.spark.durationMs / 4);
    assert.ok(spark.context.calls.filter((call) => call.method === "stroke").length > 4, "its rays, past the rules'");
    until(title, () => title.kindled);
    const kindle = frame(title, TIMING.kindle.durationMs / 2);
    assert.ok(kindle.context.texts.includes("8"), "the 8 drawn again, alight");
  });

  it("stops asking for frames on a screen that no longer draws it", () => {
    const title = new TitleLogo({ text: "DOMIN8", timing: TIMING, ...WIDE });
    frame(title, 0);
    until(title, () => title.sweeping);
    let asked = false;
    for (let elapsed = 0; elapsed < 10_000; elapsed += FRAME_MS) {
      asked ||= title.update(FRAME_MS);
    }
    assert.equal(asked, true, "the first frame after it was last drawn");
    assert.equal(title.update(FRAME_MS), false);
  });
});

/** How many times the name is filled when nothing shines. */
function fillsAtRest() {
  const title = new TitleLogo({ text: "DOMIN8", timing: TIMING, ...WIDE });
  const context = new FakeContext2D();
  title.draw(context, theme);
  return context.calls.filter((call) => call.method === "fillText" && call.args[0] === "DOMIN8").length;
}
