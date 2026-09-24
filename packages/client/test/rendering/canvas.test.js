import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CanvasHost } from "../../src/rendering/canvas/CanvasHost.js";
import { GameLoop } from "../../src/rendering/canvas/GameLoop.js";
import { Viewport } from "../../src/rendering/canvas/Viewport.js";
import { validateTheme } from "../../src/rendering/theme/Theme.js";
import { ellipsize, wrapText } from "../../src/rendering/text/textUtils.js";
import { FakeCanvas, FakeFrames, FakeWindow, themeRaw } from "./fakes.js";

describe("Viewport", () => {
  it("scales uniformly and centres with letterboxing", () => {
    const viewport = new Viewport({ logicalWidth: 1600, logicalHeight: 900 });
    viewport.resize({ cssWidth: 800, cssHeight: 600, devicePixelRatio: 2 });
    assert.equal(viewport.scale, 0.5);
    assert.deepEqual(viewport.letterbox, { x: 0, y: 75, cssWidth: 800, cssHeight: 600 });
    assert.deepEqual(viewport.deviceSize, { width: 1600, height: 1200 });
    assert.deepEqual(viewport.toLogical(400, 300), { x: 800, y: 450 });
    assert.deepEqual(viewport.toCss(800, 450), { x: 400, y: 300 });
    assert.deepEqual(viewport.toLogical(0, 0), { x: 0, y: -150 }, "points in the letterbox map outside the logical area");
  });

  it("applies a device-resolution transform", () => {
    const viewport = new Viewport({ logicalWidth: 1600, logicalHeight: 900 });
    viewport.resize({ cssWidth: 3200, cssHeight: 1800, devicePixelRatio: 1.5 });
    const calls = [];
    viewport.applyTransform({ setTransform: (...args) => calls.push(args) });
    assert.deepEqual(calls, [[3, 0, 0, 3, 0, 0]]);
  });

  it("clamps degenerate sizes and DPR", () => {
    const viewport = new Viewport({ logicalWidth: 1600, logicalHeight: 900 });
    viewport.resize({ cssWidth: 0, cssHeight: 0, devicePixelRatio: 10 });
    assert.equal(viewport.devicePixelRatio, 4);
    assert.ok(viewport.scale > 0);
  });
});

describe("CanvasHost", () => {
  it("syncs the backing store to CSS size × DPR on attach and on resize", () => {
    const canvas = new FakeCanvas(800, 600);
    const window = new FakeWindow(2);
    const viewport = new Viewport({ logicalWidth: 1600, logicalHeight: 900 });
    let resizes = 0;
    const host = new CanvasHost({ canvas, viewport, window, onResize: () => (resizes += 1) });
    host.attach();
    assert.deepEqual([canvas.width, canvas.height], [1600, 1200]);
    canvas.clientWidth = 400;
    window.dispatch("resize", {});
    assert.deepEqual([canvas.width, canvas.height], [800, 1200]);
    assert.equal(resizes, 2);
    host.detach();
    canvas.clientWidth = 100;
    window.dispatch("resize", {});
    assert.equal(canvas.width, 800, "detached: no longer listening");
    assert.deepEqual(host.boundingRect().left, 10);
  });

  it("throws without a 2D context", () => {
    const canvas = { getContext: () => null };
    assert.throws(() => new CanvasHost({ canvas, viewport: new Viewport({ logicalWidth: 1, logicalHeight: 1 }), window: new FakeWindow() }), /2D context/);
  });
});

describe("GameLoop", () => {
  it("updates every frame and renders only when dirty or requested", () => {
    const frames = new FakeFrames();
    const loop = new GameLoop(frames);
    const log = [];
    let needsRender = false;
    loop.start({
      update: (dt) => {
        log.push(`update:${dt}`);
        return needsRender;
      },
      render: () => log.push("render"),
    });
    frames.tick(16);
    assert.deepEqual(log, ["update:16", "render"], "first frame always renders");
    frames.tick(16);
    assert.deepEqual(log.slice(2), ["update:16"], "nothing changed: no render");
    loop.requestRender();
    frames.tick(500);
    assert.deepEqual(log.slice(3), ["update:100", "render"], "dt is clamped; explicit request renders");
    needsRender = true;
    frames.tick(16);
    assert.deepEqual(log.slice(5), ["update:16", "render"], "update can ask for a render");
    loop.stop();
    frames.tick(16);
    assert.equal(log.length, 7);
    assert.equal(frames.pending, 0);
    assert.equal(loop.isRunning, false);
  });

  it("ignores a second start while running", () => {
    const frames = new FakeFrames();
    const loop = new GameLoop(frames);
    let renders = 0;
    loop.start({ update: () => false, render: () => (renders += 1) });
    loop.start({ update: () => false, render: () => (renders += 100) });
    frames.tick();
    assert.equal(renders, 1);
  });

  it("stops and reports when a frame throws, and can be restarted", () => {
    const frames = new FakeFrames();
    const loop = new GameLoop(frames);
    const errors = [];
    let calls = 0;
    loop.start({
      update: () => {
        calls += 1;
        if (calls === 2) {
          throw new Error("frame exploded");
        }
        return false;
      },
      render: () => undefined,
      onError: (error) => errors.push(error.message),
    });
    frames.tick();
    frames.tick();
    assert.deepEqual(errors, ["frame exploded"]);
    assert.equal(loop.isRunning, false);
    assert.equal(frames.pending, 0, "no frame scheduled after the failure");
    loop.start({ update: () => false, render: () => undefined });
    assert.equal(loop.isRunning, true);

    const bare = new GameLoop(frames);
    bare.start({ update: () => { throw new Error("no handler"); }, render: () => undefined });
    assert.throws(() => frames.tick(), /no handler/);
    assert.equal(bare.isRunning, false);
  });
});

describe("Theme", () => {
  it("validates the bundled theme and rejects bad colours, unknown keys and wrong versions", () => {
    assert.equal(validateTheme(themeRaw).ok, true);
    const badColor = structuredClone(themeRaw);
    badColor.colors.accent = "red";
    assert.equal(validateTheme(badColor).ok, false);
    const unknown = structuredClone(themeRaw);
    unknown.colors.evil = "#000000";
    assert.equal(validateTheme(unknown).ok, false);
    const version = structuredClone(themeRaw);
    version.schemaVersion = themeRaw.schemaVersion + 1;
    assert.equal(validateTheme(version).ok, false);
    const tones = structuredClone(themeRaw);
    tones.colors.factions.ember = "#c8472f";
    assert.equal(validateTheme(tones).ok, false, "a faction needs its three tones");
    const font = structuredClone(themeRaw);
    font.fonts.family = "x; background:url(evil)";
    assert.equal(validateTheme(font).ok, false);
    assert.equal(validateTheme(null).ok, false);
  });
});

describe("textUtils", () => {
  const measure = (text) => text.length * 10;

  it("wraps on words, breaks very long words and honours newlines", () => {
    assert.deepEqual(wrapText(measure, "the quick brown fox", 100), ["the quick", "brown fox"]);
    assert.deepEqual(wrapText(measure, "abcdefghijkl", 50), ["abcde", "fghij", "kl"]);
    assert.deepEqual(wrapText(measure, "a\nb", 100), ["a", "b"]);
    assert.deepEqual(wrapText(measure, "", 100), [""]);
  });

  it("ellipsizes only when needed", () => {
    assert.equal(ellipsize(measure, "short", 100), "short");
    assert.equal(ellipsize(measure, "a very long label", 60), "a ver…");
  });
});
