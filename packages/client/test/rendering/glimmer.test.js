/**
 * The glimmer of the menu backdrop's gold figures: each now and then swells
 * with its own light and its star flares, never all together; frames asked
 * for only while one shines on a screen that shows it, and not too often.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { UiPiece } from "../../src/rendering/images/UiArt.js";
import { drawSceneBackdrop } from "../../src/rendering/ui/backdrop.js";
import { Glimmer } from "../../src/rendering/ui/Glimmer.js";
import { FakeContext2D, loadTheme } from "./fakes.js";

const theme = loadTheme();
const TIMING = Object.freeze({ pauseMs: Object.freeze({ min: 1000, max: 2000 }), swellMs: 800, frameMs: 40 });
const FIGURES = Object.freeze([Object.freeze({ x: 0.1, y: 0.2, radius: 0.1 }), Object.freeze({ x: 0.9, y: 0.8, radius: 0.1 })]);
const PAINTING = Object.freeze({ x: 0, y: 0, width: 1000, height: 600 });
const FRAME_MS = 16;

/** A frame drawn as the loop does: the lights move on, then the screen showing them is drawn. */
function frame(glimmer, dtMs = FRAME_MS) {
  const wanted = glimmer.update(dtMs);
  const context = new FakeContext2D();
  glimmer.draw(context, theme.colors, PAINTING);
  return { wanted, context };
}

/** Runs frames until a figure shines. */
function untilShining(glimmer) {
  for (let elapsed = 0; glimmer.shining === 0; elapsed += FRAME_MS) {
    assert.ok(elapsed < 60_000, "a figure shines");
    frame(glimmer);
  }
}

const rays = (context) => context.calls.filter((call) => call.method === "stroke").length;

describe("Glimmer", () => {
  it("a figure swells with light, its star flares, then it settles back dark", () => {
    const glimmer = new Glimmer({ figures: FIGURES.slice(0, 1), seed: "swell", timing: TIMING });
    untilShining(glimmer);
    const { context } = frame(glimmer, TIMING.swellMs / 2);
    assert.equal(rays(context), 8, "eight rays, like the painted stars");
    assert.ok(context.calls.some((call) => call.method === "createRadialGradient"), "around a bright core");
    assert.equal(context.globalCompositeOperation, "source-over", "blend restored");
    assert.equal(context.calls.filter((call) => call.method === "save").length, context.calls.filter((call) => call.method === "restore").length);

    const out = frame(glimmer, TIMING.swellMs);
    assert.equal(out.wanted, true, "the frame where it goes out is asked for");
    assert.equal(rays(out.context), 0);
  });

  it("figures shine at their own pace, not together", () => {
    const glimmer = new Glimmer({ figures: FIGURES, seed: "pace", timing: TIMING });
    const together = [];
    for (let elapsed = 0; elapsed < 20_000; elapsed += FRAME_MS) {
      frame(glimmer);
      together.push(glimmer.shining);
    }
    assert.ok(together.includes(1), "one at a time, mostly");
    assert.ok(together.filter((count) => count === FIGURES.length).length < together.length / 4, "rarely all at once");
  });

  it("asks for frames no more often than its frame time, and none from a screen that does not show it", () => {
    const glimmer = new Glimmer({ figures: FIGURES, seed: "rate", timing: TIMING });
    untilShining(glimmer);
    const asked = [];
    for (let elapsed = 0; elapsed < TIMING.swellMs / 2; elapsed += FRAME_MS) {
      asked.push(frame(glimmer).wanted);
    }
    const share = asked.filter(Boolean).length / asked.length;
    assert.ok(share > 0.2 && share < 0.6, `about every ${TIMING.frameMs}ms rather than every frame (${share})`);

    const hidden = new Glimmer({ figures: FIGURES, seed: "rate", timing: TIMING });
    for (let elapsed = 0; elapsed < 10_000; elapsed += FRAME_MS) {
      assert.equal(hidden.update(FRAME_MS), false);
    }
  });

  it("shines in the painted backdrop, over its vignette, where the stars are painted", () => {
    const glimmer = new Glimmer({ figures: [{ x: 0.5, y: 0.5, radius: 0.1 }], seed: "backdrop", timing: TIMING });
    untilShining(glimmer);
    glimmer.update(TIMING.swellMs / 2);
    const art = { layout: {}, imageFor: (piece) => (piece === UiPiece.BACKDROP ? { source: { piece }, width: 1500, height: 1000 } : null) };
    const context = new FakeContext2D();
    drawSceneBackdrop(context, { ...theme, uiArt: art, ambience: [glimmer] }, { x: 0, y: 0, width: 1600, height: 900 });
    const methods = context.calls.map((call) => call.method);
    assert.ok(methods.indexOf("clip") > methods.indexOf("fillRect", methods.indexOf("drawImage")), "over the vignette");
    assert.ok(methods.filter((method) => method === "drawImage").length > 1, "its gold brightens");
    const [x, y] = context.calls.find((call) => call.method === "moveTo").args;
    assert.deepEqual([Math.round(x), Math.round(y)], [800, 450], "the star where it is painted");
  });
});
