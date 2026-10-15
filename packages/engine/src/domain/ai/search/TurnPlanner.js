/**
 * Plans the rest of the AI's own turn with a beam search, and returns the
 * plan's next move.
 *
 * A line is a sequence of the AI's moves from the decision point (play this,
 * then that, attack with these, ...), played on the rebuilt game with the
 * opponent's answers (Simulator). At each step every open line is extended
 * by every move the generator offers; the lines whose turn is over (the AI
 * ended it, or the game ended) are finished and scored, the others are
 * scored too and only the best `beamWidth` distinct positions stay open.
 * When the steps or the budget run out, the open lines end the turn there.
 * The best finished line wins; its first move is the decision.
 *
 * Scores are the evaluator's, plus the level's misjudgement (DecisionNoise).
 * Finished lines are all scored at the same moment, the start of the
 * opponent's turn, so they compare fairly; open lines only compete with
 * each other for a place in the beam.
 */
import { endTurn } from "../../commands/commandFactories.js";
import { positionKey } from "./positionKey.js";

/** @typedef {import("../../game/GameEngine.js").GameEngine} GameEngine */
/** @typedef {Readonly<Record<string, unknown>>} Command */

/** Moves in one turn's plan: a full hand, moving to combat, attacking, ending the turn. */
const MAX_STEPS = 16;

/** A sequence of the AI's moves, the game it leads to, and how that position was judged. */
class Line {
  /** @type {number} */
  #score = Number.NEGATIVE_INFINITY;
  #key = "";

  /**
   * @param {GameEngine} engine
   * @param {readonly Command[]} moves
   */
  constructor(engine, moves) {
    this.engine = engine;
    this.moves = moves;
  }

  get first() {
    return this.moves[0];
  }

  get score() {
    return this.#score;
  }

  /** The position, for telling lines that reach the same one apart (positionKey). */
  get key() {
    return this.#key;
  }

  /**
   * @param {number} score
   * @param {string} key
   */
  judge(score, key) {
    this.#score = score;
    this.#key = key;
    return this;
  }
}

export class TurnPlanner {
  #generator;
  #evaluator;
  #noise;
  #beamWidth;
  #lookahead;

  /**
   * @param {{ generator: import("./ActionGenerator.js").ActionGenerator, evaluator: import("../evaluation/PositionEvaluator.js").PositionEvaluator, noise: import("./DecisionNoise.js").DecisionNoise, beamWidth: number, lookahead: boolean }} deps
   *   `lookahead`: score a finished line after the opponent's turn played out (Simulator.playOpponentTurn), not at its start
   */
  constructor({ generator, evaluator, noise, beamWidth, lookahead }) {
    this.#generator = generator;
    this.#evaluator = evaluator;
    this.#noise = noise;
    this.#beamWidth = Math.max(1, beamWidth);
    this.#lookahead = lookahead;
  }

  /**
   * @param {GameEngine} world the rebuilt game at the AI's decision
   * @param {import("./Simulator.js").Simulator} simulator
   * @returns {Command | null} null when no move could be tried
   */
  plan(world, simulator) {
    const choices = this.#generator.actionsFor(world.getSnapshot(simulator.playerId));
    if (choices.length <= 1) {
      return choices[0] ?? null;
    }
    let open = [new Line(world, [])];
    /** @type {Line | null} */
    let best = null;
    for (let step = 0; step < MAX_STEPS && open.length > 0 && !simulator.exhausted; step += 1) {
      const { finished, continuing } = this.#extend(open, simulator);
      best = finished.reduce(better, best);
      open = this.#keepBest(continuing);
    }
    const closed = open.filter((line) => line.moves.length > 0).map((line) => this.#close(line, simulator));
    best = closed.reduce(better, best);
    return best === null ? null : best.first;
  }

  /**
   * @param {readonly Line[]} lines
   * @param {import("./Simulator.js").Simulator} simulator
   */
  #extend(lines, simulator) {
    /** @type {Line[]} */
    const finished = [];
    /** @type {Line[]} */
    const continuing = [];
    for (const line of lines) {
      for (const move of this.#generator.actionsFor(line.engine.getSnapshot(simulator.playerId))) {
        if (simulator.exhausted) {
          return { finished, continuing };
        }
        const next = simulator.play(line.engine, move);
        if (next === null) {
          continue;
        }
        const child = new Line(next, [...line.moves, move]);
        if (simulator.isTurnOver(next)) {
          finished.push(this.#scoredFinished(child, simulator));
        } else {
          continuing.push(this.#scored(child, simulator.playerId));
        }
      }
    }
    return { finished, continuing };
  }

  /**
   * The best `beamWidth` lines, one per distinct position.
   * @param {Line[]} lines
   */
  #keepBest(lines) {
    const byPosition = new Map();
    for (const line of lines) {
      const kept = byPosition.get(line.key);
      if (kept === undefined || line.score > kept.score) {
        byPosition.set(line.key, line);
      }
    }
    return [...byPosition.values()].sort((a, b) => b.score - a.score).slice(0, this.#beamWidth);
  }

  /**
   * Ends the turn where the line stands, to score it with the finished ones.
   * @param {Line} line
   * @param {import("./Simulator.js").Simulator} simulator
   */
  #close(line, simulator) {
    const next = simulator.play(line.engine, endTurn(simulator.playerId));
    return next === null ? line : this.#scoredFinished(new Line(next, line.moves), simulator);
  }

  /**
   * A line whose turn is over, scored where the planner looks: after the opponent's turn with lookahead, at its start without.
   * @param {Line} line
   * @param {import("./Simulator.js").Simulator} simulator
   */
  #scoredFinished(line, simulator) {
    const judged = this.#lookahead && !line.engine.isOver ? simulator.playOpponentTurn(line.engine) : line.engine;
    return this.#judged(line, judged, simulator.playerId);
  }

  /**
   * @param {Line} line
   * @param {string} playerId
   */
  #scored(line, playerId) {
    return this.#judged(line, line.engine, playerId);
  }

  /**
   * @param {Line} line
   * @param {GameEngine} position where the line is judged: its own game, or further on
   * @param {string} playerId
   */
  #judged(line, position, playerId) {
    const snapshot = position.getSnapshot(playerId);
    const score = this.#evaluator.evaluate(snapshot, playerId) + this.#noise.offset(`${snapshot.version}|${JSON.stringify(line.moves)}`);
    return line.judge(score, positionKey(snapshot));
  }
}

/**
 * @param {Line | null} best
 * @param {Line} line
 */
function better(best, line) {
  return best === null || line.score > best.score ? line : best;
}
