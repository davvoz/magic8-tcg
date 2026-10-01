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

/** The app with ranked settings adjusted for a test. */
async function world(overrides = {}) {
  const bundled = await bundledContent();
  const ranked = structuredClone(bundled.ranked);
  Object.assign(ranked.eligibility, overrides.eligibility ?? { minFinishedCasualGames: 0 });
  Object.assign(ranked.fairPlay, overrides.fairPlay ?? {});
  if (overrides.seasons !== undefined) {
    ranked.seasons = overrides.seasons;
  }
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

const setRating = (setup, user, rating, rd = 60) =>
  setup.database.query("INSERT INTO ratings (season, user_id, account, rating, rd, volatility, updated_at) VALUES ($1, $2, $3, $4, $5, 0.06, now())", [SEASON, user.user.id, user.user.account, rating, rd]);

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

  it("pairs two players again past the daily limit, straight away", async () => {
    const { setup, player } = await world({ fairPlay: { maxRatedGamesPerPairPerDay: 1 } });
    const alice = await player("alice");
    const bob = await player("bob");
    await rankedGame(setup, alice, bob, bob);
    await setup.app.matchmaking.join({ user: alice.user, mode: "ranked", deckId: alice.deckId });
    await setup.app.matchmaking.join({ user: bob.user, mode: "ranked", deckId: bob.deckId });
    const rematch = last(bob.inbox, "match.found");
    assert.equal(last(alice.inbox, "match.found").gameId, rematch.gameId);
    const before = await setup.app.ranking.ratingOf(alice.user.id);
    await playAndConcede(setup, rematch.gameId, [alice, bob], bob);
    const [change] = await setup.database.rows("SELECT counted, reason FROM rating_changes WHERE game_id = $1 AND user_id = $2", [rematch.gameId, alice.user.id]);
    assert.deepEqual([change.counted, change.reason], [false, "repeat_pair"], "played, recorded, but not rated");
    assert.equal((await setup.app.ranking.ratingOf(alice.user.id)).rating, before.rating);
  });

  it("publishes a leaderboard: settled ratings ranked, provisional ones listed after them", async () => {
    const { setup, player } = await world();
    const alice = await player("alice");
    const bob = await player("bob");
    const carol = await player("carol");
    await setRating(setup, alice, 1720, 60);
    await setRating(setup, bob, 1610, 80);
    await setRating(setup, carol, 1900, 200);
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
