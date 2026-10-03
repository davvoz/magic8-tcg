/**
 * The storm in the menu backdrop: rare strikes, one at a time, each a bolt
 * that grows out of a painted cloud, flashes and fades; frames asked for
 * only while one moves on a screen that shows it.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { UiPiece } from "../../src/rendering/images/UiArt.js";
import { drawSceneBackdrop, drawTableBackdrop } from "../../src/rendering/ui/backdrop.js";
import { Storm } from "../../src/rendering/ui/Storm.js";
import { FakeContext2D, loadTheme } from "./fakes.js";

const theme = loadTheme();
const TIMING = Object.freeze({ firstMs: 1000, pauseMs: Object.freeze({ min: 2000, max: 3000 }), growMs: 400, flashMs: 200, fadeMs: 600 });
const STRIKE_MS = TIMING.growMs + TIMING.flashMs + TIMING.fadeMs;
const CELLS = Object.freeze([
  Object.freeze({ x: 0.25, y: 0.25, angle: 135, length: 0.2 }),
  Object.freeze({ x: 0.75, y: 0.75, angle: 45, length: 0.2 }),
]);
/** Records how much of the painting each glint lays over itself, by the centre of its disc. */
class GleamContext extends FakeContext2D {
  /** @type {Map<string, number>} */
  #light = new Map();
  #disc = "";

  arc(...args) {
    super.arc(...args);
    this.#disc = args.slice(0, 2).map(Math.round).join();
  }

  drawImage(...args) {
    super.drawImage(...args);
    if (this.globalCompositeOperation === "lighter") {
      this.#light.set(this.#disc, (this.#light.get(this.#disc) ?? 0) + this.globalAlpha);
    }
  }

  /** @param {string} disc */
  lightAt(disc) {
    return this.#light.get(disc) ?? 0;
  }
}

const PAINTING = Object.freeze({ x: 0, y: 0, width: 1000, height: 600 });
const FRAME_MS = 16;

/** A frame drawn as the loop does: the storm moves on, then the screen showing it is drawn. */
function frame(storm, dtMs = FRAME_MS) {
  const wanted = storm.update(dtMs);
  const context = new FakeContext2D();
  storm.draw(context, theme.colors, PAINTING);
  return { wanted, context };
}

/** Runs frames until a strike starts; returns how long it took. */
function untilStrike(storm) {
  let elapsed = 0;
  while (!storm.isStriking) {
    frame(storm);
    elapsed += FRAME_MS;
    assert.ok(elapsed < 60_000, "a strike comes");
  }
  return elapsed;
}

const strokes = (context) => context.calls.filter((call) => call.method === "stroke").length;
const segments = (context) => context.calls.filter((call) => call.method === "lineTo").length;

function assertBalanced(context) {
  assert.equal(context.calls.filter((call) => call.method === "save").length, context.calls.filter((call) => call.method === "restore").length, "save/restore balanced");
  assert.equal(context.globalCompositeOperation, "source-over", "blend restored");
}

describe("Storm", () => {
  it("stays quiet at first, then a bolt grows out of a cloud, flashes and fades, and the sky is quiet again", () => {
    const storm = new Storm({ cells: CELLS, seed: "test", timing: TIMING });
    assert.equal(frame(storm, TIMING.firstMs - 1).wanted, false, "no frame asked for while it waits");
    assert.equal(strokes(frame(storm, 0).context), 0, "nothing drawn");

    assert.equal(frame(storm, 1).wanted, true, "the first strike asks for a frame");
    assert.ok(storm.isStriking);
    const early = frame(storm, 50);
    const grown = frame(storm, TIMING.growMs);
    assert.ok(strokes(early.context) > 0, "the bolt is drawn");
    assert.ok(segments(early.context) < segments(grown.context), "and grows");
    assert.ok(early.context.calls.some((call) => call.method === "createRadialGradient"), "its cloud lights up");
    assert.equal(early.context.calls.filter((call) => call.method === "drawImage").length, 0, "no glint without the painting's image");
    assertBalanced(grown.context);

    const ending = frame(storm, STRIKE_MS);
    assert.equal(ending.wanted, true, "the frame that clears it is asked for");
    assert.equal(strokes(ending.context), 0);
    assert.equal(storm.isStriking, false);
    assert.equal(frame(storm).wanted, false, "and nothing more until the next");
  });

  it("strikes rarely, one cell at a time and never the same one twice running", () => {
    const storm = new Storm({ cells: CELLS, seed: "rare", timing: TIMING });
    const cells = [];
    for (let strike = 0; strike < 6; strike += 1) {
      const waited = untilStrike(storm);
      assert.ok(waited >= (strike === 0 ? TIMING.firstMs : TIMING.pauseMs.min) - FRAME_MS, `a pause before strike ${strike} (${waited}ms)`);
      const { context } = frame(storm, 0);
      const [x] = context.calls.find((call) => call.method === "createRadialGradient").args;
      cells.push(x < PAINTING.width / 2 ? 0 : 1);
      frame(storm, STRIKE_MS);
    }
    assert.deepEqual(cells.slice(1).map((cell, index) => cell !== cells[index]), [true, true, true, true, true]);
  });

  it("asks no frames of a screen that does not show it", () => {
    const storm = new Storm({ cells: CELLS, seed: "match", timing: TIMING });
    const asked = [];
    for (let elapsed = 0; elapsed < TIMING.firstMs + STRIKE_MS * 2; elapsed += FRAME_MS) {
      asked.push(storm.update(FRAME_MS));
    }
    assert.ok(asked.every((wanted) => !wanted), "never drawn, never asked");
  });

  it("plays the same storm for the same seed", () => {
    const play = (seed) => {
      const storm = new Storm({ cells: CELLS, seed, timing: TIMING });
      untilStrike(storm);
      return frame(storm, TIMING.growMs).context.calls;
    };
    assert.deepEqual(play("same"), play("same"));
    assert.notDeepEqual(play("same"), play("other"));
  });

  it("without cells there is no storm", () => {
    const storm = new Storm({ cells: [], timing: TIMING });
    assert.equal(frame(storm, 60_000).wanted, false);
    assert.equal(storm.isStriking, false);
  });
});

describe("the storm in the backdrop", () => {
  const screen = { x: 0, y: 0, width: 1600, height: 900 };
  const art = { layout: {}, imageFor: (piece) => (piece === UiPiece.BACKDROP ? { source: { piece }, width: 1500, height: 1000 } : null) };

  it("is drawn over the painted backdrop, its clouds where they are painted", () => {
    const storm = new Storm({ cells: [{ x: 0.5, y: 0.5, angle: 90, length: 0.2 }], seed: "backdrop", timing: TIMING });
    untilStrike(storm);
    const context = new FakeContext2D();
    drawSceneBackdrop(context, { ...theme, uiArt: art, ambience: [storm] }, screen);
    const methods = context.calls.map((call) => call.method);
    assert.ok(methods.indexOf("drawImage") < methods.indexOf("stroke"), "over the painting");
    const [x, y] = context.calls.findLast((call) => call.method === "createRadialGradient").args; // the cloud, after the vignette
    assert.deepEqual([Math.round(x), Math.round(y)], [800, 450], "the painting's centre is the screen's");
    const [painted, ...glints] = context.calls.filter((call) => call.method === "drawImage");
    assert.ok(glints.length > 1, "the painting catches the light, fading out from the cloud");
    const whole = glints[0].args.slice(1).map(Math.round);
    assert.ok(glints.every((call) => call.args[0] === painted.args[0] && call.args.slice(1).map(Math.round).join() === whole.join()), "the whole painting, laid where it lies");
    assert.equal(whole[2], 1600, "as wide as the screen it fills");
    assert.equal(context.calls.filter((call) => call.method === "clip").length, glints.length, "each within its disc");
    assertBalanced(context);
  });

  it("makes the gold figures on the rim gleam over the vignette, those nearest the strike the most", () => {
    const figures = [{ x: 0.4, y: 0.5, radius: 0.1 }, { x: 0.98, y: 0.5, radius: 0.1 }];
    const storm = new Storm({ cells: [{ x: 0.5, y: 0.5, angle: 90, length: 0.2 }], figures, seed: "figures", timing: TIMING });
    untilStrike(storm);
    storm.update(TIMING.growMs + 30);
    const context = new GleamContext();
    drawSceneBackdrop(context, { ...theme, uiArt: art, ambience: [storm] }, screen);
    const near = context.lightAt("640,450");
    const far = context.lightAt("1568,450");
    assert.ok(far > 0, "even a far figure catches some of the flash");
    assert.ok(near > far * 2, `the near one much more (${near} against ${far})`);
    const methods = context.calls.map((call) => call.method);
    const vignette = methods.indexOf("fillRect", methods.indexOf("drawImage"));
    assert.ok(methods.indexOf("clip") > vignette, "laid over the vignette");
  });

  it("is not drawn without the painted backdrop, nor on the match table", () => {
    const storm = new Storm({ cells: CELLS, seed: "plain", timing: TIMING });
    untilStrike(storm);
    for (const draw of [drawSceneBackdrop, drawTableBackdrop]) {
      const context = new FakeContext2D();
      draw(context, { ...theme, uiArt: { layout: {}, imageFor: () => null }, ambience: [storm] }, screen);
      assert.equal(strokes(context), 0, draw.name);
    }
    storm.update(FRAME_MS); // the frame the last screen to show it asked for
    assert.equal(storm.update(FRAME_MS), false, "then no more frames are asked for it");
  });
});
