import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BasicAi } from "../../../src/domain/ai/BasicAi.js";
import { UNKNOWN_CARD_ID } from "../../../src/domain/ai/cardViews.js";
import { PositionEvaluator, WIN_SCORE } from "../../../src/domain/ai/evaluation/PositionEvaluator.js";
import { weightsFor } from "../../../src/domain/ai/evaluation/EvaluationWeights.js";
import { ActionGenerator } from "../../../src/domain/ai/search/ActionGenerator.js";
import { DecisionNoise } from "../../../src/domain/ai/search/DecisionNoise.js";
import { DEFAULT_DIFFICULTY, DifficultyScale, MAX_LEVEL, MIN_LEVEL } from "../../../src/domain/ai/search/DifficultyScale.js";
import { PerspectiveWorld } from "../../../src/domain/ai/search/PerspectiveWorld.js";
import { SearchAi } from "../../../src/domain/ai/search/SearchAi.js";
import { positionKey } from "../../../src/domain/ai/search/positionKey.js";
import { CommandType } from "../../../src/domain/commands/CommandType.js";
import { declareAttackers, endPhase, endTurn, playCard } from "../../../src/domain/commands/commandFactories.js";
import { ZoneType } from "../../../src/domain/game/ZoneType.js";
import { P1, P2, catalog, createEngine, effects, rulesWith } from "../engine/fixtures.js";
import { createScenario } from "../engine/scenario.js";

const rules = rulesWith();
const HAND = ZoneType.HAND;
const BF = ZoneType.BATTLEFIELD;
const searchAi = (options = {}) => new SearchAi({ rules, catalog, effects, ...options });

/**
 * Lets `ai` play for P1 until its turn is over (or the game), P2 never acting: it only ever has to block, and it does not.
 * @returns {Readonly<Record<string, unknown>>[]} the AI's moves
 */
function playTurn(engine, ai) {
  const moves = [];
  while (!engine.isOver && engine.activePlayerId === P1) {
    const actor = engine.awaitingPlayerId;
    const move = actor === P1 ? ai.decide(engine.getSnapshot(P1)) : { type: CommandType.DECLARE_BLOCKERS, playerId: P2, blocks: [] };
    assert.equal(engine.execute(move).ok, true, JSON.stringify(move));
    if (actor === P1) {
      moves.push(move);
    }
  }
  return moves;
}

describe("GameEngine fork and resume", () => {
  it("a fork goes its own way: commands on it never reach the original", () => {
    const { engine } = createEngine();
    const before = engine.getStateDigest();
    const fork = engine.fork();
    assert.equal(fork.execute(endTurn(P1)).ok, true);
    assert.deepEqual(engine.getStateDigest(), before);
    assert.notDeepEqual(fork.getStateDigest(), before);
    assert.equal(engine.execute(endTurn(P1)).ok, true, "the original still plays");
    assert.deepEqual(engine.getStateDigest(), fork.getStateDigest(), "same command, same result");
  });
});

describe("PerspectiveWorld", () => {
  it("rebuilds the table exactly and hides what the player cannot see", () => {
    const { engine } = createEngine({ seed: 7 });
    const ai = new BasicAi();
    for (let moves = 0; moves < 40; moves += 1) {
      const actor = /** @type {string} */ (engine.awaitingPlayerId);
      engine.execute(ai.decide(engine.getSnapshot(actor)));
    }
    const me = /** @type {string} */ (engine.awaitingPlayerId);
    const seen = engine.getSnapshot(me);
    const world = new PerspectiveWorld({ rules, catalog, effects }).build(seen);
    const rebuilt = world.getSnapshot(me);
    assert.deepEqual(rebuilt.players, seen.players, "what the player sees is the same");
    assert.deepEqual(rebuilt.legalMoves, seen.legalMoves);
    assert.equal(rebuilt.phase, seen.phase);

    const everything = world.getSnapshot(null);
    const enemy = everything.players.find((player) => player.id !== me);
    assert.ok(enemy.hand.length > 0);
    assert.ok(enemy.hand.every((card) => card.definitionId === UNKNOWN_CARD_ID), "the enemy's hand is unknown cards");
    assert.equal(everything.players.find((player) => player.id === me).librarySize, seen.players.find((player) => player.id === me).librarySize);
  });

  it("keeps buffs and their duration", () => {
    const { engine, id } = createScenario({ p1: { hand: ["fire_surge"], battlefield: ["ember_imp"], resources: 1 } });
    assert.equal(engine.execute(playCard(P1, id(P1, HAND), [id(P1, BF)])).ok, true);
    const seen = engine.getSnapshot(P1);
    const imp = new PerspectiveWorld({ rules, catalog, effects }).build(seen).getSnapshot(P1).players[0].battlefield[0];
    assert.equal(imp.attack, 4);
    assert.deepEqual(imp.modifiers, [{ attack: 2, health: 0, duration: "end_of_turn" }]);
  });
});

describe("SearchAi — its own turn", () => {
  it("spends its energy well: two 2-drops rather than one 3-drop", () => {
    const { engine } = createScenario({ p1: { hand: ["wandering_sellsword", "rivet_hound", "village_militia"], resources: 4 } });
    playTurn(engine, searchAi());
    const board = engine.getSnapshot(P1).players[0].battlefield.map((card) => card.definitionId).sort();
    assert.deepEqual(board, ["rivet_hound", "village_militia"], "BasicAi would play the sellsword and waste 1");
  });

  it("burns the enemy's face when that wins, even with a creature to shoot", () => {
    const { engine } = createScenario({ p1: { hand: ["ember_bolt"], resources: 2 }, p2: { life: 3, battlefield: ["lava_brute"] } });
    const move = searchAi().decide(engine.getSnapshot(P1));
    assert.deepEqual(move, playCard(P1, move.cardId, [P2]));
    assert.equal(engine.execute(move).ok, true);
    assert.equal(engine.getSnapshot(P1).winnerId, P1);
  });

  it("attacks for the win", () => {
    const { engine } = createScenario({ p1: { battlefield: ["wandering_sellsword"], resources: 0 }, p2: { life: 3 } });
    playTurn(engine, searchAi({ level: MIN_LEVEL }));
    assert.equal(engine.getSnapshot(P1).winnerId, P1);
  });
});

describe("SearchAi — blocks", () => {
  it("blocks to kill an attacker and survive", () => {
    const { engine, id } = createScenario({ p1: { battlefield: ["ember_imp"], resources: 0 }, p2: { battlefield: ["steel_sentinel"] } });
    assert.equal(engine.execute(endPhase(P1)).ok, true);
    assert.equal(engine.execute(declareAttackers(P1, [id(P1, BF)])).ok, true);
    const move = searchAi().decide(engine.getSnapshot(P2));
    assert.deepEqual(move.blocks, [{ attackerId: id(P1, BF), blockerId: id(P2, BF) }]);
  });

  it("does not throw a creature away at full life", () => {
    const { engine, id } = createScenario({ p1: { battlefield: ["lava_brute"], resources: 0 }, p2: { battlefield: ["ember_imp"] } });
    engine.execute(endPhase(P1));
    engine.execute(declareAttackers(P1, [id(P1, BF)]));
    assert.deepEqual(searchAi().decide(engine.getSnapshot(P2)).blocks, [], "the imp would die and the brute live");
  });

  it("chump-blocks when the hit would kill", () => {
    const { engine, id } = createScenario({ p1: { battlefield: ["lava_brute"], resources: 0 }, p2: { life: 4, battlefield: ["ember_imp"] } });
    engine.execute(endPhase(P1));
    engine.execute(declareAttackers(P1, [id(P1, BF)]));
    assert.equal(searchAi().decide(engine.getSnapshot(P2)).blocks.length, 1);
  });
});

describe("SearchAi — a whole game", () => {
  /** Plays a game of SearchAi (P1) against BasicAi (P2); every move must be legal. */
  const playGame = (seed, level) => {
    const { engine } = createEngine({ seed });
    const players = { [P1]: searchAi({ level, salt: "test" }), [P2]: new BasicAi() };
    const moves = [];
    while (!engine.isOver && moves.length < 2000) {
      const actor = /** @type {string} */ (engine.awaitingPlayerId);
      const move = players[actor].decide(engine.getSnapshot(actor));
      assert.equal(engine.execute(move).ok, true, JSON.stringify(move));
      moves.push(move);
    }
    return { moves, winner: engine.getSnapshot(null).winnerId };
  };

  it("plays to the end with legal moves only, at both ends of the scale", () => {
    for (const level of [MIN_LEVEL, MAX_LEVEL]) {
      const { winner } = playGame(11, level);
      assert.notEqual(winner, undefined);
    }
  });

  it("is deterministic: the same game twice, move for move", () => {
    assert.deepEqual(playGame(5, 4), playGame(5, 4));
  });

  it("returns null when it is not its move", () => {
    const { engine } = createEngine();
    assert.equal(searchAi().decide(engine.getSnapshot(P2)), null);
    assert.equal(searchAi().decide(engine.getSnapshot(null)), null);
  });
});

describe("DifficultyScale", () => {
  it("gives each anchor's settings at its level and moves linearly between them", () => {
    const easy = { beamWidth: 1, attackSubsets: 4, blockRounds: 0, noise: 10, simulations: 100, lookahead: 0 };
    const hard = { beamWidth: 11, attackSubsets: 104, blockRounds: 6, noise: 0, simulations: 1000, lookahead: 1 };
    const scale = new DifficultyScale([
      { level: MIN_LEVEL, settings: easy },
      { level: MAX_LEVEL, settings: hard },
    ]);
    assert.deepEqual(scale.settingsFor(MIN_LEVEL), easy);
    assert.deepEqual(scale.settingsFor(MAX_LEVEL), hard);
    assert.deepEqual(scale.settingsFor(5.5), { beamWidth: 6, attackSubsets: 54, blockRounds: 3, noise: 5, simulations: 550, lookahead: 1 });
  });

  it("grows stronger with the level on the default scale", () => {
    const levels = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((level) => DEFAULT_DIFFICULTY.settingsFor(level));
    levels.slice(1).forEach((settings, index) => {
      assert.ok(settings.simulations >= levels[index].simulations);
      assert.ok(settings.beamWidth >= levels[index].beamWidth);
      assert.ok(settings.noise <= levels[index].noise);
    });
  });

  it("refuses levels off the scale and anchors that do not span it", () => {
    assert.throws(() => DEFAULT_DIFFICULTY.settingsFor(0), RangeError);
    assert.throws(() => DEFAULT_DIFFICULTY.settingsFor(Number.NaN), RangeError);
    const settings = DEFAULT_DIFFICULTY.settingsFor(1);
    assert.throws(() => new DifficultyScale([{ level: 2, settings }, { level: MAX_LEVEL, settings }]), TypeError);
    assert.throws(() => new DifficultyScale([{ level: MIN_LEVEL, settings }, { level: MIN_LEVEL, settings }, { level: MAX_LEVEL, settings }]), TypeError);
    assert.throws(() => new DifficultyScale([{ level: MIN_LEVEL, settings: { ...settings, noise: undefined } }, { level: MAX_LEVEL, settings }]), TypeError);
  });
});

describe("Search parts", () => {
  it("DecisionNoise is deterministic, bounded, and silent at zero", () => {
    const noise = new DecisionNoise(3, "salt");
    const offsets = ["a", "b", "c", "d"].map((key) => noise.offset(key));
    assert.deepEqual(offsets, ["a", "b", "c", "d"].map((key) => new DecisionNoise(3, "salt").offset(key)));
    assert.ok(offsets.every((offset) => offset >= -3 && offset < 3));
    assert.notDeepEqual(offsets, ["a", "b", "c", "d"].map((key) => new DecisionNoise(3, "other").offset(key)));
    assert.equal(new DecisionNoise(0).offset("a"), 0);
  });

  it("ActionGenerator offers each distinct play once, and moving on", () => {
    const { engine } = createScenario({ p1: { hand: ["ember_imp", "ember_imp", "ember_bolt"], resources: 3 }, p2: { battlefield: ["moss_beetle", "moss_beetle"] } });
    const actions = new ActionGenerator({ attackSubsets: 128 }).actionsFor(engine.getSnapshot(P1));
    const plays = actions.filter((action) => action.type === CommandType.PLAY_CARD);
    // One imp; the bolt at either player, at its own side's nothing, at one of the two identical beetles.
    assert.equal(plays.filter((play) => play.targets.length === 0).length, 1);
    assert.deepEqual(plays.filter((play) => play.targets.length === 1).map((play) => play.targets[0] === P1 || play.targets[0] === P2 ? play.targets[0] : "beetle").sort(), ["beetle", P1, P2].sort());
    assert.deepEqual(actions.at(-1), endPhase(P1));
  });

  it("ActionGenerator tries every attack when few, the telling ones when many", () => {
    const few = createScenario({ p1: { battlefield: ["ember_imp", "cinder_hound"], resources: 0 } });
    few.engine.execute(endPhase(P1));
    assert.equal(new ActionGenerator({ attackSubsets: 128 }).actionsFor(few.engine.getSnapshot(P1)).length, 4);

    const many = createScenario({ p1: { battlefield: ["ember_imp", "cinder_hound", "lava_brute", "moss_beetle", "scrap_golem"], resources: 0 } });
    many.engine.execute(endPhase(P1));
    const attacks = new ActionGenerator({ attackSubsets: 8 }).actionsFor(many.engine.getSnapshot(P1));
    assert.equal(attacks.length, 8);
    assert.deepEqual(attacks[0].attackerIds, [], "not attacking comes first");
    assert.equal(attacks[1].attackerIds.length, 5, "then everything");
  });

  it("positionKey is the same whatever order identical moves came in", () => {
    const one = createScenario({ p1: { hand: ["ember_imp", "moss_beetle"], resources: 2 } });
    const two = createScenario({ p1: { hand: ["ember_imp", "moss_beetle"], resources: 2 } });
    one.engine.execute(playCard(P1, one.id(P1, HAND, 0)));
    one.engine.execute(playCard(P1, one.id(P1, HAND, 1)));
    two.engine.execute(playCard(P1, two.id(P1, HAND, 1)));
    two.engine.execute(playCard(P1, two.id(P1, HAND, 0)));
    assert.equal(positionKey(one.engine.getSnapshot(P1)), positionKey(two.engine.getSnapshot(P1)));
  });

  it("PositionEvaluator ranks a win above anything and values life more when it is low", () => {
    const evaluator = new PositionEvaluator({ weights: weightsFor("balanced") });
    const won = createScenario({ p1: { hand: ["ember_bolt"], resources: 2 }, p2: { life: 1 } });
    won.engine.execute(playCard(P1, won.id(P1, HAND), [P2]));
    assert.ok(evaluator.evaluate(won.engine.getSnapshot(P1), P1) > WIN_SCORE / 2);
    assert.ok(evaluator.evaluate(won.engine.getSnapshot(P2), P2) < -WIN_SCORE / 2);

    const at = (life) => evaluator.evaluate(createScenario({ p1: { life } }).engine.getSnapshot(P1), P1);
    assert.ok(at(5) - at(2) > at(20) - at(17), "three life matter more at the bottom");
  });
});
