/**
 * The primitives added for the Arcane faction: return_to_hand, mill,
 * destroy, and the on_turn_start trigger that Mind Sifter rides on.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { endTurn, playCard } from "../../../src/domain/commands/commandFactories.js";
import { GameEventType } from "../../../src/domain/game/GameEventType.js";
import { ZoneType } from "../../../src/domain/game/ZoneType.js";
import { P1, P2, eventsOfType, player, view } from "./fixtures.js";
import { createScenario } from "./scenario.js";

const HAND = ZoneType.HAND;
const BF = ZoneType.BATTLEFIELD;

describe("return_to_hand", () => {
  it("sends an enemy creature back to its owner's hand with a clean slate (Unsummon)", () => {
    const { engine, id } = createScenario({
      p1: { hand: ["unsummon", "fire_surge", "quick_strike"], resources: 4 },
      p2: { battlefield: ["clockwork_knight"] },
    });
    const knight = id(P2, BF);
    assert.equal(engine.execute(playCard(P1, id(P1, HAND, 2), [knight])).ok, true, "2 damage on the knight");
    assert.equal(player(engine, P2).battlefield[0].health, 2);
    const result = engine.execute(playCard(P1, id(P1, HAND, 0), [knight]));
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(player(engine, P2).battlefield.length, 0);
    assert.equal(player(engine, P2).handSize, 1);
    const returned = eventsOfType(result.value.events, GameEventType.CARD_RETURNED)[0];
    assert.equal(returned.targetId, knight);
    assert.equal(returned.playerId, P2);
    engine.execute(endTurn(P1));
    assert.equal(engine.execute(playCard(P2, knight)).ok, true, "it can be played again");
    const replayed = player(engine, P2).battlefield[0];
    assert.equal(replayed.health, 4, "damage was cleared when it left the battlefield");
    assert.equal(replayed.summoningSick, true);
  });

  it("a bounce creature played against an empty board is just a body (Spellbinder)", () => {
    const { engine, id } = createScenario({ p1: { hand: ["spellbinder"], resources: 3 } });
    assert.deepEqual(engine.getLegalMoves(P1).playableCardIds, [id(P1, HAND)], "nothing to bounce is not a reason to stay in hand");
    const result = engine.execute(playCard(P1, id(P1, HAND)));
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(player(engine, P1).battlefield.map((card) => card.definitionId), ["spellbinder"]);
  });
});

describe("mill", () => {
  it("moves the top cards of the opponent's library to their graveyard, stopping at an empty library (Mind Drain)", () => {
    const { engine, id } = createScenario({
      p1: { hand: ["mind_drain", "mind_drain"], resources: 4 },
      p2: { library: ["ember_imp", "lava_brute", "steel_sentinel", "scrap_golem", "pyre_drake"] },
    });
    const first = engine.execute(playCard(P1, id(P1, HAND, 0)));
    assert.equal(first.ok, true, JSON.stringify(first));
    const them = player(engine, P2);
    assert.equal(them.librarySize, 1);
    assert.deepEqual(
      them.graveyard.map((card) => card.definitionId),
      ["ember_imp", "lava_brute", "steel_sentinel", "scrap_golem"],
      "top of the library first, in order",
    );
    assert.equal(eventsOfType(first.value.events, GameEventType.CARD_MILLED).length, 4);
    assert.equal(player(engine, P1).librarySize, 10, "the caster's library is untouched");

    const second = engine.execute(playCard(P1, id(P1, HAND, 1)));
    assert.equal(second.ok, true);
    assert.equal(player(engine, P2).librarySize, 0);
    assert.equal(eventsOfType(second.value.events, GameEventType.CARD_MILLED).length, 1, "only one card was left");
    assert.equal(eventsOfType(second.value.events, GameEventType.FATIGUE_DAMAGE).length, 0, "milling never inflicts fatigue");
    assert.equal(player(engine, P2).life, 20);
  });
});

describe("destroy", () => {
  it("kills a creature of any size through the death pipeline, firing its on_death (Disintegrate on Pyre Drake)", () => {
    const { engine, id } = createScenario({ p1: { hand: ["disintegrate"], resources: 5 }, p2: { battlefield: ["pyre_drake"] } });
    const result = engine.execute(playCard(P1, id(P1, HAND), [id(P2, BF)]));
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(player(engine, P2).battlefield.length, 0);
    assert.equal(player(engine, P2).graveyard.length, 1);
    assert.equal(player(engine, P1).life, 18, "Pyre Drake's on_death still fires");
    const types = result.value.events.map((event) => event.type);
    assert.ok(types.indexOf(GameEventType.CREATURE_DESTROYED) < types.indexOf(GameEventType.CREATURE_DIED));
  });

  it("is a spell with no legal target when the opponent has no creatures", () => {
    const { engine, id } = createScenario({ p1: { hand: ["disintegrate"], battlefield: ["ember_imp"], resources: 5 } });
    assert.deepEqual(engine.getLegalMoves(P1).playableCardIds, [], "own creatures are not legal targets");
    assert.equal(engine.execute(playCard(P1, id(P1, HAND), [id(P1, BF)])).ok, false);
  });
});

describe("on_turn_start", () => {
  it("fires for the active player's creatures at the start of each of their turns (Mind Sifter)", () => {
    const { engine, id } = createScenario({
      p1: { hand: ["mind_sifter"], resources: 3 },
      p2: { library: ["ember_imp", "ember_imp", "ember_imp", "ember_imp"] },
    });
    assert.equal(engine.execute(playCard(P1, id(P1, HAND))).ok, true);
    assert.equal(player(engine, P2).librarySize, 4, "entering the battlefield does nothing");
    engine.execute(endTurn(P1));
    assert.equal(player(engine, P2).librarySize, 3, "the opponent drew for their own turn");
    const result = engine.execute(endTurn(P2));
    assert.equal(result.ok, true);
    assert.equal(player(engine, P2).librarySize, 2, "P1's turn started: the sifter milled one");
    const milled = eventsOfType(result.value.events, GameEventType.CARD_MILLED);
    assert.equal(milled.length, 1);
    assert.equal(milled[0].playerId, P2);
    const trigger = eventsOfType(result.value.events, GameEventType.ABILITY_TRIGGERED).find((event) => event.trigger === "on_turn_start");
    assert.equal(trigger.sourceId, player(engine, P1).battlefield[0].instanceId);
    assert.equal(view(engine).activePlayerId, P1);
  });

  it("does not fire for a creature that left the battlefield", () => {
    const { engine, id } = createScenario({
      p1: { hand: ["mind_sifter"], resources: 3 },
      p2: { hand: ["unsummon"], resources: 2, library: ["ember_imp", "ember_imp", "ember_imp"] },
    });
    engine.execute(playCard(P1, id(P1, HAND)));
    engine.execute(endTurn(P1));
    assert.equal(engine.execute(playCard(P2, id(P2, HAND), [player(engine, P1).battlefield[0].instanceId])).ok, true);
    engine.execute(endTurn(P2));
    assert.equal(player(engine, P2).librarySize, 2, "only the draw; the sifter is back in hand");
  });
});

describe("drain", () => {
  it("drains no more than the target creature's remaining health (Soul Drain on Ember Imp)", () => {
    const { engine, id } = createScenario({ p1: { hand: ["soul_drain"], resources: 3, life: 10 }, p2: { battlefield: ["ember_imp"] } });
    const result = engine.execute(playCard(P1, id(P1, HAND), [id(P2, BF)]));
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(player(engine, P2).battlefield.length, 0);
    assert.equal(player(engine, P1).life, 11, "a 1-health creature yields 1 life, not 3");
  });
});
