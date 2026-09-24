import assert from "node:assert/strict";
import { createCipheriv, randomBytes } from "node:crypto";
import { describe, it } from "node:test";

import { ChaChaRandom } from "../../src/domain/random/ChaChaRandom.js";
import { RANDOM_SOURCE_METHODS } from "../../src/domain/random/RandomSource.contract.js";
import { bytesToHex, hexToBytes } from "../../src/shared/bytes.js";
import { blockToBytes, chacha20Block } from "../../src/shared/chacha20.js";

const RFC_KEY = hexToBytes("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f");

/**
 * Keystream from OpenSSL (via node:crypto) for comparison: encrypting zeros
 * yields the keystream. Node's IV is the 32-bit counter followed by the nonce.
 * @param {Uint8Array} key
 * @param {number} counter
 * @param {number} length
 */
function opensslKeystream(key, counter, length) {
  const iv = Buffer.alloc(16);
  iv.writeUInt32LE(counter, 0);
  const cipher = createCipheriv("chacha20", key, iv);
  return new Uint8Array(cipher.update(Buffer.alloc(length)));
}

describe("chacha20Block", () => {
  it("matches the RFC 8439 §2.3.2 test vector", () => {
    const nonce = hexToBytes("000000090000004a00000000");
    const block = bytesToHex(blockToBytes(chacha20Block(RFC_KEY, 1, nonce)));
    assert.equal(
      block,
      "10f1e7e4d13b5915500fdd1fa32071c4c7d1f4c733c068030422aa9ac3d46c4e" +
        "d2826446079faa0914c2d705d98b02a2b5129cd1de164eb9cbd083e8a2503c4e",
    );
  });

  it("matches OpenSSL's ChaCha20 keystream for random keys and counters", () => {
    for (let trial = 0; trial < 25; trial += 1) {
      const key = new Uint8Array(randomBytes(32));
      const counter = trial * 977;
      const ours = new Uint8Array(64 * 3);
      for (let block = 0; block < 3; block += 1) {
        ours.set(blockToBytes(chacha20Block(key, counter + block)), block * 64);
      }
      assert.deepEqual(ours, opensslKeystream(key, counter, ours.length));
    }
  });

  it("rejects malformed keys, nonces and counters", () => {
    assert.throws(() => chacha20Block(new Uint8Array(31), 0), TypeError);
    assert.throws(() => chacha20Block(RFC_KEY, 0, new Uint8Array(8)), TypeError);
    assert.throws(() => chacha20Block(RFC_KEY, -1), RangeError);
    assert.throws(() => chacha20Block(RFC_KEY, 2 ** 32), RangeError);
    assert.throws(() => chacha20Block(RFC_KEY, 1.5), RangeError);
  });
});

describe("ChaChaRandom", () => {
  it("implements the RandomSource contract", () => {
    const random = ChaChaRandom.fromSeed(1);
    for (const method of RANDOM_SOURCE_METHODS) {
      assert.equal(typeof random[method], "function", method);
    }
  });

  it("emits the ChaCha20 keystream (zero nonce, counter from 0) as little-endian words", () => {
    const key = new Uint8Array(randomBytes(32));
    const random = new ChaChaRandom(key);
    const words = Array.from({ length: 40 }, () => random.nextUint32());
    const stream = opensslKeystream(key, 0, 40 * 4);
    const view = new DataView(stream.buffer);
    assert.deepEqual(words, Array.from({ length: 40 }, (_, index) => view.getUint32(index * 4, true)));
  });

  it("accepts a hex key, a byte key or a safe integer, and nothing else", () => {
    const hex = bytesToHex(RFC_KEY);
    const fromHex = ChaChaRandom.fromSeed(hex);
    const fromBytes = ChaChaRandom.fromSeed(RFC_KEY);
    assert.equal(fromHex.nextUint32(), fromBytes.nextUint32());
    assert.ok(ChaChaRandom.isValidSeed(hex));
    assert.ok(ChaChaRandom.isValidSeed(-7));
    for (const invalid of [1.5, "abc", hex.toUpperCase(), `${hex}00`, new Uint8Array(16), null, undefined, 2 ** 53]) {
      assert.equal(ChaChaRandom.isValidSeed(invalid), false, String(invalid));
      assert.throws(() => ChaChaRandom.fromSeed(invalid), TypeError);
    }
  });

  it("gives distinct streams for distinct integer seeds, including negatives", () => {
    const first = (seed) => ChaChaRandom.fromSeed(seed).nextUint32();
    const values = new Set([0, 1, 2, -1, -2, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER].map(first));
    assert.equal(values.size, 7);
  });

  it("does not alias the caller's key buffer", () => {
    const key = RFC_KEY.slice();
    const random = new ChaChaRandom(key);
    const expected = new ChaChaRandom(RFC_KEY).nextUint32();
    key.fill(0);
    assert.equal(random.nextUint32(), expected);
  });

  it("is deterministic and resumable from any point through getState/fromState and clone", () => {
    for (const consumed of [0, 1, 15, 16, 17, 40]) {
      const original = ChaChaRandom.fromSeed(99);
      for (let step = 0; step < consumed; step += 1) {
        original.nextUint32();
      }
      const resumed = ChaChaRandom.fromState(original.getState());
      const cloned = original.clone();
      const next = Array.from({ length: 20 }, () => original.nextUint32());
      assert.deepEqual(Array.from({ length: 20 }, () => resumed.nextUint32()), next, `after ${consumed}`);
      assert.deepEqual(Array.from({ length: 20 }, () => cloned.nextUint32()), next, `clone after ${consumed}`);
    }
  });

  it("clones are independent of the original", () => {
    const original = ChaChaRandom.fromSeed(5);
    const clone = original.clone();
    original.nextUint32();
    original.nextUint32();
    assert.equal(clone.getState().index, 16);
    assert.equal(clone.getState().counter, 0);
  });

  it("rejects corrupted states", () => {
    const key = bytesToHex(RFC_KEY);
    assert.throws(() => ChaChaRandom.fromState({ key, counter: -1, index: 16 }), RangeError);
    assert.throws(() => ChaChaRandom.fromState({ key, counter: 0, index: 3 }), RangeError);
    assert.throws(() => ChaChaRandom.fromState({ key, counter: 1, index: 17 }), RangeError);
    assert.throws(() => ChaChaRandom.fromState({ key: "zz", counter: 1, index: 0 }), TypeError);
  });

  it("nextInt stays in range, covers every value and is roughly uniform", () => {
    const random = ChaChaRandom.fromSeed(2024);
    const buckets = new Array(6).fill(0);
    const draws = 60000;
    for (let draw = 0; draw < draws; draw += 1) {
      const value = random.nextInt(6);
      assert.ok(Number.isInteger(value) && value >= 0 && value < 6);
      buckets[value] += 1;
    }
    const expected = draws / 6;
    const chiSquare = buckets.reduce((sum, count) => sum + (count - expected) ** 2 / expected, 0);
    // 5 degrees of freedom: p = 0.001 at 20.5. A correct generator fails this about once in a thousand seeds; this seed is fixed.
    assert.ok(chiSquare < 20.5, `chi-square ${chiSquare}`);
  });

  it("nextInt handles the full 32-bit range and rejects invalid bounds", () => {
    const random = ChaChaRandom.fromSeed(3);
    assert.equal(random.nextInt(1), 0);
    const wide = random.nextInt(2 ** 32);
    assert.ok(wide >= 0 && wide < 2 ** 32);
    for (const invalid of [0, -1, 1.5, "5", 2 ** 32 + 1]) {
      assert.throws(() => random.nextInt(invalid), RangeError, String(invalid));
    }
  });

  it("shuffle returns a permutation and leaves the input untouched", () => {
    const input = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8]);
    const shuffled = ChaChaRandom.fromSeed(3).shuffle(input);
    assert.deepEqual([...shuffled].sort((x, y) => x - y), [...input]);
    assert.deepEqual(input, [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.notDeepEqual(shuffled, [...input]);
  });

  it("keys differing in a single bit give unrelated streams", () => {
    // Sanity check, not a proof: related keys must not produce related outputs.
    const a = ChaChaRandom.fromSeed(bytesToHex(RFC_KEY));
    const neighbour = RFC_KEY.slice();
    neighbour[31] ^= 1;
    const b = new ChaChaRandom(neighbour);
    let equalWords = 0;
    for (let word = 0; word < 256; word += 1) {
      equalWords += a.nextUint32() === b.nextUint32() ? 1 : 0;
    }
    assert.ok(equalWords <= 1);
  });
});

describe("bytes", () => {
  it("round-trips and rejects non-canonical hex", () => {
    assert.equal(bytesToHex(hexToBytes("00ff10")), "00ff10");
    assert.deepEqual(hexToBytes(""), new Uint8Array(0));
    for (const invalid of ["0", "0G", "FF", " 00", 12]) {
      assert.throws(() => hexToBytes(invalid), TypeError, String(invalid));
    }
    assert.throws(() => bytesToHex([1, 2]), TypeError);
  });
});
