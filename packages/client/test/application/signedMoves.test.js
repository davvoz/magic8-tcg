/**
 * Signed moves on the client (game protocol v2, docs/tcg/12): on a match
 * the browser makes a key that cannot be exported, the wallet authorises it
 * with the account's posting key, and every command leaves signed; a page
 * that lost its key authorises a new one; without an authorised key no move
 * is sent. Real WebCrypto and secp256k1.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fail, ok } from "@magic8/engine/shared/Result.js";
import { moveMessage, sessionAuthorization } from "@magic8/protocol";
import { publicKeyOf, recoverSigner, signMessage, verifySessionSignature } from "@magic8/steem";
import { OnlineService } from "../../src/application/online/OnlineService.js";
import { WebCryptoSessionKeys } from "../../src/infrastructure/crypto/webSessionKeys.js";
import { MemoryLogger } from "../../src/infrastructure/logging/MemoryLogger.js";

const flush = async () => {
  for (let round = 0; round < 5; round += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};
const GAME = "01j8x3r6h2qkq4w0v7m5a9c1dz";
const POSTING = new Uint8Array(32).fill(0x21);
const VIEW = (overrides = {}) => ({ gameId: GAME, seat: "s0", status: "ACTIVE", protocol: 2, opponent: { account: "bob" }, version: 7, snapshot: { version: 7, isOver: false }, ...overrides });

function world({ approve = true } = {}) {
  const statusListeners = new Set();
  const listeners = new Set();
  const requests = [];
  const connection = {
    connect: () => statusListeners.forEach((listener) => listener("open", { code: null })),
    close: () => undefined,
    request: async (t, d) => {
      requests.push({ t, d });
      if (t === "hello") {
        return ok({ t: "welcome", d: { user: { account: "alice" }, serverTime: 0, activeGame: null, queue: { state: "idle" } } });
      }
      if (t === "game.command") {
        return ok({ t: "game.ack", d: { commandId: d.commandId, ok: true, version: d.expectedVersion + 1 } });
      }
      return ok({ t, d: { gameId: d.gameId } });
    },
    subscribe: (listener) => (listeners.add(listener), () => listeners.delete(listener)),
    onStatus: (listener) => (statusListeners.add(listener), () => statusListeners.delete(listener)),
  };
  const prompts = [];
  const wallet = {
    signMessage: async ({ account, message, keyRole }) => {
      prompts.push({ account, message, keyRole });
      return approve ? ok(signMessage(message, POSTING)) : fail("WALLET_REJECTED", "the user said no");
    },
  };
  let ids = 0;
  const online = new OnlineService({
    connection,
    randomHex: (bytes) => "cd".repeat(bytes),
    newCommandId: () => `00000000-0000-4000-8000-${String((ids += 1)).padStart(12, "0")}`,
    accountDecks: () => [],
    sessionKeys: new WebCryptoSessionKeys({ subtle: globalThis.crypto.subtle }),
    wallet,
    logger: new MemoryLogger(),
  });
  online.start();
  return { online, requests, prompts, push: (t, d) => listeners.forEach((listener) => listener({ t, d })) };
}

describe("signed moves on the client", () => {
  it("authorises a session key when matched, then signs every command with it", async () => {
    const { online, requests, prompts, push } = world();
    await flush();
    push("match.found", { gameId: GAME, seat: "s0", opponent: { account: "bob" }, seedCommit: "ef".repeat(32), protocol: 2 });
    await flush();
    const grant = requests.find((request) => request.t === "game.session").d;
    assert.match(grant.key, /^04[0-9a-f]{128}$/);
    assert.deepEqual(prompts, [{ account: "alice", message: sessionAuthorization(GAME, grant.key), keyRole: "Posting" }], "one Keychain prompt, with the key in plain sight");
    assert.equal(recoverSigner(sessionAuthorization(GAME, grant.key), grant.authorization), publicKeyOf(POSTING));

    push("game.events", VIEW());
    await flush();
    assert.equal(requests.filter((request) => request.t === "game.session").length, 1, "the key is kept for the game");
    assert.equal((await online.state.session.submit({ type: "END_PHASE", playerId: "s0" })).ok, true);
    const sent = requests.findLast((request) => request.t === "game.command").d;
    assert.deepEqual(sent.command, { type: "END_PHASE" });
    const message = moveMessage({ gameId: GAME, commandId: sent.commandId, expectedVersion: 7, command: { type: "END_PHASE" } });
    assert.equal(verifySessionSignature(message, sent.signature, grant.key), true);
  });

  it("authorises a new key for a game in progress after a reload, and sends nothing it cannot sign", async () => {
    const { requests, prompts, push } = world();
    await flush();
    push("game.events", VIEW({ version: 12 }));
    await flush();
    assert.equal(prompts.length, 1, "the reloaded page asked for a new key");
    assert.equal(requests.filter((request) => request.t === "game.session").length, 1);

    const refused = world({ approve: false });
    await flush();
    refused.push("game.events", VIEW());
    await flush();
    assert.equal(refused.online.state.error.code, "SESSION_REFUSED");
    const attempt = await refused.online.state.session.submit({ type: "END_PHASE" });
    assert.equal(attempt.error.code, "SESSION_REQUIRED");
    assert.equal(refused.requests.some((request) => request.t === "game.command"), false);
  });

  it("does not sign v1 games", async () => {
    const { online, requests, prompts, push } = world();
    await flush();
    push("game.events", VIEW({ protocol: 1 }));
    await flush();
    assert.equal(prompts.length, 0);
    assert.equal((await online.state.session.submit({ type: "END_PHASE" })).ok, true);
    assert.equal(requests.findLast((request) => request.t === "game.command").d.signature, undefined);
  });
});
