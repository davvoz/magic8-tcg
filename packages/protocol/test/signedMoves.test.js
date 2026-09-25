/**
 * Game protocol v2: players sign their moves with a session key their
 * account authorised. The verifier accepts a game only if every player move
 * is signed by the key the seat held at that point; a move the server made
 * up, changed or attributed to the wrong seat makes the game INVALID, even
 * though its hash chain and its replay are fine. Session authorisations are
 * checked against the accounts' posting keys. Real P-256 signatures
 * (node:crypto, as WebCrypto makes them); secp256k1 is faked here.
 */
import assert from "node:assert/strict";
import { createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import { describe, it } from "node:test";

import { EventKind, GameRecorder, assembleGameHistory, genesisHead, OperationId, SessionStatus, SignatureStatus, Verdict, broadcastersManifest, canonicalize, sealRecords, sessionAuthorization, validateRecord, verifyGame, verifyGameOnChain } from "../src/index.js";
import { ACCOUNTS, BROADCASTER, GAME_ID, onlyBroadcaster, operation, playReferenceGame, resolveContent, testHex } from "./fixtures/referenceGame.js";

/** A session key as a browser holds it: P-256, signatures as r ‖ s. */
function sessionKey() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" });
  const key = `04${Buffer.from(jwk.x, "base64url").toString("hex")}${Buffer.from(jwk.y, "base64url").toString("hex")}`;
  return { key, sign: (message) => sign("sha256", Buffer.from(message), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("hex") };
}

/** node:crypto in place of the browser's noble/WebCrypto check. */
function verifyMoveSignature(message, signatureHex, keyHex) {
  const point = Buffer.from(keyHex, "hex");
  const key = createPublicKey({ key: { kty: "EC", crv: "P-256", x: point.subarray(1, 33).toString("base64url"), y: point.subarray(33).toString("base64url") }, format: "jwk" });
  return verify("sha256", Buffer.from(message), { key, dsaEncoding: "ieee-p1363" }, Buffer.from(signatureHex, "hex"));
}

/** Posting keys and their "signatures" (secp256k1 stands in as a lookup). */
const POSTING = Object.freeze({ alice: "STM6LLegbAgLAy28EHrffBVuANFWcFgmqRMW13wBmTExqFE9SCkg4", "bob.cards": "STM8ZSw7FkF7dKVnQb4RLQ7QKy9cSBHrDTkxeWtxTU3ceFSfWfE8m" });
const signed = new Map();
const accountOfSeat = (seat) => ACCOUNTS[seat === "s0" ? 0 : 1];
const authorize = (seat, key) => {
  const auth = `${testHex(`auth:${seat}:${key}`)}${testHex(`auth2:${key}`)}00`;
  signed.set(`${auth}|${sessionAuthorization(GAME_ID, key)}`, POSTING[accountOfSeat(seat)]);
  return auth;
};
const recoverSigner = (message, signature) => signed.get(`${signature}|${message}`) ?? null;

const seats = () => ({ s0: sessionKey(), s1: sessionKey() });
const verdictOf = (game) => verifyGame({ gameId: GAME_ID, operations: game.operations, isAuthorizedBroadcaster: onlyBroadcaster, resolveContent, verifyMoveSignature });

describe("signed moves (game protocol v2)", () => {
  it("verifies a game whose every player move is signed by the seat's session key", () => {
    const game = playReferenceGame({ label: "signed", signing: { keys: seats(), authorize } });
    assert.ok(game.records.every((record) => record.record.v === 2));
    const moves = game.events.filter(({ event }) => event.k === EventKind.MOVE);
    assert.deepEqual(Object.keys(moves[0].event.d).sort(), ["cid", "cmd", "ev", "sig"]);
    const result = verdictOf(game);
    assert.equal(result.signatures.status, SignatureStatus.VALID);
    assert.equal(result.replay.status, "VALID");
    assert.equal(result.verdict, Verdict.VALID);
  });

  it("rejects a game with a move the player did not sign, or signed for something else", () => {
    const forged = playReferenceGame({ label: "forged", signing: { keys: seats(), authorize, sign: (seat, message, index, honest) => (index === 5 ? sessionKey().sign(message) : honest) } });
    const result = verdictOf(forged);
    assert.equal(result.signatures.status, SignatureStatus.BAD_MOVE_SIGNATURE);
    assert.equal(result.replay.status, "VALID", "the chain and the replay alone would not have noticed");
    assert.equal(result.verdict, Verdict.INVALID);

    const keys = seats();
    const swapped = playReferenceGame({ label: "swapped", signing: { keys, authorize, sign: (seat, message, index, honest) => (index === 3 ? keys[seat === "s0" ? "s1" : "s0"].sign(message) : honest) } });
    assert.equal(verdictOf(swapped).signatures.status, SignatureStatus.BAD_MOVE_SIGNATURE, "signed by the other seat");
  });

  it("follows a new session key a player authorised mid-game, and refuses the old one afterwards", () => {
    const keys = seats();
    const replacement = sessionKey();
    const rotated = playReferenceGame({ label: "rotated", signing: { keys, authorize, rotate: { atCommand: 4, seat: "s0", session: replacement } } });
    assert.equal(verdictOf(rotated).verdict, Verdict.VALID);

    const stale = playReferenceGame({ label: "stale", signing: { keys, authorize, rotate: { atCommand: 4, seat: "s0", session: replacement }, sign: (seat, message, index, honest) => (seat === "s0" && index > 4 ? keys.s0.sign(message) : honest) } });
    assert.equal(verdictOf(stale).signatures.status, SignatureStatus.BAD_MOVE_SIGNATURE);
  });

  it("rejects a player move made before the seat had any session key", () => {
    const withoutS1 = playReferenceGame({ label: "no-session", signing: { keys: { s0: sessionKey() }, authorize, rotate: { atCommand: 60, seat: "s1", session: sessionKey() } } });
    const firstBeforeSession = verdictOf(withoutS1);
    assert.equal(firstBeforeSession.signatures.status, SignatureStatus.UNSIGNED_MOVE);
    assert.equal(firstBeforeSession.verdict, Verdict.INVALID);
  });

  it("keeps v1 and v2 apart: no SESSION in v1, no mixed versions in one game, and v2 needs a signature checker", () => {
    const v1 = new GameRecorder({ gameId: GAME_ID, secret: testHex("v1"), decks: [[["a_card", 1]], [["a_card", 1]]] });
    assert.throws(() => v1.session({ seat: "s0", key: sessionKey().key, authorization: "00".repeat(65), clock: { turn: 0, ms: 1 } }), /from game protocol v2/);
    const v2 = new GameRecorder({ gameId: GAME_ID, secret: testHex("v2"), decks: [[["a_card", 1]], [["a_card", 1]]], version: 2 });
    const created = v2.created({ network: "steem", engineVersion: "0.1.0", contentHash: "c0".repeat(32), accounts: ACCOUNTS, ms: 0 });
    const session = v2.session({ seat: "s0", key: sessionKey().key, authorization: "00".repeat(65), clock: { turn: 0, ms: 1 } });
    const [record] = sealRecords({ gameId: GAME_ID, firstRecordSeq: 0, previousHead: genesisHead(GAME_ID), chained: [created, session], ts: 1, version: 2 });
    assert.equal(validateRecord(record.record).ok, true);
    assert.equal(validateRecord({ ...record.record, v: 1 }).ok, false, "SESSION does not exist in v1");
    assert.equal(validateRecord({ ...record.record, v: 3 }).ok, false);

    const game = playReferenceGame({ label: "needs-checker", signing: { keys: seats(), authorize } });
    const mixed = assembleGameHistory(GAME_ID, [game.records[0], { ...game.records[1], record: { ...game.records[1].record, v: 1 } }]);
    assert.equal(mixed.status, "MALFORMED");
    assert.match(mixed.problem.message, /record 1 is protocol v1, the game is v2/);
    assert.throws(() => verifyGame({ gameId: GAME_ID, operations: game.operations, isAuthorizedBroadcaster: onlyBroadcaster, resolveContent }), /verifyMoveSignature/);
  });

  it("checks on chain that each session key was authorised by the seat account's posting key", async () => {
    const keys = seats();
    const game = playReferenceGame({ label: "on-chain", signing: { keys, authorize } });
    const manifest = Object.freeze({ ...operation(broadcastersManifest({ accounts: [BROADCASTER], fromBlock: 0 }), { blockNum: 900, txId: testHex("m", 20), id: OperationId.MANIFEST, requiredAuths: ["m8tcg"] }), requiredPostingAuths: [] });
    const all = [manifest, ...game.operations];
    const reader = (postingKeys) => ({
      head: async () => ({ headBlock: 5020, irreversibleBlock: 5000, time: 0 }),
      publications: async (account, after) => (after >= 0 ? [] : all.filter((op) => (op.requiredAuths[0] ?? op.requiredPostingAuths[0]) === account).map((op, index) => ({ index, operation: op }))),
      blockOperations: async (blockNum) => all.filter((op) => op.blockNum === blockNum),
      ...(postingKeys === undefined ? {} : { postingKeys }),
    });
    const run = (postingKeys) => verifyGameOnChain({ gameId: GAME_ID, reader: reader(postingKeys), rootAccount: "m8tcg", blocks: game.operations.map((op) => op.blockNum), fetchContent: async () => null, recoverSigner, verifyMoveSignature });
    const current = await run(async (account) => [POSTING[account]]);
    assert.deepEqual(current.sessions.map((session) => [session.seat, session.account, session.status]), [["s0", "alice", SessionStatus.AUTHORIZED], ["s1", "bob.cards", SessionStatus.AUTHORIZED]]);
    const rotatedSince = await run(async () => ["STM5different"]);
    assert.deepEqual(rotatedSince.sessions.map((session) => session.status), [SessionStatus.KEY_NOT_CURRENT, SessionStatus.KEY_NOT_CURRENT]);
    assert.deepEqual((await run(undefined)).sessions.map((session) => session.status), [SessionStatus.UNCHECKED, SessionStatus.UNCHECKED]);
    signed.clear();
    const forged = await run(async (account) => [POSTING[account]]);
    assert.deepEqual(forged.sessions.map((session) => session.status), [SessionStatus.FORGED, SessionStatus.FORGED], "nobody signed these authorisations");
    assert.equal(forged.verdict, Verdict.INVALID);
    assert.equal(canonicalize(forged.sessions[0]).includes("signer"), true);
  });
});
