/**
 * Chooses the AI's blocks by trying them: each candidate set of blocks is
 * declared on the rebuilt game, combat resolves, and the position after it
 * is scored.
 *
 * It starts from the obvious candidates (no blocks, and what a hint policy,
 * BasicAi by default, would block) and then improves the best one a round
 * at a time: add a block, move a blocker to another attacker, or take a
 * blocker back, keeping the change that scores best, until nothing improves
 * or the level's rounds are spent. Few rounds is a hasty defender; many is
 * one who weighs every exchange.
 */
import { declareBlockers } from "../../commands/commandFactories.js";
import { AiStyle, BasicAi } from "../BasicAi.js";
import { CommandType } from "../../commands/CommandType.js";

/** @typedef {import("../AiPolicy.contract.js").Snapshot} Snapshot */
/** @typedef {import("../../game/GameEngine.js").GameEngine} GameEngine */
/** @typedef {Readonly<{ attackerId: string, blockerId: string }>} Block */
/** @typedef {{ blocks: readonly Block[], score: number }} Candidate */

/** A change must improve the score by more than this to be worth making. */
const MIN_GAIN = 1e-6;

export class BlockPlanner {
  #evaluator;
  #noise;
  #rounds;
  #hint;

  /**
   * @param {{ evaluator: import("../evaluation/PositionEvaluator.js").PositionEvaluator, noise: import("./DecisionNoise.js").DecisionNoise, rounds: number, hint?: import("../AiPolicy.contract.js").AiPolicy }} deps
   */
  constructor({ evaluator, noise, rounds, hint = new BasicAi(AiStyle.BALANCED) }) {
    this.#evaluator = evaluator;
    this.#noise = noise;
    this.#rounds = Math.max(0, rounds);
    this.#hint = hint;
  }

  /**
   * @param {GameEngine} world the rebuilt game, awaiting the AI's blocks
   * @param {import("./Simulator.js").Simulator} simulator
   * @param {Snapshot} snapshot the AI's own, at its decision
   * @returns {Readonly<Record<string, unknown>>}
   */
  plan(world, simulator, snapshot) {
    const me = simulator.playerId;
    const seeds = [[], this.#hintedBlocks(snapshot)];
    let best = seeds.map((blocks) => this.#score(world, simulator, blocks)).reduce(better);
    const options = blockOptions(snapshot);
    for (let round = 0; round < this.#rounds && !simulator.exhausted; round += 1) {
      const improved = neighbours(best.blocks, options)
        .map((blocks) => this.#score(world, simulator, blocks))
        .reduce(better, best);
      if (improved.score <= best.score + MIN_GAIN) {
        break;
      }
      best = improved;
    }
    return declareBlockers(me, best.blocks);
  }

  /** @param {Snapshot} snapshot */
  #hintedBlocks(snapshot) {
    const command = this.#hint.decide(snapshot);
    return command?.type === CommandType.DECLARE_BLOCKERS ? /** @type {readonly Block[]} */ (command.blocks) : [];
  }

  /**
   * @param {GameEngine} world
   * @param {import("./Simulator.js").Simulator} simulator
   * @param {readonly Block[]} blocks
   * @returns {Candidate}
   */
  #score(world, simulator, blocks) {
    const me = simulator.playerId;
    const after = simulator.play(world, declareBlockers(me, blocks));
    if (after === null) {
      return { blocks, score: Number.NEGATIVE_INFINITY };
    }
    const snapshot = after.getSnapshot(me);
    return { blocks, score: this.#evaluator.evaluate(snapshot, me) + this.#noise.offset(`${world.version}|${blockKey(blocks)}`) };
  }
}

/**
 * Who may block whom, and how many blockers an attacker may take.
 * @param {Snapshot} snapshot
 */
function blockOptions(snapshot) {
  const legal = /** @type {NonNullable<Snapshot["legalMoves"]>} */ (snapshot.legalMoves);
  return { attackerIds: snapshot.combat.attackerIds, blockerIds: legal.blockerIds, perAttacker: legal.maxBlockersPerAttacker };
}

/**
 * Every set of blocks one change away: a blocker added, moved or taken back.
 * @param {readonly Block[]} blocks
 * @param {{ attackerIds: readonly string[], blockerIds: readonly string[], perAttacker: number }} options
 * @returns {Block[][]}
 */
function neighbours(blocks, { attackerIds, blockerIds, perAttacker }) {
  const result = [];
  for (const blockerId of blockerIds) {
    const others = blocks.filter((block) => block.blockerId !== blockerId);
    if (others.length !== blocks.length) {
      result.push(others);
    }
    const open = attackerIds.filter((attackerId) => others.filter((block) => block.attackerId === attackerId).length < perAttacker);
    for (const attackerId of open) {
      const moved = [...others, { attackerId, blockerId }];
      if (blockKey(moved) !== blockKey(blocks)) {
        result.push(moved);
      }
    }
  }
  return result;
}

/** @param {readonly Block[]} blocks */
function blockKey(blocks) {
  return blocks
    .map((block) => `${block.blockerId}>${block.attackerId}`)
    .sort()
    .join(",");
}

/**
 * @param {Candidate} best
 * @param {Candidate} candidate
 */
function better(best, candidate) {
  return candidate.score > best.score ? candidate : best;
}
