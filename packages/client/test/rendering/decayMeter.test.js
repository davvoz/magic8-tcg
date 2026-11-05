/**
 * Today's rating decay as a pill (DecayMeter): its words, in full and in
 * brief, its width in brief, and as a button.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DecayMeter, decayBriefText, decayMeterText } from "../../src/rendering/scenes/online/DecayMeter.js";
import { FakeContext2D, loadTheme } from "./fakes.js";

const theme = loadTheme();
const AT = Date.UTC(2026, 10, 3);
const FRAME = Object.freeze({ x: 0, y: 0, width: 420, height: 26 });

/** @param {object} decay */
const meter = (decay) => new DecayMeter({ ...FRAME, decay: { at: AT, ...decay } });

describe("DecayMeter", () => {
  it("says what is left to play today and what it costs, or that the day is safe", () => {
    assert.equal(decayMeterText({ points: 50, games: 3, played: 0, safe: false, at: AT }), "Play 3 ranked today or −50");
    assert.equal(decayMeterText({ points: 50, games: 3, played: 2, safe: false, at: AT }), "Play 1 more ranked today or −50");
    assert.equal(decayMeterText({ points: 5, games: 1, played: 0, safe: false, at: AT }), "Play ranked today or −5");
    assert.equal(decayMeterText({ points: 15, games: 2, played: 2, safe: true, at: AT }), "Safe today · 2/2 ranked");
    assert.equal(decayMeterText({ points: 5, safe: false, at: AT }), "Play ranked today or −5", "an older server asks for one game");
    assert.equal(decayMeterText({ points: 5, safe: true, at: AT }), "Safe today · 1/1 ranked");
  });

  it("in brief, says only the rating at stake or that the day is safe; given something to do, it is a button", () => {
    assert.equal(decayBriefText({ points: 50, games: 3, played: 1, safe: false, at: AT }), "−50");
    assert.equal(decayBriefText({ points: 50, games: 3, played: 3, safe: true, at: AT }), "Safe");
    const shown = meter({ points: 15, games: 2, played: 0, safe: false });
    assert.deepEqual([shown.interactive, shown.passthrough], [false, true], "drawing only");
    let opened = 0;
    const button = new DecayMeter({ ...FRAME, decay: { points: 15, games: 2, played: 0, safe: false, at: AT }, brief: true, onActivate: () => (opened += 1) });
    assert.equal(button.text, "−15");
    assert.deepEqual([button.interactive, button.focusable, button.passthrough], [true, true, false]);
    button.activate();
    assert.equal(opened, 1);
  });

  it("draws a dot for each game the day asks for, and its words run by run: what is left to play, then the rating at stake", () => {
    const context = new FakeContext2D();
    meter({ points: 50, games: 3, played: 1, safe: false }).paint(context, theme);
    assert.deepEqual(context.texts, ["Play 2 more ranked today", "or", "−50"]);
    assert.equal(context.calls.filter((call) => call.method === "arc").length, 3, "three dots");
    const safe = new FakeContext2D();
    meter({ points: 50, games: 3, played: 3, safe: true }).paint(safe, theme);
    assert.deepEqual(safe.texts, ["Safe today", "· 3/3 ranked"]);
  });

  it("is as wide in brief as its dots and words need", () => {
    const two = DecayMeter.briefWidth({ points: 15, games: 2, played: 0, safe: false, at: AT }, 44);
    const three = DecayMeter.briefWidth({ points: 50, games: 3, played: 0, safe: false, at: AT }, 44);
    assert.ok(two > 90 && two < 170, `${two}`);
    assert.ok(three > two, "a dot more");
  });

});
