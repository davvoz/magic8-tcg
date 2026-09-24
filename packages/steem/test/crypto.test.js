/**
 * Keys and signatures against vectors generated with the reference STEEM
 * library (steem-js 0.7.11: PrivateKey.fromSeed, toWif, toPublicKey,
 * Signature.signBuffer — the call Steem Keychain uses for requestSignBuffer).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { base58Decode, base58Encode } from "../src/crypto/base58.js";
import { decodePublicKey, decodeWif, encodePublicKey, publicKeyOf, recoverSigner, signMessage } from "../src/crypto/keys.js";
import { isValidAccountName } from "../src/accountName.js";

const KEYS = Object.freeze([
  {
    wif: "5JUjFuqC7ATzSHv9VznChoTBeHcjc9XNyr46i7EmpHi4zx7Dq2e",
    privateHex: "5749f1bef8b87c0cd5562ceb7b85d3f9523b64429546a857d9ba556591aabb04",
    publicKey: "STM8W6gDS6CM4VJxX82z5BT6weqweLkDMsDDgezzqA3Xt5FWS1XcM",
  },
  {
    wif: "5JsRLwXfieZiSSJizRsf2kdevyx4c6MtncwAzuiU941Jo6sLqn7",
    privateHex: "8acfd732a3493d7a75c866e2470e72f52ff65d1592e244c7f71ca2f8423fc2e7",
    publicKey: "STM8kMBSmfqnJm5HmKDmQybi8ZyUQJLFQpMxwrof5HbZBYfCoayBi",
  },
  {
    wif: "5KYuqjRWzjL4XSKb56fLxCkndrBNhaBbtfqTrcGjGT5iP3bnGYW",
    privateHex: "e47b5398fbd9ea5b3fd39cad4ab84cc72a843080d25e84917991e28624e1c7aa",
    publicKey: "STM6wQ6GTxJPg7wiq2tt7213F6Np5RUnDi5LGc1pH4W5Tpr8tZqUN",
  },
]);

const SIGNATURES = Object.freeze([
  {
    message: "magic8-tcg login\naccount: alice\nnonce: q7Yb2m\norigin: https://play.example\nissued: 2026-09-24T10:00:00.000Z",
    publicKey: "STM8W6gDS6CM4VJxX82z5BT6weqweLkDMsDDgezzqA3Xt5FWS1XcM",
    signature: "2036800710f9bde95c7525e7b853c1a8de5e82b0e8e56351c72ab62d10e348b4fd4af86c2de389975f5aaad1e8c8b0ebd04ae2b49444de3077deb73f4630b034bc",
  },
  {
    message: "hello",
    publicKey: "STM8kMBSmfqnJm5HmKDmQybi8ZyUQJLFQpMxwrof5HbZBYfCoayBi",
    signature: "206b1f5036fe1a465c16138669d07635f23749ee25df094a21f2c2303381ea5a9d21ec7c6089bb9d7e7723b5f382ba5e2c8e6409732c36752f554dde4690fa64ed",
  },
  {
    message: "unicode ☃ é",
    publicKey: "STM6wQ6GTxJPg7wiq2tt7213F6Np5RUnDi5LGc1pH4W5Tpr8tZqUN",
    signature: "1f6085cc543ed0769b120a5427ede08cfeec1506c5acb716e72679482997a4bc050c60b24ea3bdcfbee60e65fd4e398c5e09ca0437e9cb115f47e3d0473523538b",
  },
  {
    message: "",
    publicKey: "STM8W6gDS6CM4VJxX82z5BT6weqweLkDMsDDgezzqA3Xt5FWS1XcM",
    signature: "203e17c73cdd736cbf5e29fe3ea4cf51b94d78aa2adbb3248ea7eaed834fa98b22452f729e13a68bd373942cacb6aa1cc82a86a5563f5c921a1abbff6476d1c9d4",
  },
]);

/** @param {string} hex */
const bytesOf = (hex) => Uint8Array.from(hex.match(/../g), (pair) => Number.parseInt(pair, 16));

describe("base58", () => {
  it("round-trips, keeping leading zero bytes", () => {
    for (const bytes of [new Uint8Array([0, 0, 1, 2, 255]), new Uint8Array([255]), new Uint8Array(0), new Uint8Array([0])]) {
      assert.deepEqual(base58Decode(base58Encode(bytes)) ?? new Uint8Array(0), bytes);
    }
    assert.equal(base58Encode(new TextEncoder().encode("hello world")), "StV1DL6CwTryKyV");
  });

  it("rejects characters outside the alphabet and oversized input", () => {
    for (const invalid of ["0OIl", "abc!", "", "1".repeat(200), 42]) {
      assert.equal(base58Decode(invalid), null, String(invalid));
    }
  });
});

describe("STEEM keys", () => {
  it("derives the same public keys as steem-js", () => {
    for (const key of KEYS) {
      assert.equal(publicKeyOf(bytesOf(key.privateHex)), key.publicKey);
    }
  });

  it("decodes WIF like steem-js and rejects corrupted WIF", () => {
    for (const key of KEYS) {
      assert.deepEqual(decodeWif(key.wif), bytesOf(key.privateHex));
    }
    const corrupted = `${KEYS[0].wif.slice(0, -1)}${KEYS[0].wif.endsWith("e") ? "f" : "e"}`;
    assert.equal(decodeWif(corrupted), null);
    assert.equal(decodeWif(KEYS[0].publicKey), null);
    assert.equal(decodeWif("not a key"), null);
  });

  it("round-trips public keys and rejects bad prefixes, checksums and points", () => {
    for (const key of KEYS) {
      const point = decodePublicKey(key.publicKey);
      assert.equal(point?.length, 33);
      assert.equal(encodePublicKey(point), key.publicKey);
    }
    const valid = KEYS[0].publicKey;
    assert.equal(decodePublicKey(`TST${valid.slice(3)}`), null);
    assert.equal(decodePublicKey(`${valid.slice(0, -1)}${valid.endsWith("M") ? "N" : "M"}`), null);
    assert.equal(decodePublicKey(valid.slice(0, 20)), null);
    assert.equal(decodePublicKey(42), null);
    assert.throws(() => encodePublicKey(new Uint8Array(32)), TypeError);
  });
});

describe("Keychain signatures", () => {
  it("recovers the signing key from steem-js signBuffer signatures", () => {
    for (const vector of SIGNATURES) {
      assert.equal(recoverSigner(vector.message, vector.signature), vector.publicKey, JSON.stringify(vector.message));
    }
  });

  it("recovers a different key when the message or the signature changes", () => {
    const [vector] = SIGNATURES;
    assert.notEqual(recoverSigner(`${vector.message} `, vector.signature), vector.publicKey);
    const flipped = vector.signature.slice(0, 40) + (vector.signature[40] === "0" ? "1" : "0") + vector.signature.slice(41);
    assert.notEqual(recoverSigner(vector.message, flipped), vector.publicKey);
  });

  it("rejects malformed signatures", () => {
    const [vector] = SIGNATURES;
    for (const invalid of ["", vector.signature.slice(2), vector.signature.toUpperCase(), `00${vector.signature.slice(2)}`, `ff${vector.signature.slice(2)}`, "zz".repeat(65), 42]) {
      assert.equal(recoverSigner(vector.message, invalid), null, String(invalid).slice(0, 12));
    }
    assert.equal(recoverSigner(42, vector.signature), null);
  });

  it("signs in the same format steem-js verifies (header, r, s)", () => {
    for (const key of KEYS) {
      const signature = signMessage("magic8", bytesOf(key.privateHex));
      assert.match(signature, /^(1f|20)[0-9a-f]{128}$/);
      assert.equal(recoverSigner("magic8", signature), key.publicKey);
    }
  });
});

describe("account names", () => {
  it("accepts valid STEEM names", () => {
    for (const name of ["abc", "alice", "bob.cards", "a-1b", "cur8", "m8tcg.b1x", "abcdefghijklmnop"]) {
      assert.equal(isValidAccountName(name), true, name);
    }
  });

  it("rejects everything else", () => {
    for (const name of ["ab", "abcdefghijklmnopq", "Alice", "1abc", "abc-", "ab.cde", "abc..def", ".abc", "abc.", "a_bc", "abc def", "", null, 42, "abc.de"]) {
      assert.equal(isValidAccountName(name), false, String(name));
    }
  });
});
