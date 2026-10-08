/**
 * The ranked entries drawn as tickets: a stack that grows with what the
 * player holds (up to three behind the top one), a seal with the count, a
 * faded outline when there are none, and the same wear for the same seed.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { EntryTickets } from "../../src/rendering/scenes/entries/EntryTickets.js";
import { FakeContext2D, loadTheme } from "./fakes.js";

const theme = loadTheme();
const AREA = Object.freeze({ x: 10, y: 20, width: EntryTickets.widthFor(120), height: 120 });

/** @param {number | null} count @param {string} [seed] */
function painted(count, seed = "test") {
  const context = new FakeContext2D();
  new EntryTickets({ ...AREA, count, title: "Ranked", face: "1.000 STEEM", seed }).paint(context, theme);
  return context;
}

/** How many tickets were cut out (each outline starts at its top-left notch). @param {FakeContext2D} context */
const outlines = (context) => new Set(context.calls.filter((call) => call.method === "arc" && call.args[3] === Math.PI / 2 && call.args[4] === 0).map((call) => call.args.slice(0, 2).join(","))).size;

describe("EntryTickets", () => {
  it("prints the top ticket and seals it with how many the player holds", () => {
    const context = painted(3);
    assert.deepEqual(context.texts, ["A D M I T  O N E", "RANKED", "1.000 STEEM", "JACKPOT", "×3"]);
  });

  it("stacks a ticket behind for each one more held, up to three", () => {
    assert.equal(outlines(painted(1)), 1);
    assert.equal(outlines(painted(3)), 3);
    assert.equal(outlines(painted(50)), 4);
  });

  it("shows a faded outline sealed at 0 when the player has none", () => {
    const context = painted(0);
    assert.deepEqual(context.texts, ["A D M I T  O N E", "RANKED", "0"]);
    assert.ok(context.calls.some((call) => call.method === "setLineDash" && call.args[0].length > 0), "dashed");
  });

  it("draws one plain ticket, without a seal, while the count is not known", () => {
    const context = painted(null);
    assert.equal(outlines(context), 1);
    assert.equal(context.texts.includes("×1"), false);
  });

  it("wears the same way for the same seed, another way for another", () => {
    const calls = (seed) => JSON.stringify(painted(2, seed).calls);
    assert.equal(calls("a"), calls("a"));
    assert.notEqual(calls("a"), calls("b"));
  });

  it("fits its area, the tickets behind included", () => {
    const context = painted(9);
    const xs = context.calls.filter((call) => call.method === "moveTo").map((call) => call.args[0]);
    assert.ok(Math.min(...xs) >= AREA.x);
    assert.ok(Math.max(...xs) <= AREA.x + AREA.width);
  });
});
