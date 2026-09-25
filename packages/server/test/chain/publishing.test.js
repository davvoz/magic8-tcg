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
import { AckStatus, OperationId, PackVerdict, Verdict, ackKeysManifest, ackMessage, broadcastersManifest, canonicalize, verifyGame, verifyOrderOnChain } from "@magic8/protocol";
import { SignerError, recoverSigner } from "@magic8/steem";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { uuidV4 } from "../../src/kernel/random.js";
import { ResourceMode, signerFor } from "../../src/modules/chain/index.js";
import { ACK_KEYS, buildTestApp, deterministicRandom, keyPair, listen, testAckSigner, toWif } from "../helpers.js";
import { grantFor, sessionKey, signedCommand } from "../support/sessionKeys.js";
import { verifyCommand } from "../../../../tools/verify-game.js";
import { verifyOrderCommand } from "../../../../tools/verify-order.js";
import { ApiClient } from "../support/apiClient.js";
import { FakeSteemLedger } from "../support/fakeSteemLedger.js";

const ROOT = "m8tcg";
const B1 = "m8tcg-b1";
const B2 = "m8tcg-b2";
const KEYS = Object.freeze({ [B1]: new Uint8Array(32).fill(21), [B2]: new Uint8Array(32).fill(22) });
const ENTROPY = Object.freeze({ s0: "0a".repeat(16), s1: "0b".repeat(16) });

async function world({ signers = [B1, B2], rcPolicy = {}, authorize = true, signedMoves = false } = {}) {
  const ledger = new FakeSteemLedger();
  for (const name of signers) {
    ledger.addAccount(name, KEYS[name]);
  }
  const publishing = ledger.publishing(new Map(signers.map((name) => [name, toWif(KEYS[name])])));
  const setup = await buildTestApp({ ledger, publishing, chainPolicies: { rc: rcPolicy }, env: { M8_ROOT_ACCOUNT: ROOT }, signedMoves });
  const { chain } = setup.app;
  if (authorize) {
    ledger.publishManifest(ROOT, broadcastersManifest({ accounts: signers, fromBlock: 0 }));
    ledger.produceBlock();
    ledger.finalize();
    await chain.manifests.runOnce();
  }
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
  return ack;
}

/** An ack as a player keeps it: the wire ack, named by its game. */
const kept = (gameId, ack) => {
  const copy = { gameId, ...ack };
  delete copy.ok;
  return copy;
};

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

    // The server verifies the game from the chain alone, as a player would.
    const verified = await w.setup.app.verification.verify(gameId);
    assert.equal(verified.verdict, Verdict.VALID, JSON.stringify(verified).slice(0, 600));
    assert.deepEqual(verified.broadcasters, [B1, B2]);
    assert.equal(verified.content.verified, true, "content fetched by hash and checked");
    assert.equal(verified.replay.outcome.winner, "s1", "alice (s0) conceded");
    const server = await listen(w.setup.app);
    try {
      const index = await new ApiClient(server.base).get(`/api/games/${gameId}/chain`);
      assert.equal(index.status, 200);
      assert.equal(index.json.rootAccount, ROOT);
      assert.deepEqual(index.json.records.map((record) => record.status), rows.map(() => "IRREVERSIBLE"));
      assert.ok(index.json.blocks.length > 0);
      const remote = await new ApiClient(server.base).get(`/api/games/${gameId}/verification`);
      assert.equal(remote.json.verdict, Verdict.VALID);
      assert.equal((await new ApiClient(server.base).get(`/api/games/${"0".repeat(26)}/chain`)).status, 404);

      // The command-line verifier, with the server as an index, then scanning the chain without one.
      for (const extra of [["--server", server.base], ["--scan", "--server", server.base]]) {
        let output = "";
        const code = await verifyCommand([gameId, "--root", ROOT, ...extra], { reader: w.publishing.reader, write: (text) => (output += text) });
        assert.equal(code, 0, output);
        assert.match(output, /VERDICT: VALID/);
        assert.match(output, /content [0-9a-f]{64} \(engine [^)]+\): downloaded and checked/);
      }
      let wrongRoot = "";
      assert.equal(await verifyCommand([gameId, "--root", "someone", "--server", server.base], { reader: w.publishing.reader, write: (text) => (wrongRoot += text) }), 1, "another root authorises nobody");
      assert.match(wrongRoot, /the server names @m8tcg as root; verifying against @someone/);
      assert.equal((await new ApiClient(server.base).get("/api/games/not-a-game/verification")).status, 404);
    } finally {
      await server.close();
    }

    const current = w.setup.app.catalog.current();
    const verdict = verifyGame({
      gameId,
      operations: await chainOperations(w),
      isAuthorizedBroadcaster: (account) => account === B1 || account === B2,
      resolveContent: (hash, version) => (hash === current.hash && version === current.engineVersion ? { rules: current.content.gameRules, catalog: current.content.catalog, effects: createCoreEffectRegistry(), createCommands: createCoreCommandRegistry } : null),
    });
    assert.equal(verdict.verdict, Verdict.VALID, JSON.stringify(verdict.history.status));
  });

  it("signs every accepted command's ack; the chain later agrees with the acks, or they prove it wrong", async () => {
    const w = await world();
    assert.equal(w.chain.manifests.ackKeyAuthorized, false, "no ack_keys manifest yet");
    assert.ok(w.setup.logger.entries.some((entry) => entry.message.startsWith("the ack key is not named")));
    w.ledger.publishManifest(ROOT, ackKeysManifest({ keys: [ACK_KEYS.publicKey], fromBlock: 0 }));
    w.ledger.produceBlock();
    w.ledger.finalize();
    await w.chain.manifests.runOnce();
    assert.equal(w.chain.manifests.ackKeyAuthorized, true);

    const gameId = await w.newGame();
    const acks = [];
    for (let step = 0; step < 6; step += 1) {
      acks.push(kept(gameId, await pass(w, gameId, `acked-${step}`)));
    }
    const first = acks[0];
    assert.equal(first.key, ACK_KEYS.publicKey);
    assert.equal(recoverSigner(ackMessage(first), first.sig), ACK_KEYS.publicKey, "a Keychain-style signature by the ack key");
    const [event] = await w.setup.database.rows("SELECT head FROM game_events WHERE game_id = $1 AND seq = $2", [gameId, first.seq]);
    assert.equal(event.head, first.head, "the ack names the event the command produced");
    const again = await w.setup.app.games.command(w.alice.id, { gameId, commandId: first.commandId, expectedVersion: 0, command: { type: "END_TURN" } });
    assert.deepEqual(kept(gameId, again), first, "a re-sent command gets the same signed ack");
    const refused = await w.setup.app.games.command(w.alice.id, { gameId, commandId: uuidV4(deterministicRandom("stale")), expectedVersion: 0, command: { type: "END_TURN" } });
    assert.deepEqual([refused.ok, refused.sig], [false, undefined], "only accepted commands are signed");
    const concede = await w.setup.app.games.concede(w.alice.id, { gameId, commandId: uuidV4(deterministicRandom("acked-concede")) });
    acks.push(kept(gameId, concede));
    for (let round = 0; round < 4; round += 1) {
      await w.chain.broadcaster.runOnce();
      w.ledger.produceBlock();
    }
    w.ledger.finalize();

    // What an equivocating server would have signed: another head for an event, and an event the game never had.
    const forge = (fields) => ({ ...fields, sig: testAckSigner.sign(ackMessage(fields)) });
    const unsigned = { ...acks[2] };
    delete unsigned.sig;
    const divergent = forge({ ...unsigned, head: "ee".repeat(32) });
    const omitted = forge({ ...unsigned, seq: acks.at(-1).seq + 5 });
    const directory = await mkdtemp(join(tmpdir(), "m8-acks-"));
    const server = await listen(w.setup.app);
    const run = async (list) => {
      const file = join(directory, `acks-${list.length}.json`);
      await writeFile(file, JSON.stringify(list));
      let output = "";
      const code = await verifyCommand([gameId, "--root", ROOT, "--scan", "--server", server.base, "--acks", file], { reader: w.publishing.reader, write: (text) => (output += text) });
      return { code, output };
    };
    try {
      const honest = await run(acks);
      assert.equal(honest.code, 0, honest.output);
      assert.equal(honest.output.match(new RegExp(AckStatus.CONSISTENT, "g"))?.length, acks.length, honest.output);
      const caught = await run([...acks, divergent, omitted]);
      assert.equal(caught.code, 1, "a VALID game that contradicts a signed ack still fails");
      assert.match(caught.output, /VERDICT: VALID/);
      assert.match(caught.output, /DIVERGENT — PROOF: the published game differs/);
      assert.match(caught.output, /OMITTED — PROOF: the published game ended without/);
    } finally {
      await server.close();
    }
  });

  it("publishes a game with signed moves that verifies VALID, with each session key authorised by its player's account", async () => {
    const w = await world({ signedMoves: true });
    const players = [[w.alice, "alice", keyPair(31)], [w.bob, "bob", keyPair(32)]];
    const sessions = new Map();
    const gameId = await w.newGame();
    for (const [user, account, keys] of players) {
      w.setup.chain.setAccount(account, [keys.publicKey]); // what the server's wallet reads
      w.ledger.addAccount(account, keys.privateKey); // what a verifier reads
      sessions.set(user.id, sessionKey());
      assert.equal((await w.setup.app.games.session(user.id, grantFor(gameId, sessions.get(user.id), keys.privateKey))).ok, true);
    }
    for (let step = 0; step < 8; step += 1) {
      const view = await w.setup.app.games.view(w.alice.id, gameId);
      const player = view.snapshot.awaitingPlayerId === "s0" ? w.alice : w.bob;
      const own = await w.setup.app.games.view(player.id, gameId);
      let command = { type: own.snapshot.legalMoves.canEndTurn ? "END_TURN" : "END_PHASE" };
      if (own.snapshot.phase === "COMBAT_ATTACKERS") {
        command = { type: "DECLARE_ATTACKERS", attackerIds: [] };
      }
      const move = { gameId, commandId: uuidV4(deterministicRandom(`signed-${step}`)), expectedVersion: own.version, command };
      assert.equal((await w.setup.app.games.command(player.id, signedCommand(move, sessions.get(player.id)))).ok, true);
    }
    const last = await w.setup.app.games.view(w.bob.id, gameId);
    const concession = signedCommand({ gameId, commandId: uuidV4(deterministicRandom("signed-concede")), expectedVersion: last.version, command: { type: "CONCEDE" } }, sessions.get(w.bob.id));
    assert.equal((await w.setup.app.games.concede(w.bob.id, concession)).ok, true);
    for (let round = 0; round < 4; round += 1) {
      await w.chain.broadcaster.runOnce();
      w.ledger.produceBlock();
    }
    w.ledger.finalize();
    await w.chain.tracker.runOnce();

    const verified = await w.setup.app.verification.verify(gameId);
    assert.equal(verified.verdict, Verdict.VALID, JSON.stringify(verified).slice(0, 800));
    assert.equal(verified.signatures.status, "VALID");
    assert.deepEqual(verified.sessions.map((session) => [session.account, session.status]), [["alice", "AUTHORIZED"], ["bob", "AUTHORIZED"]]);
    const server = await listen(w.setup.app);
    try {
      let output = "";
      const code = await verifyCommand([gameId, "--root", ROOT, "--server", server.base], { reader: w.publishing.reader, write: (text) => (output += text) });
      assert.equal(code, 0, output);
      assert.match(output, /moves: every player move is signed/);
      assert.match(output, /session s0 @alice: AUTHORIZED/);
    } finally {
      await server.close();
    }
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

  it("publishes nothing until the root account's manifest authorises the broadcaster at an irreversible block", async () => {
    const w = await world({ signers: [B1], authorize: false });
    const gameId = await w.newGame();
    await w.chain.manifests.runOnce();
    assert.equal(await w.chain.broadcaster.runOnce(), 0);
    assert.ok(w.setup.logger.entries.some((entry) => entry.message.startsWith("broadcaster not authorised")));

    w.ledger.publishManifest(ROOT, broadcastersManifest({ accounts: [B1], fromBlock: 0 }));
    w.ledger.produceBlock();
    await w.chain.manifests.runOnce();
    assert.equal(await w.chain.broadcaster.runOnce(), 0, "the manifest is not irreversible yet");
    w.ledger.finalize();
    await w.chain.manifests.runOnce();
    assert.equal(await w.chain.broadcaster.runOnce(), 1);
    w.ledger.produceBlock();
    w.ledger.finalize();
    await w.chain.tracker.runOnce();
    assert.equal((await rowsOf(w, gameId))[0].status, "IRREVERSIBLE");

    // Revoking the pool stops publishing at once.
    w.ledger.publishManifest(ROOT, broadcastersManifest({ accounts: [], fromBlock: 0 }));
    w.ledger.produceBlock();
    w.ledger.finalize();
    await w.chain.manifests.runOnce();
    await pass(w, gameId, "after-revocation");
    await w.setup.app.games.sealStale();
    w.setup.clock.advance(30_000);
    await w.setup.app.games.sealStale();
    assert.equal(await w.chain.broadcaster.runOnce(), 0);
  });

  it("sells packs only once the pack epoch's commitment is on chain", async () => {
    const w = await world({ signers: [B1] });
    const order = (key) => w.setup.app.marketplace.createOrder({ buyer: { id: w.alice.id, account: "alice", network: "steem" }, productId: "core_booster", quantity: 1, asset: "STEEM", idempotencyKey: `gate-key-${key}-0000000000`, ip: "127.0.0.1" });
    await assert.rejects(() => order(1), (error) => error.code === "CHAIN_UNAVAILABLE", "the commitment was just queued");
    assert.equal(await w.chain.broadcaster.runOnce(), 1, "the commitment goes out first");
    await assert.rejects(() => order(2), (error) => error.code === "CHAIN_UNAVAILABLE", "sent is not enough: it must be in a block");
    w.ledger.produceBlock();
    await w.chain.tracker.runOnce();
    const placed = await order(3);
    assert.equal(placed.order.rngEpochId, 1);
    const [epochOp] = (await chainOperations(w)).filter((operation) => operation.id === "m8tcg_epoch");
    assert.match(epochOp.json, /"kind":"pack_epoch"/);
  });

  it("publishes a pack purchase so anyone can recompute the packs from the chain alone", async () => {
    const w = await world({ signers: [B1] });
    const rounds = async (count) => {
      for (let round = 0; round < count; round += 1) {
        await w.chain.broadcaster.runOnce();
        w.ledger.produceBlock();
      }
      w.ledger.finalize();
      await w.chain.tracker.runOnce();
    };
    await w.setup.app.epochs.current();
    await rounds(1);
    await w.setup.app.settlement.runOnce(); // the payment watcher starts after the shop's current history
    const buyer = { id: w.alice.id, account: "alice", network: "steem" };
    const placed = await w.setup.app.marketplace.createOrder({ buyer, productId: "core_booster", quantity: 2, asset: "STEEM", idempotencyKey: "pack-proof-key-0000000001", ip: "127.0.0.1" });
    const { payment } = placed.order;
    w.ledger.time = w.setup.clock.now();
    const paid = w.ledger.transfer({ from: payment.from, to: payment.to, amount: `${payment.amount} ${payment.asset}`, memo: payment.memo, time: w.setup.clock.now() });
    await w.setup.app.settlement.runOnce();
    w.ledger.finalize();
    await w.setup.app.settlement.runOnce();
    await w.setup.app.fulfilment.fulfilVerified();
    await rounds(2);

    const listing = await w.setup.app.marketplace.listing();
    const dropTables = new Map(listing.dropTables.map((table) => [table.hash, table.table]));
    const check = () => verifyOrderOnChain({ orderId: placed.order.id, reader: w.publishing.reader, rootAccount: ROOT, dropTables, paymentBlock: paid.blockNum });
    assert.equal((await check()).verdict, PackVerdict.NOT_REVEALED, "the receipt is on chain, the secret is not");

    // The epoch ages out, its orders are settled: the secret is revealed on chain.
    w.setup.clock.advance(8 * 24 * 60 * 60 * 1000);
    await w.setup.app.epochs.current();
    assert.deepEqual(await w.setup.app.epochs.revealSettled(), [placed.order.rngEpochId]);
    await rounds(3);
    const verified = await check();
    assert.equal(verified.verdict, PackVerdict.VALID, verified.problem);
    assert.equal(verified.packs.length, 2);
    assert.equal(verified.receipt.otherCards, 0, "a booster holds only its packs");

    const wrongTable = new Map([...dropTables.keys()].map((hash) => [hash, { ...dropTables.get(hash), foil: { ...dropTables.get(hash).foil, numerator: 0 } }]));
    const tampered = await verifyOrderOnChain({ orderId: placed.order.id, reader: w.publishing.reader, rootAccount: ROOT, dropTables: wrongTable, paymentBlock: paid.blockNum });
    assert.equal(tampered.verdict, PackVerdict.INVALID, "a table that does not hash to the receipt's is refused");
    let output = "";
    const listingFetch = async () => ({ json: async () => JSON.parse(JSON.stringify(listing)) });
    const code = await verifyOrderCommand([placed.order.id, "--server", "http://shop.invalid", "--root", ROOT, "--payment-block", String(paid.blockNum)], { fetch: /** @type {any} */ (listingFetch), reader: w.publishing.reader, write: (text) => (output += text) });
    assert.equal(code, 0, output);
    assert.match(output, /pack 1 \(epoch 1\): /);
    assert.match(output, /VERDICT: VALID/);
    const early = await verifyOrderOnChain({ orderId: placed.order.id, reader: w.publishing.reader, rootAccount: ROOT, dropTables, paymentBlock: 1 });
    assert.match(early.problem, /committed on chain only after the payment/);
  });

  it("refuses to start with a broadcaster key that also controls the active authority", async () => {
    const ledger = new FakeSteemLedger();
    ledger.addAccount(B1, KEYS[B1], { active: true });
    await assert.rejects(() => ledger.publishing(new Map([[B1, toWif(KEYS[B1])]])).transactions.verifySigners(), SignerError);
    ledger.addAccount(B1, KEYS[B1]);
    await ledger.publishing(new Map([[B1, toWif(KEYS[B1])]])).transactions.verifySigners();
  });
});
