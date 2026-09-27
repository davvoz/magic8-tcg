/**
 * Painted card art living beside the procedural one: images load on demand
 * and never block a frame, a card shows its procedural art until (and
 * unless) its image is ready, and the image is cropped to the art window
 * around its focus point.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildIllustrationManifest } from "../../src/application/content/IllustrationManifest.js";
import { MemoryLogger } from "../../src/infrastructure/logging/MemoryLogger.js";
import { coverCrop, paintCardArt } from "../../src/rendering/cards/CardArt.js";
import { CardFaceProfile, paintCardFace } from "../../src/rendering/cards/CardFace.js";
import { CardIllustrations } from "../../src/rendering/cards/CardIllustrations.js";
import { loadBundledContent } from "../application/fixtures.js";
import { FakeContext2D, loadTheme } from "./fakes.js";

const theme = loadTheme();
const content = await loadBundledContent();
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const AREA = Object.freeze({ x: 10, y: 20, width: 100, height: 50 });

/** A loader whose downloads the test settles by hand. */
function fakeLoader() {
  /** @type {Map<string, { resolve: (image: object) => void, reject: (error: Error) => void }>} */
  const pending = new Map();
  const loader = {
    requested: /** @type {string[]} */ ([]),
    inFlight: 0,
    maxInFlight: 0,
    /** @param {string} url */
    loadImage: (url) => {
      loader.requested.push(url);
      loader.inFlight += 1;
      loader.maxInFlight = Math.max(loader.maxInFlight, loader.inFlight);
      return new Promise((resolve, reject) => pending.set(url, { resolve, reject })).finally(() => {
        loader.inFlight -= 1;
      });
    },
    /** @param {string} url @param {{ width: number, height: number }} [size] */
    succeed: (url, size = { width: 400, height: 300 }) => pending.get(url)?.resolve({ source: { url }, ...size }),
    /** @param {string} url */
    fail: (url) => pending.get(url)?.reject(new Error("404")),
  };
  return loader;
}

/** @param {Record<string, object>} cards */
function illustrationsFor(cards, loader = fakeLoader()) {
  const built = buildIllustrationManifest({ schemaVersion: 1, cards }, content.catalog);
  assert.equal(built.ok, true);
  const renders = { count: 0 };
  const logger = new MemoryLogger();
  const illustrations = new CardIllustrations({ manifest: built.value, urlFor: (file) => `art/${file}`, loadImage: loader.loadImage, onLoaded: () => { renders.count += 1; }, logger });
  return { illustrations, loader, renders, logger };
}

/** @param {FakeContext2D} context */
function assertBalanced(context) {
  const count = (method) => context.calls.filter((call) => call.method === method).length;
  assert.equal(count("save"), count("restore"), "every save is restored");
}

describe("coverCrop", () => {
  it("keeps the area's proportions, centred on the focus and never outside the image", () => {
    const wide = { width: 1000, height: 500 };
    const square = { width: 100, height: 100 };
    assert.deepEqual(coverCrop(wide, square, [0.5, 0.5]), { x: 250, y: 0, width: 500, height: 500 });
    assert.deepEqual(coverCrop(wide, square, [0, 0.5]), { x: 0, y: 0, width: 500, height: 500 }, "slid back inside on the left");
    assert.deepEqual(coverCrop(wide, square, [1, 0.5]), { x: 500, y: 0, width: 500, height: 500 }, "and on the right");
    assert.deepEqual(coverCrop({ width: 600, height: 400 }, { width: 300, height: 100 }, [0.5, 0.2]), { x: 0, y: 0, width: 600, height: 200 }, "a strip near the top");
    assert.deepEqual(coverCrop({ width: 600, height: 400 }, { width: 300, height: 100 }, [0.5, 0.5]), { x: 0, y: 100, width: 600, height: 200 });
    assert.deepEqual(coverCrop(square, square, [0.9, 0.1]), { x: 0, y: 0, width: 100, height: 100 }, "same proportions: the whole image");
  });
});

describe("CardIllustrations", () => {
  it("starts a download on the first request, answers null until it is ready, then asks for a redraw once", async () => {
    const { illustrations, loader, renders } = illustrationsFor({ ember_imp: { file: "ember_imp.webp", focus: [0.4, 0.3] } });
    assert.deepEqual(illustrations.cardIds, ["ember_imp"]);
    assert.equal(illustrations.imageFor("ember_imp"), null);
    assert.equal(illustrations.imageFor("ember_imp"), null);
    assert.deepEqual(loader.requested, ["art/ember_imp.webp"], "one download, however often it is asked for");
    loader.succeed("art/ember_imp.webp");
    await flush();
    assert.equal(renders.count, 1);
    assert.deepEqual(illustrations.imageFor("ember_imp"), { image: { source: { url: "art/ember_imp.webp" }, width: 400, height: 300 }, focus: [0.4, 0.3] });
  });

  it("never downloads for a card without an illustration", () => {
    const { illustrations, loader } = illustrationsFor({ ember_imp: { file: "ember_imp.webp" } });
    assert.equal(illustrations.imageFor("cinder_hound"), null);
    assert.deepEqual(loader.requested, []);
  });

  it("leaves a card procedural, with a warning and no retry, when its image fails or is empty", async () => {
    const { illustrations, loader, renders, logger } = illustrationsFor({ ember_imp: { file: "ember_imp.webp" }, cinder_hound: { file: "cinder_hound.webp" } });
    illustrations.imageFor("ember_imp");
    illustrations.imageFor("cinder_hound");
    loader.fail("art/ember_imp.webp");
    loader.succeed("art/cinder_hound.webp", { width: 0, height: 0 });
    await flush();
    assert.equal(illustrations.imageFor("ember_imp"), null);
    assert.equal(illustrations.imageFor("cinder_hound"), null);
    assert.equal(loader.requested.length, 2, "not retried");
    assert.equal(renders.count, 0);
    assert.deepEqual(logger.entries.map((entry) => [entry.level, /** @type {any} */ (entry.data).cardId]), [["warn", "ember_imp"], ["warn", "cinder_hound"]]);
  });

  it("preloads a few at a time, skips cards without art, and settles even when some fail", async () => {
    const ids = ["ember_imp", "cinder_hound", "flame_scout", "ash_raider", "pyre_drake", "iron_watcher"];
    const { illustrations, loader, renders } = illustrationsFor(Object.fromEntries(ids.map((id) => [id, { file: `${id}.webp` }])));
    const done = illustrations.preload(["ember_imp", "not_illustrated", ...ids.slice(1)]);
    await flush();
    assert.equal(loader.requested.length, 4, "four at a time");
    for (const [index, id] of ids.entries()) {
      if (index === 1) {
        loader.fail(`art/${id}.webp`);
      } else {
        loader.succeed(`art/${id}.webp`);
      }
      await flush();
    }
    await done;
    assert.equal(loader.maxInFlight, 4);
    assert.equal(loader.requested.length, ids.length);
    assert.equal(renders.count, ids.length - 1);
    assert.equal(illustrations.imageFor("cinder_hound"), null);
    assert.notEqual(illustrations.imageFor("pyre_drake"), null);
  });
});

describe("paintCardArt with illustrations", () => {
  it("draws the loaded image cropped to the window, looked up by definition id, without the procedural emblem", async () => {
    const { illustrations, loader } = illustrationsFor({ ember_imp: { file: "ember_imp.webp" } });
    const illustrated = Object.freeze({ ...theme, illustrations });
    const model = { name: "Ember Imp", type: "creature", faction: "ember", definitionId: "ember_imp", id: "instance-7" };

    const before = new FakeContext2D();
    paintCardArt(before, illustrated, model, AREA);
    assert.equal(before.calls.some((call) => call.method === "drawImage"), false, "procedural while the image is on its way");
    assert.ok(before.calls.some((call) => call.method === "fill"));
    assertBalanced(before);

    loader.succeed("art/ember_imp.webp", { width: 400, height: 300 });
    await flush();
    const after = new FakeContext2D();
    paintCardArt(after, illustrated, model, AREA);
    const draws = after.calls.filter((call) => call.method === "drawImage");
    assert.equal(draws.length, 1);
    assert.deepEqual(draws[0].args, [{ url: "art/ember_imp.webp" }, 0, 50, 400, 200, AREA.x, AREA.y, AREA.width, AREA.height]);
    assert.ok(after.calls.findIndex((call) => call.method === "clip") < after.calls.findIndex((call) => call.method === "drawImage"), "clipped to the window");
    assert.equal(after.calls.some((call) => call.method === "fill"), false, "no emblem over a painting");
    assertBalanced(after);
  });

  it("keeps the procedural art for cards without an illustration, and for themes without illustrations", () => {
    const { illustrations } = illustrationsFor({ ember_imp: { file: "ember_imp.webp" } });
    for (const [withTheme, id] of [[Object.freeze({ ...theme, illustrations }), "cinder_hound"], [theme, "ember_imp"]]) {
      const context = new FakeContext2D();
      paintCardArt(context, withTheme, { name: "X", type: "spell", faction: "ember", id }, AREA);
      assert.equal(context.calls.some((call) => call.method === "drawImage"), false);
      assert.ok(context.calls.some((call) => call.method === "stroke"), "the rune circle");
    }
  });

  it("paints a whole card face around an illustration at both sizes", async () => {
    const { illustrations, loader } = illustrationsFor({ ember_imp: { file: "ember_imp.webp" } });
    await Promise.all([illustrations.preload(["ember_imp"]), flush().then(() => loader.succeed("art/ember_imp.webp"))]);
    const illustrated = Object.freeze({ ...theme, illustrations });
    const card = content.catalog.get("ember_imp");
    for (const [frame, profile] of [[{ x: 0, y: 0, width: 130, height: 182 }, CardFaceProfile.COMPACT], [{ x: 0, y: 0, width: 380, height: 540 }, CardFaceProfile.FULL]]) {
      const context = new FakeContext2D();
      paintCardFace(context, illustrated, card, { frame, profile });
      assert.equal(context.calls.filter((call) => call.method === "drawImage").length, 1, profile.id);
      assert.ok(context.texts.includes("Ember Imp"), profile.id);
      assertBalanced(context);
    }
  });
});
