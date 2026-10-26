/**
 * Ranked play end to end on the real services: eligibility, the ranked
 * queue pairing anyone with anyone, ratings updated once per game, the daily limit
 * between the same players, fair-play flags, the leaderboard and a
 * player's standing, the catch-up of missed games, and rating decay.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { uuidV4 } from "../../src/kernel/random.js";
import { validateRankedSettings } from "../../src/modules/ranking/index.js";
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
  if (overrides.decay !== undefined) {
    ranked.decay = overrides.decay;
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

const bundledRanked = (await bundledContent()).ranked;

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

/**
 * Records a rated game straight away (no queue, no moves): `winner` beats `loser`, the game ending at `turn` by `endReason`.
 * An auto game is recorded on a ranked one: the ranking reads the mode it is told.
 */
async function recordGame(setup, winner, loser, { mode = "ranked", endReason = "life_depleted", turn = 8 } = {}) {
  const deck = setup.app.catalog.current().content.preconDecks[0].entries;
  const gameId = await setup.app.games.createGame({ mode: "ranked", entrants: [winner, loser].map((entrant) => ({ userId: entrant.user.id, account: entrant.user.account, deckId: null, deck })) });
  const players = [winner, loser].map((entrant, index) => ({ seat: `s${index}`, userId: entrant.user.id, account: entrant.user.account }));
  assert.equal(await setup.app.ranking.record({ gameId, mode, finishedAt: setup.clock.now(), winnerSeat: "s0", endReason, turn, players }), true);
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
    assert.equal(told.message, "You will not be paired with @bob for 23h 00m: at most 2 ranked games a day with the same opponent. Looking for someone else…");
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
    const refused = (error) => error.code === "LIMIT_REACHED" && /^You can play ranked with @\w+ again in 24h 00m: at most 1 ranked game a day with the same opponent\.$/.test(error.message);
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

describe("rating decay", () => {
  // The test clock starts on 2026-09-24 at 10:00 UTC; the season ends two days later.
  const decaying = () =>
    world({
      seasons: [{ id: SEASON, name: "Beta season", startsAt: "2026-09-01T00:00:00Z", endsAt: "2026-09-26T00:00:00Z" }],
      decay: { from: "2026-09-24T00:00:00Z", places: [50, 15, 5] },
    });
  const ratingOf = async (setup, user) => (await setup.app.ranking.ratingOf(user.user.id)).rating;
  const decays = (setup) => setup.database.rows("SELECT to_char(day, 'YYYY-MM-DD') AS day, user_id, place, points FROM rating_decays ORDER BY day, place");

  it("takes rating each day from the first three that played no ranked game by hand, once a day, until the season ends", async () => {
    const { setup, player } = await decaying();
    const [alice, bob, carol, dave] = await Promise.all(["alice", "bob", "carol", "dave"].map((account) => player(account)));
    await setRating(setup, alice, 1800);
    await setRating(setup, bob, 1700);
    await setRating(setup, carol, 1600);
    await setRating(setup, dave, 1500);

    // 2026-09-24: bob's opponent concedes on turn 1, alice plays only an auto game, carol wins a whole ranked game.
    await rankedGame(setup, bob, dave, dave);
    await recordGame(setup, alice, dave, { mode: "auto" });
    await recordGame(setup, carol, dave);
    const warned = await setup.app.ranking.standing(alice.user.id);
    assert.deepEqual(warned.decay, { points: 50, safe: false, at: Date.UTC(2026, 8, 25) }, "the leader is told what the day will cost");
    assert.deepEqual((await setup.app.ranking.standing(carol.user.id)).decay, { points: 5, safe: true, at: Date.UTC(2026, 8, 25) }, "a whole ranked game saves the day");
    assert.equal((await setup.app.ranking.standing(dave.user.id)).decay, null, "4th: nothing to lose");
    const before = await Promise.all([alice, bob, carol].map((user) => ratingOf(setup, user)));

    setup.clock.advance(Date.UTC(2026, 8, 25, 0, 3) - setup.clock.now());
    assert.equal(await setup.app.ranking.decay(), 0, "a few minutes after midnight, so a late game is recorded first");
    setup.clock.advance(3 * 60 * 1000);
    assert.equal(await setup.app.ranking.decay(), 2);
    assert.equal(await setup.app.ranking.decay(), 0, "once a day");
    assert.deepEqual(await Promise.all([alice, bob, carol].map((user) => ratingOf(setup, user))), [before[0] - 50, before[1] - 15, before[2]], "an auto game and an early concession save nobody");
    const [notice] = await setup.database.rows("SELECT data FROM notifications WHERE user_id = $1 AND kind = 'ranking.decay'", [alice.user.id]);
    assert.deepEqual(notice.data, { season: "Beta season", day: "2026-09-24", place: 1, points: 50, before: Math.round(before[0]), after: Math.round(before[0] - 50) });

    // Nobody plays on 2026-09-25, the season's last day; nothing decays after the season.
    setup.clock.advance(3 * DAY);
    assert.equal(await setup.app.ranking.decay(), 3);
    assert.deepEqual(
      (await decays(setup)).map((row) => [row.day, row.user_id, row.place, row.points]),
      [
        ["2026-09-24", alice.user.id, 1, 50],
        ["2026-09-24", bob.user.id, 2, 15],
        ["2026-09-25", alice.user.id, 1, 50],
        ["2026-09-25", bob.user.id, 2, 15],
        ["2026-09-25", carol.user.id, 3, 5],
      ],
    );
    const days = await setup.database.rows("SELECT to_char(day, 'YYYY-MM-DD') AS day FROM rating_decay_days ORDER BY day");
    assert.deepEqual(days.map((row) => row.day), ["2026-09-24", "2026-09-25"], "from decay.from to the season's end");
    assert.equal((await setup.app.ranking.standing(alice.user.id)).decay, null, "no season, no decay");
  });

  it("takes the places from the leaderboard before the day's decay, and leaves provisional ratings alone", async () => {
    const { setup, player } = await decaying();
    const [alice, bob, carol] = await Promise.all(["alice", "bob", "carol"].map((account) => player(account)));
    await setRating(setup, alice, 1700);
    await setRating(setup, bob, 1680);
    await setRating(setup, carol, 2000, 2);
    setup.clock.advance(Date.UTC(2026, 8, 25, 0, 10) - setup.clock.now());
    assert.equal(await setup.app.ranking.decay(), 2);
    assert.deepEqual([await ratingOf(setup, alice), await ratingOf(setup, bob), await ratingOf(setup, carol)], [1650, 1665, 2000], "1st and 2nd as they were at midnight: they swap places");
    assert.equal((await setup.app.ranking.standing(bob.user.id)).rank, 1);
  });

  it("checks the decay settings", () => {
    const ranked = (decay) => ({ ...structuredClone(bundledRanked), decay });
    assert.equal(validateRankedSettings(ranked(undefined)).value.decay, null, "left out: no decay");
    assert.deepEqual(validateRankedSettings(ranked({ from: "2026-10-27T00:00:00Z", places: [50, 15, 5] })).value.decay, { from: Date.UTC(2026, 9, 27), places: [50, 15, 5] });
    assert.equal(validateRankedSettings(ranked({ from: "2026-10-27T10:00:00Z", places: [50] })).ok, false, "a day starts at midnight");
    assert.equal(validateRankedSettings(ranked({ from: "2026-10-27T00:00:00Z", places: [] })).ok, false);
    assert.equal(validateRankedSettings(ranked({ from: "2026-10-27T00:00:00Z", places: [-1] })).ok, false);
  });
});
