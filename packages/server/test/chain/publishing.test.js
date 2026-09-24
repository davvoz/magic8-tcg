/**
 * Publishing on chain against a fake STEEM node that checks transactions
 * like a real one (TaPoS, expiration, canonical posting signatures), through
 * the real SteemTransactionProvider and SteemPublicationReader: the
 * broadcaster (persist first, one operation per account per round, game
 * partitions), the tracker (inclusion, irreversibility, micro-forks,
 * expiry and rebroadcast of the same bytes, unknown and conflicting
 * operations), the Resource Credits monitor — and a finished game that
 * verifies VALID from what the chain holds.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createCoreCommandRegistry } from "@magic8/engine/domain/commands/registerCoreCommands.js";
import { createCoreEffectRegistry } from "@magic8/engine/domain/effects/registerCoreEffects.js";
import { OperationId, Verdict, canonicalize, verifyGame } from "@magic8/protocol";
import { SignerError } from "@magic8/steem";
import { uuidV4 } from "../../src/kernel/random.js";
import { ResourceMode, signerFor } from "../../src/modules/chain/index.js";
import { buildTestApp, deterministicRandom, toWif } from "../helpers.js";
import { FakeSteemLedger } from "../support/fakeSteemLedger.js";

const B1 = "m8tcg-b1";
const B2 = "m8tcg-b2";
const KEYS = Object.freeze({ [B1]: new Uint8Array(32).fill(21), [B2]: new Uint8Array(32).fill(22) });
const ENTROPY = Object.freeze({ s0: "0a".repeat(16), s1: "0b".repeat(16) });

async function world({ signers = [B1, B2], rcPolicy = {} } = {}) {
  const ledger = new FakeSteemLedger();
  for (const name of signers) {
    ledger.addAccount(name, KEYS[name]);
  }
  const publishing = ledger.publishing(new Map(signers.map((name) => [name, toWif(KEYS[name])])));
  const setup = await buildTestApp({ ledger, publishing, chainPolicies: { rc: rcPolicy } });
  const { chain } = setup.app;
  const content = setup.app.catalog.current().content;
  const deck = (id) => content.preconDecks.find((candidate) => candidate.id === id).entries;
  const user = async (account) => {
    const found = await setup.users.findOrCreate({ network: "steem", account }, setup.clock.now(), uuidV4(deterministicRandom(`user:${account}`)));
    setup.app.hub.attach(found.id, { send: () => undefined, close: () => undefined });
    return found;
  };
  const alice = await user("alice");
  const bob = await user("bob");
  const newGame = async () => {
    const gameId = await setup.app.games.createGame({ entrants: [{ userId: alice.id, account: "alice", deckId: null, deck: deck("precon_foundry") }, { userId: bob.id, account: "bob", deckId: null, deck: deck("precon_harvest") }] });
    await setup.app.games.entropy(alice.id, gameId, ENTROPY.s0);
    await setup.app.games.entropy(bob.id, gameId, ENTROPY.s1);
    return gameId;
  };
  return { ledger, setup, chain, alice, bob, newGame, publishing };
}

/** The awaited player passes once (no attack, end phase or turn). */
async function pass(w, gameId, label) {
  const view = await w.setup.app.games.view(w.alice.id, gameId);
  const player = view.snapshot.awaitingPlayerId === "s0" ? w.alice : w.bob;
  const own = await w.setup.app.games.view(player.id, gameId);
  let command = { type: own.snapshot.legalMoves.canEndTurn ? "END_TURN" : "END_PHASE" };
  if (own.snapshot.phase === "COMBAT_ATTACKERS") {
    command = { type: "DECLARE_ATTACKERS", attackerIds: [] };
  }
  const ack = await w.setup.app.games.command(player.id, { gameId, commandId: uuidV4(deterministicRandom(label)), expectedVersion: own.version, command });
  assert.equal(ack.ok, true);
}

const rowsOf = (w, gameId) => w.setup.database.rows("SELECT record_seq, status, reconciliation, attempts, payload, transaction_id FROM blockchain_events WHERE game_id = $1 ORDER BY record_seq", [gameId]);
const transactions = (w) => w.setup.database.rows("SELECT tx_id, signer, status, block_num, last_error FROM blockchain_transactions ORDER BY created_at, id");
const alerts = (w) => w.setup.database.rows("SELECT kind, fingerprint, details FROM chain_alerts ORDER BY id");

/** Every custom_json the chain holds, as a verifier reading blocks would see it. */
async function chainOperations(w) {
  const operations = [];
  for (const blockNum of [...w.ledger.blocks.keys()].sort((left, right) => left - right)) {
    operations.push(...((await w.publishing.reader.blockOperations(blockNum)) ?? []));
  }
  return operations;
}

describe("ChainBroadcaster and ChainTracker", () => {
  it("publishes a game's records, follows them to irreversibility, and the game verifies VALID from the chain alone", async () => {
    const w = await world();
    const gameId = await w.newGame();
    const signer = signerFor({ gameId, orderId: null, kind: "GAME_RECORD" }, [B1, B2]);

    assert.equal(await w.chain.broadcaster.runOnce(), 1);
    let [row] = await rowsOf(w, gameId);
    assert.equal(row.status, "BROADCAST", "persisted before the node sees it");
    const [tx] = await transactions(w);
    assert.equal(tx.signer, signer);
    assert.equal(w.ledger.mempool.length, 1);
    assert.equal(await w.chain.broadcaster.runOnce(), 0, "nothing else to send");

    w.ledger.produceBlock();
    await w.chain.tracker.runOnce();
    [row] = await rowsOf(w, gameId);
    assert.deepEqual([row.status, row.reconciliation], ["INCLUDED", "MATCH"]);
    w.ledger.finalize();
    await w.chain.tracker.runOnce();
    [row] = await rowsOf(w, gameId);
    assert.equal(row.status, "IRREVERSIBLE");
    assert.equal((await transactions(w))[0].status, "IRREVERSIBLE");

    // A few turns and a concession: every record reaches the chain.
    for (let step = 0; step < 12; step += 1) {
      await pass(w, gameId, `pass-${step}`);
    }
    const concede = await w.setup.app.games.concede(w.alice.id, { gameId, commandId: uuidV4(deterministicRandom("concede")) });
    assert.equal(concede.ok, true);
    for (let round = 0; round < 4; round += 1) {
      await w.chain.broadcaster.runOnce();
      w.ledger.produceBlock();
    }
    w.ledger.finalize();
    await w.chain.tracker.runOnce();
    const rows = await rowsOf(w, gameId);
    assert.ok(rows.length >= 3, `${rows.length} records`);
    assert.ok(rows.every((candidate) => candidate.status === "IRREVERSIBLE"));
    assert.deepEqual(await alerts(w), []);

    const current = w.setup.app.catalog.current();
    const verdict = verifyGame({
      gameId,
      operations: await chainOperations(w),
      isAuthorizedBroadcaster: (account) => account === B1 || account === B2,
      resolveContent: (hash, version) => (hash === current.hash && version === current.engineVersion ? { rules: current.content.gameRules, catalog: current.content.catalog, effects: createCoreEffectRegistry(), createCommands: createCoreCommandRegistry } : null),
    });
    assert.equal(verdict.verdict, Verdict.VALID, JSON.stringify(verdict.history.status));
  });

  it("sends a record again, byte for byte, when its transaction expired unseen; an ambiguous broadcast error changes nothing", async () => {
    const w = await world({ signers: [B1] });
    const gameId = await w.newGame();
    w.ledger.loseBroadcasts = true;
    await w.chain.broadcaster.runOnce();
    const [lost] = await transactions(w);
    w.ledger.produceBlocks(10);
    w.ledger.finalize();
    await w.chain.tracker.runOnce();
    assert.equal((await rowsOf(w, gameId))[0].status, "BROADCAST", "not expired while the expiration is ahead of the irreversible block");

    w.ledger.produceBlocks(20);
    w.ledger.finalize();
    await w.chain.tracker.runOnce();
    let [row] = await rowsOf(w, gameId);
    assert.deepEqual([row.status, row.reconciliation, row.transaction_id], ["BUILT", "MISSING_ON_CHAIN", null]);
    assert.equal((await transactions(w))[0].status, "EXPIRED");

    w.ledger.loseBroadcasts = false;
    w.ledger.failBroadcasts = "relayed";
    await w.chain.broadcaster.runOnce();
    const retried = (await transactions(w)).find((candidate) => candidate.status === "BROADCAST");
    assert.notEqual(retried.tx_id, lost.tx_id, "a new transaction");
    assert.match(retried.last_error, /timeout after relaying/);
    w.ledger.produceBlock();
    await w.chain.tracker.runOnce();
    [row] = await rowsOf(w, gameId);
    assert.deepEqual([row.status, row.attempts], ["INCLUDED", 2]);
    const onChain = (await chainOperations(w)).find((operation) => operation.txId === retried.tx_id);
    assert.equal(onChain.json, `{"r":[${row.payload}],"v":1}`, "the same record bytes");
  });

  it("puts a transaction dropped by a micro-fork back in flight, and alerts after repeated attempts", async () => {
    const w = await world({ signers: [B1] });
    const gameId = await w.newGame();
    await w.chain.broadcaster.runOnce();
    w.ledger.produceBlock();
    await w.chain.tracker.runOnce();
    const [tx] = await transactions(w);
    assert.equal(tx.status, "INCLUDED");
    w.ledger.drop(tx.tx_id);
    w.ledger.finalize();
    await w.chain.tracker.runOnce();
    assert.deepEqual([(await transactions(w))[0].status, (await rowsOf(w, gameId))[0].status], ["BROADCAST", "BROADCAST"]);

    w.ledger.loseBroadcasts = true;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      w.ledger.produceBlocks(30);
      w.ledger.finalize();
      await w.chain.tracker.runOnce();
      await w.chain.broadcaster.runOnce();
    }
    const [row] = await rowsOf(w, gameId);
    assert.ok(row.attempts >= 5);
    assert.ok((await alerts(w)).some((alert) => alert.kind === "REPEATED_REBROADCAST"));
  });

  it("raises an alert for an operation signed by our broadcaster that the database does not know, and for a conflicting record", async () => {
    const w = await world({ signers: [B1] });
    const gameId = await w.newGame();
    await w.chain.broadcaster.runOnce();
    w.ledger.produceBlock();
    await w.chain.tracker.runOnce();
    const [ours] = await rowsOf(w, gameId);

    // Someone holding the broadcaster's key publishes behind the server's back.
    const forged = JSON.parse(ours.payload);
    forged.ts += 1;
    const reference = await w.publishing.transactions.reference();
    const signed = w.publishing.transactions.signCustomJson({ reference, signer: B1, id: OperationId.GAME, json: canonicalize({ r: [forged], v: 1 }) });
    await w.publishing.transactions.broadcast(signed.transaction);
    w.ledger.produceBlock();
    await w.chain.tracker.runOnce();
    await w.chain.tracker.runOnce();
    const found = await alerts(w);
    assert.deepEqual(found.map((alert) => alert.kind).sort(), ["CONFLICT", "UNKNOWN_ON_CHAIN"], "raised once each");
    assert.equal((await rowsOf(w, gameId))[0].reconciliation, "CONFLICT");
    assert.equal(found.find((alert) => alert.kind === "UNKNOWN_ON_CHAIN").details.txId, signed.txId);
  });

  it("batches more when Resource Credits run low and pauses a broadcaster that runs out, without stopping games", async () => {
    const w = await world({ signers: [B1] });
    w.ledger.setResourceCredits(B1, 1000);
    await w.chain.rc.runOnce();
    assert.equal(w.chain.rc.modeOf(B1), ResourceMode.SLOW);
    const gameId = await w.newGame();
    let sent = 0;
    for (let round = 0; round < 10; round += 1) {
      sent += await w.chain.broadcaster.runOnce();
    }
    assert.equal(sent, 1, "game records leave once every ten rounds");

    w.ledger.setResourceCredits(B1, 300);
    await w.chain.rc.runOnce();
    assert.equal(w.chain.rc.modeOf(B1), ResourceMode.PAUSED);
    assert.deepEqual((await alerts(w)).map((alert) => alert.kind), ["RC_CRITICAL"]);
    await pass(w, gameId, "while-paused");
    for (let step = 0; step < 6; step += 1) {
      await pass(w, gameId, `paused-${step}`);
    }
    for (let round = 0; round < 12; round += 1) {
      assert.equal(await w.chain.broadcaster.runOnce(), 0);
    }
    const waiting = (await rowsOf(w, gameId)).filter((row) => row.status === "BUILT");
    assert.ok(waiting.length > 0, "the records wait in the outbox");

    w.ledger.setResourceCredits(B1, 9000);
    await w.chain.rc.runOnce();
    assert.equal(await w.chain.broadcaster.runOnce(), 1, "back to normal: one envelope carries the waiting records");
    assert.ok((await rowsOf(w, gameId)).every((row) => row.status !== "BUILT"));
  });

  it("partitions records by game over the pool, stably", () => {
    const counts = new Map();
    for (let index = 0; index < 200; index += 1) {
      const row = { gameId: `game-${index}`, orderId: null, kind: "GAME_RECORD" };
      const signer = signerFor(row, [B1, B2]);
      assert.equal(signerFor(row, [B1, B2]), signer);
      counts.set(signer, (counts.get(signer) ?? 0) + 1);
    }
    assert.ok(counts.get(B1) > 60 && counts.get(B2) > 60, JSON.stringify([...counts]));
  });

  it("refuses to start with a broadcaster key that also controls the active authority", async () => {
    const ledger = new FakeSteemLedger();
    ledger.addAccount(B1, KEYS[B1], { active: true });
    await assert.rejects(() => ledger.publishing(new Map([[B1, toWif(KEYS[B1])]])).transactions.verifySigners(), SignerError);
    ledger.addAccount(B1, KEYS[B1]);
    await ledger.publishing(new Map([[B1, toWif(KEYS[B1])]])).transactions.verifySigners();
  });
});
