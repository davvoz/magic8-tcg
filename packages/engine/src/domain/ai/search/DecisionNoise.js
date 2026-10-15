/**
 * The search AI's misjudgement: a deterministic offset added to the score of
 * each candidate, so weaker levels sometimes prefer a move that is good but
 * not the best, the way a person misreads a board. Deterministic because it
 * comes from a hash of the candidate and a salt, never from a random
 * generator: the same position always gets the same misjudgement, and a game
 * the AI played can be played again. Different salts (one per opponent, say)
 * misjudge differently.
 */
import { hashString, unitSequence } from "../../../shared/hash.js";

export class DecisionNoise {
  #amplitude;
  #salt;

  /**
   * @param {number} amplitude the largest offset, in evaluation points; 0 for none
   * @param {string} [salt]
   */
  constructor(amplitude, salt = "") {
    this.#amplitude = amplitude;
    this.#salt = salt;
  }

  /**
   * @param {string} key what is being judged, stable for the same candidate in the same position
   * @returns {number} in [-amplitude, amplitude)
   */
  offset(key) {
    if (this.#amplitude === 0) {
      return 0;
    }
    const [unit] = unitSequence(hashString(`${this.#salt}|${key}`), 1);
    return this.#amplitude * (2 * unit - 1);
  }
}
