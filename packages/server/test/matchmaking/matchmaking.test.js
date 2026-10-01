/**
 * The queue: deck revalidation, one ticket per player, pairing that
 * creates exactly one game per pair even when everyone joins at once, and
 * no queueing while already playing.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { uuidV4 } from "../../src/kernel/random.js";
import { buildTestApp, deterministicRandom } from "../helpers.js";

const MINUTE = 60 * 1000;

/** A signed-up player with a claimed starter deck and an inbox. */
async function player(setup, account, starterId = "precon_foundry") {
  const user = await setup.users.findOrCreate({ network: "steem", account }, setup.clock.now(), uuidV4(deterministicRandom(`user:${account}`)));
  const { deck } = await setup.app.starters.claim({ userId: user.id, starterId, ip: "127.0.0.1" });
  const inbox = [];
  setup.app.hub.attach(user.id, { send: (message) => inbox.push(JSON.parse(message)), close: () => undefined });
  return { user: { id: user.id, account }, deckId: deck.id, inbox };
}

const last = (inbox, type) => inbox.filter((message) => message.t === type).at(-1)?.d;

describe("matchmaking", () => {
  it("pairs two waiting players into a game with their frozen decks", async () => {
    const setup = await buildTestApp();
    const alice = await player(setup, "alice");
    const bob = await player(setup, "bob", "precon_shadow");
    const queued = await setup.app.matchmaking.join({ user: alice.user, mode: "casual", deckId: alice.deckId });
    assert.equal(queued.state, "searching");
    assert.equal(last(alice.inbox, "queue.status").state, "searching");
    assert.equal(last(alice.inbox, "match.found"), undefined, "nobody to play with yet");

    setup.clock.advance(1000);
    await setup.app.matchmaking.join({ user: bob.user, mode: "casual", deckId: bob.deckId });
    const found = last(alice.inbox, "match.found");
    assert.ok(found, "matched");
    assert.equal(last(bob.inbox, "match.found").gameId, found.gameId);
    assert.deepEqual([found.seat, last(bob.inbox, "match.found").seat], ["s0", "s1"], "oldest ticket first");
    const tickets = await setup.database.rows("SELECT status, game_id FROM matchmaking ORDER BY created_at");
    assert.deepEqual(tickets.map((ticket) => [ticket.status, ticket.game_id]), [["MATCHED", found.gameId], ["MATCHED", found.gameId]]);
    const players = await setup.database.rows("SELECT account, deck_snapshot FROM game_players WHERE game_id = $1 ORDER BY seat", [found.gameId]);
    assert.deepEqual(players.map((row) => row.account), ["alice", "bob"]);
    assert.equal(players[0].deck_snapshot.reduce((sum, [, count]) => sum + count, 0), 30);

    await assert.rejects(setup.app.matchmaking.join({ user: alice.user, mode: "casual", deckId: alice.deckId }), /already in a game/);
    assert.equal(await setup.app.games.activeGameOf(alice.user.id), found.gameId);
  });

  it("refuses decks that cannot be played or are not yours, and unknown modes", async () => {
    const setup = await buildTestApp();
    const alice = await player(setup, "alice");
    const bob = await player(setup, "bob");
    const draft = await setup.app.decks.create(alice.user.id, { name: "Draft", cards: [] });
    await assert.rejects(setup.app.matchmaking.join({ user: alice.user, mode: "casual", deckId: draft.id }), /cannot be played/);
    await assert.rejects(setup.app.matchmaking.join({ user: alice.user, mode: "casual", deckId: bob.deckId }), (error) => error.code === "NOT_FOUND", "someone else's deck does not exist");
    await assert.rejects(setup.app.matchmaking.join({ user: alice.user, mode: "ranked", deckId: alice.deckId }), /finish 3 more casual game/, "ranked needs finished casual games");
    await assert.rejects(setup.app.matchmaking.join({ user: alice.user, mode: "arena", deckId: alice.deckId }), /mode must be one of casual, ranked/);
    assert.deepEqual(await setup.app.matchmaking.status(alice.user.id), { state: "idle" });
  });

  it("keeps one ticket per player: joining again replaces it, leaving cancels it", async () => {
    const setup = await buildTestApp();
    const alice = await player(setup, "alice");
    await setup.app.matchmaking.join({ user: alice.user, mode: "casual", deckId: alice.deckId });
    await setup.app.matchmaking.join({ user: alice.user, mode: "casual", deckId: alice.deckId });
    const waiting = await setup.database.rows("SELECT status FROM matchmaking WHERE user_id = $1 ORDER BY created_at, status", [alice.user.id]);
    assert.deepEqual(waiting.map((row) => row.status).sort(), ["CANCELLED", "WAITING"]);
    assert.equal(await setup.app.matchmaking.leave(alice.user.id), true);
    assert.equal(last(alice.inbox, "queue.status").state, "idle");
    assert.equal(await setup.app.matchmaking.leave(alice.user.id), false);
    assert.equal(await setup.app.matchmaking.pair(), 0, "alone, and not even waiting");
  });

  it("creates exactly one game per pair when everyone joins at once", async () => {
    const setup = await buildTestApp();
    const players = await Promise.all(["alice", "bob", "carol", "dave", "erin"].map((account) => player(setup, account)));
    await Promise.all(players.map((entrant) => setup.app.matchmaking.join({ user: entrant.user, mode: "casual", deckId: entrant.deckId })));
    const games = await setup.database.rows("SELECT game_id, count(*)::integer AS n FROM game_players GROUP BY game_id");
    assert.equal(games.length, 2);
    assert.ok(games.every((game) => game.n === 2));
    const seated = await setup.database.rows("SELECT user_id, count(*)::integer AS n FROM game_players GROUP BY user_id");
    assert.ok(seated.every((row) => row.n === 1), "nobody plays two games");
    const waiting = await setup.database.rows("SELECT count(*)::integer AS n FROM matchmaking WHERE status = 'WAITING'");
    assert.equal(waiting[0].n, 1, "the fifth player keeps waiting");
  });

  it("expires tickets that waited too long", async () => {
    const setup = await buildTestApp();
    const alice = await player(setup, "alice");
    await setup.app.matchmaking.join({ user: alice.user, mode: "casual", deckId: alice.deckId });
    setup.clock.advance(11 * MINUTE);
    assert.equal(await setup.app.matchmaking.expireStale(), 1);
    assert.deepEqual(await setup.app.matchmaking.status(alice.user.id), { state: "idle" });
  });
});
