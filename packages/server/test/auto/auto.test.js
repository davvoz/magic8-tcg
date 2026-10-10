/**
 * The auto list (docs/tcg/23-automatica.md): a player joins with a deck, an
 * AI style and their entropy, paying a ranked entry at once and staying in
 * until someone comes; the second ticket makes a game the AI plays to its
 * end for both, recorded finished, rated at the auto weight and replayable
 * by anyone, move by move, with the engine and the AI.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BasicAi } from "@magic8/engine/domain/ai/BasicAi.js";
import { createCoreCommandRegistry } from "@magic8/engine/domain/commands/registerCoreCommands.js";
import { createCoreEffectRegistry } from "@magic8/engine/domain/effects/registerCoreEffects.js";
import { SPECTATOR } from "@magic8/engine/domain/game/GameSnapshot.js";
import { autoGameSecret, createGameEngine, deriveEngineSeed, seedCommitment } from "@magic8/protocol";
import { uuidV4 } from "../../src/kernel/random.js";
import { DEFAULT_RATING, rateGame } from "../../src/modules/ranking/index.js";
import { buildTestApp, bundledContent, deterministicRandom } from "../helpers.js";

const SEASON = "auto-season";
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/**
 * The app with one ranked season running that charges one entry a game, open to everyone.
 * @param {{ endsAt?: string, maxRatedGamesPerPairPerDay?: number }} [options]
 */
async function world({ endsAt, maxRatedGamesPerPairPerDay = 3 } = {}) {
  const bundled = await bundledContent();
  const ranked = structuredClone(bundled.ranked);
  ranked.eligibility.minFinishedCasualGames = 0;
  ranked.fairPlay.maxRatedGamesPerPairPerDay = maxRatedGamesPerPairPerDay;
  ranked.seasons = [{ id: SEASON, name: "Auto season", startsAt: "2026-09-01T00:00:00Z", ...(endsAt === undefined ? {} : { endsAt }), entryFee: 1 }];
  const setup = await buildTestApp({ content: { ...bundled, ranked } });
  const { auto } = setup.app;
  /** A signed-up player with a starter deck and `entries` ranked entries, connected. */
  const player = async (account, { starterId = "precon_foundry", entries = 1 } = {}) => {
    const user = await setup.users.findOrCreate({ network: "steem", account }, setup.clock.now(), uuidV4(deterministicRandom(`user:${account}`)));
    const { deck } = await setup.app.starters.claim({ userId: user.id, starterId, ip: "127.0.0.1" });
    if (entries > 0) {
      await setup.app.entries.credit({ userId: user.id, kind: "ranked", count: entries, orderId: `grant:${account}` });
    }
    const inbox = [];
    setup.app.hub.attach(user.id, { send: (message) => inbox.push(JSON.parse(message)), close: () => undefined });
    return { id: user.id, account, user: { id: user.id, account }, deckId: deck.id, inbox };
  };
  /** Prepares a ticket and joins with it; returns the commitment the player was given, and the status. */
  const enter = async (who, { style = "balanced", entropy = "ab".repeat(16) } = {}) => {
    const { ticket, commit } = await auto.prepare(who.user);
    const status = await auto.join({ user: who.user, ticket, deckId: who.deckId, style, entropy });
    return { ticket, commit, status };
  };
  const balance = async (who) => (await setup.app.entries.view(who.id)).find((entry) => entry.kind === "ranked")?.balance;
  const notes = (who, kind) => setup.database.rows("SELECT data FROM notifications WHERE user_id = $1 AND kind = $2 ORDER BY id", [who.id, kind]).then((rows) => rows.map((row) => row.data));
  return { setup, auto, player, enter, balance, notes };
}

const last = (inbox, type) => inbox.filter((message) => message.t === type).at(-1)?.d;

describe("auto list", () => {
  it("takes the entry when a player joins and keeps them in the list until someone comes", async () => {
    const { setup, auto, player, enter, balance } = await world();
    const alice = await player("alice");
    const { ticket, commit, status } = await enter(alice, { style: "aggressive" });
    assert.match(commit, /^[0-9a-f]{64}$/);
    assert.equal(status.state, "waiting");
    assert.equal(status.ticket, ticket);
    assert.equal(status.style, "aggressive");
    assert.equal(status.deckId, alice.deckId);
    assert.equal(status.waiting, 1);
    assert.equal(await balance(alice), 0, "paid on joining");
    const ledger = await setup.database.rows("SELECT reason, delta, season FROM entry_ledger WHERE ref = $1", [ticket]);
    assert.deepEqual(ledger.map((row) => [row.reason, row.delta, row.season]), [["auto_ticket", -1, SEASON]]);
    assert.equal(last(alice.inbox, "auto.status").state, "waiting");

    setup.clock.advance(DAY);
    await auto.pair();
    assert.equal((await auto.status(alice.id)).state, "waiting", "alone, she waits as long as it takes");
    await assert.rejects(enter(alice), (error) => error.code === "CONFLICT" && /already in the auto list/.test(error.message));
  });

  it("refuses a player without entries, a ticket that is not theirs, a bad style or entropy", async () => {
    const { auto, player, enter, balance } = await world();
    const broke = await player("broke", { entries: 0 });
    await assert.rejects(enter(broke), (error) => error.code === "ENTRY_REQUIRED");
    assert.equal((await auto.status(broke.id)).state, "idle");

    const alice = await player("alice");
    const bob = await player("bob");
    const { ticket } = await auto.prepare(bob.user);
    await assert.rejects(auto.join({ user: alice.user, ticket, deckId: alice.deckId, style: "balanced", entropy: "ab".repeat(16) }), (error) => error.code === "NOT_FOUND");
    const own = await auto.prepare(alice.user);
    await assert.rejects(auto.join({ user: alice.user, ticket: own.ticket, deckId: alice.deckId, style: "reckless", entropy: "ab".repeat(16) }), (error) => error.code === "VALIDATION" && /aggressive, balanced, defensive/.test(error.message));
    await assert.rejects(auto.join({ user: alice.user, ticket: own.ticket, deckId: alice.deckId, style: "balanced", entropy: "AB".repeat(16) }), (error) => error.code === "VALIDATION");
    assert.equal(await balance(alice), 1, "nothing taken");
  });

  it("plays the game when a second player joins: finished, rated at a fifth, both told", async () => {
    const { setup, auto, player, enter, balance, notes } = await world();
    const alice = await player("alice");
    const bob = await player("bob", { starterId: "precon_shadow" });
    await enter(alice, { style: "aggressive", entropy: "11".repeat(16) });
    setup.clock.advance(5 * HOUR);
    await enter(bob, { style: "defensive", entropy: "22".repeat(16) });

    assert.deepEqual([(await auto.status(alice.id)).state, (await auto.status(bob.id)).state], ["idle", "idle"]);
    assert.deepEqual([await balance(alice), await balance(bob)], [0, 0]);
    const [aliceNote] = await notes(alice, "auto.finished");
    const [bobNote] = await notes(bob, "auto.finished");
    assert.equal(aliceNote.gameId, bobNote.gameId);
    assert.deepEqual([aliceNote.opponent, bobNote.opponent], ["bob", "alice"]);
    assert.deepEqual([aliceNote.style, aliceNote.opponentStyle], ["aggressive", "defensive"]);
    assert.deepEqual(new Set([aliceNote.result, bobNote.result]), new Set(["win", "loss"]));
    assert.equal(last(alice.inbox, "auto.status").game, aliceNote.gameId);

    const game = await setup.app.gameRepository.findGame(aliceNote.gameId);
    assert.deepEqual([game.mode, game.status, game.protocolVersion], ["auto", "FINISHED", 1]);
    assert.deepEqual(game.players.map((seat) => [seat.seat, seat.account]), [["s0", "alice"], ["s1", "bob"]], "the older ticket sits at s0");

    // A fifth of the Glicko-2 change of the same game played by hand.
    const won = aliceNote.result === "win" ? 1 : 0;
    const [full] = rateGame(DEFAULT_RATING, DEFAULT_RATING, won);
    const expected = DEFAULT_RATING.rating + 0.2 * (full.rating - DEFAULT_RATING.rating);
    assert.equal(aliceNote.rating.before, DEFAULT_RATING.rating);
    assert.equal(aliceNote.rating.after, Math.round(expected));
    const changes = await setup.database.rows("SELECT mode, weight, counted FROM rating_changes WHERE game_id = $1", [game.id]);
    assert.deepEqual(changes.map((row) => [row.mode, row.weight, row.counted]), [["auto", 0.2, true], ["auto", 0.2, true]]);
    const standing = await setup.app.ranking.standing(alice.id);
    assert.equal(standing.games, 1, "an auto game counts toward a settled rating");

    const history = await setup.app.games.history({ account: "bob" });
    assert.deepEqual(history.games.map((played) => [played.mode, played.opponent]), [["auto", "alice"]]);
  });

  it("publishes everything needed to replay the game and check every move against the AI", async () => {
    const { setup, auto, player, enter, notes } = await world();
    const alice = await player("alice");
    const bob = await player("bob", { starterId: "precon_ember" });
    const first = await enter(alice, { style: "defensive", entropy: "0f".repeat(16) });
    const second = await enter(bob, { style: "aggressive", entropy: "f0".repeat(16) });
    const [{ gameId }] = await notes(alice, "auto.finished");

    const replay = await auto.replay(gameId);
    assert.equal(replay.mode, "auto");
    assert.equal(replay.aiVersion, 1);
    assert.deepEqual(replay.tickets.map((ticket) => [ticket.seat, ticket.account, ticket.style, ticket.commit, ticket.entropy]), [
      ["s0", "alice", "defensive", first.commit, "0f".repeat(16)],
      ["s1", "bob", "aggressive", second.commit, "f0".repeat(16)],
    ]);
    // Each ticket's secret is the one its player was committed to, and the game's derives from both.
    for (const ticket of replay.tickets) {
      assert.equal(seedCommitment(ticket.secret), ticket.commit);
    }
    const events = replay.events;
    const finished = events.at(-1);
    assert.equal(finished.k, "GAME_FINISHED");
    assert.equal(finished.d.secret, autoGameSecret(replay.tickets.map((ticket) => ticket.secret)));
    const entropies = events.filter((event) => event.k === "PLAYER_JOINED").map((event) => event.d.ent);
    assert.deepEqual(entropies, ["0f".repeat(16), "f0".repeat(16)]);

    // Rebuilt from the events alone, every move is the one the AI makes in that seat's style.
    const { content } = setup.app.catalog.current();
    const engine = createGameEngine({
      content: { rules: content.gameRules, catalog: content.catalog, effects: createCoreEffectRegistry(), createCommands: createCoreCommandRegistry },
      accounts: ["alice", "bob"],
      decks: finished.d.decks,
      firstSeat: events.find((event) => event.k === "GAME_STARTED").d.first,
      engineSeed: deriveEngineSeed({ secret: finished.d.secret, entropies, gameId }),
    }).value;
    assert.equal(engine.start().ok, true);
    const players = new Map(replay.tickets.map((ticket) => [ticket.seat, new BasicAi(ticket.style)]));
    const moves = events.filter((event) => event.k === "MOVE");
    assert.ok(moves.length > 20, `a whole game (${moves.length} moves)`);
    for (const move of moves) {
      const decided = players.get(move.a).decide(engine.getSnapshot(move.a));
      assert.deepEqual({ ...decided, playerId: undefined }, { ...move.d, playerId: undefined }, `move ${move.i}`);
      assert.equal(engine.execute({ ...move.d, playerId: move.a }).ok, true);
    }
    const end = engine.getSnapshot(SPECTATOR);
    assert.equal(end.isOver, true);
    assert.equal(end.winnerId, finished.d.win);
    assert.equal(await auto.replay("01arz3ndektsv4rrffq69g5fav"), null, "not a game");
  });

  it("counts the daily limit per pair apart from ranked games by hand", async () => {
    const { setup, auto, player, enter, notes } = await world({ maxRatedGamesPerPairPerDay: 1 });
    const alice = await player("alice", { entries: 2 });
    const bob = await player("bob", { entries: 2 });
    await enter(alice);
    await enter(bob);
    assert.equal((await notes(alice, "auto.finished")).length, 1);

    setup.clock.advance(HOUR);
    await enter(alice);
    await enter(bob);
    assert.deepEqual([(await auto.status(alice.id)).state, (await auto.status(bob.id)).state], ["waiting", "waiting"], "one auto game a day between them");
    assert.deepEqual(await setup.app.ranking.pairsAtLimit([alice.id, bob.id], "ranked"), [], "their ranked games by hand are not limited");

    const carol = await player("carol");
    await enter(carol);
    const [carolGame] = await notes(carol, "auto.finished");
    assert.equal(carolGame.opponent, "alice", "the oldest ticket plays the newcomer");
    assert.equal((await auto.status(bob.id)).state, "waiting");

    setup.clock.advance(DAY);
    await auto.pair();
    assert.equal((await notes(bob, "auto.finished")).length, 1, "bob still has no one left to play");
  });

  it("gives the entry back when the season ends before an opponent comes", async () => {
    const { setup, auto, player, enter, balance, notes } = await world({ endsAt: "2026-09-25T00:00:00Z" });
    const alice = await player("alice");
    const { ticket } = await enter(alice);
    assert.equal(await auto.closeEnded(), 0, "the season still runs");
    setup.clock.advance(DAY);
    assert.equal(await auto.closeEnded(), 1);
    assert.equal(await balance(alice), 1);
    assert.equal((await auto.status(alice.id)).state, "idle");
    assert.deepEqual(await notes(alice, "auto.refunded"), [{ ticket, entries: 1, reason: "season_ended" }]);
    assert.deepEqual(last(alice.inbox, "auto.status"), { state: "idle", reason: "season_ended" });
    assert.equal(await auto.closeEnded(), 0, "once");
    await assert.rejects(enter(alice), (error) => error.code === "CONFLICT" && /no ranked season/.test(error.message));
  });

  it("closes both tickets, entries back, when their game cannot be played", async () => {
    const { setup, player, enter, balance, notes } = await world();
    const alice = await player("alice");
    const bob = await player("bob");
    const { ticket } = await enter(alice);
    await setup.database.query("UPDATE auto_tickets SET deck_snapshot = $2 WHERE id = $1", [ticket, JSON.stringify([["no_such_card", 30]])]);
    await enter(bob);
    assert.deepEqual([await balance(alice), await balance(bob)], [1, 1]);
    assert.deepEqual((await notes(alice, "auto.refunded")).map((note) => note.reason), ["failed"]);
    assert.deepEqual((await notes(bob, "auto.refunded")).map((note) => note.reason), ["failed"]);
    assert.equal((await setup.database.rows("SELECT id FROM games WHERE mode = 'auto'")).length, 0, "no game left behind");
    assert.ok(setup.logger.entries.some((entry) => entry.level === "error" && /auto game could not be played/.test(entry.message)));
  });

  it("stops new tickets and games during an announced maintenance, keeping those waiting", async () => {
    const { setup, auto, player, enter } = await world();
    const alice = await player("alice");
    const bob = await player("bob");
    await enter(alice);
    await setup.app.maintenance.announce({ userId: null }, { minutes: 15, message: null });
    await assert.rejects(auto.prepare(bob.user), (error) => error.code === "MAINTENANCE");
    assert.equal(await auto.pair(), 0);
    assert.equal((await auto.status(alice.id)).state, "waiting");
  });
});
