import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ENVELOPE_OVERHEAD_BYTES,
  EventChain,
  EventKind,
  LIMITS,
  MAX_RECORD_BYTES,
  ProtocolError,
  Seat,
  canonicalDeck,
  canonicalize,
  deckCommitment,
  deriveEngineSeed,
  firstSeatFor,
  genesisHead,
  nextHead,
  packEnvelopes,
  parseCanonical,
  sealRecord,
  sealRecords,
  secretFromBytes,
  seedCommitment,
  stateCommitment,
  stateSalt,
  validateEnvelope,
  validateRecord,
} from "../src/index.js";
import { GAME_ID, testHex } from "./fixtures/referenceGame.js";

const OTHER_GAME = "01j8x3r6h2qkq4w0v7m5a9c1dy";

/** @param {EventChain} chain */
function appendMoves(chain, count) {
  return Array.from({ length: count }, (_, index) => chain.append({ k: EventKind.MOVE, a: index % 2 === 0 ? Seat.S0 : Seat.S1, t: 1, ms: index, d: { type: "END_PHASE" } }));
}

/** A fresh chain; any schema-valid events can be chained, lifecycle order is checked elsewhere. */
function newChain(gameId = GAME_ID) {
  return new EventChain({ gameId });
}

describe("EventChain", () => {
  it("numbers events from 0 and chains each head from the previous one", () => {
    const chain = newChain();
    assert.equal(chain.head, genesisHead(GAME_ID));
    const [first, second] = appendMoves(chain, 2);
    assert.equal(first.event.i, 0);
    assert.equal(second.event.i, 1);
    assert.equal(first.head, nextHead(genesisHead(GAME_ID), GAME_ID, first.event));
    assert.equal(second.head, nextHead(first.head, GAME_ID, second.event));
    assert.equal(chain.head, second.head);
    assert.equal(chain.nextSeq, 2);
  });

  it("binds every event to its game: the same events give different heads in another game", () => {
    const [mine] = appendMoves(newChain(GAME_ID), 1);
    const [theirs] = appendMoves(newChain(OTHER_GAME), 1);
    assert.deepEqual(mine.event, theirs.event);
    assert.notEqual(mine.head, theirs.head);
  });

  it("changes the head when any field of an event changes", () => {
    const [base] = appendMoves(newChain(), 1);
    const genesis = genesisHead(GAME_ID);
    for (const variant of [{ ...base.event, ms: 999 }, { ...base.event, t: 2 }, { ...base.event, a: Seat.S1 }, { ...base.event, d: { type: "END_TURN" } }]) {
      assert.notEqual(nextHead(genesis, GAME_ID, variant), base.head);
    }
    assert.notEqual(nextHead(genesis, GAME_ID, base.event, 2), base.head, "the protocol version is hashed too");
  });

  it("returns frozen events that do not alias the caller's payload", () => {
    const payload = { type: "PLAY_CARD", cardId: "c1", targets: ["c2"] };
    const { event } = newChain().append({ k: EventKind.MOVE, a: Seat.S0, t: 1, ms: 0, d: payload });
    payload.targets.push("c3");
    assert.deepEqual(event.d.targets, ["c2"]);
    assert.ok(Object.isFrozen(event.d.targets));
  });

  it("refuses invalid events without advancing", () => {
    const chain = newChain();
    const invalid = [
      { k: "NOPE", a: null, t: 0, ms: 0, d: {} },
      { k: EventKind.MOVE, a: "s9", t: 0, ms: 0, d: { type: "END_PHASE" } },
      { k: EventKind.MOVE, a: Seat.S0, t: 0, ms: 0, d: { type: "END_PHASE", playerId: "s0" } },
      { k: EventKind.STATE_CHECKPOINT, a: Seat.S0, t: 0, ms: 0, d: { ver: 1, sc: "ab".repeat(32) } },
      { k: EventKind.MOVE, a: Seat.S0, t: -1, ms: 0, d: { type: "END_PHASE" } },
      { k: EventKind.MOVE, a: Seat.S0, t: 0, ms: 1.5, d: { type: "END_PHASE" } },
    ];
    for (const fields of invalid) {
      assert.throws(() => chain.append(fields), ProtocolError, JSON.stringify(fields));
    }
    assert.equal(chain.nextSeq, 0);
    assert.equal(chain.head, genesisHead(GAME_ID));
  });

  it("restores from a persisted head and sequence, and rejects half-restored state", () => {
    const original = newChain();
    appendMoves(original, 3);
    const restored = new EventChain({ gameId: GAME_ID, head: original.head, nextSeq: original.nextSeq });
    const [next] = appendMoves(restored, 1);
    const [expected] = appendMoves(original, 1);
    assert.deepEqual(next, expected);
    assert.throws(() => new EventChain({ gameId: GAME_ID, head: original.head }), ProtocolError);
    assert.throws(() => new EventChain({ gameId: GAME_ID, nextSeq: 3 }), ProtocolError);
    assert.throws(() => new EventChain({ gameId: "NOT-A-ULID" }), ProtocolError);
  });
});

describe("commitments", () => {
  const secret = testHex("commitments:secret");
  const entropies = [testHex("e0", 16), testHex("e1", 16)];

  it("derive everything from the secret, deterministically", () => {
    assert.equal(seedCommitment(secret), seedCommitment(secret));
    assert.notEqual(seedCommitment(secret), seedCommitment(testHex("other")));
    const seed = deriveEngineSeed({ secret, entropies, gameId: GAME_ID });
    assert.match(seed, /^[0-9a-f]{64}$/);
    assert.ok([Seat.S0, Seat.S1].includes(firstSeatFor(seed)));
    assert.notEqual(stateSalt(secret), seedCommitment(secret));
  });

  it("make the engine seed depend on the secret, each entropy, their order and the game", () => {
    const base = deriveEngineSeed({ secret, entropies, gameId: GAME_ID });
    const variants = [
      deriveEngineSeed({ secret: testHex("other"), entropies, gameId: GAME_ID }),
      deriveEngineSeed({ secret, entropies: [testHex("x", 16), entropies[1]], gameId: GAME_ID }),
      deriveEngineSeed({ secret, entropies: [entropies[0], testHex("x", 16)], gameId: GAME_ID }),
      deriveEngineSeed({ secret, entropies: [entropies[1], entropies[0]], gameId: GAME_ID }),
      deriveEngineSeed({ secret, entropies, gameId: OTHER_GAME }),
    ];
    assert.equal(new Set([base, ...variants]).size, variants.length + 1);
  });

  it("choose the first seat from the seed's lowest bit", () => {
    assert.equal(firstSeatFor(`00${"ff".repeat(31)}`), Seat.S0);
    assert.equal(firstSeatFor(`01${"00".repeat(31)}`), Seat.S1);
  });

  it("commit to decks independently of entry order, per seat", () => {
    const deck = [{ cardId: "b_card", count: 2 }, { cardId: "a_card", count: 1 }];
    const reordered = [["a_card", 1], ["b_card", 1], ["b_card", 1]];
    assert.deepEqual(canonicalDeck(deck), [["a_card", 1], ["b_card", 2]]);
    assert.equal(deckCommitment(secret, 0, deck), deckCommitment(secret, 0, reordered));
    assert.notEqual(deckCommitment(secret, 0, deck), deckCommitment(secret, 1, deck), "seats use different salts");
    assert.notEqual(deckCommitment(secret, 0, deck), deckCommitment(secret, 0, [["a_card", 1], ["b_card", 3]]));
  });

  it("salt state commitments so equal states under different games differ", () => {
    const digest = { turn: 1, hand: ["x"] };
    assert.equal(stateCommitment(stateSalt(secret), digest), stateCommitment(stateSalt(secret), { hand: ["x"], turn: 1 }));
    assert.notEqual(stateCommitment(stateSalt(secret), digest), stateCommitment(stateSalt(testHex("other")), digest));
  });

  it("reject malformed inputs", () => {
    assert.throws(() => seedCommitment("abc"), ProtocolError);
    assert.throws(() => deriveEngineSeed({ secret, entropies: [entropies[0]], gameId: GAME_ID }), ProtocolError);
    assert.throws(() => deriveEngineSeed({ secret, entropies, gameId: "bad" }), ProtocolError);
    assert.throws(() => deckCommitment(secret, 2, [["a", 1]]), ProtocolError);
    assert.throws(() => canonicalDeck([]), ProtocolError);
    assert.throws(() => canonicalDeck([["Bad Id", 1]]), ProtocolError);
    assert.throws(() => canonicalDeck([["a", 0]]), ProtocolError);
    assert.throws(() => secretFromBytes(new Uint8Array(16)), ProtocolError);
    assert.equal(secretFromBytes(new Uint8Array(32).fill(1)), "01".repeat(32));
  });
});

describe("records and envelopes", () => {
  it("seal chained events into a canonical, schema-valid record", () => {
    const chain = newChain();
    const chained = appendMoves(chain, 3);
    const sealed = sealRecord({ gameId: GAME_ID, seq: 0, previousHead: genesisHead(GAME_ID), chained, ts: 5 });
    assert.equal(sealed.head, chain.head);
    assert.equal(sealed.json, canonicalize(sealed.record));
    assert.deepEqual(parseCanonical(sealed.json), sealed.record);
    assert.equal(validateRecord(sealed.record).ok, true);
    assert.equal(sealed.firstEventSeq, 0);
    assert.equal(sealed.lastEventSeq, 2);
  });

  it("refuse events that do not chain from the given head", () => {
    const chained = appendMoves(newChain(), 3);
    assert.throws(() => sealRecord({ gameId: GAME_ID, seq: 0, previousHead: "00".repeat(32), chained, ts: 0 }), ProtocolError);
    assert.throws(() => sealRecord({ gameId: GAME_ID, seq: 0, previousHead: genesisHead(GAME_ID), chained: [chained[0], chained[2]], ts: 0 }), ProtocolError);
    assert.throws(() => sealRecord({ gameId: GAME_ID, seq: 0, previousHead: genesisHead(GAME_ID), chained: [], ts: 0 }), ProtocolError);
  });

  it("split long runs into records that each fit one operation, chained together", () => {
    const chain = newChain();
    const chained = appendMoves(chain, 600);
    const records = sealRecords({ gameId: GAME_ID, firstRecordSeq: 0, previousHead: genesisHead(GAME_ID), chained, ts: 0 });
    assert.ok(records.length >= 3);
    records.forEach((record, index) => {
      assert.ok(record.bytes <= MAX_RECORD_BYTES);
      assert.equal(record.seq, index);
      assert.ok(record.record.e.length <= LIMITS.MAX_EVENTS_PER_RECORD);
      if (index > 0) {
        assert.equal(record.previousHead, records[index - 1].head);
        assert.equal(record.firstEventSeq, records[index - 1].lastEventSeq + 1);
      }
    });
    assert.equal(records[records.length - 1].head, chain.head);
  });

  it("respect a smaller byte budget", () => {
    const chained = appendMoves(newChain(), 50);
    const records = sealRecords({ gameId: GAME_ID, firstRecordSeq: 0, previousHead: genesisHead(GAME_ID), chained, ts: 0, maxRecordBytes: 1000 });
    assert.ok(records.every((record) => record.bytes <= 1000));
    assert.throws(() => sealRecords({ gameId: GAME_ID, firstRecordSeq: 0, previousHead: genesisHead(GAME_ID), chained, ts: 0, maxRecordBytes: 100 }), ProtocolError);
    assert.throws(() => sealRecords({ gameId: GAME_ID, firstRecordSeq: 0, previousHead: genesisHead(GAME_ID), chained, ts: 0, maxRecordBytes: 9000 }), ProtocolError);
  });

  it("pack records into canonical envelopes within the operation limit", () => {
    const chained = appendMoves(newChain(), 400);
    const records = sealRecords({ gameId: GAME_ID, firstRecordSeq: 0, previousHead: genesisHead(GAME_ID), chained, ts: 0, maxRecordBytes: 1500 });
    const envelopes = packEnvelopes(records);
    assert.equal(envelopes.reduce((sum, envelope) => sum + envelope.count, 0), records.length);
    for (const envelope of envelopes) {
      assert.ok(envelope.bytes <= LIMITS.MAX_OPERATION_BYTES);
      assert.ok(envelope.count <= LIMITS.MAX_RECORDS_PER_ENVELOPE);
      assert.equal(canonicalize(parseCanonical(envelope.json)), envelope.json);
      assert.equal(validateEnvelope(parseCanonical(envelope.json)).ok, true);
    }
    assert.equal(ENVELOPE_OVERHEAD_BYTES, '{"r":[],"v":1}'.length);
  });

  it("honour a record-count limit and reject limits beyond the protocol", () => {
    const chained = appendMoves(newChain(), 10);
    const records = sealRecords({ gameId: GAME_ID, firstRecordSeq: 0, previousHead: genesisHead(GAME_ID), chained, ts: 0, maxRecordBytes: 400 });
    assert.ok(packEnvelopes(records, { maxRecords: 1 }).every((envelope) => envelope.count === 1));
    assert.throws(() => packEnvelopes(records, { maxBytes: 9000 }), ProtocolError);
    assert.throws(() => packEnvelopes(records, { maxRecords: 17 }), ProtocolError);
    assert.throws(() => packEnvelopes([{ json: "x".repeat(8190) }]), ProtocolError);
  });
});

describe("schema", () => {
  const record = () => {
    const chained = appendMoves(newChain(), 2);
    return structuredClone(sealRecord({ gameId: GAME_ID, seq: 0, previousHead: genesisHead(GAME_ID), chained, ts: 0 }).record);
  };

  it("rejects unknown fields, wrong versions and bad ids anywhere", () => {
    const mutations = [
      (r) => ({ ...r, extra: 1 }),
      (r) => ({ ...r, v: 2 }),
      (r) => ({ ...r, g: "01J8X3R6H2QKQ4W0V7M5A9C1DZ" }),
      (r) => ({ ...r, p: "zz" }),
      (r) => ({ ...r, e: [] }),
      (r) => ({ ...r, e: [{ ...r.e[0], extra: true }, r.e[1]] }),
      (r) => ({ ...r, e: [r.e[0], { ...r.e[1], i: 5 }] }),
      (r) => ({ ...r, e: [{ ...r.e[0], k: "CARD_EFFECT" }, r.e[1]] }),
    ];
    for (const mutate of mutations) {
      assert.equal(validateRecord(mutate(record())).ok, false, mutate.toString());
    }
  });

  it("validates lifecycle payloads strictly", () => {
    const created = {
      a: null,
      i: 0,
      k: EventKind.GAME_CREATED,
      ms: 0,
      t: 0,
      d: { content: "ab".repeat(32), deck_c: ["cd".repeat(32), "ef".repeat(32)], eng: "0.1.0", mode: "casual", net: "steem", seats: [{ acct: "alice", seat: "s0" }, { acct: "bob", seat: "s1" }], seed_c: "12".repeat(32) },
    };
    const wrap = (event) => ({ e: [event], g: GAME_ID, h: "00".repeat(32), p: "00".repeat(32), s: 0, ts: 0, v: 1 });
    assert.equal(validateRecord(wrap(created)).ok, true);
    const broken = [
      { ...created, d: { ...created.d, seats: [{ acct: "alice", seat: "s1" }, { acct: "bob", seat: "s0" }] } },
      { ...created, d: { ...created.d, seats: [{ acct: "alice", seat: "s0" }, { acct: "alice", seat: "s1" }] } },
      { ...created, d: { ...created.d, deck_c: ["cd".repeat(32)] } },
      { ...created, d: { ...created.d, mode: "wager" } },
      { ...created, a: "s0" },
    ];
    for (const event of broken) {
      assert.equal(validateRecord(wrap(event)).ok, false, JSON.stringify(event.d));
    }
  });

  it("limits forced moves to doing nothing", () => {
    const forced = (cmd) => ({ e: [{ a: "s0", d: { cmd, why: "timeout" }, i: 0, k: EventKind.FORCED_MOVE, ms: 0, t: 1 }], g: GAME_ID, h: "00".repeat(32), p: "00".repeat(32), s: 0, ts: 0, v: 1 });
    assert.equal(validateRecord(forced({ type: "END_TURN" })).ok, true);
    assert.equal(validateRecord(forced({ type: "DECLARE_BLOCKERS", blocks: [] })).ok, true);
    assert.equal(validateRecord(forced({ type: "PLAY_CARD", cardId: "c1", targets: [] })).ok, false);
    assert.equal(validateRecord(forced({ type: "DECLARE_ATTACKERS", attackerIds: ["c1"] })).ok, false);
    assert.equal(validateRecord(forced({ type: "END_TURN", cardId: "c1" })).ok, false);
  });

  it("requires revealed decks sorted and bounded", () => {
    const finished = (decks) => ({
      e: [{ a: null, d: { decks, sc: "ab".repeat(32), secret: "cd".repeat(32), ver: 10, why: "concede", win: "s1" }, i: 0, k: EventKind.GAME_FINISHED, ms: 0, t: 3 }],
      g: GAME_ID,
      h: "00".repeat(32),
      p: "00".repeat(32),
      s: 0,
      ts: 0,
      v: 1,
    });
    assert.equal(validateRecord(finished([[["a", 1], ["b", 2]], [["c", 3]]])).ok, true);
    assert.equal(validateRecord(finished([[["b", 1], ["a", 2]], [["c", 3]]])).ok, false);
    assert.equal(validateRecord(finished([[["a", 1], ["a", 2]], [["c", 3]]])).ok, false);
    assert.equal(validateRecord(finished([[["a", 0]], [["c", 3]]])).ok, false);
    assert.equal(validateRecord(finished([[["a", 1]]])).ok, false);
  });
});
