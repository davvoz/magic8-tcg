/**
 * Turns a difficulty level into how the search AI searches. The level is a
 * number on a continuous scale, not a few fixed modes, so a daily challenge
 * can pick "an easy 3" and a ranked bot can be matched to a player's rating
 * anywhere in between (docs/tcg/24-sfide.md).
 *
 * A scale is a few anchor levels with their settings; between two anchors
 * every setting moves linearly (counts rounded). A scale is data: another
 * one (calibrated on real players, say) is just another instance.
 *
 * - beamWidth: plans kept at each step of a turn (1: greedy)
 * - attackSubsets: combinations of attackers tried
 * - blockRounds: rounds of improving a block, after the obvious ones
 * - noise: how far the AI may misjudge a candidate, in evaluation points (0: never)
 * - simulations: moves tried on the rebuilt game per decision, a hard cap
 * - lookahead: 1 to judge a turn after the opponent's answer to it, 0 to judge it as it ends
 */

export const MIN_LEVEL = 1;
export const MAX_LEVEL = 10;

/**
 * @typedef {Readonly<{ beamWidth: number, attackSubsets: number, blockRounds: number, noise: number, simulations: number, lookahead: number }>} SearchSettings
 * @typedef {Readonly<{ level: number, settings: SearchSettings }>} Anchor
 */

/** Settings that count things, rounded to whole numbers. */
const COUNTS = Object.freeze(["beamWidth", "attackSubsets", "blockRounds", "simulations", "lookahead"]);
const FIELDS = Object.freeze([...COUNTS, "noise"]);

export class DifficultyScale {
  /** @type {readonly Anchor[]} */
  #anchors;

  /**
   * @param {readonly Anchor[]} anchors in increasing level, the first at MIN_LEVEL and the last at MAX_LEVEL
   */
  constructor(anchors) {
    const problem = anchorProblem(anchors);
    if (problem !== null) {
      throw new TypeError(`DifficultyScale: ${problem}`);
    }
    this.#anchors = Object.freeze(anchors.map((anchor) => Object.freeze({ level: anchor.level, settings: Object.freeze({ ...anchor.settings }) })));
  }

  /**
   * @param {number} level from MIN_LEVEL to MAX_LEVEL, fractions included
   * @returns {SearchSettings}
   */
  settingsFor(level) {
    if (!Number.isFinite(level) || level < MIN_LEVEL || level > MAX_LEVEL) {
      throw new RangeError(`difficulty level must be between ${MIN_LEVEL} and ${MAX_LEVEL}, got ${level}`);
    }
    const upper = this.#anchors.findIndex((anchor) => anchor.level >= level);
    const high = this.#anchors[upper];
    const low = this.#anchors[Math.max(0, upper - 1)];
    const share = high.level === low.level ? 0 : (level - low.level) / (high.level - low.level);
    const settings = {};
    for (const field of FIELDS) {
      const value = low.settings[field] + share * (high.settings[field] - low.settings[field]);
      settings[field] = COUNTS.includes(field) ? Math.round(value) : value;
    }
    return /** @type {SearchSettings} */ (Object.freeze(settings));
  }
}

/**
 * @param {readonly Anchor[]} anchors
 * @returns {string | null}
 */
function anchorProblem(anchors) {
  if (!Array.isArray(anchors) || anchors.length < 2) {
    return "at least two anchors are needed";
  }
  if (anchors[0].level !== MIN_LEVEL || anchors.at(-1)?.level !== MAX_LEVEL) {
    return `the anchors must span levels ${MIN_LEVEL} to ${MAX_LEVEL}`;
  }
  if (anchors.some((anchor, index) => index > 0 && anchor.level <= anchors[index - 1].level)) {
    return "anchor levels must increase";
  }
  const incomplete = anchors.find((anchor) => FIELDS.some((field) => !Number.isFinite(anchor.settings?.[field])));
  return incomplete === undefined ? null : `the anchor at level ${incomplete.level} lacks a setting (${FIELDS.join(", ")})`;
}

/**
 * The scale the game uses unless told otherwise. Measured with the
 * simulator against BasicAi on every pairing of the precons (packages/client
 * tools/simulate.js --versus): see docs/tcg/24-sfide.md.
 */
export const DEFAULT_DIFFICULTY = new DifficultyScale([
  { level: 1, settings: { beamWidth: 1, attackSubsets: 4, blockRounds: 0, noise: 10, simulations: 150, lookahead: 0 } },
  { level: 4, settings: { beamWidth: 3, attackSubsets: 16, blockRounds: 1, noise: 4, simulations: 800, lookahead: 0 } },
  { level: 7, settings: { beamWidth: 5, attackSubsets: 64, blockRounds: 3, noise: 1, simulations: 2500, lookahead: 1 } },
  { level: 10, settings: { beamWidth: 10, attackSubsets: 128, blockRounds: 6, noise: 0, simulations: 5000, lookahead: 1 } },
]);
