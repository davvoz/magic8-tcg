import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { statLines } from "../../src/rendering/cards/StatBreakdown.js";

const creature = (fields) => ({ attack: 4, health: 4, damage: 0, modifiers: [], printedAttack: 4, printedHealth: 4, ...fields });
const shown = (lines) => lines.map((line) => `${line.label} ${line.value}`);

describe("statLines", () => {
  it("has nothing to say about printed stats, nor about a card without printed stats", () => {
    assert.deepEqual(statLines(creature({})), []);
    assert.deepEqual(statLines({ attack: 0, health: 0 }), []);
  });

  it("separates lasting boosts, this turn's and damage: a 4/4 boosted +1/+1, hit for 2", () => {
    const card = creature({ attack: 7, health: 3, damage: 2, modifiers: [{ attack: 1, health: 1, duration: "permanent" }, { attack: 2, health: 0, duration: "end_of_turn" }] });
    assert.deepEqual(shown(statLines(card)), ["Printed 4/4", "Boosts +1/+1", "This turn +2/+0", "Damage -2", "Now 7/3"]);
  });

  it("shows penalties as such", () => {
    const lines = statLines(creature({ attack: 1, modifiers: [{ attack: -3, health: 0, duration: "permanent" }] }));
    assert.deepEqual(shown(lines), ["Printed 4/4", "Boosts -3/+0", "Now 1/4"]);
    assert.equal(lines[1].colorKey, "danger");
  });
});
