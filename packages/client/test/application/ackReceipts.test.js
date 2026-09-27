/**
 * Signed acks on the client: every accepted move's ack is checked against
 * the key the server announced and kept for the verifier page; one that
 * does not verify is reported at once. Real secp256k1 signatures.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ok } from "@magic8/engine/shared/Result.js";
import { ackMessage } from "@magic8/protocol";
import { publicKeyOf, signMessage } from "@magic8/steem";
import { AckReceipts, RECEIPTS_INDEX_KEY, receiptsKey } from "../../src/application/online/AckReceipts.js";
import { OnlineService } from "../../src/application/online/OnlineService.js";
import { MemoryLogger } from "../../src/infrastructure/logging/MemoryLogger.js";
import { verifySignedAck as verify } from "../../src/infrastructure/crypto/ackVerifier.js";
import { InMemoryStore } from "../../src/infrastructure/persistence/InMemoryStore.js";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const SERVER_KEY = new Uint8Array(32).fill(0x42);
const OTHER_KEY = new Uint8Array(32).fill(0x43);
const GAME = "01j8x3r6h2qkq4w0v7m5a9c1dz";

/** The server's ack for a command, signed with `privateKey`. */
function signedAck(commandId, { privateKey = SERVER_KEY, seq = 5, gameId = GAME } = {}) {
  const fields = { commandId, version: seq + 2, head: "ab".repeat(32), seq, at: 1_790_000_000_000, key: publicKeyOf(privateKey) };
  return { ok: true, ...fields, sig: signMessage(ackMessage({ gameId, ...fields }), privateKey) };
}

const commandId = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("AckReceipts", () => {
  it("keeps verified acks per game, once, and forgets the oldest games", () => {
    const store = new InMemoryStore();
    const receipts = new AckReceipts({ store, verify, logger: new MemoryLogger() });
    const key = publicKeyOf(SERVER_KEY);
    assert.equal(receipts.keep(GAME, signedAck(commandId(1)), key), true);
    assert.equal(receipts.keep(GAME, signedAck(commandId(1)), key), true, "a repeated ack is kept once");
    assert.deepEqual(receipts.forGame(GAME).map((ack) => [ack.gameId, ack.commandId, ack.ok]), [[GAME, commandId(1), undefined]]);
    assert.equal(JSON.parse(store.read(receiptsKey(GAME)).value).length, 1, "stored per game");

    const games = Array.from({ length: 21 }, (_, index) => `01j8x3r6h2qkq4w0v7m5a9c${String(index).padStart(3, "0")}`.replace(/[ilou]/g, "0"));
    games.forEach((gameId, index) => receipts.keep(gameId, signedAck(commandId(100 + index), { gameId }), key));
    const index = JSON.parse(store.read(RECEIPTS_INDEX_KEY).value);
    assert.equal(index.length, 20);
    assert.equal(receipts.forGame(GAME).length, 0, "the oldest game is dropped");
  });

  it("refuses an unsigned ack, a forged one, and one signed by a key the server did not announce", () => {
    const receipts = new AckReceipts({ store: new InMemoryStore(), verify, logger: new MemoryLogger() });
    const key = publicKeyOf(SERVER_KEY);
    const unsigned = signedAck(commandId(2));
    delete unsigned.sig;
    assert.equal(receipts.keep(GAME, unsigned, key), false);
    assert.equal(receipts.keep(GAME, { ...signedAck(commandId(3)), head: "cd".repeat(32) }, key), false, "a changed field breaks the signature");
    assert.equal(receipts.keep(GAME, signedAck(commandId(4), { privateKey: OTHER_KEY }), key), false, "validly signed, but not by the server's key");
    assert.equal(receipts.forGame(GAME).length, 0);
  });
});

describe("OnlineService with signed acks", () => {
  it("checks each accepted move's ack against the announced key, and says when one does not verify", async () => {
    const statusListeners = new Set();
    const listeners = new Set();
    let reply = signedAck(commandId(1));
    const connection = {
      connect: () => statusListeners.forEach((listener) => listener("open", { code: null })),
      close: () => undefined,
      request: async (t, d) => {
        if (t === "hello") {
          return ok({ t: "welcome", d: { user: {}, serverTime: 0, activeGame: null, queue: { state: "idle" }, ackKey: publicKeyOf(SERVER_KEY) } });
        }
        return ok(t === "game.command" ? { t: "game.ack", d: { ...reply, commandId: d.commandId } } : { t: "ok", d: {} });
      },
      subscribe: (listener) => (listeners.add(listener), () => listeners.delete(listener)),
      onStatus: (listener) => (statusListeners.add(listener), () => statusListeners.delete(listener)),
    };
    let ids = 0;
    const receipts = new AckReceipts({ store: new InMemoryStore(), verify, logger: new MemoryLogger() });
    const online = new OnlineService({ connection, randomHex: (bytes) => "cd".repeat(bytes), newCommandId: () => commandId((ids += 1)), accountDecks: () => [], receipts, logger: new MemoryLogger() });
    online.start();
    await flush();
    listeners.forEach((listener) => listener({ t: "game.events", d: { gameId: GAME, seat: "s0", status: "ACTIVE", opponent: { account: "bob" }, version: 3, snapshot: { version: 3, isOver: false } } }));
    const session = online.state.session;

    // The server signs over the command id the client chose: sign the reply for it.
    reply = signedAck(commandId(1));
    assert.equal((await session.submit({ type: "END_PHASE" })).ok, true);
    assert.equal(receipts.forGame(GAME).length, 1);
    assert.equal(online.state.error, null);

    reply = signedAck(commandId(2), { privateKey: OTHER_KEY });
    assert.equal((await session.submit({ type: "END_PHASE" })).ok, true, "the move stands: the server is the authority");
    assert.equal(online.state.error.code, "BAD_ACK");
    assert.equal(receipts.forGame(GAME).length, 1);
  });
});
