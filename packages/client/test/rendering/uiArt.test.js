/**
 * The painted menus (UiArt): the backdrop, the panel corners, the divider
 * medallion and the button plates, each loaded through an ImageCache, and
 * the painters that use them once they are ready and draw procedurally
 * until then.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { MemoryLogger } from "../../src/infrastructure/logging/MemoryLogger.js";
import { UiArt, UiPiece } from "../../src/rendering/images/UiArt.js";
import { drawSceneBackdrop } from "../../src/rendering/ui/backdrop.js";
import { Button } from "../../src/rendering/ui/Button.js";
import { Ornament } from "../../src/rendering/ui/Ornament.js";
import { Panel } from "../../src/rendering/ui/Panel.js";
import { FakeContext2D, loadTheme } from "./fakes.js";

const theme = loadTheme();
const URLS = Object.fromEntries(Object.values(UiPiece).map((piece) => [piece, `art/${piece}.jpg`]));
const PLATE = { plate: { x: 0, y: 0.25, width: 1, height: 0.5 }, caps: { left: 0.2, right: 0.2 }, radius: 0.2 };
const LAYOUT = {
  corner: { extent: { x: 0.05, y: 0.05, width: 0.9, height: 0.9 }, lines: { x: 0.1, y: 0.1 } },
  divider: { x: 0.2, y: 0.2, width: 0.6, height: 0.6 },
  buttons: { primary: PLATE, secondary: PLATE },
};
/** Every piece ready, each a 1000² image (the backdrop 1500×1000). */
const readyArt = { layout: LAYOUT, imageFor: (piece) => ({ source: { piece }, width: piece === UiPiece.BACKDROP ? 1500 : 1000, height: 1000 }) };
const withArt = { ...theme, uiArt: readyArt };
const noArt = { ...theme, uiArt: { layout: LAYOUT, imageFor: () => null } };

/** The pieces drawn, in order, with their source and destination rectangles (rounded). */
const drawn = (context) => context.calls.filter((call) => call.method === "drawImage").map((call) => ({ piece: call.args[0].piece, source: call.args.slice(1, 5).map(Math.round), target: call.args.slice(5).map(Math.round) }));

function assertBalanced(context) {
  assert.equal(context.calls.filter((call) => call.method === "save").length, context.calls.filter((call) => call.method === "restore").length, "save/restore balanced");
  assert.equal(context.globalAlpha, 1, "alpha restored");
  assert.equal(context.globalCompositeOperation, "source-over", "blend restored");
}

describe("UiArt", () => {
  it("loads each piece from its own image and carries the layout", async () => {
    const requested = [];
    const art = new UiArt({ urls: URLS, layout: LAYOUT, loadImage: async (url) => { requested.push(url); return { source: { url }, width: 10, height: 10 }; }, logger: new MemoryLogger() });
    assert.equal(art.imageFor(UiPiece.CORNER), null, "not ready on first ask");
    await art.preload();
    assert.deepEqual(requested.sort(), Object.values(URLS).sort());
    assert.deepEqual(art.imageFor(UiPiece.DIVIDER)?.source, { url: "art/divider.jpg" });
    assert.equal(art.layout, LAYOUT);
  });

  it("warns about a piece that cannot be loaded, and refuses art missing a piece", async () => {
    const logger = new MemoryLogger();
    const art = new UiArt({ urls: URLS, layout: LAYOUT, loadImage: async () => Promise.reject(new Error("404")), logger });
    await art.preload();
    assert.equal(art.imageFor(UiPiece.BACKDROP), null);
    assert.equal(logger.entries.filter((entry) => entry.message === "ui art unavailable").length, Object.keys(URLS).length);
    assert.throws(() => new UiArt({ urls: { [UiPiece.BACKDROP]: "b.jpg" }, layout: LAYOUT, loadImage: async () => ({ source: {}, width: 1, height: 1 }), logger }), /each piece/);
  });

  it("the bundled art is there: one JPEG per piece", () => {
    for (const file of ["Sfondo_Menu.jpg", "Angolo_decorativo_pannelli.jpg", "DIVISORE_TITOLI.jpg", "BOTTONE_PRIMARIO.jpg", "BOTTONE_SECONDARIO.jpg"]) {
      const bytes = readFileSync(new URL(`../../../../data/art/${file}`, import.meta.url));
      assert.deepEqual([bytes[0], bytes[1]], [0xff, 0xd8], `${file} is a JPEG`);
    }
  });
});

describe("painting the menus", () => {
  const screen = { x: 0, y: 0, width: 1600, height: 900 };

  it("every menu stands on the painted backdrop, squeezed a little rather than cropped to the screen", () => {
    const painted = new FakeContext2D();
    drawSceneBackdrop(painted, withArt, screen);
    const [backdrop, ...rest] = drawn(painted);
    assert.deepEqual(rest, []);
    assert.equal(backdrop.piece, UiPiece.BACKDROP);
    assert.deepEqual(backdrop.target, [0, 0, 1600, 900]);
    const [, , top, width, height] = painted.calls.find((call) => call.method === "drawImage").args;
    assert.equal(width, 1500, "the whole width");
    assert.ok(height > (1500 * 900) / 1600 && height < 1000, `more than a plain crop keeps, less than all of it (${height})`);
    assert.ok(Math.abs(top - (1000 - height) / 2) < 1e-9, "cropped evenly");
    assertBalanced(painted);

    const plain = new FakeContext2D();
    drawSceneBackdrop(plain, noArt, screen);
    assert.deepEqual(drawn(plain), [], "the drawn glow while the image is on its way");
  });

  it("a large plain panel gets the gold corner in each corner; small, textured or art-less panels do not", () => {
    const painted = new FakeContext2D();
    new Panel({ x: 100, y: 50, width: 600, height: 700 }).draw(painted, withArt);
    const corners = drawn(painted);
    assert.equal(corners.length, 4);
    assert.ok(corners.every((corner) => corner.piece === UiPiece.CORNER));
    const origins = painted.calls.filter((call) => call.method === "translate").map((call) => call.args);
    assert.deepEqual(origins, [[106, 56], [694, 56], [106, 744], [694, 744]], "laid along the rim, just inside the edge");
    const flips = painted.calls.filter((call) => call.method === "scale").map((call) => call.args.map(Math.sign));
    assert.deepEqual(flips, [[1, 1], [-1, 1], [1, -1], [-1, -1]], "mirrored into each corner");
    assertBalanced(painted);

    for (const [label, panel, look] of [
      ["small", new Panel({ x: 0, y: 0, width: 400, height: 90 }), withArt],
      ["textured", new Panel({ x: 0, y: 0, width: 600, height: 700, textured: true }), withArt],
      ["no art", new Panel({ x: 0, y: 0, width: 600, height: 700 }), noArt],
    ]) {
      const context = new FakeContext2D();
      panel.draw(context, look);
      assert.deepEqual(drawn(context).filter((call) => call.piece === UiPiece.CORNER), [], label);
    }
  });

  it("the divider's medallion sits on the centre of its line, in place of the diamond", () => {
    const painted = new FakeContext2D();
    new Ornament({ x: 580, y: 314, width: 440, height: 16 }).draw(painted, withArt);
    const [medallion] = drawn(painted);
    assert.equal(medallion.piece, UiPiece.DIVIDER);
    assert.deepEqual(medallion.source, [200, 200, 600, 600]);
    const [x, y, width, height] = medallion.target;
    assert.equal(x + width / 2, 800, "centred across");
    assert.equal(y + height / 2, 322, "centred on the line");
    assert.ok(!painted.calls.some((call) => call.method === "fill"), "no diamond");
    assertBalanced(painted);

    const plain = new FakeContext2D();
    new Ornament({ x: 580, y: 314, width: 440, height: 16 }).draw(plain, noArt);
    assert.deepEqual(drawn(plain), []);
    assert.ok(plain.calls.some((call) => call.method === "fill"), "the diamond while the image is on its way");
  });

  it("a button lies on its plate: ends kept whole, middle stretched, label on top", () => {
    const button = (options) => new Button({ x: 100, y: 200, width: 300, height: 50, text: "Play", onActivate: () => undefined, ...options });
    const painted = new FakeContext2D();
    button({ variant: "primary" }).draw(painted, withArt);
    const slices = drawn(painted);
    assert.ok(slices.every((slice) => slice.piece === UiPiece.BUTTON_PRIMARY));
    // Plate 1000×500 at scale 0.1: 20px ends, the middle between them (overlapping each by a pixel).
    assert.deepEqual(slices.map((slice) => slice.target), [[119, 200, 262, 50], [100, 200, 20, 50], [380, 200, 20, 50]]);
    assert.deepEqual(slices.map((slice) => slice.source), [[200, 250, 600, 500], [0, 250, 200, 500], [800, 250, 200, 500]]);
    assert.ok(painted.calls.some((call) => call.method === "clip"), "cut along its outline");
    assert.ok(painted.texts.includes("Play"));
    assertBalanced(painted);

    for (const variant of ["secondary", "danger"]) {
      const context = new FakeContext2D();
      button({ variant }).draw(context, withArt);
      assert.ok(drawn(context).length === 3 && drawn(context).every((slice) => slice.piece === UiPiece.BUTTON_SECONDARY), variant);
    }
    const disabled = new FakeContext2D();
    button({ enabled: false }).draw(disabled, withArt);
    assert.equal(drawn(disabled).length, 3, "a disabled button keeps its plate, greyed");
    assert.ok(disabled.texts.includes("Play"));
    assertBalanced(disabled);
  });

  it("small-text buttons, buttons too narrow for the plate's ends and buttons without art keep the drawn slab", () => {
    for (const [label, options, look] of [
      ["small text", { textSize: "small" }, withArt],
      ["narrow", { width: 45 }, withArt],
      ["no art", {}, noArt],
    ]) {
      const context = new FakeContext2D();
      new Button({ x: 0, y: 0, width: 300, height: 50, text: "Go", onActivate: () => undefined, ...options }).draw(context, look);
      assert.deepEqual(drawn(context), [], label);
      assert.ok(context.texts.includes("Go"), label);
    }
  });
});
