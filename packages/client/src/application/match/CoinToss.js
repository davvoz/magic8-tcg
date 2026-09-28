/**
 * The coin toss that decides who plays first: each player is given a face
 * (heads or tails), the coin lands on one, and whoever holds that face
 * takes the first turn.
 *
 * An immutable value: it says who called what and how the coin landed,
 * never how it is shown. Two ways to make one:
 * - `flip`: nothing is decided yet (a practice match), the faces and the
 *   landing are both drawn;
 * - `decided`: the first player is already known (an online game, where the
 *   server's committed seed chose it), so only the faces are drawn and the
 *   coin is made to land on the first player's.
 * Randomness always comes from an injected RandomSource.
 */

export const CoinFace = Object.freeze({
  HEADS: "heads",
  TAILS: "tails",
});

/** @type {readonly string[]} */
const FACES = Object.freeze([CoinFace.HEADS, CoinFace.TAILS]);

/** @typedef {import("@magic8/engine/domain/random/RandomSource.contract.js").RandomSource} RandomSource */

export class CoinToss {
  /** Seating order, as given. @type {readonly string[]} */
  #playerIds;
  /** @type {ReadonlyMap<string, string>} player id → face */
  #calls;
  #landed;

  /**
   * @param {{ calls: Readonly<Record<string, string>>, landed: string }} toss
   *   `calls`: the face each of the two players holds, one each
   */
  constructor({ calls, landed }) {
    const entries = Object.entries(calls ?? {});
    if (entries.length !== FACES.length || entries.some(([id]) => typeof id !== "string" || id.length === 0)) {
      throw new TypeError("CoinToss: exactly two players must call a face");
    }
    const called = entries.map(([, face]) => face);
    if (!FACES.every((face) => called.includes(face))) {
      throw new TypeError("CoinToss: one player calls heads and the other tails");
    }
    if (!FACES.includes(landed)) {
      throw new TypeError(`CoinToss: the coin lands on heads or tails, not "${landed}"`);
    }
    this.#playerIds = Object.freeze(entries.map(([id]) => id));
    this.#calls = new Map(entries);
    this.#landed = landed;
    Object.freeze(this);
  }

  /**
   * A fair toss: who holds heads, and how the coin lands, are both drawn.
   * @param {{ playerIds: readonly string[], random: Pick<RandomSource, "nextInt"> }} options
   */
  static flip({ playerIds, random }) {
    const calls = callsFor(playerIds, random);
    return new CoinToss({ calls, landed: FACES[random.nextInt(FACES.length)] });
  }

  /**
   * The toss that tells an outcome already settled elsewhere: the faces are
   * drawn, the coin lands on `firstPlayerId`'s.
   * @param {{ playerIds: readonly string[], firstPlayerId: string, random: Pick<RandomSource, "nextInt"> }} options
   */
  static decided({ playerIds, firstPlayerId, random }) {
    if (!playerIds.includes(firstPlayerId)) {
      throw new TypeError(`CoinToss: "${firstPlayerId}" is not one of the players`);
    }
    const calls = callsFor(playerIds, random);
    return new CoinToss({ calls, landed: calls[firstPlayerId] });
  }

  /** @returns {readonly string[]} the two players, in the order they were given */
  get playerIds() {
    return this.#playerIds;
  }

  /** @returns {string} the face the coin shows once it settles (a CoinFace) */
  get landed() {
    return this.#landed;
  }

  /** @returns {string} the player whose face came up */
  get firstPlayerId() {
    return /** @type {string} */ (this.#playerIds.find((id) => this.#calls.get(id) === this.#landed));
  }

  /**
   * @param {string} playerId
   * @returns {string | null} the face that player holds, null for a stranger
   */
  faceOf(playerId) {
    return this.#calls.get(playerId) ?? null;
  }
}

/**
 * Gives heads to one of the two players at random, tails to the other.
 * @param {readonly string[]} playerIds
 * @param {Pick<RandomSource, "nextInt">} random
 * @returns {Record<string, string>}
 */
function callsFor(playerIds, random) {
  if (!Array.isArray(playerIds) || playerIds.length !== FACES.length || playerIds[0] === playerIds[1]) {
    throw new TypeError("CoinToss: a toss is between two distinct players");
  }
  const heads = random.nextInt(FACES.length);
  return Object.fromEntries(playerIds.map((id, index) => [id, index === heads ? CoinFace.HEADS : CoinFace.TAILS]));
}
