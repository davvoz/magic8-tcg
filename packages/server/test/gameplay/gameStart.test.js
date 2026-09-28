/**
 * The start of a v2 game (docs/tcg/12): nothing is dealt, drawn or timed
 * until both players have accepted the game by authorising their session
 * key with Keychain. Each is told who has accepted so far; a player who
 * declines, or lets the time run out, calls the game off — both players
 * learn who did not sign, the protocol records GAME_ABORTED, nobody wins or
 * loses, and both may look for another game.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { uuidV4 } from "../../src/kernel/random.js";
import { AbortReason, DEFAULT_TIME_POLICY } from "../../src/modules/gameplay/index.js";
import { buildTestApp, deterministicRandom, keyPair } from "../helpers.js";
import { grantFor, sessionKey, signedCommand } from "../support/sessionKeys.js";

const SECOND = 1000;
const ENTROPY = Object.freeze({ s0: "0a".repeat(16), s1: "0b".repeat(16) });

/** Alice (s0) and Bob (s1), with posting keys and inboxes, matched in a v2 game. */
async function world(options = {}) {
  const setup = await buildTestApp({ signedMoves: true, ...options });
  const content = setup.app.catalog.current().content;
  const person = async (account, seed, deckId) => {
    const keys = keyPair(seed);
    setup.chain.setAccount(account, [keys.publicKey]);
    const user = await setup.users.findOrCreate({ network: "steem", account }, setup.clock.now(), uuidV4(deterministicRandom(`user:${account}`)));
    const inbox = [];
    setup.app.hub.attach(user.id, { send: (message) => inbox.push(JSON.parse(message)), close: () => undefined });
    return { id: user.id, keys, inbox, session: sessionKey(), entrant: { userId: user.id, account, deckId: null, deck: content.preconDecks.find((deck) => deck.id === deckId).entries } };
  };
  const alice = await person("alice", 11, "precon_foundry");
  const bob = await person("bob", 12, "precon_harvest");
  const finished = [];
  setup.app.games.onGameFinished(async (summary) => {
    finished.push(summary);
  });
  const gameId = await setup.app.games.createGame({ entrants: [alice.entrant, bob.entrant] });
  const w = { setup, games: setup.app.games, alice, bob, gameId, finished };
  return {
    ...w,
    /** @param {typeof alice} player */
    accept: async (player) => assert.equal((await w.games.session(player.id, grantFor(gameId, player.session, player.keys.privateKey))).ok, true),
    /** @param {typeof alice} player */
    entropy: async (player) => assert.equal((await w.games.entropy(player.id, gameId, player === alice ? ENTROPY.s0 : ENTROPY.s1)).ok, true),
    kinds: async () => (await setup.database.rows("SELECT kind FROM game_events WHERE game_id = $1 ORDER BY seq", [gameId])).map((row) => row.kind),
    status: async () => (await setup.database.rows("SELECT status, end_reason FROM games WHERE id = $1", [gameId]))[0],
  };
}

const last = (inbox, type) => inbox.filter((message) => message.t === type).at(-1)?.d;

describe("a v2 game starts only once both players accepted it with Keychain", () => {
  it("announces how long the players have to accept the game", async () => {
    const w = await world();
    const found = last(w.alice.inbox, "match.found");
    assert.equal(found.protocol, 2);
    assert.equal(found.authorizeDeadline - found.entropyDeadline, DEFAULT_TIME_POLICY.authorizeMs - DEFAULT_TIME_POLICY.entropyMs);
    const view = await w.games.view(w.alice.id, w.gameId);
    assert.deepEqual(view.authorized, { s0: false, s1: false });
    assert.equal(view.authorizeDeadline, found.authorizeDeadline);
  });

  it("waits with both entropies in until the second player signs, telling each who has accepted so far", async () => {
    const w = await world();
    await w.entropy(w.alice);
    await w.entropy(w.bob);
    await w.accept(w.alice);
    assert.equal((await w.status()).status, "CREATED", "one signature is not enough");
    assert.equal(last(w.alice.inbox, "game.events"), undefined, "no hand, no coin toss, no clock yet");
    const told = last(w.bob.inbox, "game.state");
    assert.deepEqual([told.status, told.authorized, told.snapshot], ["CREATED", { s0: true, s1: false }, null], "bob learns alice has accepted");

    await w.accept(w.bob);
    const opening = last(w.alice.inbox, "game.events");
    assert.equal(opening.status, "ACTIVE");
    assert.ok(opening.events.some((event) => event.type === "GAME_STARTED"), "the opening (and its coin toss) comes only now");
    assert.deepEqual(opening.authorized, { s0: true, s1: true });
    assert.equal(opening.authorizeDeadline, null);
    assert.deepEqual(await w.kinds(), ["GAME_CREATED", "PLAYER_JOINED", "PLAYER_JOINED", "SESSION", "SESSION", "GAME_STARTED"]);
  });

  it("starts on the last entropy when both had signed first", async () => {
    const w = await world();
    await w.accept(w.bob);
    await w.accept(w.alice);
    await w.entropy(w.alice);
    assert.equal((await w.status()).status, "CREATED");
    await w.entropy(w.bob);
    assert.equal((await w.status()).status, "ACTIVE");
    assert.deepEqual(await w.kinds(), ["GAME_CREATED", "SESSION", "SESSION", "PLAYER_JOINED", "PLAYER_JOINED", "GAME_STARTED"]);
  });

  it("is called off when a player declines: both are told who, nothing counts, and both may play again", async () => {
    const w = await world();
    await w.entropy(w.alice);
    await w.accept(w.alice);
    assert.equal((await w.games.decline(w.bob.id, w.gameId)).ok, true);

    for (const [player, you] of [[w.alice, "s0"], [w.bob, "s1"]]) {
      assert.deepEqual(last(player.inbox, "game.aborted"), { gameId: w.gameId, reason: AbortReason.DECLINED, seats: ["s1"], you });
      assert.equal(last(player.inbox, "game.events"), undefined, "the game never started");
    }
    assert.deepEqual(await w.status(), { status: "ABORTED", end_reason: "declined" });
    const [aborted] = await w.setup.database.rows("SELECT actor, payload FROM game_events WHERE game_id = $1 AND kind = 'GAME_ABORTED'", [w.gameId]);
    assert.equal(aborted.actor, null);
    assert.equal(aborted.payload.why, "declined");
    assert.match(aborted.payload.secret, /^[0-9a-f]{64}$/, "the secret is revealed as the protocol requires");
    assert.equal(aborted.payload.decks, undefined, "no decks: nothing was dealt");
    const results = await w.setup.database.rows("SELECT seat, result FROM game_players WHERE game_id = $1 ORDER BY seat", [w.gameId]);
    assert.deepEqual(results, [{ seat: "s0", result: "aborted" }, { seat: "s1", result: "aborted" }]);
    assert.deepEqual(w.finished, [], "no winner, no loser: ranking never hears of it");
    assert.equal(await w.games.activeGameOf(w.alice.id), null, "alice is free to look for another game");
    assert.equal(await w.games.activeGameOf(w.bob.id), null);

    assert.equal((await w.games.session(w.bob.id, grantFor(w.gameId, w.bob.session, w.bob.keys.privateKey))).ok, false, "too late to accept");
    assert.equal((await w.games.decline(w.alice.id, w.gameId)).ok, false, "nothing left to decline");
  });

  it("is called off when the time to accept runs out, naming every player who did not sign", async () => {
    const w = await world();
    await w.entropy(w.alice);
    await w.accept(w.alice);
    w.setup.clock.advance(DEFAULT_TIME_POLICY.entropyMs + SECOND);
    await w.games.tick();
    assert.equal((await w.status()).status, "CREATED", "bob's entropy came from the server, but he has not accepted");
    w.setup.clock.advance(DEFAULT_TIME_POLICY.authorizeMs);
    await w.games.tick();
    assert.deepEqual(await w.status(), { status: "ABORTED", end_reason: "not_authorized" });
    assert.deepEqual(last(w.alice.inbox, "game.aborted").seats, ["s1"]);

    const neither = await world();
    neither.setup.clock.advance(DEFAULT_TIME_POLICY.authorizeMs);
    await neither.games.tick();
    assert.deepEqual(last(neither.bob.inbox, "game.aborted").seats, ["s0", "s1"]);
  });

  it("cannot be declined once it has started", async () => {
    const w = await world();
    for (const player of [w.alice, w.bob]) {
      await w.accept(player);
      await w.entropy(player);
    }
    const refused = await w.games.decline(w.bob.id, w.gameId);
    assert.equal(refused.error.code, "GAME_NOT_ACTIVE");
    assert.equal((await w.status()).status, "ACTIVE");
    const view = await w.games.view(w.bob.id, w.gameId);
    const player = view.snapshot.awaitingPlayerId === "s1" ? w.bob : w.alice;
    const own = await w.games.view(player.id, w.gameId);
    const move = { gameId: w.gameId, commandId: uuidV4(deterministicRandom("move")), expectedVersion: own.version, command: { type: own.snapshot.legalMoves.canEndTurn ? "END_TURN" : "END_PHASE" } };
    assert.equal((await w.games.command(player.id, signedCommand(move, player.session))).ok, true, "the game goes on");
  });

  it("remembers who accepted across a restart, and starts when the other does", async () => {
    const w = await world();
    await w.entropy(w.alice);
    await w.entropy(w.bob);
    await w.accept(w.alice);
    const restarted = await buildTestApp({ signedMoves: true, database: w.setup.database, random: deterministicRandom("restart"), chain: w.setup.chain });
    assert.deepEqual((await restarted.app.games.view(w.bob.id, w.gameId)).authorized, { s0: true, s1: false });
    assert.equal((await restarted.app.games.session(w.bob.id, grantFor(w.gameId, w.bob.session, w.bob.keys.privateKey))).ok, true);
    assert.equal((await restarted.app.games.view(w.bob.id, w.gameId)).status, "ACTIVE");
  });

  it("leaves v1 games as they were: they start on the entropies alone, and cannot be declined", async () => {
    const w = await world({ signedMoves: false });
    assert.equal(last(w.alice.inbox, "match.found").authorizeDeadline, undefined);
    assert.equal((await w.games.decline(w.alice.id, w.gameId)).error.code, "GAME_NOT_ACTIVE");
    await w.entropy(w.alice);
    await w.entropy(w.bob);
    const view = await w.games.view(w.alice.id, w.gameId);
    assert.equal(view.status, "ACTIVE");
    assert.equal(view.authorized, undefined);
  });
});
