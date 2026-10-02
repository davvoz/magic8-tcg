import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CanvasHost } from "../../src/rendering/canvas/CanvasHost.js";
import { GameLoop } from "../../src/rendering/canvas/GameLoop.js";
import { COMPACT, LayoutProfile, Viewport } from "../../src/rendering/canvas/Viewport.js";
import { validateTheme } from "../../src/rendering/theme/Theme.js";
import { ellipsize, wrapText } from "../../src/rendering/text/textUtils.js";
import { FakeCanvas, FakeFrames, FakeWindow, themeRaw } from "./fakes.js";

describe("Viewport", () => {
  it("scales uniformly and centres with letterboxing", () => {
    const viewport = new Viewport({ logicalWidth: 1600, logicalHeight: 900 });
    viewport.resize({ cssWidth: 1200, cssHeight: 900, devicePixelRatio: 2 });
    assert.equal(viewport.scale, 0.75);
    assert.equal(viewport.profile, LayoutProfile.WIDE);
    assert.deepEqual(viewport.letterbox, { x: 0, y: 112.5, cssWidth: 1200, cssHeight: 900 });
    assert.deepEqual(viewport.deviceSize, { width: 2400, height: 1800 });
    assert.deepEqual(viewport.toLogical(600, 450), { x: 800, y: 450 });
    assert.deepEqual(viewport.toCss(800, 450), { x: 600, y: 450 });
    assert.deepEqual(viewport.toLogical(0, 0), { x: 0, y: -150 }, "points in the letterbox map outside the logical area");
    assert.deepEqual(viewport.bounds, { x: 0, y: -150, width: 1600, height: 1200 }, "bounds cover the whole canvas, the design area centred");
  });

  it("bounds the design area until it knows the canvas, and widens for a wide one", () => {
    const viewport = new Viewport({ logicalWidth: 1600, logicalHeight: 900 });
    assert.deepEqual(viewport.bounds, { x: 0, y: 0, width: 1600, height: 900 });
    viewport.resize({ cssWidth: 2000, cssHeight: 900 });
    assert.deepEqual(viewport.bounds, { x: -200, y: 0, width: 2000, height: 900 });
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
    assert.equal(viewport.devicePixelRatio, 2, "a screen that small is compact: capped at 2");
    assert.ok(viewport.scale > 0);
    viewport.resize({ cssWidth: 1600, cssHeight: 900, devicePixelRatio: 10 });
    assert.equal(viewport.devicePixelRatio, 4);
  });

  it("switches to the compact profile on a phone in landscape: a 400-unit-tall design area as wide as the screen allows", () => {
    const viewport = new Viewport({ logicalWidth: 1600, logicalHeight: 900 });
    viewport.resize({ cssWidth: 844, cssHeight: 390, devicePixelRatio: 3 });
    assert.equal(viewport.profile, LayoutProfile.COMPACT);
    assert.equal(viewport.compact, true);
    assert.equal(viewport.logicalHeight, COMPACT.height);
    assert.equal(viewport.scale, 390 / 400);
    assert.equal(viewport.logicalWidth, Math.round(844 / (390 / 400)));
    assert.equal(viewport.devicePixelRatio, 2);
    assert.deepEqual(viewport.deviceSize, { width: 1688, height: 780 });
    // iPhone SE, the smallest supported: the minimum width decides the scale, the spare height is margin.
    viewport.resize({ cssWidth: 667, cssHeight: 375 });
    assert.equal(viewport.logicalWidth, COMPACT.minWidth);
    assert.equal(viewport.scale, 667 / COMPACT.minWidth);
    assert.ok(viewport.scale * 20 >= 17, "body text stays readable");
    assert.ok(viewport.bounds.height > COMPACT.height);
    // A short, very wide window: the design area stops at its widest, centred.
    viewport.resize({ cssWidth: 2400, cssHeight: 500 });
    assert.equal(viewport.logicalWidth, COMPACT.maxWidth);
    assert.ok(viewport.bounds.x < 0);
    // Back to a desktop window: the wide design again.
    viewport.resize({ cssWidth: 1600, cssHeight: 900 });
    assert.deepEqual([viewport.profile, viewport.logicalWidth, viewport.logicalHeight, viewport.scale], [LayoutProfile.WIDE, 1600, 900, 1]);
  });

  it("keeps the design area clear of the screen's unsafe edges while bounds still cover them", () => {
    const viewport = new Viewport({ logicalWidth: 1600, logicalHeight: 900 });
    viewport.resize({ cssWidth: 844, cssHeight: 390, insets: { left: 47, right: 47, bottom: 21 } });
    const scale = Math.min((390 - 21) / 400, (844 - 94) / COMPACT.minWidth);
    assert.equal(viewport.scale, scale);
    const origin = viewport.toCss(0, 0);
    assert.ok(origin.x >= 47, "the design area starts right of the notch");
    const end = viewport.toCss(viewport.logicalWidth, viewport.logicalHeight);
    assert.ok(end.x <= 844 - 47 + 1e-9 && end.y <= 390 - 21 + 1e-9);
    assert.deepEqual([viewport.bounds.width * scale, viewport.bounds.height * scale].map(Math.round), [844, 390]);
    const safe = viewport.safeBounds;
    assert.deepEqual([viewport.toCss(safe.x, safe.y).x, viewport.toCss(safe.x + safe.width, safe.y + safe.height).y].map(Math.round), [47, 369], "safe bounds stop at the insets");
    viewport.resize({ cssWidth: 1600, cssHeight: 900 });
    assert.deepEqual(viewport.safeBounds, viewport.bounds, "no insets: the same as bounds");
    viewport.resize({ cssWidth: 844, cssHeight: 390, insets: { left: 47, right: 47, bottom: 21 } });
    viewport.resize({ cssWidth: 844, cssHeight: 390, insets: { left: Number.NaN, right: 10_000 } });
    assert.ok(viewport.logicalWidth >= COMPACT.minWidth, "nonsense insets are clamped");
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

  it("hands the viewport the screen's unsafe edges and follows orientation changes", () => {
    const canvas = new FakeCanvas(844, 390);
    const window = new FakeWindow(1);
    const viewport = new Viewport({ logicalWidth: 1600, logicalHeight: 900 });
    let notch = 0;
    const host = new CanvasHost({ canvas, viewport, window, insets: () => ({ left: notch }) });
    host.attach();
    const before = viewport.toCss(0, 0).x;
    notch = 47;
    [canvas.clientWidth, canvas.clientHeight] = [844, 390];
    window.dispatch("orientationchange", {});
    assert.ok(viewport.toCss(0, 0).x > before);
    host.detach();
    assert.ok([...window.listeners.values()].every((handlers) => handlers.length === 0));
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
