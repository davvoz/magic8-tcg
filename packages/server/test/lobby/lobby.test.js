/**
 * The lobby: who is online and what they are doing, and challenges between
 * players — sent, accepted into a game without the queue, declined,
 * cancelled, replaced, lapsed, called off when a player leaves or gets
 * into a game — with ranked challenges only between eligible players.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { uuidV4 } from "../../src/kernel/random.js";
import { buildTestApp, bundledContent, deterministicRandom } from "../helpers.js";

const SECOND = 1000;

/** The app; `eligibility` adjusts who may play ranked. */
async function world({ eligibility = { minFinishedCasualGames: 3 } } = {}) {
  const bundled = await bundledContent();
  const ranked = structuredClone(bundled.ranked);
  Object.assign(ranked.eligibility, eligibility);
  // Ranked games cost entries in the bundled seasons; what that does is tested in entries.test.js.
  ranked.seasons = ranked.seasons.map(({ entryFee: _fee, ...season }) => season);
  const setup = await buildTestApp({ content: { ...bundled, ranked }, lobbyPolicy: { listCacheMs: 0 } });
  /** A signed-up player with a starter deck, online (connected) unless said otherwise. */
  const player = async (account, { online = true, starterId = "precon_foundry" } = {}) => {
    const user = await setup.users.findOrCreate({ network: "steem", account }, setup.clock.now(), uuidV4(deterministicRandom(`user:${account}`)));
    const { deck } = await setup.app.starters.claim({ userId: user.id, starterId, ip: "127.0.0.1" });
    const inbox = [];
    if (online) {
      setup.app.hub.attach(user.id, { send: (message) => inbox.push(JSON.parse(message)), close: () => undefined });
    }
    return { user: { userId: user.id, account }, id: user.id, deckId: deck.id, inbox };
  };
  return { setup, lobby: setup.app.lobby, player };
}

const last = (inbox, type) => inbox.filter((message) => message.t === type).at(-1)?.d;

describe("lobby", () => {
  it("lists the other players online with what they are doing, ready ones first", async () => {
    const { setup, lobby, player } = await world();
    const alice = await player("alice");
    const bob = await player("bob");
    const carol = await player("carol");
    await player("dave", { online: false });
    await setup.app.matchmaking.join({ user: { id: carol.id, account: "carol" }, mode: "casual", deckId: carol.deckId });

    const view = await lobby.view(alice.id);
    assert.deepEqual(view.players, [
      { account: "bob", status: "idle" },
      { account: "carol", status: "searching" },
    ]);
    assert.deepEqual(view.challenges, { incoming: [], outgoing: null });

    await setup.app.matchmaking.join({ user: { id: bob.id, account: "bob" }, mode: "casual", deckId: bob.deckId });
    const playing = await lobby.view(alice.id);
    assert.deepEqual(playing.players, [
      { account: "bob", status: "playing" },
      { account: "carol", status: "playing" },
    ]);
  });

  it("starts a game when a challenge is accepted, taking both players out of the queue", async () => {
    const { setup, lobby, player } = await world();
    const alice = await player("alice");
    const bob = await player("bob", { starterId: "precon_shadow" });
    await setup.app.matchmaking.join({ user: { id: bob.id, account: "bob" }, mode: "casual", deckId: bob.deckId });

    const sent = await lobby.challenge({ user: alice.user, to: "bob", mode: "casual", deckId: alice.deckId });
    assert.deepEqual([sent.from, sent.to, sent.mode, sent.expiresInMs], ["alice", "bob", "casual", 60 * SECOND]);
    assert.deepEqual(last(bob.inbox, "challenge.received"), sent);
    assert.deepEqual(lobby.challengesOf(bob.id).incoming, [sent]);
    assert.deepEqual(lobby.challengesOf(alice.id).outgoing, sent);

    const { gameId } = await lobby.accept({ user: bob.user, challengeId: sent.id, deckId: bob.deckId });
    assert.equal(last(alice.inbox, "match.found").gameId, gameId);
    assert.equal(last(bob.inbox, "match.found").gameId, gameId);
    assert.deepEqual(last(alice.inbox, "challenge.closed"), { challengeId: sent.id, reason: "accepted", gameId });
    assert.equal(last(bob.inbox, "queue.status").state, "idle", "bob left the queue");
    assert.deepEqual(await setup.app.matchmaking.status(bob.id), { state: "idle" });
    const players = await setup.database.rows("SELECT account FROM game_players WHERE game_id = $1 ORDER BY seat", [gameId]);
    assert.deepEqual(players.map((row) => row.account), ["alice", "bob"], "the challenger sits first");
    const [game] = await setup.database.rows("SELECT mode FROM games WHERE id = $1", [gameId]);
    assert.equal(game.mode, "casual");
    assert.deepEqual(lobby.challengesOf(alice.id), { incoming: [], outgoing: null });
    await assert.rejects(lobby.accept({ user: bob.user, challengeId: sent.id, deckId: bob.deckId }), /no longer open/);
  });

  it("tells the challenger when the challenge is declined, and makes them wait before asking again", async () => {
    const { setup, lobby, player } = await world();
    const alice = await player("alice");
    const bob = await player("bob");
    const sent = await lobby.challenge({ user: alice.user, to: "bob", mode: "casual", deckId: alice.deckId });
    assert.throws(() => lobby.decline({ user: alice.user, challengeId: sent.id }), /no longer open/, "only the challenged player declines");
    lobby.decline({ user: bob.user, challengeId: sent.id });
    assert.deepEqual(last(alice.inbox, "challenge.closed"), { challengeId: sent.id, reason: "declined" });
    assert.equal(last(bob.inbox, "challenge.closed"), undefined, "bob knows: he said no");
    await assert.rejects(lobby.challenge({ user: alice.user, to: "bob", mode: "casual", deckId: alice.deckId }), (error) => error.code === "RATE_LIMITED");
    setup.clock.advance(31 * SECOND);
    await lobby.challenge({ user: alice.user, to: "bob", mode: "casual", deckId: alice.deckId });
  });

  it("lets the challenger take a challenge back, or replace it with another", async () => {
    const { lobby, player } = await world();
    const alice = await player("alice");
    const bob = await player("bob");
    const carol = await player("carol");
    const first = await lobby.challenge({ user: alice.user, to: "bob", mode: "casual", deckId: alice.deckId });
    const second = await lobby.challenge({ user: alice.user, to: "carol", mode: "casual", deckId: alice.deckId });
    assert.deepEqual(last(bob.inbox, "challenge.closed"), { challengeId: first.id, reason: "cancelled" });
    assert.deepEqual(lobby.challengesOf(alice.id).outgoing, second);
    lobby.cancel({ user: alice.user, challengeId: second.id });
    assert.deepEqual(last(carol.inbox, "challenge.closed"), { challengeId: second.id, reason: "cancelled" });
    assert.deepEqual(lobby.challengesOf(carol.id).incoming, []);
  });

  it("refuses challenges to players who are offline, busy or yourself, and with unplayable decks", async () => {
    const { setup, lobby, player } = await world();
    const alice = await player("alice");
    await player("dave", { online: false });
    const bob = await player("bob");
    const carol = await player("carol");
    await assert.rejects(lobby.challenge({ user: alice.user, to: "dave", mode: "casual", deckId: alice.deckId }), /@dave is not online/);
    await assert.rejects(lobby.challenge({ user: alice.user, to: "nobody", mode: "casual", deckId: alice.deckId }), /@nobody is not online/);
    await assert.rejects(lobby.challenge({ user: alice.user, to: "alice", mode: "casual", deckId: alice.deckId }), /cannot challenge yourself/);
    await assert.rejects(lobby.challenge({ user: alice.user, to: "bob", mode: "arena", deckId: alice.deckId }), /mode must be one of/);
    const draft = await setup.app.decks.create(alice.id, { name: "Draft", cards: [] });
    await assert.rejects(lobby.challenge({ user: alice.user, to: "bob", mode: "casual", deckId: draft.id }), /cannot be played/);
    await setup.app.matchmaking.join({ user: { id: bob.id, account: "bob" }, mode: "casual", deckId: bob.deckId });
    await setup.app.matchmaking.join({ user: { id: carol.id, account: "carol" }, mode: "casual", deckId: carol.deckId });
    await assert.rejects(lobby.challenge({ user: alice.user, to: "bob", mode: "casual", deckId: alice.deckId }), /@bob is in a game/);
    assert.deepEqual(lobby.challengesOf(bob.id).incoming, []);
  });

  it("allows ranked challenges only between players who may both play ranked", async () => {
    const { lobby, player } = await world({ eligibility: { minFinishedCasualGames: 0 } });
    const alice = await player("alice");
    const bob = await player("bob");
    const sent = await lobby.challenge({ user: alice.user, to: "bob", mode: "ranked", deckId: alice.deckId });
    const { gameId } = await lobby.accept({ user: bob.user, challengeId: sent.id, deckId: bob.deckId });
    assert.equal(last(alice.inbox, "match.found").gameId, gameId);

    const strict = await world();
    const carol = await strict.player("carol");
    await strict.player("dave");
    await assert.rejects(strict.lobby.challenge({ user: carol.user, to: "dave", mode: "ranked", deckId: carol.deckId }), /finish 3 more casual game/);
  });

  it("tells the challenger when the challenged player cannot play ranked yet", async () => {
    const { setup, lobby, player } = await world({ eligibility: { minFinishedCasualGames: 1 } });
    const alice = await player("alice");
    const bob = await player("bob");
    const carol = await player("carol");
    // alice and carol finish a casual game; bob has played none.
    const casual = await lobby.challenge({ user: alice.user, to: "carol", mode: "casual", deckId: alice.deckId });
    const { gameId } = await lobby.accept({ user: carol.user, challengeId: casual.id, deckId: carol.deckId });
    await setup.app.games.entropy(alice.id, gameId, "0a".repeat(16));
    await setup.app.games.entropy(carol.id, gameId, "0b".repeat(16));
    assert.equal((await setup.app.games.concede(carol.id, { gameId, commandId: uuidV4(deterministicRandom("concede")) })).ok, true);

    await assert.rejects(lobby.challenge({ user: alice.user, to: "bob", mode: "ranked", deckId: alice.deckId }), /@bob cannot play ranked yet/);
    await assert.rejects(lobby.challenge({ user: bob.user, to: "alice", mode: "ranked", deckId: bob.deckId }), /finish 1 more casual game/);
    await lobby.challenge({ user: alice.user, to: "bob", mode: "casual", deckId: alice.deckId });
  });

  it("closes a challenge nobody answered, telling both players", async () => {
    const { setup, lobby, player } = await world();
    const alice = await player("alice");
    const bob = await player("bob");
    const sent = await lobby.challenge({ user: alice.user, to: "bob", mode: "casual", deckId: alice.deckId });
    setup.clock.advance(59 * SECOND);
    assert.equal(lobby.expireDue(), 0);
    setup.clock.advance(SECOND);
    assert.equal(lobby.expireDue(), 1);
    assert.deepEqual(last(alice.inbox, "challenge.closed"), { challengeId: sent.id, reason: "expired" });
    assert.deepEqual(last(bob.inbox, "challenge.closed"), { challengeId: sent.id, reason: "expired" });
    await assert.rejects(lobby.accept({ user: bob.user, challengeId: sent.id, deckId: bob.deckId }), /no longer open/);
  });

  it("calls off the challenges of a player who leaves, and of players who got into a game", async () => {
    const { lobby, player } = await world();
    const alice = await player("alice");
    const bob = await player("bob");
    const carol = await player("carol");
    const dave = await player("dave");
    const toBob = await lobby.challenge({ user: alice.user, to: "bob", mode: "casual", deckId: alice.deckId });
    const toAlice = await lobby.challenge({ user: carol.user, to: "alice", mode: "casual", deckId: carol.deckId });
    const toCarol = await lobby.challenge({ user: dave.user, to: "carol", mode: "casual", deckId: dave.deckId });

    await lobby.accept({ user: alice.user, challengeId: toAlice.id, deckId: alice.deckId });
    assert.deepEqual(last(bob.inbox, "challenge.closed"), { challengeId: toBob.id, reason: "busy" }, "alice is playing carol now");
    assert.deepEqual(last(dave.inbox, "challenge.closed"), { challengeId: toCarol.id, reason: "busy" });

    const eve = await player("eve");
    const toEve = await lobby.challenge({ user: bob.user, to: "eve", mode: "casual", deckId: bob.deckId });
    lobby.disconnected(eve.id);
    assert.deepEqual(last(bob.inbox, "challenge.closed"), { challengeId: toEve.id, reason: "offline" });
  });

  it("calls everything off for a maintenance, and refuses new challenges during it", async () => {
    const { setup, lobby, player } = await world();
    const alice = await player("alice");
    const bob = await player("bob");
    const sent = await lobby.challenge({ user: alice.user, to: "bob", mode: "casual", deckId: alice.deckId });
    await setup.app.maintenance.announce({ userId: null }, { minutes: 15, message: null });
    await new Promise((resolve) => setTimeout(resolve, 20)); // the maintenance listeners run after the announcement
    assert.deepEqual(last(alice.inbox, "challenge.closed"), { challengeId: sent.id, reason: "maintenance" });
    assert.deepEqual(last(bob.inbox, "challenge.closed"), { challengeId: sent.id, reason: "maintenance" });
    await assert.rejects(lobby.challenge({ user: alice.user, to: "bob", mode: "casual", deckId: alice.deckId }), (error) => error.code === "MAINTENANCE");
  });
});
