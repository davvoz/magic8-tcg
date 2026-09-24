import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BasicAiController } from "../../src/application/match/BasicAiController.js";
import { CommandType } from "@magic8/engine/domain/commands/CommandType.js";
import { declareAttackers, endPhase, endTurn } from "@magic8/engine/domain/commands/commandFactories.js";
import { ZoneType } from "@magic8/engine/domain/game/ZoneType.js";
import { P1, P2 } from "@magic8/engine/testing/fixtures.js";
import { createScenario } from "@magic8/engine/testing/scenario.js";

const ai = new BasicAiController();
const HAND = ZoneType.HAND;
const BF = ZoneType.BATTLEFIELD;

describe("BasicAiController — main phase", () => {
  it("plays the most expensive playable card and targets the enemy creature it can kill", () => {
    const { engine, id } = createScenario({
      p1: { hand: ["ember_bolt", "lava_brute", "ember_imp"], resources: 5 },
      p2: { battlefield: ["steel_sentinel", "cinder_hound"] },
    });
    const first = ai.decide(engine.getSnapshot(P1));
    assert.equal(first.type, CommandType.PLAY_CARD);
    assert.equal(first.cardId, id(P1, HAND, 1), "Lava Brute (4) over Ember Bolt (2)");
    assert.equal(engine.execute(first).ok, true);
    const second = ai.decide(engine.getSnapshot(P1));
    assert.equal(second.type, CommandType.PLAY_CARD);
    assert.equal(second.cardId, id(P1, HAND, 2), "imp is what remains affordable");
  });

  it("aims damage at a killable creature, otherwise at the enemy player", () => {
    const killable = createScenario({ p1: { hand: ["ember_bolt"], resources: 2 }, p2: { battlefield: ["lava_brute"] } });
    const decision = ai.decide(killable.engine.getSnapshot(P1));
    assert.deepEqual(decision.targets, [killable.id(P2, BF)], "4/3 brute dies to 3 damage");

    const face = createScenario({ p1: { hand: ["ember_bolt"], resources: 2 }, p2: { battlefield: ["iron_colossus"] } });
    assert.deepEqual(ai.decide(face.engine.getSnapshot(P1)).targets, [P2], "colossus survives; go face");
  });

  it("goes for the kill when the damage is lethal, even with a creature to shoot", () => {
    const { engine, id } = createScenario({ p1: { hand: ["ember_bolt"], resources: 2 }, p2: { life: 1, battlefield: ["lava_brute"] } });
    const decision = ai.decide(engine.getSnapshot(P1));
    assert.deepEqual(decision.targets, [P2], "winning now beats killing the 4/3 brute");
    assert.notDeepEqual(decision.targets, [id(P2, BF)]);
    assert.equal(engine.execute(decision).ok, true);
    assert.equal(engine.getSnapshot(P1).isOver, true);
  });

  it("plays the cheap lethal burn ahead of the bigger card in hand", () => {
    const { engine, id } = createScenario({ p1: { hand: ["lava_brute", "ember_bolt"], resources: 5 }, p2: { life: 3 } });
    const decision = ai.decide(engine.getSnapshot(P1));
    assert.equal(decision.cardId, id(P1, HAND, 1), "Ember Bolt (2) over Lava Brute (4): it wins on the spot");
    assert.deepEqual(decision.targets, [P2]);
  });

  it("aims destroy and bounce at the strongest enemy creature", () => {
    const destroy = createScenario({ p1: { hand: ["disintegrate"], battlefield: ["iron_colossus"], resources: 5 }, p2: { battlefield: ["ember_imp", "blazing_titan", "steel_sentinel"] } });
    assert.deepEqual(ai.decide(destroy.engine.getSnapshot(P1)).targets, [destroy.id(P2, BF, 1)], "the titan, not its own colossus");

    const bounce = createScenario({ p1: { hand: ["spellbinder"], resources: 3 }, p2: { battlefield: ["scrap_golem", "lava_brute"] } });
    assert.deepEqual(ai.decide(bounce.engine.getSnapshot(P1)).targets, [bounce.id(P2, BF, 1)]);
  });

  it("buffs its own strongest creature and heals its most damaged one", () => {
    const buff = createScenario({ p1: { hand: ["reinforce"], battlefield: ["scrap_golem", "lava_brute"], resources: 2 }, p2: { battlefield: ["ember_imp"] } });
    assert.deepEqual(ai.decide(buff.engine.getSnapshot(P1)).targets, [buff.id(P1, BF, 1)]);

    const heal = createScenario({ p1: { hand: ["mending_herbs"], life: 10, resources: 1 } });
    assert.deepEqual(ai.decide(heal.engine.getSnapshot(P1)).targets, [P1], "no damaged creature: heal self");
  });

  it("keeps healing spells in hand when nothing of its own is hurt", () => {
    const { engine } = createScenario({ p1: { hand: ["mending_herbs", "repair_drones"], battlefield: ["scrap_golem"], resources: 3 }, p2: { battlefield: ["ember_imp"] } });
    assert.deepEqual(ai.decide(engine.getSnapshot(P1)), endPhase(P1), "full life, no wounded ally: healing is wasted");
  });

  it("ends the phase in MAIN_1 and the turn in MAIN_2 when nothing is playable", () => {
    const { engine } = createScenario({ p1: { hand: ["blazing_titan"], resources: 1 } });
    assert.deepEqual(ai.decide(engine.getSnapshot(P1)), endPhase(P1));
    engine.execute(endPhase(P1));
    engine.execute(declareAttackers(P1, []));
    assert.deepEqual(ai.decide(engine.getSnapshot(P1)), endTurn(P1));
  });

  it("returns null when it is not its decision to make", () => {
    const { engine } = createScenario();
    assert.equal(ai.decide(engine.getSnapshot(P2)), null);
    assert.equal(ai.decide(engine.getSnapshot(null)), null);
  });
});

describe("BasicAiController — combat", () => {
  it("attacks with creatures that cannot be blocked and killed for free", () => {
    const { engine, id } = createScenario({
      p1: { battlefield: ["ember_imp", "iron_colossus", "bulwark_engine"] },
      p2: { battlefield: ["steel_sentinel"] },
    });
    engine.execute(endPhase(P1));
    const decision = ai.decide(engine.getSnapshot(P1));
    assert.equal(decision.type, CommandType.DECLARE_ATTACKERS);
    assert.deepEqual(decision.attackerIds, [id(P1, BF, 1)], "imp would die to the sentinel; engine has 0 attack");
  });

  it("attacks with everything when unblocked damage is lethal", () => {
    const { engine, id } = createScenario({ p1: { battlefield: ["ember_imp", "cinder_hound"] }, p2: { life: 5, battlefield: ["steel_sentinel"] } });
    engine.execute(endPhase(P1));
    assert.deepEqual(ai.decide(engine.getSnapshot(P1)).attackerIds, [id(P1, BF, 0), id(P1, BF, 1)]);
  });

  it("blocks to kill and survive, trades when even, and chumps only against lethal damage", () => {
    const noChump = createScenario({ p1: { battlefield: ["lava_brute"] }, p2: { battlefield: ["scrap_golem"] } });
    noChump.engine.execute(endPhase(P1));
    noChump.engine.execute(declareAttackers(P1, [noChump.id(P1, BF)]));
    assert.deepEqual(ai.decide(noChump.engine.getSnapshot(P2)).blocks, [], "golem would die for nothing at 20 life");

    const { engine, id } = createScenario({
      p1: { battlefield: ["lava_brute", "ember_imp"] },
      p2: { battlefield: ["iron_colossus", "scrap_golem"] },
    });
    engine.execute(endPhase(P1));
    engine.execute(declareAttackers(P1, [id(P1, BF, 0), id(P1, BF, 1)]));
    const decision = ai.decide(engine.getSnapshot(P2));
    assert.equal(decision.type, CommandType.DECLARE_BLOCKERS);
    assert.deepEqual(
      decision.blocks,
      [
        { attackerId: id(P1, BF, 0), blockerId: id(P2, BF, 0) },
        { attackerId: id(P1, BF, 1), blockerId: id(P2, BF, 1) },
      ],
      "colossus kills the brute and survives; golem trades evenly with the imp",
    );
    assert.equal(engine.execute(decision).ok, true);

    const lethal = createScenario({ p1: { battlefield: ["blazing_titan"] }, p2: { life: 5, battlefield: ["scrap_golem"] } });
    lethal.engine.execute(endPhase(P1));
    lethal.engine.execute(declareAttackers(P1, [lethal.id(P1, BF)]));
    assert.deepEqual(ai.decide(lethal.engine.getSnapshot(P2)).blocks, [{ attackerId: lethal.id(P1, BF), blockerId: lethal.id(P2, BF) }], "chump to survive");
  });
});
