import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import { CanonicalJsonErrorCode, HashTag, canonicalize, isHash, parseCanonical, sha256Hex, taggedHash, taggedHashHex, utf8, utf8Length } from "../src/index.js";

/**
 * @param {() => unknown} action
 * @param {string} code
 */
function assertCode(action, code) {
  assert.throws(action, (error) => error.code === code, `expected ${code}`);
}

describe("canonicalize", () => {
  it("sorts keys by UTF-16 code units and drops whitespace", () => {
    assert.equal(canonicalize({ b: 1, a: [true, null, "x"], A: {} }), '{"A":{},"a":[true,null,"x"],"b":1}');
    // Code-unit order, not locale order: "Z" (0x5a) < "a" (0x61) < "é" (0xe9).
    assert.equal(canonicalize({ é: 1, a: 2, Z: 3 }), '{"Z":3,"a":2,"é":1}');
  });

  it("is independent of insertion order", () => {
    assert.equal(canonicalize({ x: { q: 1, p: 2 }, y: 0 }), canonicalize({ y: 0, x: { p: 2, q: 1 } }));
  });

  it("escapes strings exactly like JSON.stringify", () => {
    const text = 'quote " backslash \\ newline \n tab \t unicode ☃ lone \ud800';
    assert.equal(canonicalize(text), JSON.stringify(text));
  });

  it("accepts safe integers only", () => {
    assert.equal(canonicalize([0, -5, Number.MAX_SAFE_INTEGER]), `[0,-5,${Number.MAX_SAFE_INTEGER}]`);
    for (const invalid of [1.5, -0, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      assertCode(() => canonicalize(invalid), CanonicalJsonErrorCode.UNSUPPORTED_VALUE);
    }
  });

  it("rejects values JSON cannot represent unambiguously", () => {
    for (const invalid of [undefined, () => 1, Symbol("s"), 10n, new Date(0), new Map(), { a: undefined }]) {
      assertCode(() => canonicalize(invalid), CanonicalJsonErrorCode.UNSUPPORTED_VALUE);
    }
  });

  it("rejects prototype-polluting keys", () => {
    assertCode(() => canonicalize(JSON.parse('{"__proto__":{"x":1}}')), CanonicalJsonErrorCode.FORBIDDEN_KEY);
    assertCode(() => canonicalize({ constructor: 1 }), CanonicalJsonErrorCode.FORBIDDEN_KEY);
  });

  it("bounds nesting depth", () => {
    let deep = 0;
    for (let level = 0; level < 20; level += 1) {
      deep = [deep];
    }
    assertCode(() => canonicalize(deep), CanonicalJsonErrorCode.TOO_DEEP);
    assert.doesNotThrow(() => canonicalize(deep, { maxDepth: 32 }));
  });

  it("accepts objects without a prototype", () => {
    const bare = Object.create(null);
    bare.k = 1;
    assert.equal(canonicalize(bare), '{"k":1}');
  });
});

describe("parseCanonical", () => {
  it("round-trips canonical text and returns frozen data", () => {
    const text = '{"a":[1,{"b":null}],"c":"d"}';
    const parsed = parseCanonical(text);
    assert.deepEqual(parsed, { a: [1, { b: null }], c: "d" });
    assert.ok(Object.isFrozen(parsed) && Object.isFrozen(parsed.a) && Object.isFrozen(parsed.a[1]));
  });

  it("rejects every non-canonical spelling of the same value", () => {
    for (const text of ['{"b":1,"a":2}', '{"a": 1}', '{"a":1.0}', '{"a":1e0}', '{"a":1,"a":1}', ' {"a":1}', '{"a":"\\u0061"}', "[1,]"]) {
      assert.throws(() => parseCanonical(text), (error) => ["NOT_CANONICAL", "NOT_JSON"].includes(error.code), text);
    }
  });

  it("rejects oversized input before parsing it", () => {
    assertCode(() => parseCanonical(`"${"x".repeat(100)}"`, { maxBytes: 50 }), CanonicalJsonErrorCode.TOO_LARGE);
    assertCode(() => parseCanonical(`"${"é".repeat(30)}"`, { maxBytes: 50 }), CanonicalJsonErrorCode.TOO_LARGE);
  });

  it("rejects non-strings and invalid JSON", () => {
    assertCode(() => parseCanonical(42), CanonicalJsonErrorCode.NOT_JSON);
    assertCode(() => parseCanonical("{"), CanonicalJsonErrorCode.NOT_JSON);
  });

  it("rejects prototype-polluting keys and unsafe numbers read from text", () => {
    assertCode(() => parseCanonical('{"__proto__":1}'), CanonicalJsonErrorCode.FORBIDDEN_KEY);
    assertCode(() => parseCanonical("9007199254740993"), CanonicalJsonErrorCode.UNSUPPORTED_VALUE);
  });

  it("counts UTF-8 bytes, not characters", () => {
    assert.equal(utf8Length("é☃"), 5);
  });
});

describe("hashing", () => {
  it("taggedHash is SHA-256 over prefix, tag, a zero byte and the data", () => {
    const expected = createHash("sha256").update("m8tcg/v1/event").update(Buffer.from([0])).update("payload").digest("hex");
    assert.equal(taggedHashHex(HashTag.EVENT, utf8("payload")), expected);
  });

  it("separates domains: same data, different tags, different hashes", () => {
    const data = utf8("same");
    const hashes = new Set(Object.values(HashTag).map((tag) => taggedHashHex(tag, data)));
    assert.equal(hashes.size, Object.values(HashTag).length);
  });

  it("concatenates parts in order", () => {
    assert.equal(taggedHashHex(HashTag.SEED, utf8("ab"), utf8("c")), taggedHashHex(HashTag.SEED, utf8("abc")));
    assert.notEqual(taggedHashHex(HashTag.SEED, utf8("ab"), utf8("c")), taggedHashHex(HashTag.SEED, utf8("c"), utf8("ab")));
  });

  it("rejects invalid tags and non-byte parts", () => {
    assert.throws(() => taggedHash("Bad Tag", utf8("x")), TypeError);
    assert.throws(() => taggedHash(HashTag.EVENT, "x"), TypeError);
  });

  it("recognises hashes and computes plain SHA-256", () => {
    assert.equal(isHash("ab".repeat(32)), true);
    assert.equal(isHash("AB".repeat(32)), false);
    assert.equal(isHash("ab".repeat(31)), false);
    assert.equal(sha256Hex(utf8("abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
