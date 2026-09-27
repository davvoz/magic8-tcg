import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  EventChain,
  EventKind,
  GameProtocol,
  ProtocolError,
  Seat,
  canonicalDeck,
  deckCommitment,
  deriveEngineSeed,
  firstSeatFor,
  genesisHead,
  nextHead,
  secretFromBytes,
  seedCommitment,
  stateCommitment,
  stateSalt,
  validateEvent,
} from "../src/index.js";
import { GAME_ID, testHex } from "./fixtures/common.js";

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

describe("schema", () => {
  const move = () => ({ a: "s0", d: { type: "END_PHASE" }, i: 0, k: EventKind.MOVE, ms: 0, t: 1 });

  it("rejects unknown fields, unknown kinds and bad fields in an event", () => {
    assert.equal(validateEvent(move()).ok, true);
    const mutations = [
      (e) => ({ ...e, extra: 1 }),
      (e) => ({ ...e, k: "CARD_EFFECT" }),
      (e) => ({ ...e, i: -1 }),
      (e) => ({ ...e, a: "s2" }),
      (e) => ({ ...e, a: null }),
      (e) => ({ ...e, d: { type: "END_PHASE", playerId: "s0", extra: "x".repeat(2000) } }),
    ];
    for (const mutate of mutations) {
      assert.equal(validateEvent(mutate(move())).ok, false, mutate.toString());
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
    assert.equal(validateEvent(created).ok, true);
    const broken = [
      { ...created, d: { ...created.d, seats: [{ acct: "alice", seat: "s1" }, { acct: "bob", seat: "s0" }] } },
      { ...created, d: { ...created.d, seats: [{ acct: "alice", seat: "s0" }, { acct: "alice", seat: "s1" }] } },
      { ...created, d: { ...created.d, deck_c: ["cd".repeat(32)] } },
      { ...created, d: { ...created.d, mode: "wager" } },
      { ...created, a: "s0" },
    ];
    for (const event of broken) {
      assert.equal(validateEvent(event).ok, false, JSON.stringify(event.d));
    }
  });

  it("limits forced moves to doing nothing", () => {
    const forced = (cmd) => ({ a: "s0", d: { cmd, why: "timeout" }, i: 0, k: EventKind.FORCED_MOVE, ms: 0, t: 1 });
    assert.equal(validateEvent(forced({ type: "END_TURN" })).ok, true);
    assert.equal(validateEvent(forced({ type: "DECLARE_BLOCKERS", blocks: [] })).ok, true);
    assert.equal(validateEvent(forced({ type: "PLAY_CARD", cardId: "c1", targets: [] })).ok, false);
    assert.equal(validateEvent(forced({ type: "DECLARE_ATTACKERS", attackerIds: ["c1"] })).ok, false);
    assert.equal(validateEvent(forced({ type: "END_TURN", cardId: "c1" })).ok, false);
  });

  it("requires revealed decks sorted and bounded", () => {
    const finished = (decks) => ({ a: null, d: { decks, sc: "ab".repeat(32), secret: "cd".repeat(32), ver: 10, why: "concede", win: "s1" }, i: 0, k: EventKind.GAME_FINISHED, ms: 0, t: 3 });
    assert.equal(validateEvent(finished([[["a", 1], ["b", 2]], [["c", 3]]])).ok, true);
    assert.equal(validateEvent(finished([[["b", 1], ["a", 2]], [["c", 3]]])).ok, false);
    assert.equal(validateEvent(finished([[["a", 1], ["a", 2]], [["c", 3]]])).ok, false);
    assert.equal(validateEvent(finished([[["a", 0]], [["c", 3]]])).ok, false);
    assert.equal(validateEvent(finished([[["a", 1]]])).ok, false);
  });

  it("knows SESSION and signed moves only from game protocol v2", () => {
    const session = { a: "s0", d: { auth: "ab".repeat(65), key: `04${"cd".repeat(64)}` }, i: 3, k: EventKind.SESSION, ms: 1, t: 0 };
    assert.equal(validateEvent(session, GameProtocol.V2).ok, true);
    assert.equal(validateEvent(session, GameProtocol.V1).ok, false, "SESSION does not exist in v1");
    const signed = { ...move(), d: { cid: "0000000a-0000-4000-8000-000000000001", cmd: { type: "END_PHASE" }, ev: 4, sig: "ef".repeat(64) } };
    assert.equal(validateEvent(signed, GameProtocol.V2).ok, true);
    assert.equal(validateEvent(move(), GameProtocol.V2).ok, false, "a v2 move carries its signature");
  });
});
