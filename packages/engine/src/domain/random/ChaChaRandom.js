/**
 * The engine's random source: the ChaCha20 keystream under a 256-bit key.
 *
 * - Unpredictable without the key: seeing any number of outcomes (your own
 *   opening hand, every draw) reveals nothing about the rest of the stream.
 *   The previous generator (mulberry32) had a 32-bit state that a player could
 *   brute-force from their own hand; see docs/tcg/00-analisi.md, E1.
 * - Deterministic with the key: the authoritative server, the client and the
 *   replay verifier all derive the same shuffles from the same key.
 *
 * Integers are drawn by rejection sampling, so `nextInt(n)` is exactly
 * uniform (no modulo bias).
 *
 * @implements {import("./RandomSource.contract.js").RandomSource}
 */
import { chacha20Block } from "../../shared/chacha20.js";
import { bytesToHex, hexToBytes, isHexOfLength } from "../../shared/bytes.js";

const KEY_BYTES = 32;
const WORDS_PER_BLOCK = 16;
const MAX_COUNTER = 0xffffffff;
const UINT32_RANGE = 0x100000000;

/**
 * @typedef {Readonly<{ key: string, counter: number, index: number }>} ChaChaState
 * `counter` is the next block to generate; `index` the next unread word of
 * the current block (16 when no block is buffered).
 */

export class ChaChaRandom {
  /** @type {Uint8Array} */
  #key;
  /** @type {number} */
  #counter = 0;
  /** @type {Uint32Array} */
  #block = new Uint32Array(WORDS_PER_BLOCK);
  /** @type {number} */
  #index = WORDS_PER_BLOCK;

  /** @param {Uint8Array} key 32 bytes */
  constructor(key) {
    if (!(key instanceof Uint8Array) || key.length !== KEY_BYTES) {
      throw new TypeError("ChaChaRandom: key must be 32 bytes");
    }
    this.#key = key.slice();
  }

  /**
   * Builds a generator from a seed:
   * - a 64-character lowercase hex string or a 32-byte Uint8Array: the key itself (production);
   * - a safe integer: expanded to a key (tests, tools and offline practice only).
   * @param {unknown} seed
   * @returns {ChaChaRandom}
   */
  static fromSeed(seed) {
    if (seed instanceof Uint8Array) {
      return new ChaChaRandom(seed);
    }
    if (isHexOfLength(seed, KEY_BYTES)) {
      return new ChaChaRandom(hexToBytes(seed));
    }
    if (Number.isSafeInteger(seed)) {
      return new ChaChaRandom(keyFromInteger(/** @type {number} */ (seed)));
    }
    throw new TypeError("ChaChaRandom: seed must be a 32-byte key (hex or bytes) or a safe integer");
  }

  /**
   * @param {unknown} seed
   * @returns {boolean}
   */
  static isValidSeed(seed) {
    return (seed instanceof Uint8Array && seed.length === KEY_BYTES) || isHexOfLength(seed, KEY_BYTES) || Number.isSafeInteger(seed);
  }

  /**
   * Restores a generator from getState().
   * @param {ChaChaState} state
   */
  static fromState(state) {
    const random = new ChaChaRandom(hexToBytes(state.key));
    if (!Number.isInteger(state.counter) || state.counter < 0 || state.counter > MAX_COUNTER + 1) {
      throw new RangeError("ChaChaRandom.fromState: invalid counter");
    }
    if (!Number.isInteger(state.index) || state.index < 0 || state.index > WORDS_PER_BLOCK) {
      throw new RangeError("ChaChaRandom.fromState: invalid index");
    }
    if (state.index < WORDS_PER_BLOCK && state.counter === 0) {
      throw new RangeError("ChaChaRandom.fromState: a buffered block needs a counter above zero");
    }
    random.#counter = state.counter;
    random.#index = state.index;
    if (state.index < WORDS_PER_BLOCK) {
      random.#block = chacha20Block(random.#key, state.counter - 1);
    }
    return random;
  }

  /** @returns {number} uniform 32-bit unsigned integer */
  nextUint32() {
    if (this.#index === WORDS_PER_BLOCK) {
      if (this.#counter > MAX_COUNTER) {
        throw new RangeError("ChaChaRandom: keystream exhausted");
      }
      this.#block = chacha20Block(this.#key, this.#counter);
      this.#counter += 1;
      this.#index = 0;
    }
    const value = this.#block[this.#index];
    this.#index += 1;
    return value;
  }

  /**
   * @param {number} maxExclusive integer in [1, 2^32]
   * @returns {number} uniform integer in [0, maxExclusive)
   */
  nextInt(maxExclusive) {
    if (!Number.isInteger(maxExclusive) || maxExclusive <= 0 || maxExclusive > UINT32_RANGE) {
      throw new RangeError("ChaChaRandom.nextInt: maxExclusive must be an integer in [1, 2^32]");
    }
    const limit = UINT32_RANGE - (UINT32_RANGE % maxExclusive);
    let value = this.nextUint32();
    while (value >= limit) {
      value = this.nextUint32();
    }
    return value % maxExclusive;
  }

  /**
   * Fisher–Yates shuffle into a new array.
   * @template T
   * @param {readonly T[]} items
   * @returns {T[]}
   */
  shuffle(items) {
    const result = [...items];
    for (let index = result.length - 1; index > 0; index -= 1) {
      const swap = this.nextInt(index + 1);
      [result[index], result[swap]] = [result[swap], result[index]];
    }
    return result;
  }

  /** @returns {ChaChaState} */
  getState() {
    return Object.freeze({ key: bytesToHex(this.#key), counter: this.#counter, index: this.#index });
  }

  /** An independent generator that will produce exactly the same future values. */
  clone() {
    const copy = new ChaChaRandom(this.#key);
    copy.#counter = this.#counter;
    copy.#block = this.#block.slice();
    copy.#index = this.#index;
    return copy;
  }
}

/**
 * @param {number} value safe integer
 * @returns {Uint8Array} the integer's 64-bit two's complement, little-endian, zero-padded to 32 bytes
 */
function keyFromInteger(value) {
  const key = new Uint8Array(KEY_BYTES);
  let remaining = BigInt.asUintN(64, BigInt(value));
  for (let index = 0; index < 8; index += 1) {
    key[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return key;
}
