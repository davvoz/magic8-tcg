import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CommandError } from "../../../src/domain/commands/CommandError.js";
import { endTurn, playCard } from "../../../src/domain/commands/commandFactories.js";
import { GameEventType } from "../../../src/domain/game/GameEventType.js";
import { ZoneType } from "../../../src/domain/game/ZoneType.js";
import { P1, P2, eventsOfType, player, rulesWith, view } from "./fixtures.js";
import { createScenario } from "./scenario.js";

const HAND = ZoneType.HAND;
const BF = ZoneType.BATTLEFIELD;

const creatureOn = (engine, playerId, instanceId) => player(engine, playerId).battlefield.find((card) => card.instanceId === instanceId);

describe("PLAY_CARD — creatures", () => {
  it("pays the cost, moves the card to the battlefield and applies summoning sickness", () => {
    const { engine, id } = createScenario({ p1: { hand: ["lava_brute"], resources: 5 } });
    const cardId = id(P1, HAND);
    const result = engine.execute(playCard(P1, cardId));
    assert.equal(result.ok, true, JSON.stringify(result));
    const me = player(engine, P1);
    assert.deepEqual(me.resources, { current: 1, max: 5 });
    assert.equal(me.handSize, 0);
    const brute = creatureOn(engine, P1, cardId);
    assert.equal(brute.summoningSick, true);
    assert.equal(brute.attack, 4);
    const played = eventsOfType(result.value.events, GameEventType.CARD_PLAYED)[0];
    assert.equal(played.zone, BF);
    assert.equal(eventsOfType(result.value.events, GameEventType.RESOURCES_CHANGED).length, 1);
  });

  it("haste creatures enter ready", () => {
    const { engine, id } = createScenario({ p1: { hand: ["flame_scout"], resources: 2 } });
    engine.execute(playCard(P1, id(P1, HAND)));
    assert.equal(creatureOn(engine, P1, id(P1, HAND)).summoningSick, false);
  });

  it("rejects unaffordable cards, cards not in hand, and a full battlefield", () => {
    const { engine, id } = createScenario({
      p1: { hand: ["blazing_titan", "ember_imp"], battlefield: Array(7).fill("scrap_golem"), resources: 5 },
      p2: { hand: ["ember_imp"] },
    });
    assert.equal(engine.execute(playCard(P1, id(P1, HAND, 0))).error.code, CommandError.CANNOT_AFFORD);
    assert.equal(engine.execute(playCard(P1, id(P1, HAND, 1))).error.code, CommandError.ZONE_FULL);
    assert.equal(engine.execute(playCard(P1, id(P2, HAND, 0))).error.code, CommandError.CARD_NOT_FOUND, "opponent's card");
    assert.equal(engine.execute(playCard(P1, id(P1, BF, 0))).error.code, CommandError.CARD_NOT_FOUND, "already on the battlefield");
  });

  it("is only allowed in main phases by the active player", () => {
    const { engine, id } = createScenario({ p1: { hand: ["ember_imp"] }, p2: { hand: ["ember_imp"] } });
    assert.equal(engine.execute(playCard(P2, id(P2, HAND))).error.code, CommandError.NOT_YOUR_TURN);
    engine.execute(endTurn(P1));
    assert.equal(engine.execute(playCard(P2, id(P2, HAND))).ok, true);
  });
});

describe("PLAY_CARD — on_play / on_cast effects", () => {
  it("draw_card draws for the controller (Iron Watcher)", () => {
    const { engine, id } = createScenario({ p1: { hand: ["iron_watcher"], resources: 3 } });
    const result = engine.execute(playCard(P1, id(P1, HAND)));
    assert.equal(result.ok, true);
    assert.equal(player(engine, P1).handSize, 1);
    assert.equal(player(engine, P1).librarySize, 9);
    const types = result.value.events.map((event) => event.type);
    assert.ok(types.indexOf(GameEventType.ABILITY_TRIGGERED) < types.indexOf(GameEventType.CARD_DRAWN));
  });

  it("deal_damage to a chosen enemy creature (Magma Hurler) and kills it via state-based actions", () => {
    const { engine, id } = createScenario({ p1: { hand: ["magma_hurler"], resources: 4 }, p2: { battlefield: ["gear_smith"] } });
    const target = id(P2, BF);
    const result = engine.execute(playCard(P1, id(P1, HAND), [target]));
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(player(engine, P2).battlefield.length, 0);
    assert.equal(player(engine, P2).graveyard.length, 1);
    assert.equal(eventsOfType(result.value.events, GameEventType.CREATURE_DIED).length, 1);
    assert.equal(player(engine, P2).handSize, 1, "Gear Smith's on_death draws its controller a card");
  });

  it("deal_damage to a player (Ember Bolt to face) and win by damage", () => {
    const { engine, id } = createScenario({ p1: { hand: ["ember_bolt"], resources: 2 }, p2: { life: 3 } });
    const result = engine.execute(playCard(P1, id(P1, HAND), [P2]));
    assert.equal(result.ok, true);
    const snapshot = view(engine);
    assert.equal(snapshot.isOver, true);
    assert.equal(snapshot.winnerId, P1);
    assert.equal(player(engine, P1).graveyard.length, 1, "spell goes to the graveyard");
  });

  it("modify_stats until end of turn expires at turn end (Fire Surge)", () => {
    const { engine, id } = createScenario({ p1: { hand: ["fire_surge"], battlefield: ["ember_imp"], resources: 1 } });
    const imp = id(P1, BF);
    const result = engine.execute(playCard(P1, id(P1, HAND), [imp]));
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(creatureOn(engine, P1, imp).attack, 4);
    assert.equal(eventsOfType(result.value.events, GameEventType.STATS_MODIFIED)[0].attackNow, 4);
    engine.execute(endTurn(P1));
    assert.equal(creatureOn(engine, P1, imp).attack, 2);
  });

  it("permanent modify_stats persists (Reinforce) and heal restores damage", () => {
    const { engine, id } = createScenario({
      p1: { hand: ["reinforce", "quick_strike", "mending_herbs"], battlefield: ["steel_sentinel"], resources: 4 },
    });
    const sentinel = id(P1, BF);
    assert.equal(engine.execute(playCard(P1, id(P1, HAND, 0), [sentinel])).ok, true);
    assert.deepEqual([creatureOn(engine, P1, sentinel).attack, creatureOn(engine, P1, sentinel).health], [3, 6]);
    assert.equal(engine.execute(playCard(P1, id(P1, HAND, 1), [sentinel])).ok, true);
    assert.equal(creatureOn(engine, P1, sentinel).health, 4);
    assert.equal(engine.execute(playCard(P1, id(P1, HAND, 2), [sentinel])).ok, true);
    assert.equal(creatureOn(engine, P1, sentinel).health, 6);
    engine.execute(endTurn(P1));
    engine.execute(endTurn(P2));
    assert.equal(creatureOn(engine, P1, sentinel).attack, 3, "permanent buff survives turns");
  });

  it("heal on a player never exceeds starting life", () => {
    const { engine, id } = createScenario({ p1: { hand: ["mending_herbs"], life: 19, resources: 1 } });
    const result = engine.execute(playCard(P1, id(P1, HAND), [P1]));
    assert.equal(result.ok, true);
    assert.equal(player(engine, P1).life, 20);
    assert.equal(eventsOfType(result.value.events, GameEventType.HEALED)[0].amount, 1);
  });
});

describe("PLAY_CARD — targeting rules", () => {
  it("rejects wrong count, wrong owner, self-targeting and duplicates", () => {
    const { engine, id } = createScenario({
      p1: { hand: ["forge_warden", "ember_bolt"], battlefield: ["scrap_golem"], resources: 10 },
      p2: { battlefield: ["ember_imp"] },
    });
    const warden = id(P1, HAND, 0);
    const bolt = id(P1, HAND, 1);
    assert.equal(engine.execute(playCard(P1, warden)).error.code, CommandError.INVALID_TARGET, "missing target");
    assert.equal(engine.execute(playCard(P1, warden, [id(P2, BF)])).error.code, CommandError.INVALID_TARGET, "enemy creature for an ally-only buff");
    assert.equal(engine.execute(playCard(P1, warden, [warden])).error.code, CommandError.INVALID_TARGET, "cannot target itself");
    assert.equal(engine.execute(playCard(P1, bolt, [P2, P2])).error.code, CommandError.INVALID_TARGET, "too many targets");
    assert.equal(engine.execute(playCard(P1, bolt, ["c999"])).error.code, CommandError.INVALID_TARGET, "unknown target");
    assert.equal(engine.execute(playCard(P1, warden, [id(P1, BF)])).ok, true);
  });

  it("a creature whose on_play has no legal target enters anyway, the ability fizzling", () => {
    const lone = createScenario({ p1: { hand: ["forge_warden"], resources: 5 } });
    assert.deepEqual(lone.engine.getLegalMoves(P1).playableCardIds, [lone.id(P1, HAND)], "a body with nobody to buff is still a body");
    const fizzled = lone.engine.execute(playCard(P1, lone.id(P1, HAND)));
    assert.equal(fizzled.ok, true, JSON.stringify(fizzled));
    assert.deepEqual(player(lone.engine, P1).battlefield.map((card) => card.definitionId), ["forge_warden"]);
    assert.equal(eventsOfType(fizzled.value.events, GameEventType.STATS_MODIFIED).length, 0, "nothing to buff");
    assert.equal(eventsOfType(fizzled.value.events, GameEventType.ABILITY_TRIGGERED).length, 0, "an ability with no target never fires");
    assert.equal(lone.engine.execute(playCard(P1, lone.id(P1, HAND), [lone.id(P1, HAND)])).ok, false, "and it takes no target ids");

    const { engine, id } = createScenario({ p1: { hand: ["forge_warden"], battlefield: ["scrap_golem"], resources: 5 } });
    const result = engine.execute(playCard(P1, id(P1, HAND), [id(P1, BF)]));
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(eventsOfType(result.value.events, GameEventType.STATS_MODIFIED).length, 1, "the ally it buffed");
  });

  it("a spell with no legal target cannot be cast and is not listed as playable", () => {
    const { engine, id } = createScenario({ p1: { hand: ["quick_strike"], resources: 5 } });
    assert.equal(engine.execute(playCard(P1, id(P1, HAND))).error.code, CommandError.INVALID_TARGET);
    assert.deepEqual(engine.getLegalMoves(P1).playableCardIds, []);
  });

  it("a tribute creature needs a creature to sacrifice (Bone Colossus)", () => {
    const lone = createScenario({ p1: { hand: ["bone_colossus"], resources: 5 } });
    assert.deepEqual(lone.engine.getLegalMoves(P1).playableCardIds, [], "it may not eat itself");

    const { engine, id } = createScenario({ p1: { hand: ["bone_colossus"], battlefield: ["grave_rat"], resources: 5 } });
    assert.equal(engine.execute(playCard(P1, id(P1, HAND), [id(P1, BF)])).ok, true);
    const me = player(engine, P1);
    assert.deepEqual(me.battlefield.map((card) => card.definitionId), ["bone_colossus"]);
    assert.equal(me.graveyard.some((card) => card.definitionId === "grave_rat"), true, "the tribute was paid");
  });

  it("Ash Raider pings a 1-health creature on entry and the creature dies", () => {
    const { engine, id } = createScenario({ p1: { hand: ["ash_raider"], resources: 3 }, p2: { battlefield: ["ember_imp"] } });
    const result = engine.execute(playCard(P1, id(P1, HAND), [id(P2, BF)]));
    assert.equal(result.ok, true);
    assert.equal(player(engine, P2).battlefield.length, 0);
    assert.equal(player(engine, P1).battlefield.length, 1);
  });
});

describe("on_death triggers", () => {
  it("damage on creatures persists across turns until healed", () => {
    const { engine, id } = createScenario({ p1: { hand: ["ember_bolt"], resources: 2 }, p2: { battlefield: ["pyre_drake"] } });
    assert.equal(engine.execute(playCard(P1, id(P1, HAND), [id(P2, BF)])).ok, true);
    assert.equal(player(engine, P2).battlefield[0].health, 1);
    engine.execute(endTurn(P1));
    engine.execute(endTurn(P2));
    assert.equal(player(engine, P2).battlefield[0].health, 1);
  });

  it("Pyre Drake dying automatically damages its controller's opponent", () => {
    const { engine, id } = createScenario({ p1: { hand: ["ember_bolt", "quick_strike"], resources: 3 }, p2: { battlefield: ["pyre_drake"] } });
    const drake = id(P2, BF);
    assert.equal(engine.execute(playCard(P1, id(P1, HAND, 0), [drake])).ok, true);
    const result = engine.execute(playCard(P1, id(P1, HAND, 1), [drake]));
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(player(engine, P2).graveyard.length, 1);
    assert.equal(player(engine, P1).life, 18, "on_death dealt 2 to P1");
    const types = result.value.events.map((event) => event.type);
    assert.ok(types.indexOf(GameEventType.CREATURE_DIED) < types.lastIndexOf(GameEventType.ABILITY_TRIGGERED));
    assert.ok(types.lastIndexOf(GameEventType.ABILITY_TRIGGERED) < types.lastIndexOf(GameEventType.DAMAGE_DEALT));
  });

  it("an on_death trigger that kills the player ends the game inside the same command", () => {
    const { engine, id } = createScenario({ p1: { hand: ["ember_bolt", "quick_strike"], life: 2, resources: 3 }, p2: { battlefield: ["pyre_drake"] } });
    const drake = id(P2, BF);
    assert.equal(engine.execute(playCard(P1, id(P1, HAND, 0), [drake])).ok, true);
    const result = engine.execute(playCard(P1, id(P1, HAND, 1), [drake]));
    assert.equal(result.ok, true);
    assert.equal(view(engine).isOver, true);
    assert.equal(view(engine).winnerId, P2);
    assert.equal(eventsOfType(result.value.events, GameEventType.GAME_ENDED).length, 1);
  });
});

describe("legal moves", () => {
  it("lists playable cards with their target options and excludes unaffordable ones", () => {
    const { engine, id } = createScenario({
      p1: { hand: ["ember_bolt", "blazing_titan", "ember_imp"], battlefield: ["scrap_golem"], resources: 2 },
      p2: { battlefield: ["steel_sentinel"] },
    });
    const moves = engine.getLegalMoves(P1);
    assert.deepEqual(moves.playableCardIds, [id(P1, HAND, 0), id(P1, HAND, 2)]);
    const boltOptions = moves.targetOptions[id(P1, HAND, 0)];
    assert.equal(boltOptions.length, 1);
    assert.deepEqual([...boltOptions[0]].sort(), [id(P1, BF), id(P2, BF), P1, P2].sort());
    assert.deepEqual(moves.targetOptions[id(P1, HAND, 2)], []);
    assert.deepEqual(engine.getSnapshot(P1).legalMoves.playableCardIds, moves.playableCardIds);
    assert.deepEqual(engine.getLegalMoves(P2).playableCardIds, []);
  });
});

describe("resolution bounds", () => {
  it("aborts a command whose resolution exceeds maxEffectsPerResolution and rolls back", () => {
    const rules = rulesWith({ limits: { maxEffectsPerResolution: 1, maxEventsPerCommand: 500 } });
    const { engine, id } = createScenario({ rules, p1: { hand: ["ember_bolt", "quick_strike"], resources: 3 }, p2: { battlefield: ["pyre_drake"] } });
    const drake = id(P2, BF);
    assert.equal(engine.execute(playCard(P1, id(P1, HAND, 0), [drake])).ok, true, "one effect is within the limit");
    const before = view(engine);
    const result = engine.execute(playCard(P1, id(P1, HAND, 1), [drake]));
    assert.equal(result.ok, false, "strike + on_death = two effects");
    assert.equal(result.error.code, CommandError.ENGINE_ERROR);
    assert.deepEqual(view(engine), before);
  });
});
