/**
 * The search AI: instead of following fixed rules like BasicAi, it tries
 * its options on a copy of the game and keeps what leads to the best
 * position. It plans the rest of its turn as a whole (which cards, in which
 * order, with which targets, which attack) and weighs its blocks by playing
 * out the combat.
 *
 * It never knows more than a human in its seat: it rebuilds the game from
 * its own perspective snapshot (PerspectiveWorld), with the cards it cannot
 * see as unknown cards. It is deterministic: the same snapshot, level,
 * style and salt always give the same command, so its games replay from
 * their seed like BasicAi's.
 *
 * What it is made of, each part replaceable on its own:
 * - a profile: a level on a continuous scale (how well it searches,
 *   DifficultyScale) and a style (what it values, EvaluationWeights);
 * - PositionEvaluator, which scores positions;
 * - TurnPlanner (its own turn) and BlockPlanner (the enemy's attacks);
 * - OpponentModel, how it expects the opponent to block.
 */
import { createCoreCommandRegistry } from "../../commands/registerCoreCommands.js";
import { declareAttackers, endPhase, endTurn } from "../../commands/commandFactories.js";
import { createCoreEffectRegistry } from "../../effects/registerCoreEffects.js";
import { GamePhase } from "../../game/GamePhase.js";
import { AiStyle } from "../BasicAi.js";
import { PositionEvaluator } from "../evaluation/PositionEvaluator.js";
import { weightsFor } from "../evaluation/EvaluationWeights.js";
import { ActionGenerator } from "./ActionGenerator.js";
import { BlockPlanner } from "./BlockPlanner.js";
import { DEFAULT_DIFFICULTY } from "./DifficultyScale.js";
import { DecisionNoise } from "./DecisionNoise.js";
import { OpponentModel } from "./OpponentModel.js";
import { PerspectiveWorld } from "./PerspectiveWorld.js";
import { Simulator } from "./Simulator.js";
import { TurnPlanner } from "./TurnPlanner.js";

/**
 * Version of the search and its evaluation. Like BasicAi's AI_VERSION: a
 * change to what the AI decides in any situation is a new version.
 */
export const SEARCH_AI_VERSION = 1;

/** @typedef {import("../AiPolicy.contract.js").Snapshot} Snapshot */
/** @typedef {Readonly<Record<string, unknown>>} Command */

/**
 * @typedef {object} SearchAiOptions
 * @property {import("../../game/GameRules.js").GameRules} rules of the game being played
 * @property {import("../../cards/CardCatalog.js").CardCatalog} catalog of the game being played
 * @property {import("../../effects/EffectRegistry.js").EffectRegistry} [effects]
 * @property {import("../../commands/CommandRegistry.js").CommandRegistry} [commands]
 * @property {number} [level] on the difficulty scale (default: the middle)
 * @property {string} [style] one of AiStyle
 * @property {import("../evaluation/EvaluationWeights.js").EvaluationWeights} [weights] a character of its own, instead of the style's
 * @property {string} [salt] varies the misjudgements of weaker levels between AIs of the same profile
 * @property {import("./DifficultyScale.js").DifficultyScale} [scale]
 * @property {OpponentModel} [opponent]
 */

/** The middle of the default scale. */
const DEFAULT_LEVEL = 5;

export class SearchAi {
  #level;
  #style;
  #settings;
  #world;
  #opponent;
  #turnPlanner;
  #blockPlanner;

  /** @param {SearchAiOptions} options */
  constructor({ rules, catalog, effects = createCoreEffectRegistry(), commands = createCoreCommandRegistry(), level = DEFAULT_LEVEL, style = AiStyle.BALANCED, weights = weightsFor(style), salt = "", scale = DEFAULT_DIFFICULTY, opponent = new OpponentModel() }) {
    this.#level = level;
    this.#style = style;
    this.#settings = scale.settingsFor(level);
    this.#world = new PerspectiveWorld({ rules, catalog, effects, commands });
    this.#opponent = opponent;
    const evaluator = new PositionEvaluator({ weights });
    const noise = new DecisionNoise(this.#settings.noise, `${SEARCH_AI_VERSION}|${level}|${style}|${salt}`);
    this.#turnPlanner = new TurnPlanner({ generator: new ActionGenerator(this.#settings), evaluator, noise, beamWidth: this.#settings.beamWidth, lookahead: this.#settings.lookahead > 0 });
    this.#blockPlanner = new BlockPlanner({ evaluator, noise, rounds: this.#settings.blockRounds });
  }

  get level() {
    return this.#level;
  }

  get style() {
    return this.#style;
  }

  /** How this AI searches, from its level. */
  get settings() {
    return this.#settings;
  }

  /**
   * @param {Snapshot} snapshot
   * @returns {Command | null} null when it is not the perspective player's move
   */
  decide(snapshot) {
    const me = snapshot.perspectivePlayerId;
    if (me === null || snapshot.isOver || snapshot.awaitingPlayerId !== me || snapshot.legalMoves === null) {
      return null;
    }
    const opponentId = snapshot.players.find((player) => player.id !== me)?.id;
    if (opponentId === undefined) {
      return null;
    }
    const simulator = new Simulator({ playerId: me, opponentId, opponent: this.#opponent, simulations: this.#settings.simulations });
    if (snapshot.phase === GamePhase.COMBAT_BLOCKERS) {
      return this.#blockPlanner.plan(this.#world.build(snapshot), simulator, snapshot);
    }
    return this.#turnPlanner.plan(this.#world.build(snapshot), simulator) ?? fallback(snapshot, me);
  }
}

/**
 * The least move there is, should the search find nothing to try.
 * @param {Snapshot} snapshot
 * @param {string} me
 */
function fallback(snapshot, me) {
  const legal = /** @type {NonNullable<Snapshot["legalMoves"]>} */ (snapshot.legalMoves);
  if (legal.canEndTurn) {
    return endTurn(me);
  }
  return legal.canEndPhase ? endPhase(me) : declareAttackers(me, []);
}
