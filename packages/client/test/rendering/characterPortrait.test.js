/**
 * The challenge characters' living portraits (docs/tcg/24-sfide.md): the
 * faction's aura drawn from the clock alone, the painted portrait when there
 * is one and the medallion with the initial until then, and the same
 * portrait at a challenger's seat in the match.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ANY_ID, buildIllustrationManifest } from "../../src/application/content/IllustrationManifest.js";
import { AURAS, paintAura } from "../../src/rendering/scenes/daily/FactionAura.js";
import { CharacterPortrait } from "../../src/rendering/scenes/daily/CharacterPortrait.js";
import { drawAvatar } from "../../src/rendering/ui/avatar.js";
import { FakeContext2D, loadTheme } from "./fakes.js";

const theme = loadTheme();
const AREA = Object.freeze({ x: 0, y: 0, width: 400, height: 200 });
const IMAGE = Object.freeze({ source: /** @type {any} */ ({}), width: 1344, height: 768 });
/** A Theme.characterArt with Kael's portrait ready. */
const KAEL_ART = Object.freeze({ imageFor: (id) => (id === "kael" ? { image: IMAGE, focus: /** @type {const} */ ([0.5, 0.3]) } : null) });

/** @param {(context: FakeContext2D) => void} paint */
function drawn(paint) {
  const context = new FakeContext2D();
  paint(context);
  return context.calls;
}

describe("FactionAura", () => {
  it("is a picture of the clock: the same moment twice is the same frame, another moment another", () => {
    const at = (timeMs) => JSON.stringify(drawn((context) => paintAura(context, theme, { area: AREA, faction: "ember", timeMs, seed: "kael" })));
    assert.equal(at(1234), at(1234));
    assert.notEqual(at(1234), at(1300));
  });

  it("has an air for every faction, a quiet one for any other, and draws its particles in two layers", () => {
    for (const faction of ["ember", "iron", "shadow", "verdant", "arcane", "neutral", "unknown"]) {
      assert.ok(drawn((context) => paintAura(context, theme, { area: AREA, faction, timeMs: 5000, seed: "x" })).length > 0, faction);
    }
    const particles = (share) => drawn((context) => paintAura(context, theme, { area: AREA, faction: "arcane", timeMs: 5000, seed: "x", share })).filter((call) => call.method === "arc").length;
    assert.equal(particles([0, 0.5]) + particles([0.5, 1]), particles([0, 1]));
    assert.ok(particles([0, 1]) <= AURAS.arcane.count);
  });
});

describe("CharacterPortrait", () => {
  const portrait = (character, art) => {
    const node = new CharacterPortrait({ ...AREA, character: { id: "kael", name: "Kael", faction: "ember", boss: false, state: "next", ...character }, layout: "stacked", clock: () => 4200 });
    return drawn((context) => node.paint(context, { ...theme, characterArt: art }));
  };

  it("shows the painted portrait when there is one, and the medallion with the initial until then", () => {
    const painted = portrait({}, KAEL_ART);
    assert.equal(painted.filter((call) => call.method === "drawImage").length, 1);
    assert.equal(painted.some((call) => call.method === "fillText"), false);
    const medallion = portrait({ id: "volcanic_wyrm", name: "The Volcanic Wyrm", boss: true }, KAEL_ART);
    assert.equal(medallion.some((call) => call.method === "drawImage"), false);
    assert.deepEqual(medallion.filter((call) => call.method === "fillText").map((call) => call.args[0]), ["W"], "the name's last word");
  });

  it("leaves the text room for the name: under the figure, or beside it on a phone", () => {
    const node = (layout) => new CharacterPortrait({ ...AREA, character: { id: "kael", name: "Kael", faction: "ember", boss: false, state: "next" }, layout, clock: () => 0 });
    assert.ok(node("stacked").textArea.y > AREA.height / 2);
    assert.equal(node("beside").textArea.x, AREA.height);
  });
});

describe("character portraits elsewhere", () => {
  it("reads the portraits file, any character id welcome", () => {
    const built = buildIllustrationManifest({ schemaVersion: 1, characters: { kael: { file: "character_kael.jpg", focus: [0.5, 0.3] } } }, ANY_ID, "characters");
    assert.equal(built.ok, true);
    assert.deepEqual(built.value.entries.get("kael"), { file: "character_kael.jpg", focus: [0.5, 0.3] });
    assert.equal(buildIllustrationManifest({ schemaVersion: 1, cards: {} }, ANY_ID, "characters").ok, false, "the section asked for");
  });

  it("gives a character's seat its painted portrait, and never asks STEEM for a picture of it", () => {
    const asked = [];
    const avatars = { imageFor: (account) => (asked.push(account), null) };
    const calls = drawn((context) => drawAvatar(context, { ...theme, characterArt: KAEL_ART, avatars }, { account: "ai_kael", center: { x: 50, y: 50 }, radius: 30 }));
    assert.equal(calls.filter((call) => call.method === "drawImage").length, 1);
    drawn((context) => drawAvatar(context, { ...theme, characterArt: KAEL_ART, avatars }, { account: "ai_sira", center: { x: 50, y: 50 }, radius: 30 }));
    assert.deepEqual(asked, []);
  });
});
