/**
 * Players' profile pictures: one STEEM image-service URL per valid account
 * name, each downloaded once, failures reported once; the portrait drawn
 * from the picture when it is ready and as the account's initial until then.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MemoryLogger } from "../../src/infrastructure/logging/MemoryLogger.js";
import { Avatars, steemAvatarUrl } from "../../src/rendering/images/Avatars.js";
import { drawAvatar } from "../../src/rendering/ui/avatar.js";
import { OptionRow } from "../../src/rendering/ui/OptionRow.js";
import { FakeContext2D, loadTheme } from "./fakes.js";

const theme = loadTheme();
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const PICTURE = Object.freeze({ source: /** @type {any} */ ({ picture: true }), width: 128, height: 128 });

describe("profile pictures", () => {
  it("asks the STEEM image service for each valid account once, never for other names", async () => {
    const urls = [];
    let loaded = 0;
    const avatars = new Avatars({ loadImage: async (url) => (urls.push(url), PICTURE), onLoaded: () => (loaded += 1), logger: new MemoryLogger() });
    assert.equal(steemAvatarUrl("alice"), "https://steemitimages.com/u/alice/avatar/medium");
    assert.equal(avatars.imageFor("alice"), null, "not ready yet");
    assert.equal(avatars.imageFor("alice"), null);
    await flush();
    assert.equal(avatars.imageFor("alice"), PICTURE);
    assert.equal(loaded, 1);
    assert.equal(avatars.imageFor("Bad Name"), null);
    assert.equal(avatars.imageFor("../x"), null);
    assert.equal(avatars.imageFor("ab"), null, "too short for STEEM");
    assert.deepEqual(urls, ["https://steemitimages.com/u/alice/avatar/medium"]);
  });

  it("warns once when pictures cannot be loaded, and keeps drawing initials", async () => {
    const logger = new MemoryLogger();
    const avatars = new Avatars({ loadImage: async () => Promise.reject(new Error("offline")), logger });
    avatars.imageFor("alice");
    avatars.imageFor("bob");
    await flush();
    assert.equal(logger.entries.filter((entry) => entry.message === "profile pictures unavailable").length, 1);
    assert.equal(avatars.imageFor("alice"), null);
  });

  it("draws the picture in a disc when it is ready, the initial until then", () => {
    const context = new FakeContext2D();
    drawAvatar(context, theme, { account: "alice", center: { x: 50, y: 50 }, radius: 20 });
    assert.deepEqual(context.texts, ["A"]);
    assert.ok(!context.calls.some((call) => call.method === "drawImage"));

    const withPicture = new FakeContext2D();
    drawAvatar(withPicture, { ...theme, avatars: { imageFor: () => PICTURE } }, { account: "alice", center: { x: 50, y: 50 }, radius: 20 });
    assert.deepEqual(withPicture.texts, []);
    assert.equal(withPicture.calls.find((call) => call.method === "drawImage")?.args[0], PICTURE.source);
    assert.ok(withPicture.calls.some((call) => call.method === "clip"), "clipped to the disc");
  });

  it("puts a player's portrait at the start of their row, before the name", () => {
    const row = new OptionRow({ x: 0, y: 0, width: 400, height: 64, text: "@alice", subtitle: "Ready to play", avatar: "alice", onActivate: () => undefined });
    const context = new FakeContext2D();
    row.paint(context, { ...theme, avatars: { imageFor: () => PICTURE } });
    const image = context.calls.find((call) => call.method === "drawImage");
    const name = context.calls.find((call) => call.method === "fillText" && call.args[0] === "@alice");
    assert.ok(image !== undefined && name !== undefined);
    assert.ok(/** @type {number} */ (name.args[1]) > /** @type {number} */ (image.args[5]) + /** @type {number} */ (image.args[7]), "the name starts after the portrait");
  });
});
