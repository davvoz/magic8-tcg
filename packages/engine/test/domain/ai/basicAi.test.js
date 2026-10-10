import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AI_STYLES, AiStyle, BasicAi } from "../../../src/domain/ai/BasicAi.js";
import { CommandType } from "../../../src/domain/commands/CommandType.js";
import { declareAttackers, endPhase, endTurn } from "../../../src/domain/commands/commandFactories.js";
import { ZoneType } from "../../../src/domain/game/ZoneType.js";
import { P1, P2 } from "../engine/fixtures.js";
import { createScenario } from "../engine/scenario.js";

const ai = new BasicAi();
const HAND = ZoneType.HAND;
const BF = ZoneType.BATTLEFIELD;

describe("BasicAi — main phase", () => {
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

  it("keeps harmful spells in hand when they could only hit its own creatures", () => {
    const selfOnly = createScenario({ p1: { hand: ["quick_strike"], battlefield: ["ember_imp", "cinder_hound"], resources: 1 } });
    assert.deepEqual(ai.decide(selfOnly.engine.getSnapshot(P1)), endPhase(P1), "no enemy creature: Quick Strike would kill its own");

    const withEnemy = createScenario({ p1: { hand: ["quick_strike"], battlefield: ["ember_imp"], resources: 1 }, p2: { battlefield: ["iron_colossus"] } });
    assert.deepEqual(ai.decide(withEnemy.engine.getSnapshot(P1)).targets, [withEnemy.id(P2, BF)], "an enemy it cannot kill still beats its own imp");
  });

  it("sacrifices only a creature worth at most half of what the card brings", () => {
    const even = createScenario({ p1: { hand: ["bone_colossus"], battlefield: ["bone_colossus"], resources: 5 } });
    assert.deepEqual(ai.decide(even.engine.getSnapshot(P1)), endPhase(P1), "a healthy colossus for another colossus is no gain");

    const fodder = createScenario({ p1: { hand: ["bone_colossus"], battlefield: ["iron_colossus", "bulwark_engine", "flame_scout"], resources: 5 } });
    const decision = ai.decide(fodder.engine.getSnapshot(P1));
    assert.equal(decision.cardId, fodder.id(P1, HAND));
    assert.deepEqual(decision.targets, [fodder.id(P1, BF, 2)], "the 2/2 scout, not the 0/7 wall");

    const keep = createScenario({ p1: { hand: ["dark_bargain"], battlefield: ["clockwork_knight"], resources: 1 } });
    assert.deepEqual(ai.decide(keep.engine.getSnapshot(P1)), endPhase(P1), "a 4/4 is worth more than two cards");

    const bargain = createScenario({ p1: { hand: ["dark_bargain"], battlefield: ["clockwork_knight", "kindling_sprite"], resources: 1 } });
    assert.deepEqual(ai.decide(bargain.engine.getSnapshot(P1)).targets, [bargain.id(P1, BF, 1)]);
  });

  it("plays a haste creature first when its attack makes the unblocked damage lethal", () => {
    const { engine, id } = createScenario({ p1: { hand: ["lava_brute", "flame_scout"], battlefield: ["ember_imp"], resources: 6 }, p2: { life: 4 } });
    assert.equal(ai.decide(engine.getSnapshot(P1)).cardId, id(P1, HAND, 1), "the 2/2 haste scout and the imp hit for 4 this turn");
  });

  it("prefers a haste creature on equal cost before combat, not after", () => {
    const { engine, id } = createScenario({ p1: { hand: ["rivet_hound", "flame_scout"], resources: 2 } });
    assert.equal(ai.decide(engine.getSnapshot(P1)).cardId, id(P1, HAND, 1), "the scout can attack this turn");
    engine.execute(endPhase(P1));
    engine.execute(declareAttackers(P1, []));
    assert.equal(ai.decide(engine.getSnapshot(P1)).cardId, id(P1, HAND, 0), "after combat haste is worth nothing");
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

describe("BasicAi — combat", () => {
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

  it("chumps a trampler with the blocker that soaks enough of its damage", () => {
    const { engine, id } = createScenario({ p1: { battlefield: ["thunderhoof_mammoth"] }, p2: { life: 3, battlefield: ["scrap_golem", "steel_sentinel"] } });
    engine.execute(endPhase(P1));
    engine.execute(declareAttackers(P1, [id(P1, BF)]));
    const decision = ai.decide(engine.getSnapshot(P2));
    assert.deepEqual(decision.blocks, [{ attackerId: id(P1, BF), blockerId: id(P2, BF, 1) }], "the 1/2 golem lets 4 trample over; the 1/4 sentinel only 2");
    assert.equal(engine.execute(decision).ok, true);
  });

  it("keeps attackers without vigilance home when the enemy's next attack would otherwise be lethal", () => {
    const enemy = { battlefield: ["cinder_hound", "ember_imp", "ember_imp"] };
    const vigilant = createScenario({ p1: { life: 4, battlefield: ["lava_brute", "rune_warden"] }, p2: enemy });
    vigilant.engine.execute(endPhase(P1));
    assert.deepEqual(ai.decide(vigilant.engine.getSnapshot(P1)).attackerIds, [vigilant.id(P1, BF, 1)], "the warden still blocks after attacking; the brute guards");

    const plain = createScenario({ p1: { life: 4, battlefield: ["lava_brute", "thornback_bear"] }, p2: enemy });
    plain.engine.execute(endPhase(P1));
    assert.deepEqual(ai.decide(plain.engine.getSnapshot(P1)).attackerIds, [], "both are needed to block 7 damage");

    const doomed = createScenario({ p1: { life: 2, battlefield: ["lava_brute", "thornback_bear"] }, p2: enemy });
    doomed.engine.execute(endPhase(P1));
    assert.deepEqual(ai.decide(doomed.engine.getSnapshot(P1)).attackerIds, [doomed.id(P1, BF, 0), doomed.id(P1, BF, 1)], "guarding cannot save it: attack");
  });
});

describe("BasicAi — styles", () => {
  const aggressive = new BasicAi(AiStyle.AGGRESSIVE);
  const defensive = new BasicAi(AiStyle.DEFENSIVE);

  it("plays the balanced rules by default and refuses an unknown style", () => {
    assert.equal(ai.style, AiStyle.BALANCED);
    assert.deepEqual(AI_STYLES, ["aggressive", "balanced", "defensive"]);
    assert.throws(() => new BasicAi("reckless"), /unknown AI style "reckless"/);
  });

  it("aggressive: aims damage at the enemy player once they are at 8 life or less", () => {
    const { engine, id } = createScenario({ p1: { hand: ["ember_bolt"], resources: 2 }, p2: { life: 8, battlefield: ["lava_brute"] } });
    assert.deepEqual(ai.decide(engine.getSnapshot(P1)).targets, [id(P2, BF)], "balanced kills the brute");
    assert.deepEqual(aggressive.decide(engine.getSnapshot(P1)).targets, [P2]);
  });

  it("aggressive: attacks with everything once the enemy is at 5 life or less", () => {
    const { engine, id } = createScenario({ p1: { battlefield: ["ember_imp"] }, p2: { life: 5, battlefield: ["steel_sentinel"] } });
    engine.execute(endPhase(P1));
    assert.deepEqual(ai.decide(engine.getSnapshot(P1)).attackerIds, [], "balanced keeps the imp the sentinel would kill for free");
    assert.deepEqual(aggressive.decide(engine.getSnapshot(P1)).attackerIds, [id(P1, BF)]);
  });

  it("aggressive: blocks to kill and survive, never to trade", () => {
    const { engine, id } = createScenario({ p1: { battlefield: ["lava_brute", "ember_imp"] }, p2: { battlefield: ["iron_colossus", "scrap_golem"] } });
    engine.execute(endPhase(P1));
    engine.execute(declareAttackers(P1, [id(P1, BF, 0), id(P1, BF, 1)]));
    assert.deepEqual(aggressive.decide(engine.getSnapshot(P2)).blocks, [{ attackerId: id(P1, BF, 0), blockerId: id(P2, BF, 0) }], "the golem stays home to attack");
  });

  it("defensive: attacks only with creatures no untapped blocker can kill", () => {
    const { engine, id } = createScenario({ p1: { battlefield: ["lava_brute", "iron_colossus"] }, p2: { battlefield: ["clockwork_knight"] } });
    engine.execute(endPhase(P1));
    assert.deepEqual(ai.decide(engine.getSnapshot(P1)).attackerIds, [id(P1, BF, 0), id(P1, BF, 1)], "balanced accepts the brute's trade");
    assert.deepEqual(defensive.decide(engine.getSnapshot(P1)).attackerIds, [id(P1, BF, 1)]);
  });

  it("defensive: chump-blocks when the hit would leave it at half its life or less", () => {
    const { engine, id } = createScenario({ p1: { battlefield: ["lava_brute"] }, p2: { life: 12, battlefield: ["scrap_golem"] } });
    engine.execute(endPhase(P1));
    engine.execute(declareAttackers(P1, [id(P1, BF)]));
    assert.deepEqual(ai.decide(engine.getSnapshot(P2)).blocks, [], "balanced takes 4 at 12 life");
    assert.deepEqual(defensive.decide(engine.getSnapshot(P2)).blocks, [{ attackerId: id(P1, BF), blockerId: id(P2, BF) }]);
  });
});
