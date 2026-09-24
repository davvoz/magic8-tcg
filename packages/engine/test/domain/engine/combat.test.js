import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CommandError } from "../../../src/domain/commands/CommandError.js";
import { declareAttackers, declareBlockers, endPhase, endTurn, playCard } from "../../../src/domain/commands/commandFactories.js";
import { GameEventType } from "../../../src/domain/game/GameEventType.js";
import { GamePhase } from "../../../src/domain/game/GamePhase.js";
import { ZoneType } from "../../../src/domain/game/ZoneType.js";
import { P1, P2, eventsOfType, player, rulesWith, view } from "./fixtures.js";
import { createScenario } from "./scenario.js";

const BF = ZoneType.BATTLEFIELD;
const HAND = ZoneType.HAND;

const creatureOn = (engine, playerId, instanceId) => player(engine, playerId).battlefield.find((card) => card.instanceId === instanceId);

/** Moves P1 from MAIN_1 into COMBAT_ATTACKERS. */
function toCombat(engine) {
  assert.equal(engine.execute(endPhase(P1)).ok, true);
  assert.equal(view(engine).phase, GamePhase.COMBAT_ATTACKERS);
}

describe("declaring attackers", () => {
  it("lists ready creatures as legal attackers and excludes summoning-sick ones", () => {
    const { engine, id } = createScenario({ p1: { battlefield: ["ember_imp"], hand: ["cinder_hound"], resources: 2 } });
    assert.equal(engine.execute(playCard(P1, id(P1, HAND))).ok, true);
    toCombat(engine);
    const moves = engine.getLegalMoves(P1);
    assert.deepEqual(moves.attackerIds, [id(P1, BF)]);
    assert.deepEqual(moves.playableCardIds, []);
    assert.equal(engine.execute(declareAttackers(P1, [id(P1, HAND)])).error.code, CommandError.INVALID_TARGET, "summoning sick");
  });

  it("rejects duplicates, opponent creatures and cards in hand; empty declaration skips combat", () => {
    const { engine, id } = createScenario({ p1: { battlefield: ["ember_imp"], hand: ["ember_imp"] }, p2: { battlefield: ["ember_imp"] } });
    toCombat(engine);
    const imp = id(P1, BF);
    assert.equal(engine.execute(declareAttackers(P1, [imp, imp])).error.code, CommandError.INVALID_TARGET);
    assert.equal(engine.execute(declareAttackers(P1, [id(P2, BF)])).error.code, CommandError.INVALID_TARGET);
    assert.equal(engine.execute(declareAttackers(P1, [id(P1, HAND)])).error.code, CommandError.INVALID_TARGET);
    assert.equal(engine.execute(declareAttackers(P1, [])).ok, true);
    assert.equal(view(engine).phase, GamePhase.MAIN_2);
    assert.equal(player(engine, P2).life, 20);
  });

  it("is refused outside COMBAT_ATTACKERS", () => {
    const { engine, id } = createScenario({ p1: { battlefield: ["ember_imp"] } });
    assert.equal(engine.execute(declareAttackers(P1, [id(P1, BF)])).error.code, CommandError.NOT_ALLOWED_IN_PHASE);
  });
});

describe("blocking and damage", () => {
  it("unblocked attackers hit the defending player; the defender must declare (possibly no) blockers", () => {
    const { engine, id } = createScenario({ p1: { battlefield: ["lava_brute", "ember_imp"] }, p2: { battlefield: ["scrap_golem"] } });
    toCombat(engine);
    const result = engine.execute(declareAttackers(P1, [id(P1, BF, 0), id(P1, BF, 1)]));
    assert.equal(result.ok, true);
    assert.equal(view(engine).phase, GamePhase.COMBAT_BLOCKERS);
    assert.equal(view(engine).awaitingPlayerId, P2);
    assert.deepEqual(view(engine).combat.attackerIds, [id(P1, BF, 0), id(P1, BF, 1)]);
    assert.deepEqual(engine.getLegalMoves(P2).blockerIds, [id(P2, BF)]);
    assert.equal(engine.execute(endPhase(P2)).error.code, CommandError.NOT_ALLOWED_IN_PHASE, "defender must answer with blocks");
    assert.equal(engine.execute(endTurn(P1)).error.code, CommandError.NOT_YOUR_TURN);

    const damage = engine.execute(declareBlockers(P2, []));
    assert.equal(damage.ok, true);
    assert.equal(player(engine, P2).life, 14);
    assert.equal(view(engine).phase, GamePhase.MAIN_2);
    assert.deepEqual(view(engine).combat.attackerIds, [], "combat cleared after damage");
    const hits = eventsOfType(damage.value.events, GameEventType.DAMAGE_DEALT);
    assert.deepEqual(hits.map((hit) => hit.amount), [4, 2]);
    assert.ok(creatureOn(engine, P1, id(P1, BF, 0)).exhausted);
  });

  it("a blocked attacker and its blocker damage each other; deaths resolve through state-based actions", () => {
    // Lava Brute 4/3 blocked by Steel Sentinel 1/4: sentinel dies, brute survives with 1 damage.
    const { engine, id } = createScenario({ p1: { battlefield: ["lava_brute"] }, p2: { battlefield: ["steel_sentinel"] } });
    toCombat(engine);
    engine.execute(declareAttackers(P1, [id(P1, BF)]));
    const result = engine.execute(declareBlockers(P2, [{ attackerId: id(P1, BF), blockerId: id(P2, BF) }]));
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(player(engine, P2).life, 20);
    assert.equal(player(engine, P2).battlefield.length, 0);
    assert.equal(player(engine, P2).graveyard.length, 1);
    assert.equal(creatureOn(engine, P1, id(P1, BF)).health, 2);
    assert.equal(eventsOfType(result.value.events, GameEventType.CREATURE_DIED).length, 1);
  });

  it("a trade kills both and fires on_death triggers (Pyre Drake vs Iron Colossus)", () => {
    // Iron Colossus 5/7 attacks; Pyre Drake 5/4 blocks: drake dies (5 ≥ 4), colossus takes 5 (survives with 2), drake's death hits P1 for 2.
    const { engine, id } = createScenario({ p1: { battlefield: ["iron_colossus"] }, p2: { battlefield: ["pyre_drake"] } });
    toCombat(engine);
    engine.execute(declareAttackers(P1, [id(P1, BF)]));
    const result = engine.execute(declareBlockers(P2, [{ attackerId: id(P1, BF), blockerId: id(P2, BF) }]));
    assert.equal(result.ok, true);
    assert.equal(player(engine, P2).graveyard.length, 1);
    assert.equal(creatureOn(engine, P1, id(P1, BF)).health, 2);
    assert.equal(player(engine, P1).life, 18, "drake's on_death hit its enemy");
    assert.equal(player(engine, P2).life, 20);
  });

  it("lethal combat damage ends the game", () => {
    const { engine, id } = createScenario({ p1: { battlefield: ["blazing_titan"] }, p2: { life: 6 } });
    toCombat(engine);
    engine.execute(declareAttackers(P1, [id(P1, BF)]));
    assert.equal(view(engine).phase, GamePhase.COMBAT_BLOCKERS);
    const result = engine.execute(declareBlockers(P2, []));
    assert.equal(result.ok, true);
    assert.equal(view(engine).isOver, true);
    assert.equal(view(engine).winnerId, P1);
  });

  it("rejects illegal blocks: exhausted blocker, non-attacker, double-blocking, too many blockers", () => {
    const { engine, id } = createScenario({
      p1: { battlefield: ["ember_imp", "cinder_hound"] },
      p2: { battlefield: ["scrap_golem", "steel_sentinel"] },
    });
    // Make P2's golem exhausted by having it attack on P2's turn first.
    engine.execute(endTurn(P1));
    engine.execute(endPhase(P2));
    assert.equal(engine.execute(declareAttackers(P2, [id(P2, BF, 0)])).ok, true);
    assert.equal(engine.execute(declareBlockers(P1, [])).ok, true);
    engine.execute(endTurn(P2));
    // Now P1's turn: golem is still exhausted, sentinel is ready.
    toCombat(engine);
    const imp = id(P1, BF, 0);
    const hound = id(P1, BF, 1);
    engine.execute(declareAttackers(P1, [imp]));
    assert.deepEqual(engine.getLegalMoves(P2).blockerIds, [id(P2, BF, 1)]);
    const golem = id(P2, BF, 0);
    const sentinel = id(P2, BF, 1);
    assert.equal(engine.execute(declareBlockers(P2, [{ attackerId: imp, blockerId: golem }])).error.code, CommandError.INVALID_TARGET, "exhausted");
    assert.equal(engine.execute(declareBlockers(P2, [{ attackerId: hound, blockerId: sentinel }])).error.code, CommandError.INVALID_TARGET, "not attacking");
    assert.equal(
      engine.execute(declareBlockers(P2, [{ attackerId: imp, blockerId: sentinel }, { attackerId: imp, blockerId: sentinel }])).error.code,
      CommandError.INVALID_TARGET,
      "same blocker twice",
    );
    assert.equal(engine.execute(declareBlockers(P2, [{ attackerId: imp, blockerId: sentinel }])).ok, true);
    assert.equal(creatureOn(engine, P2, sentinel).health, 2);
  });

  it("attackers stay exhausted through the opponent's turn and cannot block", () => {
    const { engine, id } = createScenario({ p1: { battlefield: ["ember_imp"] }, p2: { battlefield: ["cinder_hound"] } });
    toCombat(engine);
    engine.execute(declareAttackers(P1, [id(P1, BF)]));
    engine.execute(declareBlockers(P2, []));
    engine.execute(endTurn(P1));
    engine.execute(endPhase(P2));
    engine.execute(declareAttackers(P2, [id(P2, BF)]));
    assert.deepEqual(engine.getLegalMoves(P1).blockerIds, [], "the imp attacked last turn");
    engine.execute(declareBlockers(P1, []));
    assert.equal(player(engine, P1).life, 17);
    engine.execute(endTurn(P2));
    toCombat(engine);
    assert.deepEqual(engine.getLegalMoves(P1).attackerIds, [id(P1, BF)], "readied at its own turn start");
  });
});

describe("rule variants", () => {
  it("multiple blockers: damage is assigned lethally in order, the remainder to the last", () => {
    const rules = rulesWith({ combat: { blockersEnabled: true, summoningSickness: true, maxBlockersPerAttacker: 2 } });
    // Blazing Titan 6/5 blocked by Ember Imp 2/1 and Scrap Golem 1/2: imp takes 1, golem takes 5 (dies); titan takes 3.
    const { engine, id } = createScenario({ rules, p1: { battlefield: ["blazing_titan"] }, p2: { battlefield: ["ember_imp", "scrap_golem"] } });
    toCombat(engine);
    const titan = id(P1, BF);
    engine.execute(declareAttackers(P1, [titan]));
    const result = engine.execute(
      declareBlockers(P2, [
        { attackerId: titan, blockerId: id(P2, BF, 0) },
        { attackerId: titan, blockerId: id(P2, BF, 1) },
      ]),
    );
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(player(engine, P2).battlefield.length, 0);
    assert.equal(creatureOn(engine, P1, titan).health, 2);
    const dealtByTitan = eventsOfType(result.value.events, GameEventType.DAMAGE_DEALT).filter((hit) => hit.sourceId === titan);
    assert.deepEqual(dealtByTitan.map((hit) => hit.amount), [1, 5]);
  });

  it("with blockers disabled, combat resolves straight after declaring attackers", () => {
    const rules = rulesWith({ combat: { blockersEnabled: false, summoningSickness: true, maxBlockersPerAttacker: 1 } });
    const { engine, id } = createScenario({ rules, p1: { battlefield: ["ember_imp"] }, p2: { battlefield: ["steel_sentinel"] } });
    toCombat(engine);
    const result = engine.execute(declareAttackers(P1, [id(P1, BF)]));
    assert.equal(result.ok, true);
    assert.equal(view(engine).phase, GamePhase.MAIN_2);
    assert.equal(player(engine, P2).life, 18);
  });

  it("with summoning sickness disabled, creatures attack the turn they are played", () => {
    const rules = rulesWith({ combat: { blockersEnabled: true, summoningSickness: false, maxBlockersPerAttacker: 1 } });
    const { engine, id } = createScenario({ rules, p1: { hand: ["ember_imp"], resources: 1 } });
    engine.execute(playCard(P1, id(P1, HAND)));
    toCombat(engine);
    assert.deepEqual(engine.getLegalMoves(P1).attackerIds, [id(P1, HAND)]);
  });
});
