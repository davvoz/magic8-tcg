/**
 * The game's name on the main menu: its painted image once ready, cast gold
 * in its own face until then, with rules on either side when there is room;
 * a sheen sweeps it soon after the menu opens, sparks wink on it and its
 * star (in the face, its last letter) kindles, now and then; frames asked
 * for only while its light moves on a screen that draws it.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { UiPiece } from "../../src/rendering/images/UiArt.js";
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

/** The painted name (1000×300), its letters filling the middle 80% of its width and height. */
const LETTERS = Object.freeze({ top: 0.1, bottom: 0.9, stops: Object.freeze([0.1, 0.26, 0.42, 0.58, 0.74, 0.9]), star: Object.freeze({ x: 0.18, y: 0.5 }) });
const NAME_IMAGE = Object.freeze({ source: Object.freeze({ piece: UiPiece.TITLE }), width: 1000, height: 300 });
const uiArt = (ready) => ({ layout: { title: LETTERS }, imageFor: (piece) => (ready && piece === UiPiece.TITLE ? NAME_IMAGE : null) });
const painted = { ...theme, uiArt: uiArt(true) };

/** A frame drawn as the loop does: time moves on, then the screen showing it is drawn. */
function frame(title, dtMs = FRAME_MS, withTheme = theme) {
  const wanted = title.update(dtMs);
  const context = new FakeContext2D();
  title.draw(context, withTheme);
  return { wanted, context };
}

/** The painted name's images drawn: [x, y, width, height] each. */
const namesDrawn = (context) => context.calls.filter((call) => call.method === "drawImage" && call.args[0] === NAME_IMAGE.source).map((call) => ({ box: call.args.slice(1).map(Math.round) }));

function assertBalanced(context) {
  assert.equal(context.calls.filter((call) => call.method === "save").length, context.calls.filter((call) => call.method === "restore").length, "save/restore balanced");
  assert.equal(context.globalAlpha, 1, "alpha restored");
  assert.equal(context.globalCompositeOperation, "source-over", "blend restored");
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
    const title = new TitleLogo({ text: "KIJAM", timing: TIMING, ...WIDE });
    const { context } = frame(title, 0);
    assert.ok(context.texts.includes("KIJAM"));
    const fills = context.calls.filter((call) => call.method === "fillText" && call.args[0] === "KIJAM");
    assert.ok(fills.length >= 5, "a shadow, its carved depth and its gold face");
    assert.ok(context.calls.some((call) => call.method === "strokeText"), "outlined and bevelled");
    assert.ok(context.calls.filter((call) => call.method === "stroke").length >= 4, "a rule on either side");
    assert.equal(context.globalCompositeOperation, "source-over", "blend restored");
    assert.equal(context.calls.filter((call) => call.method === "save").length, context.calls.filter((call) => call.method === "restore").length);
  });

  it("sets the name in theme.fonts.titleFamily", () => {
    const title = new TitleLogo({ text: "KIJAM", timing: TIMING, ...WIDE });
    const fonts = [];
    const context = new FakeContext2D();
    const fillText = context.fillText.bind(context);
    context.fillText = (...args) => (fonts.push(context.font), fillText(...args));
    title.draw(context, theme);
    assert.ok(fonts.every((font) => font.includes(theme.fonts.titleFamily)), fonts.join(" | "));
    assert.match(theme.fonts.titleFamily, /Cinzel Decorative/);
  });

  it("drops the rules when the word fills its room", () => {
    const title = new TitleLogo({ text: "KIJAM", timing: TIMING, x: 0, y: 0, width: 60, height: 84 });
    const { context } = frame(title, 0);
    assert.ok(context.texts.includes("KIJAM"));
    assert.equal(context.calls.filter((call) => call.method === "stroke").length, 0, "no rules");
  });

  it("a sheen sweeps the gold soon after it appears, then it rests and asks for no frames", () => {
    const title = new TitleLogo({ text: "KIJAM", timing: TIMING, ...WIDE });
    frame(title, 0);
    until(title, () => title.sweeping);
    const during = frame(title, TIMING.sweep.durationMs / 2);
    assert.ok(during.context.calls.filter((call) => call.method === "fillText" && call.args[0] === "KIJAM").length > fillsAtRest(), "the sheen laid over the letters");
    const out = frame(title, TIMING.sweep.durationMs);
    assert.equal(out.wanted, true, "the frame where it ends is asked for");
    assert.equal(title.sweeping, false);
    assert.equal(frame(title).wanted, false, "nothing moves: no frame");
  });

  it("sparks wink on the letters and the last one kindles, each in its own time", () => {
    const title = new TitleLogo({ text: "KIJAM", seed: "sparks", timing: TIMING, ...WIDE });
    frame(title, 0);
    until(title, () => title.sparking > 0);
    const spark = frame(title, TIMING.spark.durationMs / 4);
    assert.ok(spark.context.calls.filter((call) => call.method === "stroke").length > 4, "its rays, past the rules'");
    until(title, () => title.kindled);
    const kindle = frame(title, TIMING.kindle.durationMs / 2);
    assert.ok(kindle.context.texts.includes("M"), "the last letter drawn again, alight");
  });

  it("stops asking for frames on a screen that no longer draws it", () => {
    const title = new TitleLogo({ text: "KIJAM", timing: TIMING, ...WIDE });
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

describe("TitleLogo, painted", () => {
  it("lays the painted name once ready, its letters centred on the node, instead of the title face", () => {
    const title = new TitleLogo({ text: "KIJAM", timing: TIMING, ...WIDE });
    const { context } = frame(title, 0, painted);
    const drawn = namesDrawn(context);
    assert.equal(drawn.length, 1, "once, at rest");
    const [x, y, width, height] = drawn[0].box;
    assert.ok(Math.abs(x + width / 2 - (WIDE.x + WIDE.width / 2)) <= 1, "centred across");
    assert.ok(Math.abs(y + height / 2 - (WIDE.y + WIDE.height / 2)) <= 1, "centred down");
    assert.ok(Math.abs(height * (LETTERS.bottom - LETTERS.top) - WIDE.height * 0.8) <= 1, "its capitals 80% of the node's height");
    assert.ok(Math.abs(width / height - NAME_IMAGE.width / NAME_IMAGE.height) < 0.01, "not stretched");
    assert.ok(!context.texts.includes("KIJAM"), "no letters of the face");
    assert.ok(context.calls.some((call) => call.method === "stroke"), "the rules, with room for them");
    assertBalanced(context);
  });

  it("shrinks to fit a narrow node, the rules gone first", () => {
    const narrow = { x: 0, y: 0, width: 240, height: 110 };
    const { context } = frame(new TitleLogo({ text: "KIJAM", timing: TIMING, ...narrow }), 0, painted);
    const [x, , width] = namesDrawn(context)[0].box;
    const letters = width * (LETTERS.stops[5] - LETTERS.stops[0]);
    assert.ok(letters <= narrow.width, "the letters fit");
    assert.ok(x + width * LETTERS.stops[0] >= narrow.x - 1, "inside on the left");
  });

  it("is drawn in the title face while its image is on its way", () => {
    const { context } = frame(new TitleLogo({ text: "KIJAM", timing: TIMING, ...WIDE }), 0, { ...theme, uiArt: uiArt(false) });
    assert.deepEqual(namesDrawn(context), []);
    assert.ok(context.texts.includes("KIJAM"));
  });

  it("a sheen lays the gold again, lighter; the star flares up, then all settles back", () => {
    const title = new TitleLogo({ text: "KIJAM", timing: TIMING, ...WIDE });
    frame(title, 0, painted);
    until(title, () => title.sweeping);
    const sweep = frame(title, TIMING.sweep.durationMs / 2, painted).context;
    assert.ok(namesDrawn(sweep).length >= 3, "the name, then the sheen's bands over it");
    assert.ok(sweep.calls.some((call) => call.method === "clip"), "each held to its band");
    assertBalanced(sweep);
    until(title, () => title.kindled);
    const kindle = frame(title, TIMING.kindle.durationMs / 2, painted).context;
    const rays = kindle.calls.filter((call) => call.method === "stroke").length;
    const atRest = frame(new TitleLogo({ text: "KIJAM", timing: TIMING, ...WIDE }), 0, painted).context.calls.filter((call) => call.method === "stroke").length;
    assert.ok(rays >= atRest + 8, "the star's eight rays");
    assertBalanced(kindle);
  });
});

/** How many times the name is filled when nothing shines. */
function fillsAtRest() {
  const title = new TitleLogo({ text: "KIJAM", timing: TIMING, ...WIDE });
  const context = new FakeContext2D();
  title.draw(context, theme);
  return context.calls.filter((call) => call.method === "fillText" && call.args[0] === "KIJAM").length;
}
