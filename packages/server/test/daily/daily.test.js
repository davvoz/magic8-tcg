/**
 * The daily challenges (docs/tcg/24-sfide.md): the same three opponents for
 * everyone each day, a track chosen once a day, challenges played in order
 * against the server's AI and replayed when lost, and a pack, the player's to
 * keep and trade, for winning all three.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SearchAi } from "@magic8/engine/domain/ai/search/SearchAi.js";
import { drawPack, GameMode, parseGrantRecord } from "@magic8/protocol";
import { uuidV4 } from "../../src/kernel/random.js";
import { DailySchedule, Rotation, aiAccountOf, dayOf, validateDailyRoster, validateDailyTracks } from "../../src/modules/daily/index.js";
import { TRADEABLE_ORIGINS } from "../../src/modules/collection/index.js";
import { buildTestApp, bundledContent, deterministicRandom } from "../helpers.js";

const DAY = 24 * 60 * 60 * 1000;

/** The app, and a way to sign up players with a starter deck, connected. */
async function world() {
  const setup = await buildTestApp();
  const { daily, games } = setup.app;
  const player = async (account) => {
    const user = await setup.users.findOrCreate({ network: "steem", account }, setup.clock.now(), uuidV4(deterministicRandom(`user:${account}`)));
    const { deck } = await setup.app.starters.claim({ userId: user.id, starterId: "precon_foundry", ip: "127.0.0.1" });
    const inbox = [];
    setup.app.hub.attach(user.id, { send: (message) => inbox.push(JSON.parse(message)), close: () => undefined });
    return { id: user.id, account, user: { id: user.id, account }, deckId: deck.id, inbox };
  };
  const content = setup.app.catalog.current().content;
  return { setup, daily, games, player, content };
}

/**
 * Plays the player's seat until the game is over, with the search AI, waiting for the server's AI in between.
 * @returns {Promise<string | null>} the winner seat
 */
async function playOut(w, who, gameId, level = 10) {
  const me = new SearchAi({ rules: w.content.gameRules, catalog: w.content.catalog, level });
  for (let step = 0; step < 2000; step += 1) {
    const view = await w.games.view(who.id, gameId);
    if (view.snapshot?.isOver) {
      return view.snapshot.winnerId;
    }
    if (view.snapshot === null || view.snapshot.awaitingPlayerId !== view.seat) {
      await new Promise((resolve) => setTimeout(resolve, 2));
      continue;
    }
    const command = me.decide(view.snapshot);
    const ack = await w.games.command(who.id, { gameId, commandId: uuidV4(deterministicRandom(`${gameId}:${step}`)), expectedVersion: view.version, command });
    assert.equal(ack.ok, true, JSON.stringify(ack));
  }
  assert.fail("the game did not end");
}

/** Waits until the game has started (the player's entropy given, the AI's too). */
async function started(w, who, gameId) {
  assert.equal((await w.games.entropy(who.id, gameId, "cd".repeat(16))).ok, true);
  for (let tries = 0; tries < 200; tries += 1) {
    const view = await w.games.view(who.id, gameId);
    if (view.status === "ACTIVE") {
      return view;
    }
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  assert.fail("the game never started");
}

const finished = (gameId, winnerSeat) => Object.freeze({ gameId, mode: GameMode.DAILY, finishedAt: 0, winnerSeat, endReason: "life_depleted", turn: 9, players: [] });

describe("the daily schedule", () => {
  it("brings the same two characters and a boss to everyone, and others the next day", async () => {
    const { content } = await world();
    const bundled = await bundledContent();
    const roster = /** @type {import("../../src/modules/daily/index.js").DailyRoster} */ (validateDailyRoster(bundled.daily.roster, content).value);
    const schedule = new DailySchedule(roster);
    const today = schedule.forDay("2026-10-15");
    assert.deepEqual(today.map((opponent) => opponent.id), new DailySchedule(roster).forDay("2026-10-15").map((opponent) => opponent.id));
    assert.deepEqual(today.map((opponent) => opponent.boss), [false, false, true]);
    assert.notEqual(today[0].id, today[1].id);
    let yesterday = schedule.forDay("2026-09-30");
    for (let offset = 1; offset <= 120; offset += 1) {
      const day = dayOf(Date.UTC(2026, 8, 30) + offset * DAY);
      const opponents = schedule.forDay(day);
      assert.ok(!opponents.some((opponent) => yesterday.some((met) => met.id === opponent.id)), `${day} repeats the day before`);
      yesterday = opponents;
    }
  });

  it("goes through every character once before any comes back", () => {
    const items = ["a", "b", "c", "d", "e", "f", "g", "h"].map((id) => ({ id }));
    const rotation = new Rotation(items, 2, "test");
    for (let round = 0; round < 6; round += 1) {
      const met = [0, 1, 2, 3].flatMap((slot) => rotation.groupOn(round * 4 + slot).map((item) => item.id));
      assert.deepEqual([...met].sort(), items.map((item) => item.id), `round ${round}`);
    }
  });

  it("refuses a roster with an illegal deck or missing lines, and tracks with a bad level or pack", async () => {
    const { content } = await world();
    const bundled = /** @type {any} */ (await bundledContent());
    const broken = structuredClone(bundled.daily.roster);
    broken.characters[0].deck = "precon_nowhere";
    delete broken.bosses[0].lines.unlock;
    broken.bosses[2].conditions = [{ name: "Doom", text: "Nothing good.", scope: "everyone", rule: { kind: "doom", amount: 1 } }];
    broken.bosses[3].conditions = [{ name: "Mine", text: "Only mine.", scope: "opponent", rule: { kind: "extra_draw", amount: 1, players: ["s1"] } }];
    broken.bosses[1].deck = { base: "precon_iron", add: [{ cardId: "iron_colossus", count: 3 }] };
    const roster = validateDailyRoster(broken, content);
    assert.equal(roster.ok, false);
    const problems = roster.error.details.problems.join("\n");
    assert.match(problems, /precon_nowhere/);
    assert.match(problems, /unlock/);
    assert.match(problems, /breaks the rules/);
    assert.match(problems, /conditions\[0\]\.rule/);
    assert.match(problems, /the scope says whom/);

    const tracks = structuredClone(bundled.daily.tracks);
    tracks.tracks.hard.levels = [6, 7, 11];
    tracks.tracks.normal.reward = "golden_pack";
    const checked = validateDailyTracks(tracks, { hasDropTable: (id) => id.startsWith("core_") });
    assert.equal(checked.ok, false);
    assert.match(checked.error.details.problems.join("\n"), /levels\[2\][\s\S]*golden_pack|golden_pack[\s\S]*levels\[2\]/);
  });
});

describe("daily challenges", () => {
  it("shows today's opponents, and fixes the track for the day", async () => {
    const w = await world();
    const alice = await w.player("alice");
    const before = await w.daily.today(alice.id);
    assert.equal(before.run, null);
    assert.deepEqual(before.opponents.map((opponent) => opponent.state), ["next", "locked", "locked"]);
    assert.deepEqual(before.tracks.map((track) => [track.id, track.reward]), [["normal", "core_mini_booster"], ["hard", "core_booster"]]);
    assert.ok(before.opponents[0].lines.intro.length > 0);
    await assert.rejects(w.daily.play({ user: alice.user, deckId: alice.deckId }), (error) => error.code === "PRECONDITION_REQUIRED");

    const chosen = await w.daily.chooseTrack(alice.id, "normal");
    assert.deepEqual(chosen.run, { track: "normal", stage: 0, gameId: null, attempts: 0, rewarded: false, last: null, reward: null });
    assert.equal((await w.daily.chooseTrack(alice.id, "normal")).run.track, "normal", "the same choice again is harmless");
    await assert.rejects(w.daily.chooseTrack(alice.id, "hard"), (error) => error.code === "CONFLICT");
    await assert.rejects(w.daily.chooseTrack(alice.id, "legendary"), (error) => error.code === "VALIDATION");

    w.setup.clock.advance(DAY);
    assert.equal((await w.daily.today(alice.id)).run, null, "a new day, a new choice");
    assert.equal((await w.daily.chooseTrack(alice.id, "hard")).run.track, "hard");
  });

  it("plays a challenge against the server's AI, which joins, moves on its own and is never published", async () => {
    const w = await world();
    const alice = await w.player("alice");
    await w.daily.chooseTrack(alice.id, "normal");
    const { gameId } = await w.daily.play({ user: alice.user, deckId: alice.deckId });
    assert.deepEqual(await w.daily.play({ user: alice.user, deckId: alice.deckId }), { gameId }, "asking again gives back the game in play");
    const found = alice.inbox.find((message) => message.t === "match.found")?.d;
    assert.equal(found.mode, "daily");
    assert.equal(found.protocol, 1, "nobody signs moves against the AI");
    const opponent = (await w.daily.today(alice.id)).opponents[0];
    assert.equal(found.opponent.account, aiAccountOf(opponent.id));

    await started(w, alice, gameId);
    const winner = await playOut(w, alice, gameId);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const [row] = await w.setup.database.rows("SELECT result FROM daily_games WHERE game_id = $1", [gameId]);
    assert.equal(row.result, winner === "s0" ? "win" : "loss");
    const day = await w.daily.today(alice.id);
    assert.equal(day.run.gameId, null);
    assert.equal(day.run.stage, winner === "s0" ? 1 : 0);
    const players = await w.setup.database.rows("SELECT seat, user_id, account, ai_profile FROM game_players WHERE game_id = $1 ORDER BY seat", [gameId]);
    assert.equal(players[1].user_id, null);
    assert.deepEqual({ ...players[1].ai_profile, salt: undefined }, { id: opponent.id, level: 2, style: opponent.style, salt: undefined });
    const outbox = await w.setup.database.rows("SELECT count(*)::integer AS n FROM blockchain_events WHERE game_id = $1", [gameId]);
    assert.equal(outbox[0].n, 0, "a game against the house stays off chain");
  });

  it("brings the boss's conditions to the table: recorded with the game, played by the engine, shown to the player", async () => {
    const w = await world();
    const alice = await w.player("alice");
    await w.daily.chooseTrack(alice.id, "normal");
    for (let stage = 0; stage < 2; stage += 1) {
      const { gameId } = await w.daily.play({ user: alice.user, deckId: alice.deckId });
      await w.daily.onGameFinished(finished(gameId, "s0"));
      const view = await started(w, alice, gameId);
      await w.games.concede(alice.id, { gameId, commandId: uuidV4(deterministicRandom(`concede:${gameId}`)), expectedVersion: view.version });
    }
    const today = await w.daily.today(alice.id);
    const boss = today.opponents[2];
    assert.equal(boss.state, "next");
    assert.ok(boss.conditions.length > 0, "every boss has a condition");
    assert.deepEqual(Object.keys(boss.conditions[0]).sort(), ["name", "scope", "text"]);

    const { gameId } = await w.daily.play({ user: alice.user, deckId: alice.deckId });
    const [created] = await w.setup.database.rows("SELECT payload FROM game_events WHERE game_id = $1 AND kind = 'GAME_CREATED'", [gameId]);
    const [stored] = await w.setup.database.rows("SELECT conditions FROM games WHERE id = $1", [gameId]);
    assert.ok(Array.isArray(created.payload.cond) && created.payload.cond.length === boss.conditions.length, "in the game's record");
    assert.deepEqual(stored.conditions, created.payload.cond);
    const view = await started(w, alice, gameId);
    assert.deepEqual(view.snapshot.conditions, created.payload.cond, "the engine plays by them, and the player's snapshot says so");
    const players = { challenger: ["s0"], opponent: ["s1"], everyone: ["s0", "s1"] };
    assert.deepEqual(view.snapshot.conditions.map((condition) => condition.players), boss.conditions.map((condition) => players[condition.scope]));
  });

  it("lets a lost challenge be played again, and gives the pack once all three are won", async () => {
    const w = await world();
    const alice = await w.player("alice");
    await w.daily.chooseTrack(alice.id, "hard");
    const play = async () => (await w.daily.play({ user: alice.user, deckId: alice.deckId })).gameId;
    const end = async (gameId, winnerSeat) => {
      await w.daily.onGameFinished(finished(gameId, winnerSeat));
      // Ends the game itself (already settled: its real end changes nothing), so the player is free for the next one.
      const view = await started(w, alice, gameId);
      assert.equal((await w.games.concede(alice.id, { gameId, commandId: uuidV4(deterministicRandom(`concede:${gameId}`)), expectedVersion: view.version })).ok, true);
    };

    const lost = await play();
    await end(lost, "s1");
    assert.deepEqual((await w.daily.today(alice.id)).run, { track: "hard", stage: 0, gameId: null, attempts: 1, rewarded: false, last: { gameId: lost, stage: 0, opponent: (await w.daily.today(alice.id)).opponents[0].id, result: "loss" }, reward: null });
    await w.daily.onGameFinished(finished(lost, "s0"));
    assert.equal((await w.daily.today(alice.id)).run.stage, 0, "a game is settled once");

    for (let stage = 0; stage < 3; stage += 1) {
      const gameId = await play();
      await end(gameId, "s0");
    }
    const day = await w.daily.today(alice.id);
    assert.deepEqual({ ...day.run, last: undefined, reward: undefined }, { track: "hard", stage: 3, gameId: null, attempts: 4, rewarded: true, last: undefined, reward: undefined });
    assert.equal(day.run.last.result, "win");
    assert.equal(day.run.reward.pack, "core_booster");
    assert.deepEqual(day.opponents.map((opponent) => opponent.state), ["beaten", "beaten", "beaten"]);
    await assert.rejects(play(), (error) => error.code === "CONFLICT");

    const cards = await w.setup.database.rows("SELECT definition_id, origin_kind, origin_ref FROM card_instances WHERE owner_id = $1 AND origin_kind = 'reward'", [alice.id]);
    assert.equal(cards.length, 5, "a Core Booster");
    assert.deepEqual(day.run.reward.cards.map((card) => card.definitionId).sort(), cards.map((card) => card.definition_id).sort(), "the day shows the pack won");
    assert.ok(cards.every((card) => card.origin_ref === `daily:${dayOf(w.setup.clock.now())}`));
    assert.ok(TRADEABLE_ORIGINS.includes("reward"), "the cards are the player's to trade and sell");
    const [run] = await w.setup.database.rows("SELECT reward_seed FROM daily_runs WHERE user_id = $1", [alice.id]);
    const table = w.setup.app.marketplace.catalog.dropTables.get("core_booster").table;
    assert.deepEqual(drawPack(table, run.reward_seed).map((card) => card.cardId).sort(), cards.map((card) => card.definition_id).sort(), "the seed draws the same pack again");
    const [grant] = (await w.setup.database.rows("SELECT payload FROM blockchain_events WHERE kind = 'GRANT'")).map((row) => parseGrantRecord(row.payload)).filter((record) => record.k === "daily");
    assert.deepEqual([grant.u, grant.track, grant.seed, grant.t], ["alice", "hard", run.reward_seed.trim(), w.setup.app.marketplace.catalog.dropTables.get("core_booster").hash], "the pack goes on chain with its seed");
    assert.deepEqual(drawPack(table, grant.seed).map((card) => card.cardId).sort(), grant.cards.map(([, definitionId]) => definitionId).sort(), "and anyone can draw it again from the record");
    const notes = await w.setup.database.rows("SELECT data FROM notifications WHERE user_id = $1 AND kind = 'daily.reward'", [alice.id]);
    assert.equal(notes.length, 1);
    assert.equal(notes[0].data.pack, "core_booster");

    await w.daily.onGameFinished(finished(lost, "s0"));
    assert.equal((await w.setup.database.rows("SELECT count(*)::integer AS n FROM card_instances WHERE owner_id = $1 AND origin_kind = 'reward'", [alice.id]))[0].n, 5, "one pack a day");
  });
});
