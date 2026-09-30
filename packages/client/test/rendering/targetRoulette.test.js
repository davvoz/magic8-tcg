/**
 * TargetRoulette: the crosshair of a random discard hunts across the hand
 * and always comes to rest on the cards that go, the same way every time.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CastReveal } from "../../src/rendering/board/CastReveal.js";
import { EffectsNode } from "../../src/rendering/board/EffectsNode.js";
import { TargetRoulette } from "../../src/rendering/board/TargetRoulette.js";
import { loadBundledContent } from "../application/fixtures.js";
import { FakeContext2D, loadTheme } from "./fakes.js";

const theme = loadTheme();
const hand = [100, 200, 300, 400, 500].map((x) => ({ x, y: 50 }));

describe("TargetRoulette", () => {
  it("hunts across the hand, slowing down, and locks on each card that goes, in order", () => {
    const roulette = new TargetRoulette({ candidates: hand, picks: [3, 1], seed: "c7:c3,c1", animation: theme.animation });
    assert.deepEqual(roulette.picked, [hand[3], hand[1]]);
    const seen = new Set();
    let firstLockAt = null;
    for (let time = 0; time <= roulette.durationMs; time += 10) {
      const { point, locked } = roulette.at(time);
      seen.add(point.x);
      firstLockAt ??= locked.length > 0 ? time : null;
      if (locked.length > 0) {
        assert.deepEqual(locked[0], hand[3], "the first card locks first");
      }
    }
    assert.ok([...seen].filter((x) => hand.some((card) => card.x === x)).length >= 3, "it rests on several cards along the way");
    assert.ok(firstLockAt !== null && firstLockAt < roulette.durationMs, "one locks before the draw is over");
    assert.deepEqual(roulette.at(firstLockAt).point, hand[3], "right where the crosshair stopped");
    const end = roulette.at(roulette.durationMs);
    assert.deepEqual(end.locked, [hand[3], hand[1]], "both locked in the end");
    assert.deepEqual(end.point, hand[1], "the crosshair on the last");
    assert.deepEqual(roulette.at(roulette.durationMs * 2), end, "and it stays there");
  });

  it("plays the same draw for the same seed", () => {
    const one = new TargetRoulette({ candidates: hand, picks: [2], seed: "same", animation: theme.animation });
    const two = new TargetRoulette({ candidates: hand, picks: [2], seed: "same", animation: theme.animation });
    for (let time = 0; time <= one.durationMs; time += 37) {
      assert.deepEqual(one.at(time), two.at(time));
    }
  });

  it("copes with a hand of one", () => {
    const roulette = new TargetRoulette({ candidates: [hand[0]], picks: [0], seed: "x", animation: theme.animation });
    assert.deepEqual(roulette.at(roulette.durationMs), { point: hand[0], locked: [hand[0]] });
  });

  it("is drawn over the table while the cast hunts, and not once its beams strike", async () => {
    const content = await loadBundledContent();
    const spell = content.catalog.all().find((definition) => definition.isSpell);
    const roulette = new TargetRoulette({ candidates: hand, picks: [4], seed: "paint", animation: theme.animation });
    const reveal = new CastReveal({
      card: { ...spell, instanceId: "c9", damage: 0, summoningSick: false, exhausted: false },
      caption: "Bob casts",
      targets: [{ ...hand[4], name: "Alice's hand" }],
      roulette,
      from: { x: 700, y: 20, width: 48, height: 68 },
      at: { x: 695, y: 300, width: 210, height: 294 },
      to: { x: 16, y: 16, width: 200, height: 184 },
      animation: theme.animation,
      holdMs: 0,
    });
    const node = new EffectsNode({ presenter: { leavingVisuals: [], floats: [], breakthroughs: [], cardFor: () => null, get moment() { return reveal.isDone ? null : reveal; } }, layout: { width: 1600, height: 900, cards: {} }, blocks: [] });
    const arcsNear = (context) => context.calls.filter((call) => call.method === "arc" && call.args[1] === 50).length;
    let hunting = 0;
    let afterStrike = 0;
    for (let frames = 0; frames < 400 && !reveal.isDone; frames += 1) {
      const context = new FakeContext2D();
      node.draw(context, theme);
      if (reveal.frame.seek > 0 && reveal.frame.strike === 0) {
        hunting += arcsNear(context) > 0 ? 1 : 0;
      }
      if (reveal.frame.strike >= 1) {
        afterStrike += context.calls.some((call) => call.method === "arc" && call.args[2] === 24) ? 1 : 0;
      }
      reveal.update(theme.animation.shortMs / 2);
    }
    assert.ok(hunting > 0, "the crosshair is drawn over the hand while it hunts");
    assert.equal(afterStrike, 0, "and gone once the beams strike");
  });
});
