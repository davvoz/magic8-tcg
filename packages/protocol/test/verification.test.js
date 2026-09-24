/**
 * End-to-end verification of games read "from the chain": a reference game
 * is played with the engine, recorded, sealed and packed exactly as the
 * server will do it; then operations are duplicated, reordered, dropped,
 * forged or rewritten, and the verifier must reach the right verdict.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  EventChain,
  EventKind,
  GameRecorder,
  HistoryStatus,
  OperationId,
  RejectionReason,
  ReplayStatus,
  Seat,
  Verdict,
  genesisHead,
  packEnvelopes,
  sealRecords,
  verifyGame,
} from "../src/index.js";
import { ACCOUNTS, BROADCASTER, CONTENT_HASH, ENGINE_VERSION, GAME_ID, NETWORK, onlyBroadcaster, operation, playReferenceGame, resolveContent, testHex } from "./fixtures/referenceGame.js";

const reference = playReferenceGame();

/**
 * @param {readonly import("../src/game/OperationDecoder.js").ChainOperation[]} operations
 * @param {{ policy?: (account: string, block: number) => boolean, resolver?: typeof resolveContent }} [options]
 */
function verify(operations, { policy = onlyBroadcaster, resolver = resolveContent } = {}) {
  return verifyGame({ gameId: GAME_ID, operations, isAuthorizedBroadcaster: policy, resolveContent: resolver });
}

/**
 * Re-chains, re-seals and re-packs a (possibly altered) list of events, as a
 * dishonest broadcaster holding the key could do: the result is structurally
 * perfect, so only the commitments and the replay can catch the lie.
 * @param {readonly import("../src/game/EventChain.js").ProtocolEvent[]} events
 */
function republish(events) {
  const chain = new EventChain({ gameId: GAME_ID });
  const chained = events.map(({ k, a, t, ms, d }) => chain.append({ k, a, t, ms, d }));
  const records = sealRecords({ gameId: GAME_ID, firstRecordSeq: 0, previousHead: genesisHead(GAME_ID), chained, ts: 0 });
  return packEnvelopes(records).map((envelope, index) => operation(envelope.json, { blockNum: 2000 + index, txId: testHex(`republish${index}`, 20) }));
}

/** The reference events as plain, mutable objects. */
function referenceEvents() {
  return reference.events.map(({ event }) => structuredClone(event));
}

/**
 * Re-serialises an envelope after changing its first record.
 * @param {string} json
 * @param {(record: any) => any} change returns the replacement record
 */
function withFirstRecord(json, change) {
  const envelope = JSON.parse(json);
  return JSON.stringify({ ...envelope, r: [change(envelope.r[0]), ...envelope.r.slice(1)] });
}

describe("verification of an honest game", () => {
  it("is VALID and reproduces the outcome by replay", () => {
    const report = verify(reference.operations);
    assert.equal(report.verdict, Verdict.VALID, JSON.stringify(report.replay ?? report.history.problem));
    assert.equal(report.history.status, HistoryStatus.COMPLETE);
    assert.equal(report.replay.status, ReplayStatus.VALID);
    assert.deepEqual(report.replay.outcome, { winner: reference.outcome.winner, reason: reference.outcome.reason });
    assert.equal(report.history.events.length, reference.events.length);
    assert.ok(report.replay.engineEvents > reference.outcome.commands, "derived engine events are reproduced");
    assert.equal(report.rejected.length, 0);
  });

  it("stays VALID for many different games, including concessions", () => {
    for (const [label, concedeAt] of [["alpha", null], ["beta", null], ["gamma", 7], ["delta", 0]]) {
      const game = playReferenceGame({ label, concedeAt });
      const report = verify(game.operations);
      assert.equal(report.verdict, Verdict.VALID, `${label}: ${JSON.stringify(report.replay)}`);
      assert.deepEqual(report.replay.outcome, { winner: game.outcome.winner, reason: game.outcome.reason });
    }
  });

  it("fits a typical game in a handful of operations below the 8192-byte limit", () => {
    assert.ok(reference.operations.length <= 6);
    assert.ok(reference.envelopes.every((envelope) => envelope.bytes <= 8192));
  });

  it("ignores rebroadcast duplicates and the order in which operations were included", () => {
    const shuffled = [...reference.operations].reverse();
    const report = verify([...shuffled, reference.operations[0], reference.operations[1]]);
    assert.equal(report.verdict, Verdict.VALID);
    assert.ok(report.history.duplicates >= 2);
  });

  it("verifies each game independently when records of several games share an envelope", () => {
    const otherId = "01j8x3r6h2qkq4w0v7m5a9c1dy";
    const other = playReferenceGame({ label: "neighbour", gameId: otherId });
    const interleaved = reference.records.flatMap((record, index) => [record, other.records[index]]).filter(Boolean);
    const mixed = packEnvelopes([...interleaved, ...other.records.slice(reference.records.length)]).map((envelope, index) => operation(envelope.json, { blockNum: 3000 + index, txId: testHex(`mixed${index}`, 20) }));
    assert.equal(verify(mixed).verdict, Verdict.VALID);
    const otherReport = verifyGame({ gameId: otherId, operations: mixed, isAuthorizedBroadcaster: onlyBroadcaster, resolveContent });
    assert.equal(otherReport.verdict, Verdict.VALID);
  });

  it("accepts forced moves that do nothing, when the replay agrees", () => {
    const events = referenceEvents();
    const target = events.find((event) => event.k === EventKind.MOVE && event.d.type === "END_PHASE");
    target.k = EventKind.FORCED_MOVE;
    target.d = { cmd: { type: "END_PHASE" }, why: "timeout" };
    assert.equal(verify(republish(events)).verdict, Verdict.VALID);
  });
});

describe("what the chain alone reveals", () => {
  it("a missing operation in the middle makes the game INCOMPLETE", () => {
    const withoutSecond = reference.operations.filter((_, index) => index !== 1);
    const report = verify(withoutSecond);
    assert.equal(report.verdict, Verdict.INVALID);
    assert.equal(report.history.status, HistoryStatus.INCOMPLETE);
  });

  it("missing final operations look like a game still in progress", () => {
    const report = verify(reference.operations.slice(0, -1));
    assert.equal(report.verdict, Verdict.IN_PROGRESS);
    assert.equal(report.replay, null);
  });

  it("operations from accounts that are not authorised broadcasters are ignored", () => {
    const forgedJson = withFirstRecord(reference.operations[1].json, (record) => ({ ...record, e: [{ ...record.e[0], d: { type: "CONCEDE" } }, ...record.e.slice(1)] }));
    const forged = operation(forgedJson, { blockNum: 999, txId: testHex("forged", 20), signer: "mallory" });
    const report = verify([forged, ...reference.operations]);
    assert.equal(report.verdict, Verdict.VALID);
    assert.equal(report.rejected[0].reason, RejectionReason.UNAUTHORIZED_SIGNER);
  });

  it("rejects active-authority, multi-signer, wrong-id and non-canonical operations", () => {
    const json = reference.operations[0].json;
    const cases = [
      [operation(json, { blockNum: 1, txId: "a1", requiredAuths: [BROADCASTER] }), RejectionReason.ACTIVE_AUTHORITY],
      [{ ...operation(json, { blockNum: 1, txId: "a2" }), requiredPostingAuths: [BROADCASTER, "other"] }, RejectionReason.SIGNER_COUNT],
      [operation(json, { blockNum: 1, txId: "a3", id: OperationId.RECEIPT }), RejectionReason.WRONG_ID],
      [operation(JSON.stringify(JSON.parse(json), null, 1), { blockNum: 1, txId: "a4" }), RejectionReason.NOT_CANONICAL],
      [operation('{"r":[],"v":1}', { blockNum: 1, txId: "a5" }), RejectionReason.INVALID_ENVELOPE],
    ];
    for (const [op, reason] of cases) {
      const report = verify([op]);
      assert.equal(report.rejected[0].reason, reason, reason);
    }
  });

  it("two different records with the same sequence from our broadcaster are a FORK", () => {
    const altered = withFirstRecord(reference.operations[1].json, (record) => ({ ...record, ts: record.ts + 1 }));
    const report = verify([...reference.operations, operation(altered, { blockNum: 5000, txId: testHex("fork", 20) })]);
    assert.equal(report.history.status, HistoryStatus.FORK);
    assert.equal(report.verdict, Verdict.INVALID);
  });

  it("an event changed after sealing breaks the chain: TAMPERED", () => {
    const tampered = reference.operations.map((op, index) =>
      index === 1
        ? operation(
            withFirstRecord(op.json, (record) => ({ ...record, e: [{ ...record.e[0], ms: record.e[0].ms + 1 }, ...record.e.slice(1)] })),
            { blockNum: op.blockNum, txId: op.txId },
          )
        : op,
    );
    const report = verify(tampered);
    assert.equal(report.history.status, HistoryStatus.TAMPERED);
    assert.equal(report.verdict, Verdict.INVALID);
  });

  it("events out of lifecycle order are MALFORMED", () => {
    const events = referenceEvents();
    const moveBeforeStart = [events[0], events[1], events[2], { a: Seat.S0, d: { type: "END_PHASE" }, i: 3, k: EventKind.MOVE, ms: 1, t: 0 }, ...events.slice(3)];
    assert.equal(verify(republish(moveBeforeStart)).history.status, HistoryStatus.MALFORMED);
    const afterEnd = [...events, { a: Seat.S0, d: { type: "END_PHASE" }, i: 0, k: EventKind.MOVE, ms: 1, t: 0 }];
    assert.equal(verify(republish(afterEnd)).history.status, HistoryStatus.MALFORMED);
  });
});

describe("what only commitments and replay reveal (a dishonest key holder)", () => {
  it("a different winner is caught by the replay", () => {
    const events = referenceEvents();
    const finished = events[events.length - 1];
    finished.d.win = finished.d.win === Seat.S0 ? Seat.S1 : Seat.S0;
    const report = verify(republish(events));
    assert.equal(report.history.status, HistoryStatus.COMPLETE);
    assert.equal(report.replay.status, ReplayStatus.REPLAY_MISMATCH);
    assert.equal(report.verdict, Verdict.INVALID);
  });

  it("a rewritten move is caught: the engine rejects it or a checkpoint stops matching", () => {
    const events = referenceEvents();
    const play = events.find((event) => event.k === EventKind.MOVE && event.d.type === "PLAY_CARD");
    play.d = { type: "END_PHASE" };
    const report = verify(republish(events));
    assert.equal(report.replay.status, ReplayStatus.REPLAY_MISMATCH);
    assert.ok(report.replay.eventSeq >= play.i);
  });

  it("a removed move is caught", () => {
    const events = referenceEvents().filter((event, index, all) => !(event.k === EventKind.MOVE && index === all.findIndex((e) => e.k === EventKind.MOVE && e.d.type === "DECLARE_ATTACKERS")));
    const report = verify(republish(events.map((event, index) => ({ ...event, i: index }))));
    assert.equal(report.replay.status, ReplayStatus.REPLAY_MISMATCH);
  });

  it("a forged state checkpoint is caught", () => {
    const events = referenceEvents();
    const checkpoint = events.find((event) => event.k === EventKind.STATE_CHECKPOINT);
    checkpoint.d.sc = "ab".repeat(32);
    assert.equal(verify(republish(events)).replay.status, ReplayStatus.REPLAY_MISMATCH);
  });

  it("revealing a different secret than the one committed is caught", () => {
    const events = referenceEvents();
    events[events.length - 1].d.secret = testHex("another secret");
    assert.equal(verify(republish(events)).replay.status, ReplayStatus.INVALID_REVEAL);
  });

  it("revealing a different deck than the one committed is caught", () => {
    const events = referenceEvents();
    const decks = events[events.length - 1].d.decks;
    decks[0][0][1] += 1;
    assert.equal(verify(republish(events)).replay.status, ReplayStatus.INVALID_REVEAL);
  });

  it("choosing who plays first is caught", () => {
    const events = referenceEvents();
    const started = events.find((event) => event.k === EventKind.GAME_STARTED);
    started.d.first = started.d.first === Seat.S0 ? Seat.S1 : Seat.S0;
    assert.equal(verify(republish(events)).replay.status, ReplayStatus.INVALID_REVEAL);
  });

  it("replaying a game under another game id is caught: the id is part of the seed", () => {
    const otherId = "01j8x3r6h2qkq4w0v7m5a9c1dy";
    const chain = new EventChain({ gameId: otherId });
    const chained = reference.events.map(({ event: { k, a, t, ms, d } }) => chain.append({ k, a, t, ms, d }));
    const records = sealRecords({ gameId: otherId, firstRecordSeq: 0, previousHead: genesisHead(otherId), chained, ts: 0 });
    const operations = packEnvelopes(records).map((envelope, index) => operation(envelope.json, { blockNum: 4000 + index, txId: testHex(`retag${index}`, 20) }));
    const report = verifyGame({ gameId: otherId, operations, isAuthorizedBroadcaster: onlyBroadcaster, resolveContent });
    assert.equal(report.history.status, HistoryStatus.COMPLETE);
    assert.equal(report.verdict, Verdict.INVALID);
  });

  it("a game whose content cannot be found is not declared valid", () => {
    const report = verify(reference.operations, { resolver: () => null });
    assert.equal(report.replay.status, ReplayStatus.UNKNOWN_CONTENT);
    assert.equal(report.verdict, Verdict.INVALID);
  });
});

describe("aborted games", () => {
  it("an abort before the start only needs the secret to match its commitment", () => {
    const secret = testHex("aborted");
    const recorder = new GameRecorder({ gameId: GAME_ID, secret, decks: [[["ember_imp", 30]], [["ember_imp", 30]]] });
    const events = [
      recorder.created({ mode: "casual", network: NETWORK, engineVersion: ENGINE_VERSION, contentHash: CONTENT_HASH, accounts: ACCOUNTS, ms: 0 }),
      recorder.joined({ seat: Seat.S0, entropy: testHex("a0", 16), ms: 10 }),
      recorder.aborted({ reason: "no_show", started: false, clock: { turn: 0, ms: 60000 } }),
    ];
    const records = sealRecords({ gameId: GAME_ID, firstRecordSeq: 0, previousHead: genesisHead(GAME_ID), chained: events, ts: 0 });
    const operations = packEnvelopes(records).map((envelope) => operation(envelope.json, { blockNum: 1, txId: "ab" }));
    const report = verify(operations);
    assert.equal(report.verdict, Verdict.VALID);
    assert.equal(report.history.terminal, EventKind.GAME_ABORTED);
    assert.equal(report.history.started, false);
  });
});
