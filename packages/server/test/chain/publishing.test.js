/**
 * Publishing on chain against a fake STEEM node that checks transactions
 * like a real one (TaPoS, expiration, canonical posting signatures), through
 * the real SteemTransactionProvider and SteemPublicationReader: the
 * broadcaster (persist first, one operation per account per round, order
 * partitions), the tracker (inclusion, irreversibility, micro-forks, expiry
 * and rebroadcast of the same bytes, unknown operations), the Resource
 * Credits monitor, the records of receipts, packs, trades and sales — and
 * games, whose history stays off the chain but whose result is published.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { OperationId, PackVerdict, ackKeysManifest, ackMessage, broadcastersManifest, canonicalize, parseGameResultRecord, verifyOrderOnChain } from "@magic8/protocol";
import { SignerError, recoverSigner } from "@magic8/steem";
import { uuidV4 } from "../../src/kernel/random.js";
import { ResourceMode, signerFor } from "../../src/modules/chain/index.js";
import { ACK_KEYS, buildTestApp, deterministicRandom, toWif } from "../helpers.js";
import { verifyOrderCommand } from "../../../../tools/verify-order.js";
import { FakeSteemLedger } from "../support/fakeSteemLedger.js";

const ROOT = "m8tcg";
const B1 = "m8tcg-b1";
const B2 = "m8tcg-b2";
const KEYS = Object.freeze({ [B1]: new Uint8Array(32).fill(21), [B2]: new Uint8Array(32).fill(22) });
const ENTROPY = Object.freeze({ s0: "0a".repeat(16), s1: "0b".repeat(16) });

async function world({ signers = [B1, B2], rcPolicy = {}, authorize = true } = {}) {
  const ledger = new FakeSteemLedger();
  for (const name of signers) {
    ledger.addAccount(name, KEYS[name]);
  }
  const publishing = ledger.publishing(new Map(signers.map((name) => [name, toWif(KEYS[name])])));
  const setup = await buildTestApp({ ledger, publishing, chainPolicies: { rc: rcPolicy }, env: { M8_ROOT_ACCOUNT: ROOT } });
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
  let records = 0;
  /** A record of ours waiting in the outbox (a trade's, as the trading module writes it). */
  const newRecord = async () => {
    records += 1;
    await setup.app.outbox.enqueueTrade({ network: "steem", tradeId: `trade-${records}`, payload: canonicalize({ kind: "trade", n: records, v: 1 }) });
  };
  return { ledger, setup, chain, alice, bob, newGame, newRecord, publishing };
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

const rowsOf = (w) => w.setup.database.rows("SELECT id, kind, status, reconciliation, attempts, payload, transaction_id FROM blockchain_events ORDER BY id");
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
  it("publishes a record, one operation per account per round, and follows it to irreversibility", async () => {
    const w = await world();
    await w.newRecord();
    await w.newRecord();
    const signer = signerFor({ orderId: null, kind: "TRADE" }, [B1, B2]);

    assert.equal(await w.chain.broadcaster.runOnce(), 1, "both records belong to one account: one per round");
    let [row, next] = await rowsOf(w);
    assert.deepEqual([row.status, next.status], ["BROADCAST", "BUILT"], "persisted before the node sees it");
    const [tx] = await transactions(w);
    assert.equal(tx.signer, signer);
    assert.equal(w.ledger.mempool.length, 1);
    assert.equal(await w.chain.broadcaster.runOnce(), 1);
    assert.equal(await w.chain.broadcaster.runOnce(), 0, "nothing else to send");

    w.ledger.produceBlock();
    await w.chain.tracker.runOnce();
    [row, next] = await rowsOf(w);
    assert.deepEqual([row.status, row.reconciliation, next.status], ["INCLUDED", "MATCH", "INCLUDED"]);
    w.ledger.finalize();
    await w.chain.tracker.runOnce();
    assert.ok((await rowsOf(w)).every((candidate) => candidate.status === "IRREVERSIBLE"));
    assert.ok((await transactions(w)).every((candidate) => candidate.status === "IRREVERSIBLE"));
    const onChain = (await chainOperations(w)).filter((operation) => operation.id === OperationId.TRADE);
    assert.deepEqual(onChain.map((operation) => operation.json), (await rowsOf(w)).map((candidate) => candidate.payload), "each record is one operation, byte for byte");
    assert.deepEqual(await alerts(w), []);
  });

  it("keeps a game's history in the database and publishes only its result, once, when it ends", async () => {
    const w = await world();
    const gameId = await w.newGame();
    for (let step = 0; step < 12; step += 1) {
      await pass(w, gameId, `pass-${step}`);
    }
    assert.deepEqual(await rowsOf(w), [], "nothing is published while the game runs");
    assert.equal(await w.chain.broadcaster.runOnce(), 0);
    assert.equal((await w.setup.app.games.concede(w.alice.id, { gameId, commandId: uuidV4(deterministicRandom("concede")) })).ok, true);

    const [last] = await w.setup.database.rows("SELECT seq, head FROM game_events WHERE game_id = $1 ORDER BY seq DESC LIMIT 1", [gameId]);
    const [row] = await rowsOf(w);
    assert.equal(row.kind, "RESULT");
    const result = parseGameResultRecord(row.payload);
    assert.deepEqual(
      [result.g, result.a, result.m, result.w, result.r, result.n, result.h],
      [gameId, ["alice", "bob"], "casual", "s1", "concede", last.seq, last.head],
      "the result commits to the last event of the history kept in the database",
    );
    assert.ok(row.payload.length < 250, `${row.payload.length} bytes`);

    assert.equal(await w.chain.broadcaster.runOnce(), 1);
    assert.equal(w.ledger.mempool[0].operations[0].data.id, OperationId.RESULT);
    assert.equal(w.ledger.mempool[0].operations[0].data.json, row.payload);
    w.ledger.produceBlock();
    w.ledger.finalize();
    await w.chain.tracker.runOnce();
    assert.deepEqual([(await rowsOf(w))[0].status, (await rowsOf(w))[0].reconciliation], ["IRREVERSIBLE", "MATCH"]);
    assert.equal((await rowsOf(w)).length, 1, "one record for the whole game");
    await assert.rejects(w.setup.app.outbox.enqueueResult({ network: "steem", gameId, payload: row.payload }), "never a second result for a game");
    assert.deepEqual(await alerts(w), []);
  });

  it("signs every accepted command's ack with the key the root's ack_keys manifest names", async () => {
    const w = await world();
    assert.equal(w.chain.manifests.ackKeyAuthorized, false, "no ack_keys manifest yet");
    assert.ok(w.setup.logger.entries.some((entry) => entry.message.startsWith("the ack key is not named")));
    w.ledger.publishManifest(ROOT, ackKeysManifest({ keys: [ACK_KEYS.publicKey], fromBlock: 0 }));
    w.ledger.produceBlock();
    w.ledger.finalize();
    await w.chain.manifests.runOnce();
    assert.equal(w.chain.manifests.ackKeyAuthorized, true);

    const gameId = await w.newGame();
    const first = kept(gameId, await pass(w, gameId, "acked-0"));
    assert.equal(first.key, ACK_KEYS.publicKey);
    assert.equal(recoverSigner(ackMessage(first), first.sig), ACK_KEYS.publicKey, "a Keychain-style signature by the ack key");
    const [event] = await w.setup.database.rows("SELECT head FROM game_events WHERE game_id = $1 AND seq = $2", [gameId, first.seq]);
    assert.equal(event.head, first.head, "the ack names the event the command produced");
    const again = await w.setup.app.games.command(w.alice.id, { gameId, commandId: first.commandId, expectedVersion: 0, command: { type: "END_TURN" } });
    assert.deepEqual(kept(gameId, again), first, "a re-sent command gets the same signed ack");
    const refused = await w.setup.app.games.command(w.alice.id, { gameId, commandId: uuidV4(deterministicRandom("stale")), expectedVersion: 0, command: { type: "END_TURN" } });
    assert.deepEqual([refused.ok, refused.sig], [false, undefined], "only accepted commands are signed");
  });

  it("publishes a completed trade, and the tracker follows it like any record of ours", async () => {
    const w = await world();
    const printing = { edition: "core-1" };
    const [imp] = await w.setup.app.inventory.mint({ ownerId: w.alice.id, items: [{ definitionId: "ember_imp", count: 1 }], ...printing, origin: { kind: "purchase", ref: "test:trade:a" } });
    await w.setup.app.inventory.mint({ ownerId: w.bob.id, items: [{ definitionId: "iron_watcher", count: 1 }], ...printing, origin: { kind: "purchase", ref: "test:trade:b" } });
    const { trade } = await w.setup.app.trading.propose({ proposer: { id: w.alice.id, account: "alice" }, to: "bob", give: [imp.id], want: [{ definitionId: "iron_watcher", count: 1 }], idempotencyKey: "chain-trade-00000001", ip: "x" });
    await w.setup.app.trading.accept({ userId: w.bob.id, tradeId: trade.id, ip: "x" });
    assert.equal(await w.chain.broadcaster.runOnce(), 1);
    const [pending] = w.ledger.mempool;
    const operation = pending.operations[0].data;
    assert.equal(operation.id, OperationId.TRADE);
    assert.equal(JSON.parse(operation.json).t, trade.id);
    w.ledger.produceBlock();
    await w.chain.tracker.runOnce();
    const [row] = await w.setup.database.rows("SELECT status, reconciliation FROM blockchain_events WHERE kind = 'TRADE'");
    assert.deepEqual([row.status, row.reconciliation], ["INCLUDED", "MATCH"]);
    assert.deepEqual(await alerts(w), [], "our own trade record is not an unknown operation");
  });

  it("publishes a completed sale, and the tracker follows it like any record of ours", async () => {
    const w = await world();
    const [imp] = await w.setup.app.inventory.mint({ ownerId: w.alice.id, items: [{ definitionId: "ember_imp", count: 1 }], edition: "core-1", origin: { kind: "purchase", ref: "test:sale:a" } });
    const { listing } = await w.setup.app.sales.list({ seller: { id: w.alice.id, account: "alice", network: "steem" }, copy: imp.id, price: "0.5", asset: "STEEM", idempotencyKey: "chain-sale-000000001", ip: "x" });
    const purchase = await w.setup.app.sales.reserve({ buyer: { id: w.bob.id, account: "bob", network: "steem" }, listingId: listing.id, ip: "x" });
    const { txId } = w.ledger.transfer({ from: "bob", to: "alice", amount: "0.500 STEEM", memo: purchase.payment.memo, time: w.setup.clock.now() });
    w.ledger.finalize();
    assert.equal((await w.setup.app.saleSettlement.runOnce()).completed, 1);
    assert.equal(await w.chain.broadcaster.runOnce(), 1);
    const operation = w.ledger.mempool[0].operations[0].data;
    assert.equal(operation.id, OperationId.SALE);
    assert.deepEqual([JSON.parse(operation.json).t, JSON.parse(operation.json).x], [listing.id, txId]);
    w.ledger.produceBlock();
    await w.chain.tracker.runOnce();
    const [row] = await w.setup.database.rows("SELECT status, reconciliation FROM blockchain_events WHERE kind = 'SALE'");
    assert.deepEqual([row.status, row.reconciliation], ["INCLUDED", "MATCH"]);
    assert.deepEqual(await alerts(w), [], "our own sale record is not an unknown operation");
  });

  it("does not send a record again when its block is irreversible but the account history does not show it yet", async () => {
    const w = await world({ signers: [B1] });
    await w.newRecord();
    w.ledger.historyLags = true;
    await w.chain.broadcaster.runOnce();
    const [sent] = await transactions(w);
    const block = w.ledger.produceBlock();
    w.ledger.produceBlocks(30);
    w.ledger.finalize();
    await w.chain.tracker.runOnce();
    const [found] = await transactions(w);
    assert.deepEqual([found.tx_id, found.status, Number(found.block_num)], [sent.tx_id, "INCLUDED", block], "found in its block, not expired");
    assert.deepEqual((await rowsOf(w)).map((row) => [row.status, row.attempts]), [["INCLUDED", 1]]);

    await w.chain.broadcaster.runOnce();
    assert.equal((await transactions(w)).length, 1, "nothing is sent again");
    await w.chain.tracker.runOnce();
    assert.equal((await transactions(w))[0].status, "IRREVERSIBLE");
    assert.deepEqual(await alerts(w), []);
  });

  it("sends a record again, byte for byte, when its transaction expired unseen; an ambiguous broadcast error changes nothing", async () => {
    const w = await world({ signers: [B1] });
    await w.newRecord();
    w.ledger.loseBroadcasts = true;
    await w.chain.broadcaster.runOnce();
    const [lost] = await transactions(w);
    w.ledger.produceBlocks(10);
    w.ledger.finalize();
    await w.chain.tracker.runOnce();
    assert.equal((await rowsOf(w))[0].status, "BROADCAST", "not expired while the expiration is ahead of the irreversible block");

    w.ledger.produceBlocks(20);
    w.ledger.finalize();
    await w.chain.tracker.runOnce();
    let [row] = await rowsOf(w);
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
    [row] = await rowsOf(w);
    assert.deepEqual([row.status, row.attempts], ["INCLUDED", 2]);
    const onChain = (await chainOperations(w)).find((operation) => operation.txId === retried.tx_id);
    assert.equal(onChain.json, row.payload, "the same record bytes");
  });

  it("puts a transaction dropped by a micro-fork back in flight, and alerts after repeated attempts", async () => {
    const w = await world({ signers: [B1] });
    await w.newRecord();
    await w.chain.broadcaster.runOnce();
    w.ledger.produceBlock();
    await w.chain.tracker.runOnce();
    const [tx] = await transactions(w);
    assert.equal(tx.status, "INCLUDED");
    w.ledger.drop(tx.tx_id);
    w.ledger.finalize();
    await w.chain.tracker.runOnce();
    assert.deepEqual([(await transactions(w))[0].status, (await rowsOf(w))[0].status], ["BROADCAST", "BROADCAST"]);

    w.ledger.loseBroadcasts = true;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      w.ledger.produceBlocks(30);
      w.ledger.finalize();
      await w.chain.tracker.runOnce();
      await w.chain.broadcaster.runOnce();
    }
    const [row] = await rowsOf(w);
    assert.ok(row.attempts >= 5);
    const repeated = (await alerts(w)).find((alert) => alert.kind === "REPEATED_REBROADCAST");
    assert.equal(repeated.details.kind, "TRADE");
  });

  it("raises an alert, once, for an operation signed by our broadcaster that the database does not know", async () => {
    const w = await world({ signers: [B1] });
    await w.newRecord();
    await w.chain.broadcaster.runOnce();
    w.ledger.produceBlock();
    await w.chain.tracker.runOnce();

    // Someone holding the broadcaster's key publishes behind the server's back.
    const reference = await w.publishing.transactions.reference();
    const signed = w.publishing.transactions.signCustomJson({ reference, signer: B1, id: OperationId.TRADE, json: canonicalize({ kind: "trade", n: 99, v: 1 }) });
    await w.publishing.transactions.broadcast(signed.transaction);
    w.ledger.produceBlock();
    await w.chain.tracker.runOnce();
    await w.chain.tracker.runOnce();
    const found = await alerts(w);
    assert.deepEqual(found.map((alert) => alert.kind), ["UNKNOWN_ON_CHAIN"], "raised once");
    assert.equal(found[0].details.txId, signed.txId);
    assert.equal((await rowsOf(w))[0].reconciliation, "MATCH", "our own record is untouched");
  });

  it("keeps publishing when Resource Credits run low, and pauses a broadcaster that runs out", async () => {
    const w = await world({ signers: [B1] });
    w.ledger.setResourceCredits(B1, 1000);
    await w.chain.rc.runOnce();
    assert.equal(w.chain.rc.modeOf(B1), ResourceMode.SLOW);
    assert.ok(w.setup.logger.entries.some((entry) => entry.message === "broadcaster low on resource credits"));
    await w.newRecord();
    assert.equal(await w.chain.broadcaster.runOnce(), 1, "low is a warning, not a stop");

    w.ledger.setResourceCredits(B1, 300);
    await w.chain.rc.runOnce();
    assert.equal(w.chain.rc.modeOf(B1), ResourceMode.PAUSED);
    assert.deepEqual((await alerts(w)).map((alert) => alert.kind), ["RC_CRITICAL"]);
    await w.newRecord();
    for (let round = 0; round < 12; round += 1) {
      assert.equal(await w.chain.broadcaster.runOnce(), 0);
    }
    assert.equal((await rowsOf(w))[1].status, "BUILT", "the record waits in the outbox");

    w.ledger.setResourceCredits(B1, 9000);
    await w.chain.rc.runOnce();
    assert.equal(await w.chain.broadcaster.runOnce(), 1, "back to normal");
    assert.ok((await rowsOf(w)).every((row) => row.status !== "BUILT"));
  });

  it("partitions records by order over the pool, stably", () => {
    const counts = new Map();
    for (let index = 0; index < 200; index += 1) {
      const row = { orderId: `order-${index}`, kind: "RECEIPT" };
      const signer = signerFor(/** @type {any} */ (row), [B1, B2]);
      assert.equal(signerFor(/** @type {any} */ (row), [B1, B2]), signer);
      counts.set(signer, (counts.get(signer) ?? 0) + 1);
    }
    assert.ok(counts.get(B1) > 60 && counts.get(B2) > 60, JSON.stringify([...counts]));
  });

  it("publishes nothing until the root account's manifest authorises the broadcaster at an irreversible block", async () => {
    const w = await world({ signers: [B1], authorize: false });
    await w.newRecord();
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
    assert.equal((await rowsOf(w))[0].status, "IRREVERSIBLE");

    // Revoking the pool stops publishing at once.
    w.ledger.publishManifest(ROOT, broadcastersManifest({ accounts: [], fromBlock: 0 }));
    w.ledger.produceBlock();
    w.ledger.finalize();
    await w.chain.manifests.runOnce();
    await w.newRecord();
    assert.equal(await w.chain.broadcaster.runOnce(), 0);
  });

  it("sells packs only once the pack epoch's commitment is on chain", async () => {
    const w = await world({ signers: [B1] });
    const order = (key) => w.setup.app.marketplace.createOrder({ buyer: { id: w.alice.id, account: "alice", network: "steem" }, items: [{ productId: "core_booster", quantity: 1 }], asset: "STEEM", idempotencyKey: `gate-key-${key}-0000000000`, ip: "127.0.0.1" });
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
    const placed = await w.setup.app.marketplace.createOrder({ buyer, items: [{ productId: "core_booster", quantity: 2 }], asset: "STEEM", idempotencyKey: "pack-proof-key-0000000001", ip: "127.0.0.1" });
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

    const wrongTable = new Map([...dropTables.keys()].map((hash) => [hash, { ...dropTables.get(hash), edition: "core-2" }]));
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
