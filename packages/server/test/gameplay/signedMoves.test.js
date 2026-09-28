/**
 * Game protocol v2 on the server (docs/tcg/12): a player authorises a
 * session key with their account, then every command must be signed with
 * it; the server checks both, records the signature in the MOVE, keeps the
 * keys across a restart, and accepts a newer key that replaces a lost one.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { uuidV4 } from "../../src/kernel/random.js";
import { buildTestApp, deterministicRandom, keyPair } from "../helpers.js";
import { grantFor, sessionKey, signedCommand } from "../support/sessionKeys.js";

const ENTROPY = Object.freeze({ s0: "0a".repeat(16), s1: "0b".repeat(16) });

/** Two players with posting keys on the (fake) chain, and a v2 game between them. */
async function world(options = {}) {
  const setup = await buildTestApp({ signedMoves: true, ...options });
  const content = setup.app.catalog.current().content;
  const person = async (account, seed, deckId) => {
    const keys = keyPair(seed);
    setup.chain.setAccount(account, [keys.publicKey]);
    const user = await setup.users.findOrCreate({ network: "steem", account }, setup.clock.now(), uuidV4(deterministicRandom(`user:${account}`)));
    setup.app.hub.attach(user.id, { send: () => undefined, close: () => undefined });
    return { id: user.id, keys, entrant: { userId: user.id, account, deckId: null, deck: content.preconDecks.find((deck) => deck.id === deckId).entries } };
  };
  const alice = await person("alice", 11, "precon_foundry");
  const bob = await person("bob", 12, "precon_harvest");
  const gameId = await setup.app.games.createGame({ entrants: [alice.entrant, bob.entrant] });
  return { setup, games: setup.app.games, alice, bob, gameId };
}

async function start(w, sessions) {
  for (const [player, session] of [[w.alice, sessions.alice], [w.bob, sessions.bob]]) {
    assert.equal((await w.games.session(player.id, grantFor(w.gameId, session, player.keys.privateKey))).ok, true);
  }
  await w.games.entropy(w.alice.id, w.gameId, ENTROPY.s0);
  await w.games.entropy(w.bob.id, w.gameId, ENTROPY.s1);
}

/** The awaited player's id, their own view, and a pass command. */
async function turnOf(w) {
  const view = await w.games.view(w.alice.id, w.gameId);
  const player = view.snapshot.awaitingPlayerId === view.seat ? w.alice : w.bob;
  const own = await w.games.view(player.id, w.gameId);
  const command = own.snapshot.legalMoves.canEndTurn ? { type: "END_TURN" } : { type: "END_PHASE" };
  return { player, own, command };
}

describe("signed moves on the server (protocol v2)", () => {
  it("announces the version, and accepts only a session key the player's account signed", async () => {
    const w = await world();
    assert.equal((await w.games.view(w.alice.id, w.gameId)).protocol, 2);
    const session = sessionKey();
    const forged = grantFor(w.gameId, session, keyPair(99).privateKey);
    assert.equal((await w.games.session(w.alice.id, forged)).error.code, "INVALID_SIGNATURE", "not alice's posting key");
    const bobsGrant = grantFor(w.gameId, session, w.bob.keys.privateKey);
    assert.equal((await w.games.session(w.alice.id, bobsGrant)).error.code, "INVALID_SIGNATURE", "bob cannot authorise a key for alice's seat");
    assert.equal((await w.games.session(w.alice.id, { ...grantFor(w.gameId, session, w.alice.keys.privateKey), key: sessionKey().key })).error.code, "INVALID_SIGNATURE", "the grant names another key");
    assert.equal((await w.games.session("stranger", grantFor(w.gameId, session, w.alice.keys.privateKey))).error.code, "NOT_IN_GAME");
    assert.equal((await w.games.session(w.alice.id, grantFor(w.gameId, session, w.alice.keys.privateKey))).ok, true);
    const [event] = await w.setup.database.rows("SELECT kind, actor, payload FROM game_events WHERE game_id = $1 AND kind = 'SESSION'", [w.gameId]);
    assert.deepEqual([event.actor, event.payload.key], ["s0", session.key]);
  });

  it("plays only moves signed by the seat's key, over exactly that command, and records the signature", async () => {
    const w = await world();
    const sessions = { alice: sessionKey(), bob: sessionKey() };
    await start(w, sessions);
    const { player, own, command } = await turnOf(w);
    const mine = player === w.alice ? sessions.alice : sessions.bob;
    const theirs = player === w.alice ? sessions.bob : sessions.alice;
    const move = (label) => ({ gameId: w.gameId, commandId: uuidV4(deterministicRandom(label)), expectedVersion: own.version, command });
    const refusal = async (request) => (await w.games.command(player.id, request)).error?.code;
    assert.equal(await refusal(move("unsigned")), "INVALID_SIGNATURE");
    assert.equal(await refusal(signedCommand(move("other-key"), theirs)), "INVALID_SIGNATURE", "signed by the opponent's key");
    assert.equal(await refusal({ ...signedCommand(move("changed"), mine), command: { type: "CONCEDE" } }), "INVALID_SIGNATURE", "the signature covers the command");
    assert.equal(await refusal({ ...signedCommand({ ...move("version"), expectedVersion: own.version + 1 }, mine), expectedVersion: own.version }), "INVALID_SIGNATURE", "and the version");
    const accepted = await w.games.command(player.id, signedCommand(move("good"), mine));
    assert.equal(accepted.ok, true, JSON.stringify(accepted));
    const [event] = await w.setup.database.rows("SELECT payload FROM game_events WHERE game_id = $1 AND kind = 'MOVE'", [w.gameId]);
    assert.deepEqual(Object.keys(event.payload).sort(), ["cid", "cmd", "ev", "sig"]);
    assert.deepEqual(event.payload.cmd, command);

    // A concession is a signed move too.
    const now = await w.games.view(player.id, w.gameId);
    const concede = { gameId: w.gameId, commandId: uuidV4(deterministicRandom("concede")), expectedVersion: now.version, command: { type: "CONCEDE" } };
    assert.equal((await w.games.concede(player.id, { gameId: w.gameId, commandId: uuidV4(deterministicRandom("concede-unsigned")), expectedVersion: now.version })).error.code, "INVALID_SIGNATURE");
    const { signature } = signedCommand(concede, mine);
    assert.equal((await w.games.concede(player.id, { gameId: w.gameId, commandId: uuidV4(deterministicRandom("concede-2")), expectedVersion: now.version, signature })).error.code, "INVALID_SIGNATURE", "signed for another command id");
    assert.equal((await w.games.concede(player.id, { gameId: w.gameId, commandId: concede.commandId, expectedVersion: now.version, signature })).ok, true);
  });

  it("needs both session keys before the game starts, takes a newer one in place of a lost one, and keeps them across a restart", async () => {
    const w = await world();
    const sessions = { alice: sessionKey(), bob: sessionKey() };
    await w.games.entropy(w.alice.id, w.gameId, ENTROPY.s0);
    await w.games.entropy(w.bob.id, w.gameId, ENTROPY.s1);
    const waiting = await w.games.view(w.alice.id, w.gameId);
    assert.deepEqual([waiting.status, waiting.snapshot], ["CREATED", null], "both entropies are in, but nobody has accepted the game with Keychain");
    const early = { gameId: w.gameId, commandId: uuidV4(deterministicRandom("early")), expectedVersion: 0, command: { type: "END_TURN" } };
    assert.equal((await w.games.command(w.alice.id, signedCommand(early, sessions.alice))).error.code, "GAME_NOT_ACTIVE");
    for (const [player, session] of [[w.alice, sessions.alice], [w.bob, sessions.bob]]) {
      await w.games.session(player.id, grantFor(w.gameId, session, player.keys.privateKey));
    }
    let turn = await turnOf(w);
    const signFor = (player) => (player === w.alice ? sessions.alice : sessions.bob);
    const move = (label) => ({ gameId: w.gameId, commandId: uuidV4(deterministicRandom(label)), expectedVersion: turn.own.version, command: turn.command });
    assert.equal((await w.games.command(turn.player.id, signedCommand(move("first"), signFor(turn.player)))).ok, true);

    // The page was reloaded: the browser lost its key and authorises a new one.
    turn = await turnOf(w);
    const lost = signFor(turn.player);
    const replacement = sessionKey();
    if (turn.player === w.alice) {
      sessions.alice = replacement;
    } else {
      sessions.bob = replacement;
    }
    await w.games.session(turn.player.id, grantFor(w.gameId, replacement, turn.player.keys.privateKey));
    assert.equal((await w.games.command(turn.player.id, signedCommand(move("old-key"), lost))).error.code, "INVALID_SIGNATURE");
    assert.equal((await w.games.command(turn.player.id, signedCommand(move("new-key"), replacement))).ok, true);

    // A restarted server rebuilds the game and its keys from the database.
    const restarted = await buildTestApp({ signedMoves: true, database: w.setup.database, random: deterministicRandom("restart"), chain: w.setup.chain });
    const again = { ...w, games: restarted.app.games };
    turn = await turnOf(again);
    const after = { gameId: w.gameId, commandId: uuidV4(deterministicRandom("after-restart")), expectedVersion: turn.own.version, command: turn.command };
    assert.equal((await again.games.command(turn.player.id, signedCommand(after, signFor(turn.player)))).ok, true);
  });

  it("keeps v1 games unsigned", async () => {
    const setup = await buildTestApp();
    assert.equal(setup.config.gameProtocol, 1);
    const w = await world({ signedMoves: false });
    assert.equal((await w.games.view(w.alice.id, w.gameId)).protocol, 1);
    assert.equal((await w.games.session(w.alice.id, grantFor(w.gameId, sessionKey(), w.alice.keys.privateKey))).error.code, "GAME_NOT_ACTIVE");
  });
});
