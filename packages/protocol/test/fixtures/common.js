/**
 * Shared test values: a game id, a broadcaster, deterministic hex, and chain
 * operations as a chain adapter would produce them.
 */
import { createHash } from "node:crypto";

import { OperationId } from "../../src/index.js";

export const GAME_ID = "01j8x3r6h2qkq4w0v7m5a9c1dz";
export const BROADCASTER = "m8tcg.b1";
export const ACCOUNTS = Object.freeze(["alice", "bob.cards"]);
export const NETWORK = "steem";

/** @param {string} label */
export function testHex(label, bytes = 32) {
  return createHash("sha256").update(label).digest("hex").slice(0, bytes * 2);
}

/**
 * @param {string} json
 * @param {{ blockNum: number, txId: string, signer?: string, id?: string, requiredAuths?: string[] }} options
 */
export function operation(json, { blockNum, txId, signer = BROADCASTER, id = OperationId.MANIFEST, requiredAuths = [] }) {
  return Object.freeze({ network: NETWORK, txId, blockNum, opIndex: 0, id, requiredAuths, requiredPostingAuths: [signer], json });
}
