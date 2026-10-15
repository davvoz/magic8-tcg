import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SearchAi } from "../../src/domain/ai/search/SearchAi.js";
import { PerspectiveWorld } from "../../src/domain/ai/search/PerspectiveWorld.js";
import { createCoreCommandRegistry } from "../../src/domain/commands/registerCoreCommands.js";
import { declareAttackers, declareBlockers, endPhase, endTurn, playCard } from "../../src/domain/commands/commandFactories.js";
import { MatchConditions } from "../../src/domain/conditions/MatchConditions.js";
import { GameEngine } from "../../src/domain/game/GameEngine.js";
import { ZoneType } from "../../src/domain/game/ZoneType.js";
import { P1, P2, catalog, effects, emberDeck, ironDeck, rulesWith } from "./engine/fixtures.js";
import { createScenario } from "./engine/scenario.js";

const HAND = ZoneType.HAND;
const BF = ZoneType.BATTLEFIELD;
const rules = rulesWith();
const seen = (engine, playerId = P1) => engine.getSnapshot(playerId).players.find((player) => player.id === playerId);
const enemy = (engine) => engine.getSnapshot(P1).players.find((player) => player.id === P2);

describe("match conditions — cost", () => {
  it("makes a player's spells cost more, shows it, and charges it", () => {
    const { engine, id } = createScenario({ p1: { hand: ["ember_bolt", "ember_imp"], resources: 2 }, conditions: [{ kind: "cost", players: [P1], filter: { type: "spell" }, amount: 1 }] });
    const [bolt, imp] = seen(engine).hand;
    assert.deepEqual([bolt.cost, bolt.printedCost, imp.cost], [3, 2, 1], "the hand shows what cards cost now");
    assert.ok(!engine.getSnapshot(P1).legalMoves.playableCardIds.includes(id(P1, HAND, 0)), "2 energy no longer pays for Ember Bolt");
    assert.equal(engine.execute(playCard(P1, id(P1, HAND, 0), [P2])).ok, false);
    assert.equal(engine.execute(playCard(P1, id(P1, HAND, 1))).ok, true, "creatures are untouched");
    assert.equal(seen(engine).resources.current, 1);
  });

  it("makes creatures cheaper for everyone, never below nothing", () => {
    const { engine, id } = createScenario({ p1: { hand: ["lava_brute", "ember_imp"], resources: 3 }, conditions: [{ kind: "cost", players: [P1, P2], filter: { type: "creature" }, amount: -1 }] });
    assert.deepEqual(seen(engine).hand.map((card) => card.cost), [3, 0]);
    assert.equal(engine.execute(playCard(P1, id(P1, HAND, 0))).ok, true, "a 4-drop for 3");
    assert.equal(engine.execute(playCard(P1, id(P1, HAND, 1))).ok, true, "and the imp for free");
    assert.equal(seen(engine).resources.current, 0);
  });
});

describe("match conditions — creatures entering", () => {
  it("gives one player's creatures lasting stats, and the other's nothing", () => {
    const { engine, id } = createScenario({ p1: { hand: ["ember_imp"], resources: 1 }, p2: { hand: ["scrap_golem"], resources: 1 }, conditions: [{ kind: "enter_stats", players: [P2], attack: 0, health: 2 }] });
    engine.execute(playCard(P1, id(P1, HAND)));
    assert.deepEqual([seen(engine).battlefield[0].attack, seen(engine).battlefield[0].health], [2, 1]);
    engine.execute(endTurn(P1));
    engine.execute(playCard(P2, id(P2, HAND)));
    const golem = seen(engine, P2).battlefield[0];
    assert.deepEqual([golem.attack, golem.health, golem.printedHealth], [1, 4, 2]);
    assert.deepEqual(golem.modifiers, [{ attack: 0, health: 2, duration: "permanent" }]);
  });

  it("gives keywords that count in play and go when the creature leaves", () => {
    const { engine, id } = createScenario({ p1: { hand: ["ember_imp"], resources: 1 }, p2: { hand: ["unsummon"], resources: 2 }, conditions: [{ kind: "keyword", players: [P1], filter: { faction: "ember" }, keyword: "haste" }] });
    engine.execute(playCard(P1, id(P1, HAND)));
    const imp = seen(engine).battlefield[0];
    assert.deepEqual([imp.keywords, imp.summoningSick], [["haste"], false]);
    engine.execute(endPhase(P1));
    assert.equal(engine.execute(declareAttackers(P1, [imp.instanceId])).ok, true, "haste: it attacks at once");
    engine.execute(declareBlockers(P2, []));
    engine.execute(endTurn(P1));
    engine.execute(playCard(P2, id(P2, HAND), [imp.instanceId]));
    assert.deepEqual(seen(engine).hand.find((card) => card.instanceId === imp.instanceId).keywords, [], "back in hand it is only what it says");
  });
});

describe("match conditions — turns and setup", () => {
  it("costs a player life at the start of each of their turns, and can end the game", () => {
    const { engine } = createScenario({ p2: { life: 1 }, conditions: [{ kind: "turn_start", players: [P1, P2], effect: "lose_life", amount: 1 }] });
    assert.equal(seen(engine).life, 19, "P1's first turn already began");
    engine.execute(endTurn(P1));
    assert.equal(engine.getSnapshot(null).winnerId, P1, "P2 starts their turn at 0");
  });

  it("draws more cards a turn", () => {
    const { engine } = createScenario({ p2: { library: Array(10).fill("ember_imp") }, conditions: [{ kind: "extra_draw", players: [P2], amount: 1 }] });
    const before = enemy(engine).handSize;
    engine.execute(endTurn(P1));
    assert.equal(enemy(engine).handSize, before + 2);
  });

  it("gives a player more starting life (healing up to it) and more starting cards", () => {
    const conditions = MatchConditions.fromPlain([{ kind: "starting_life", players: [P2], amount: 5 }, { kind: "starting_hand", players: [P2], amount: 1 }], [P1, P2]);
    assert.equal(conditions.ok, true);
    const engine = GameEngine.create({ rules, catalog, effects, commands: createCoreCommandRegistry(), players: [{ id: P1, name: "A", deckList: emberDeck }, { id: P2, name: "B", deckList: ironDeck }], seed: 9, conditions: conditions.value }).value;
    engine.start();
    const [one, two] = engine.getSnapshot(null).players;
    assert.deepEqual([one.life, one.maxLife, one.handSize], [20, 20, 5]);
    assert.deepEqual([two.life, two.maxLife, two.handSize], [25, 25, 6]);
    assert.equal(engine.getSnapshot(null).conditions.length, 2, "everyone sees the game's conditions");
  });
});

describe("match conditions — data", () => {
  it("reads back what it writes, and refuses what it cannot apply", () => {
    const plain = [
      { kind: "cost", players: [P1], filter: { type: "spell" }, amount: 1 },
      { kind: "turn_start", players: [P1, P2], effect: "gain_life", amount: 2 },
    ];
    const read = MatchConditions.fromPlain(plain, [P1, P2]);
    assert.deepEqual(read.value.toPlain(), [{ kind: "cost", players: [P1], amount: 1, filter: { type: "spell" } }, { kind: "turn_start", players: [P1, P2], amount: 2, effect: "gain_life" }]);
    assert.deepEqual(MatchConditions.fromPlain(read.value.toPlain(), [P1, P2]).value.toPlain(), read.value.toPlain());
    for (const broken of [
      [{ kind: "lucky", players: [P1] }],
      [{ kind: "cost", players: ["nobody"], amount: 1 }],
      [{ kind: "cost", players: [P1, P1], amount: 1 }],
      [{ kind: "cost", players: [], amount: 1 }],
      [{ kind: "cost", players: [P1], amount: 9 }],
      [{ kind: "cost", players: [P1], amount: 1, colour: "red" }],
      [{ kind: "keyword", players: [P1], keyword: "flying" }],
      [{ kind: "enter_stats", players: [P1], attack: 1, health: 1, filter: { type: "artifact" } }],
      "everything",
    ]) {
      assert.equal(MatchConditions.fromPlain(broken, [P1, P2]).ok, false, JSON.stringify(broken));
    }
    assert.equal(MatchConditions.fromPlain(undefined, [P1, P2]).value.isEmpty, true);
  });

  it("is rebuilt from a snapshot, so the search AI plays by the game's conditions", () => {
    const conditions = [{ kind: "cost", players: [P1], filter: { type: "creature" }, amount: -1 }, { kind: "keyword", players: [P1], keyword: "vigilance" }];
    const { engine, id } = createScenario({ p1: { hand: ["lava_brute"], battlefield: ["ember_imp"], resources: 3 }, conditions });
    const world = new PerspectiveWorld({ rules, catalog, effects }).build(engine.getSnapshot(P1));
    assert.deepEqual(world.getSnapshot(P1).conditions, engine.getSnapshot(P1).conditions);
    const move = new SearchAi({ rules, catalog, effects }).decide(engine.getSnapshot(P1));
    assert.deepEqual(move, playCard(P1, id(P1, HAND)), "it knows the brute costs 3 here");
    engine.execute(move);
    assert.deepEqual(world.getSnapshot(P1).players[0].battlefield[0].keywords, seen(engine).battlefield[0].keywords);
    assert.deepEqual(seen(engine).battlefield.map((card) => card.keywords), [[], ["vigilance"]], "the imp was there before: only creatures entering get it");
    assert.equal(id(P1, BF), seen(engine).battlefield[0].instanceId);
  });
});
