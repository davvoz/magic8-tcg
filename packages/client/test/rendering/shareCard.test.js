/**
 * The picture of a shared game (docs/tcg/26-ping.md): what it shows (the
 * game's name, the outcome, the winner and the defeated with their life), and
 * how it is saved: the players' profile pictures the game server passes
 * through (initials when there is none, or it is late), a challenge
 * character's own portrait, never another site's picture.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CanvasShareImage, paintShareCard } from "../../src/rendering/share/ShareCard.js";
import { FakeContext2D, loadTheme } from "./fakes.js";

const theme = loadTheme();
const PICTURE = Object.freeze({ source: /** @type {any} */ ({ picture: true }), width: 256, height: 256 });
const card = (opponent = { name: "@bob", account: "bob", life: 0 }) => ({ outcome: "win", title: "Victory", kind: "Ranked game", me: { name: "@alice", account: "alice", life: 14 }, opponent, turns: 12, site: "play.example" });

/** A canvas that records what is drawn on it. */
function fakeCanvas() {
  const context = new FakeContext2D();
  return { context, canvas: { width: 0, height: 0, getContext: () => context, toDataURL: (type) => `data:${type};base64,/9j/AAAA` } };
}

describe("ShareCard", () => {
  it("shows the outcome, the kind of game, both players with their life, and the turns", () => {
    const context = new FakeContext2D();
    paintShareCard(context, theme, card(), { x: 0, y: 0, width: 1200, height: 630 });
    for (const text of ["KIJAM", "VICTORY", "Ranked game", "@alice", "14", "@bob", "0", "life", "12 turns", "#kijam", "WINNER", "DEFEATED"]) {
      assert.ok(context.texts.includes(text), text);
    }
    assert.ok(context.texts.some((text) => text.startsWith("Play at play.example")));
  });

  it("is saved as a JPEG with the profile pictures passed through the server, initials where there is none", async () => {
    const { context, canvas } = fakeCanvas();
    const asked = [];
    const image = new CanvasShareImage({ theme: { ...theme, avatars: { imageFor: () => PICTURE } }, createCanvas: () => /** @type {any} */ (canvas), pictureOf: async (account) => (asked.push(account), account === "alice" ? PICTURE : null) });
    const painted = await image.render(card());
    assert.equal(painted.value.base64, "/9j/AAAA");
    assert.equal(painted.value.image.source, canvas, "and the painting itself, for the dialog");
    assert.deepEqual([canvas.width, canvas.height], [1200, 630]);
    assert.deepEqual(asked.sort(), ["alice", "bob"]);
    assert.equal(context.calls.filter((call) => call.method === "drawImage").length, 1, "alice's picture; bob, without one, as his initial (never the screen's own pictures)");
    assert.ok(context.texts.includes("B"));
  });

  it("does not wait for a late picture, and asks none for a challenge's character", async () => {
    const { canvas } = fakeCanvas();
    const asked = [];
    const image = new CanvasShareImage({ theme, createCanvas: () => /** @type {any} */ (canvas), pictureOf: (account) => (asked.push(account), new Promise(() => undefined)), waitMs: 10 });
    assert.equal((await image.render(card({ name: "The Gravelord", account: "ai_gravelord", life: 0 }))).ok, true);
    assert.deepEqual(asked, ["alice"]);
  });
});
