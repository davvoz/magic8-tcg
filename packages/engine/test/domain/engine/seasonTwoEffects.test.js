/**
 * The primitives added for season 2: damage_faction (the bane rites),
 * reanimate (Wake the Dead) and the static trigger with its continuous
 * faction_aura (Wildheart Druid).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { endTurn, playCard } from "../../../src/domain/commands/commandFactories.js";
import { GameEventType } from "../../../src/domain/game/GameEventType.js";
import { ZoneType } from "../../../src/domain/game/ZoneType.js";
import { P1, P2, eventsOfType, player } from "./fixtures.js";
import { createScenario } from "./scenario.js";

const HAND = ZoneType.HAND;
const BF = ZoneType.BATTLEFIELD;

/** @param {ReturnType<typeof player>} seat */
const board = (seat) => seat.battlefield.map((card) => `${card.definitionId} ${card.attack}/${card.health}`);

describe("damage_faction", () => {
  it("sacrifices a friendly creature, then hits every Iron creature on both sides and nothing else (Rustbane Rite)", () => {
    const { engine, id } = createScenario({
      p1: { hand: ["rustbane_rite"], battlefield: ["grave_rat", "scrap_golem"], resources: 2 },
      p2: { battlefield: ["clockwork_knight", "steel_sentinel", "thornback_bear"] },
    });
    const result = engine.execute(playCard(P1, id(P1, HAND), [id(P1, BF, 0)]));
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(board(player(engine, P1)), [], "the rat was the price, the golem an Iron creature");
    assert.deepEqual(board(player(engine, P2)), ["clockwork_knight 4/2", "steel_sentinel 1/2", "thornback_bear 3/4"]);
    const hit = eventsOfType(result.value.events, GameEventType.DAMAGE_DEALT).map((event) => event.targetId);
    assert.deepEqual(hit, [id(P1, BF, 1), id(P2, BF, 0), id(P2, BF, 1)]);
  });

  it("a counter sweep needs no price and spares its own faction (Dawnlight against Shadow)", () => {
    const { engine, id } = createScenario({
      p1: { hand: ["dawnlight"], battlefield: ["rune_warden"], resources: 4 },
      p2: { battlefield: ["grave_rat", "bone_colossus", "tomb_knight", "scrap_golem"] },
    });
    const result = engine.execute(playCard(P1, id(P1, HAND)));
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(board(player(engine, P1)), ["rune_warden 3/4"]);
    assert.deepEqual(board(player(engine, P2)), ["bone_colossus 5/3", "tomb_knight 4/3", "scrap_golem 1/2"]);
  });

  it("cannot be cast without a friendly creature to sacrifice", () => {
    const { engine, id } = createScenario({ p1: { hand: ["rustbane_rite"], resources: 2 }, p2: { battlefield: ["scrap_golem"] } });
    assert.deepEqual(engine.getLegalMoves(P1).playableCardIds, []);
    assert.equal(engine.execute(playCard(P1, id(P1, HAND))).ok, false);
  });
});

describe("reanimate", () => {
  it("returns the top two creatures of the graveyard, skipping spells, sick and without their play abilities (Wake the Dead)", () => {
    const { engine, id } = createScenario({
      p1: { hand: ["wake_the_dead"], graveyard: ["grave_rat", "magma_hurler", "ember_bolt", "crypt_stalker"], resources: 3 },
      p2: { battlefield: ["scrap_golem"] },
    });
    const result = engine.execute(playCard(P1, id(P1, HAND)));
    assert.equal(result.ok, true, JSON.stringify(result));
    const me = player(engine, P1);
    assert.deepEqual(board(me), ["crypt_stalker 3/2", "magma_hurler 3/3"], "the top creature first; Ember Bolt in between is skipped");
    assert.deepEqual(me.battlefield.map((card) => card.summoningSick), [false, true], "Crypt Stalker has haste, Magma Hurler waits");
    assert.deepEqual(
      me.graveyard.map((card) => card.definitionId),
      ["grave_rat", "ember_bolt", "wake_the_dead"],
    );
    assert.deepEqual(board(player(engine, P2)), ["scrap_golem 1/2"], "Magma Hurler's entry damage does not fire");
    const reanimated = eventsOfType(result.value.events, GameEventType.CREATURE_REANIMATED);
    assert.deepEqual(reanimated.map((event) => event.instanceId), [id(P1, ZoneType.GRAVEYARD, 3), id(P1, ZoneType.GRAVEYARD, 1)]);
    assert.ok(reanimated.every((event) => event.playerId === P1));
  });

  it("stops when the battlefield is full, and does nothing with no creature in the graveyard", () => {
    const full = createScenario({
      p1: { hand: ["wake_the_dead"], battlefield: Array(6).fill("scrap_golem"), graveyard: ["grave_rat", "crypt_stalker"], resources: 3 },
    });
    assert.equal(full.engine.execute(playCard(P1, full.id(P1, HAND))).ok, true);
    assert.equal(player(full.engine, P1).battlefield.length, 7);
    assert.deepEqual(player(full.engine, P1).graveyard.map((card) => card.definitionId), ["grave_rat", "wake_the_dead"]);

    const empty = createScenario({ p1: { hand: ["wake_the_dead"], graveyard: ["ember_bolt"], resources: 3 } });
    const result = empty.engine.execute(playCard(P1, empty.id(P1, HAND)));
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(player(empty.engine, P1).battlefield.length, 0);
  });

  it("the creatures it brings back can be sacrificed and reanimated again", () => {
    const { engine, id } = createScenario({ p1: { hand: ["dark_bargain", "wake_the_dead"], battlefield: ["crypt_stalker"], resources: 6 } });
    assert.equal(engine.execute(playCard(P1, id(P1, HAND, 0), [id(P1, BF)])).ok, true);
    assert.equal(engine.execute(playCard(P1, id(P1, HAND, 1))).ok, true);
    assert.deepEqual(board(player(engine, P1)), ["crypt_stalker 3/2"]);
  });
});

describe("faction_aura (static)", () => {
  it("gives its controller's Verdant creatures, itself included, +1/+1 from the moment it enters (Wildheart Druid)", () => {
    const { engine, id } = createScenario({
      p1: { hand: ["wildheart_druid"], battlefield: ["moss_beetle", "scrap_golem"], resources: 4 },
      p2: { battlefield: ["thornback_bear"] },
    });
    const result = engine.execute(playCard(P1, id(P1, HAND)));
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(board(player(engine, P1)), ["moss_beetle 2/3", "scrap_golem 1/2", "wildheart_druid 3/3"]);
    assert.deepEqual(board(player(engine, P2)), ["thornback_bear 3/4"], "the opponent's Verdant creatures are not its own");
    const lifted = eventsOfType(result.value.events, GameEventType.STATS_MODIFIED);
    assert.deepEqual(lifted.map((event) => [event.targetId, event.attack, event.health, event.attackNow, event.healthNow]), [
      [id(P1, BF, 0), 1, 1, 2, 3],
      [id(P1, HAND), 1, 1, 3, 3],
    ]);
  });

  it("stacks with a second copy, follows creatures that enter later, and ends when it leaves", () => {
    const { engine, id } = createScenario({
      p1: { hand: ["moss_beetle"], battlefield: ["wildheart_druid", "wildheart_druid"], resources: 1 },
      p2: { hand: ["searing_lash"], resources: 2 },
    });
    assert.deepEqual(board(player(engine, P1)), ["wildheart_druid 4/4", "wildheart_druid 4/4"]);
    assert.equal(engine.execute(playCard(P1, id(P1, HAND))).ok, true);
    assert.deepEqual(board(player(engine, P1)), ["wildheart_druid 4/4", "wildheart_druid 4/4", "moss_beetle 3/4"]);
    engine.execute(endTurn(P1));
    assert.equal(engine.execute(playCard(P2, id(P2, HAND), [id(P1, BF, 0)])).ok, true, "4 damage kills a 4/4 druid");
    assert.deepEqual(board(player(engine, P1)), ["wildheart_druid 3/3", "moss_beetle 2/3"]);
  });

  it("a lord may lift one stat only, and lifts its own faction only (Foundry Overseer, Pyre Chanter)", () => {
    const { engine } = createScenario({
      p1: { battlefield: ["foundry_overseer", "bulwark_engine", "pyre_chanter", "ember_imp", "moss_beetle"] },
    });
    assert.deepEqual(board(player(engine, P1)), ["foundry_overseer 3/6", "bulwark_engine 0/9", "pyre_chanter 3/2", "ember_imp 3/1", "moss_beetle 1/2"]);
  });

  it("a creature that only lived on the bonus health dies when the bonus goes", () => {
    const { engine, id } = createScenario({
      p1: { battlefield: ["wildheart_druid", "moss_beetle"] },
      p2: { hand: ["quick_strike", "searing_lash"], resources: 3 },
    });
    engine.execute(endTurn(P1));
    assert.equal(engine.execute(playCard(P2, id(P2, HAND, 0), [id(P1, BF, 1)])).ok, true, "2 damage on a 2/3 beetle");
    assert.equal(player(engine, P1).battlefield[1].health, 1);
    const result = engine.execute(playCard(P2, id(P2, HAND, 1), [id(P1, BF, 0)]));
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(board(player(engine, P1)), []);
    assert.deepEqual(
      eventsOfType(result.value.events, GameEventType.CREATURE_DIED).map((event) => event.instanceId),
      [id(P1, BF, 0), id(P1, BF, 1)],
    );
  });

  it("shows the bonus on the card's view, apart from its modifiers (the inspect view's Auras line)", () => {
    const { engine } = createScenario({ p1: { battlefield: ["wildheart_druid", "moss_beetle", "scrap_golem"] } });
    const views = engine.getSnapshot(null).players[0].battlefield;
    assert.deepEqual(views.map((view) => [view.definitionId, view.staticBonus, view.modifiers, view.attack, view.health]), [
      ["wildheart_druid", { attack: 1, health: 1 }, [], 3, 3],
      ["moss_beetle", { attack: 1, health: 1 }, [], 2, 3],
      ["scrap_golem", { attack: 0, health: 0 }, [], 1, 2],
    ]);
  });

  it("leaves the state digest as before: the bonus is derived from the board", () => {
    const { engine } = createScenario({ p1: { battlefield: ["wildheart_druid"] } });
    const card = engine.getStateDigest().players[0].zones.battlefield[0];
    assert.deepEqual(Object.keys(card).sort(), ["controller", "damage", "def", "exhausted", "id", "modifiers", "owner", "sick"]);
    assert.deepEqual(card.modifiers, []);
  });
});
