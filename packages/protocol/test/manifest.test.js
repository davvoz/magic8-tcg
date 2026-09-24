import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BroadcasterRegistry, OperationId, canonicalize } from "../src/index.js";

const ROOT = "m8tcg";

/**
 * @param {object} payload
 * @param {{ blockNum: number, signer?: string, posting?: boolean, json?: string, opIndex?: number }} options
 */
function manifestOp(payload, { blockNum, signer = ROOT, posting = false, json, opIndex = 0 }) {
  return {
    network: "steem",
    txId: `tx${blockNum}`,
    blockNum,
    opIndex,
    id: OperationId.MANIFEST,
    requiredAuths: posting ? [] : [signer],
    requiredPostingAuths: posting ? [signer] : [],
    json: json ?? canonicalize(payload),
  };
}

const broadcasters = (accounts, fromBlock) => ({ accounts, from_block: fromBlock, kind: "broadcasters", v: 1 });

describe("BroadcasterRegistry", () => {
  it("authorises the listed accounts from the effective block on", () => {
    const { registry } = BroadcasterRegistry.fromOperations([manifestOp(broadcasters(["b1", "b2"], 100), { blockNum: 90 })], ROOT);
    assert.equal(registry.isAuthorized("b1", 99), false);
    assert.equal(registry.isAuthorized("b1", 100), true);
    assert.equal(registry.isAuthorized("b2", 5000), true);
    assert.equal(registry.isAuthorized("b3", 5000), false);
  });

  it("never authorises retroactively: the manifest's own block is the earliest start", () => {
    const { registry } = BroadcasterRegistry.fromOperations([manifestOp(broadcasters(["b1"], 10), { blockNum: 500 })], ROOT);
    assert.equal(registry.isAuthorized("b1", 499), false);
    assert.equal(registry.isAuthorized("b1", 500), true);
  });

  it("revokes a compromised broadcaster by publishing a new list", () => {
    const operations = [manifestOp(broadcasters(["b1", "b2"], 100), { blockNum: 100 }), manifestOp(broadcasters(["b2"], 800), { blockNum: 800 })];
    const { registry } = BroadcasterRegistry.fromOperations([...operations].reverse(), ROOT);
    assert.equal(registry.isAuthorized("b1", 799), true);
    assert.equal(registry.isAuthorized("b1", 800), false);
    assert.equal(registry.isAuthorized("b2", 800), true);
  });

  it("ignores manifests not signed by the root's active authority, and malformed ones", () => {
    const operations = [
      manifestOp(broadcasters(["evil"], 1), { blockNum: 1, signer: "mallory" }),
      manifestOp(broadcasters(["evil"], 1), { blockNum: 1, posting: true }),
      manifestOp({ ...broadcasters(["evil"], 1), extra: 1 }, { blockNum: 1 }),
      manifestOp({}, { blockNum: 1, json: '{"accounts": ["evil"]}' }),
      manifestOp(broadcasters(["evil", "evil"], 1), { blockNum: 1 }),
      manifestOp(broadcasters(["Evil"], 1), { blockNum: 1 }),
      { ...manifestOp(broadcasters(["evil"], 1), { blockNum: 1 }), id: OperationId.GAME },
    ];
    const { registry, rejected } = BroadcasterRegistry.fromOperations(operations, ROOT);
    assert.equal(registry.isAuthorized("evil", 10), false);
    assert.equal(rejected, operations.length - 1, "the op with another id is skipped, not rejected");
  });

  it("exposes a policy function for the decoder", () => {
    const { registry } = BroadcasterRegistry.fromOperations([manifestOp(broadcasters(["b1"], 0), { blockNum: 1 })], ROOT);
    const policy = registry.asPolicy();
    assert.equal(policy("b1", 1), true);
    assert.equal(policy("b1", 0), false);
  });
});
