/**
 * Ranked play end to end on the real services: eligibility, the ranked
 * queue pairing anyone with anyone, ratings updated once per game, the daily limit
 * between the same players, fair-play flags, the leaderboard and a
 * player's standing, and the catch-up of missed games.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { uuidV4 } from "../../src/kernel/random.js";
import { buildTestApp, bundledContent, deterministicRandom, listen } from "../helpers.js";
import { ApiClient } from "../support/apiClient.js";

const SEASON = "2026-s1";
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** The app with ranked settings adjusted for a test. */
async function world(overrides = {}) {
  const bundled = await bundledContent();
  const ranked = structuredClone(bundled.ranked);
  Object.assign(ranked.eligibility, overrides.eligibility ?? { minFinishedCasualGames: 0 });
  Object.assign(ranked.fairPlay, overrides.fairPlay ?? {});
  if (overrides.seasons !== undefined) {
    ranked.seasons = overrides.seasons;
  }
  // Ranked games cost entries in the bundled seasons; what that does is tested in entries.test.js.
  ranked.seasons = ranked.seasons.map(({ entryFee: _fee, ...season }) => season);
  const setup = await buildTestApp({ content: { ...bundled, ranked } });
  const player = async (account, starterId = "precon_foundry") => {
    const user = await setup.users.findOrCreate({ network: "steem", account }, setup.clock.now(), uuidV4(deterministicRandom(`user:${account}`)));
    const { deck } = await setup.app.starters.claim({ userId: user.id, starterId, ip: "127.0.0.1" });
    const inbox = [];
    setup.app.hub.attach(user.id, { send: (message) => inbox.push(JSON.parse(message)), close: () => undefined });
    return { user: { id: user.id, account }, deckId: deck.id, inbox };
  };
  return { setup, player };
}

const last = (inbox, type) => inbox.filter((message) => message.t === type).at(-1)?.d;

/** Both players send entropy, then `loser` concedes. */
async function playAndConcede(setup, gameId, [first, second], loser) {
  await setup.app.games.entropy(first.user.id, gameId, "0a".repeat(16));
  await setup.app.games.entropy(second.user.id, gameId, "0b".repeat(16));
  const ack = await setup.app.games.concede(loser.user.id, { gameId, commandId: uuidV4(deterministicRandom(`concede:${gameId}`)) });
  assert.equal(ack.ok, true);
  await new Promise((resolve) => setTimeout(resolve, 20)); // the ranking listener runs after the game's commit
}

async function rankedGame(setup, a, b, loser) {
  await setup.app.matchmaking.join({ user: a.user, mode: "ranked", deckId: a.deckId });
  setup.clock.advance(1000);
  await setup.app.matchmaking.join({ user: b.user, mode: "ranked", deckId: b.deckId });
  const found = last(a.inbox, "match.found");
  assert.ok(found, "matched");
  await playAndConcede(setup, found.gameId, [a, b], loser);
  return found.gameId;
}

const setRating = (setup, user, rating, games = 10) =>
  setup.database.query("INSERT INTO ratings (season, user_id, account, rating, rd, volatility, games, updated_at) VALUES ($1, $2, $3, $4, 60, 0.06, $5, now())", [SEASON, user.user.id, user.user.account, rating, games]);

describe("ranked play", () => {
  it("rates a ranked game once, for both players, and shows it in the standings", async () => {
    const { setup, player } = await world();
    const alice = await player("alice");
    const bob = await player("bob", "precon_shadow");
    const gameId = await rankedGame(setup, alice, bob, bob);
    const [game] = await setup.database.rows("SELECT mode FROM games WHERE id = $1", [gameId]);
    assert.equal(game.mode, "ranked");

    const changes = await setup.database.rows("SELECT user_id, score, counted, rating_before, rating_after FROM rating_changes WHERE game_id = $1 ORDER BY score DESC", [gameId]);
    assert.equal(changes.length, 2);
    assert.deepEqual(changes.map((change) => [change.user_id, change.score, change.counted]), [[alice.user.id, 1, true], [bob.user.id, 0, true]]);
    assert.ok(changes[0].rating_after > 1500 && changes[1].rating_after < 1500);

    const standing = await setup.app.ranking.standing(alice.user.id);
    assert.deepEqual([standing.games, standing.wins, standing.provisional, standing.rank, standing.season.id], [1, 1, true, null, SEASON], "one game: still provisional");
    assert.ok(standing.rating > 1500);
    assert.equal(await setup.app.ranking.record({ gameId, mode: "ranked", finishedAt: setup.clock.now(), winnerSeat: "s0", endReason: "concede", turn: 1, players: [] }), false);
    assert.equal(await setup.app.ranking.catchUp(), 0, "nothing was missed");
    assert.equal((await setup.database.rows("SELECT * FROM rating_changes")).length, 2, "recorded once");

    setup.clock.advance(1000);
    await rankedGame(setup, alice, bob, bob);
    assert.equal((await setup.app.ranking.standing(alice.user.id)).provisional, true, "two games: still provisional");
    setup.clock.advance(1000);
    await rankedGame(setup, alice, bob, bob);
    const settled = await setup.app.ranking.standing(alice.user.id);
    assert.deepEqual([settled.games, settled.provisional, settled.rank], [3, false, 1], "three games: settled and ranked");
  });

  it("lets only eligible players queue ranked, and only during a season", async () => {
    const { setup, player } = await world({ eligibility: { minFinishedCasualGames: 1 } });
    const alice = await player("alice");
    const bob = await player("bob");
    await assert.rejects(setup.app.matchmaking.join({ user: alice.user, mode: "ranked", deckId: alice.deckId }), /finish 1 more casual game/);
    await setup.app.matchmaking.join({ user: alice.user, mode: "casual", deckId: alice.deckId });
    await setup.app.matchmaking.join({ user: bob.user, mode: "casual", deckId: bob.deckId });
    await playAndConcede(setup, last(alice.inbox, "match.found").gameId, [alice, bob], alice);
    assert.equal((await setup.app.matchmaking.join({ user: alice.user, mode: "ranked", deckId: alice.deckId })).state, "searching");
    assert.equal((await setup.database.rows("SELECT * FROM rating_changes")).length, 0, "casual games are not rated");

    const early = await world({ seasons: [{ id: "later", name: "Later", startsAt: "2030-01-01T00:00:00Z" }] });
    const carol = await early.player("carol");
    await assert.rejects(early.setup.app.matchmaking.join({ user: carol.user, mode: "ranked", deckId: carol.deckId }), /no ranked season/);
  });

  it("pairs any two ranked players straight away, however far apart their ratings", async () => {
    const { setup, player } = await world();
    const strong = await player("strong");
    const weak = await player("weak");
    await setRating(setup, strong, 2400);
    await setRating(setup, weak, 1100);
    await setup.app.matchmaking.join({ user: strong.user, mode: "ranked", deckId: strong.deckId });
    await setup.app.matchmaking.join({ user: weak.user, mode: "ranked", deckId: weak.deckId });
    assert.equal(last(weak.inbox, "match.found").gameId, last(strong.inbox, "match.found").gameId, "1300 points apart, no wait");
  });

  it("stops rating the same two players after the daily limit, and flags quick concessions", async () => {
    const { setup, player } = await world({ fairPlay: { maxRatedGamesPerPairPerDay: 1, earlyConcedesToFlag: 2 } });
    const alice = await player("alice");
    const bob = await player("bob");
    await rankedGame(setup, alice, bob, bob);

    // Another game between them (here created outside the queue) is not counted, and is flagged.
    const deck = setup.app.catalog.current().content.preconDecks[0].entries;
    const before = await setup.app.ranking.ratingOf(alice.user.id);
    const extra = await setup.app.games.createGame({ mode: "ranked", entrants: [alice, bob].map((entrant) => ({ userId: entrant.user.id, account: entrant.user.account, deckId: null, deck })) });
    setup.clock.advance(1000);
    await playAndConcede(setup, extra, [alice, bob], bob);
    const [change] = await setup.database.rows("SELECT counted, reason FROM rating_changes WHERE game_id = $1 AND user_id = $2", [extra, alice.user.id]);
    assert.deepEqual([change.counted, change.reason], [false, "repeat_pair"]);
    assert.equal((await setup.app.ranking.ratingOf(alice.user.id)).rating, before.rating, "not counted");
    const flags = await setup.app.ranking.flags();
    assert.deepEqual(flags.map((flag) => flag.kind).sort(), ["early_concedes", "repeat_pair"]);
    const admin = /** @type {any} */ (setup.app).admin;
    assert.deepEqual((await admin.rankingFlags()).length, 2, "operators see them");
  });

  it("holds two players apart in the queue once they played their rated games of the day, and tells them for how long and why", async () => {
    const { setup, player } = await world({ fairPlay: { maxRatedGamesPerPairPerDay: 2 } });
    const alice = await player("alice");
    const bob = await player("bob");
    const carol = await player("carol");
    await rankedGame(setup, alice, bob, bob);
    const firstEnded = setup.clock.now();
    setup.clock.advance(HOUR);
    await rankedGame(setup, alice, bob, alice);
    const games = () => alice.inbox.filter((message) => message.t === "match.found").length;
    const played = games();

    await setup.app.matchmaking.join({ user: alice.user, mode: "ranked", deckId: alice.deckId });
    setup.clock.advance(1000);
    await setup.app.matchmaking.join({ user: bob.user, mode: "ranked", deckId: bob.deckId });
    assert.equal(games(), played, "not paired again");
    const told = last(alice.inbox, "queue.status");
    assert.deepEqual([told.state, told.reason, told.opponent, told.nextAt], ["searching", "pair_limit", "bob", firstEnded + DAY], "free again once their older game is a day old");
    assert.equal(told.message, "You will not be paired with @bob for 23h 00m: you have played 2 ranked games together in 24 hours, the most two players may. Looking for someone else…");
    assert.equal(last(bob.inbox, "queue.status").opponent, "alice");
    await setup.app.matchmaking.pair();
    assert.equal(alice.inbox.filter((message) => message.d?.reason === "pair_limit").length, 1, "told once per search");

    await setup.app.matchmaking.join({ user: carol.user, mode: "ranked", deckId: carol.deckId });
    assert.equal(last(carol.inbox, "match.found").gameId, last(alice.inbox, "match.found").gameId, "the oldest ticket plays the oldest one it may");
    assert.deepEqual(await setup.app.matchmaking.status(bob.user.id), { state: "searching", mode: "ranked", since: told.since + 1000 });
    await playAndConcede(setup, last(alice.inbox, "match.found").gameId, [alice, carol], carol);
    await setup.app.matchmaking.leave(bob.user.id);

    setup.clock.advance(firstEnded + DAY - setup.clock.now());
    await setup.app.matchmaking.join({ user: alice.user, mode: "ranked", deckId: alice.deckId });
    await setup.app.matchmaking.join({ user: bob.user, mode: "ranked", deckId: bob.deckId });
    assert.equal(last(bob.inbox, "match.found").gameId, last(alice.inbox, "match.found").gameId, "a day after their older game, they play again");
  });

  it("refuses a ranked challenge between two players who played their rated games of the day, saying for how long and why", async () => {
    const { setup, player } = await world({ fairPlay: { maxRatedGamesPerPairPerDay: 1 } });
    const alice = await player("alice");
    const bob = await player("bob");
    const asParty = (entrant) => ({ userId: entrant.user.id, account: entrant.user.account });
    const lobby = setup.app.lobby;

    // Sent while they may, accepted after a queue game between them.
    const sent = await lobby.challenge({ user: asParty(alice), to: "bob", mode: "ranked", deckId: alice.deckId });
    await rankedGame(setup, alice, bob, bob);
    const refused = (error) => error.code === "LIMIT_REACHED" && /^You can play ranked with @\w+ again in 24h 00m: you have played 1 ranked game together in 24 hours, the most two players may\.$/.test(error.message);
    await assert.rejects(lobby.accept({ user: asParty(bob), challengeId: sent.id, deckId: bob.deckId }), refused);
    assert.deepEqual(last(alice.inbox, "challenge.closed"), { challengeId: sent.id, reason: "pair_limit" });

    setup.clock.advance(HOUR);
    await assert.rejects(lobby.challenge({ user: asParty(bob), to: "alice", mode: "ranked", deckId: bob.deckId }), (error) => error.code === "LIMIT_REACHED" && /again in 23h 00m/.test(error.message) && error.details.opponent === "alice");
    assert.equal((await lobby.challenge({ user: asParty(bob), to: "alice", mode: "casual", deckId: bob.deckId })).mode, "casual", "casual games are not limited");
  });

  it("publishes a leaderboard: settled ratings ranked, provisional ones listed after them", async () => {
    const { setup, player } = await world();
    const alice = await player("alice");
    const bob = await player("bob");
    const carol = await player("carol");
    await setRating(setup, alice, 1720, 10);
    await setRating(setup, bob, 1610, 3);
    await setRating(setup, carol, 1900, 2);
    const server = await listen(setup.app);
    try {
      const board = (await new ApiClient(server.base).get("/api/ranking/leaderboard")).json;
      assert.equal(board.season.id, SEASON);
      assert.deepEqual(
        board.entries.map((entry) => [entry.rank, entry.provisional, entry.account, entry.rating]),
        [[1, false, "alice", 1720], [2, false, "bob", 1610], [null, true, "carol", 1900]],
        "a provisional rating is listed, after the settled ones and with no rank yet",
      );
      assert.equal((await new ApiClient(server.base).get("/api/ranking/leaderboard?season=bad%20id")).status, 400);
      assert.equal((await new ApiClient(server.base).get("/api/ranking/me")).status, 401);
    } finally {
      await server.close();
    }
    assert.equal((await setup.app.ranking.standing(bob.user.id)).rank, 2);
  });
});
