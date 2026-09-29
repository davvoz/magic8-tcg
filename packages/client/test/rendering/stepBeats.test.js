/**
 * StepBeats: one update broken into the beats the board plays one after
 * another, each with the state as it stood at its end — driven by real
 * engine moves, so the events are the ones the engine emits.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CommandType } from "@magic8/engine/domain/commands/CommandType.js";
import { GameEventType } from "@magic8/engine/domain/game/GameEventType.js";
import { ZoneType } from "@magic8/engine/domain/game/ZoneType.js";
import { P1, P2 } from "@magic8/engine/testing/fixtures.js";
import { createScenario } from "@magic8/engine/testing/scenario.js";
import { splitIntoBeats } from "../../src/rendering/board/StepBeats.js";

/**
 * Plays one of P1's hand cards and returns what the board would be handed, from `perspective`.
 * @param {Record<string, unknown>} spec
 * @param {(id: (playerId: string, zone: string, index?: number) => string) => string[]} targets
 */
function playFirstCard(spec, targets = () => [], perspective = P1) {
  const { engine, id } = createScenario(spec);
  engine.start();
  const before = engine.getSnapshot(perspective);
  const result = engine.execute({ type: CommandType.PLAY_CARD, playerId: P1, cardId: id(P1, ZoneType.HAND, 0), targets: targets(id) });
  assert.ok(result.ok, "the card is played");
  const after = engine.getSnapshot(perspective);
  return { before, after, events: result.value.events, beats: splitIntoBeats(before, after, result.value.events) };
}

const seat = (snapshot, playerId) => snapshot.players.find((player) => player.id === playerId);
const types = (beat) => beat.events.map((event) => event.type);

describe("StepBeats", () => {
  it("breaks a cast, the death it causes and what that death sets off into beats, each with the board as it stood", () => {
    const { before, after, events, beats } = playFirstCard({ p1: { hand: ["ember_bolt"], resources: 2 }, p2: { battlefield: ["ember_zealot"] } }, (id) => [id(P2, ZoneType.BATTLEFIELD, 0)]);
    const zealot = seat(before, P2).battlefield[0].instanceId;
    assert.equal(seat(after, P1).life, 19, "the zealot's death burned Alice");
    assert.equal(beats.length, 3);
    assert.deepEqual(beats.flatMap((beat) => beat.events), [...events], "every event, once, in order");

    const [cast, struck, burned] = beats;
    assert.equal(types(cast).at(-1), GameEventType.ABILITY_TRIGGERED, "the cast is announced");
    assert.ok(types(cast).includes(GameEventType.CARD_PLAYED));
    assert.ok(!seat(cast.snapshot, P1).hand.some((card) => card.name === "Ember Bolt"), "the bolt has left the hand");
    assert.equal(seat(cast.snapshot, P1).resources.current, 0, "and been paid for");
    assert.deepEqual(seat(cast.snapshot, P2).battlefield.map((card) => [card.instanceId, card.damage]), [[zealot, 0]], "the zealot stands untouched");
    assert.equal(seat(cast.snapshot, P1).life, 20);

    assert.deepEqual(types(struck), [GameEventType.DAMAGE_DEALT, GameEventType.CREATURE_DIED, GameEventType.ABILITY_TRIGGERED], "the bolt strikes, the zealot dies, its death is announced");
    assert.deepEqual(seat(struck.snapshot, P2).battlefield, [], "the zealot is gone");
    assert.ok(seat(struck.snapshot, P2).graveyard.some((card) => card.instanceId === zealot), "to the graveyard");
    assert.equal(seat(struck.snapshot, P1).life, 20, "but Alice is not burned yet");

    assert.equal(burned.snapshot, after, "the last beat is the final state itself");
    assert.ok(types(burned).includes(GameEventType.LIFE_CHANGED));
  });

  it("keeps a damaged survivor at full health until the blow that damages it", () => {
    const { after, beats } = playFirstCard({ p1: { hand: ["magma_hurler"], resources: 4 }, p2: { battlefield: ["steel_sentinel"] } }, (id) => [id(P2, ZoneType.BATTLEFIELD, 0)]);
    assert.equal(beats.length, 2);
    const [landed, blasted] = beats;
    assert.deepEqual(seat(landed.snapshot, P1).battlefield.map((card) => card.name), ["Magma Hurler"], "the hurler lands first");
    const standing = seat(landed.snapshot, P2).battlefield[0];
    assert.deepEqual([standing.health, standing.damage], [4, 0], "the sentinel unhurt while the ability is announced");
    assert.equal(blasted.snapshot, after);
    const hurt = seat(after, P2).battlefield[0];
    assert.deepEqual([hurt.health, hurt.damage], [2, 2]);
  });

  it("counts a hidden hand down as the card leaves it", () => {
    const { before, beats } = playFirstCard({ p1: { hand: ["ember_bolt", "ember_imp"], resources: 2 }, p2: { battlefield: ["ember_zealot"] } }, (id) => [id(P2, ZoneType.BATTLEFIELD, 0)], P2);
    assert.equal(seat(before, P1).hand, null, "Bob cannot see Alice's hand");
    assert.equal(seat(beats[0].snapshot, P1).handSize, seat(before, P1).handSize - 1);
    assert.equal(seat(beats[0].snapshot, P1).hand, null, "and still cannot");
  });

  it("leaves an update with nothing set off in one beat", () => {
    const { after, events, beats } = playFirstCard({ p1: { hand: ["lava_brute"], resources: 4 } });
    assert.deepEqual(beats, [{ snapshot: after, events, outcome: [] }]);
    assert.deepEqual(splitIntoBeats(null, after, events), [{ snapshot: after, events, outcome: [] }], "nor staged without a state to stage from");
  });
});
