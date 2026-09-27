/**
 * Authoritative games without the network: GameService/GameActor on a real
 * database, players simulated by reading what the ConnectionHub delivers.
 * Covers the lifecycle, first player by lot, perspectives, hostile
 * commands, idempotency and races, timers and forced moves, restore after a
 * restart — and that a finished game keeps its whole history, hash-chained,
 * and publishes only its result.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createCoreEffectRegistry } from "@magic8/engine/domain/effects/registerCoreEffects.js";
import { ChaChaRandom } from "@magic8/engine/domain/random/ChaChaRandom.js";
import { firstSeatFor, genesisHead, nextHead, parseGameResultRecord } from "@magic8/protocol";
import { uuidV4 } from "../../src/kernel/random.js";
import { GameService, PgGameRepository } from "../../src/modules/gameplay/index.js";
import { buildTestApp, bundledContent, deterministicRandom } from "../helpers.js";

const SECOND = 1000;
const ENTROPY = Object.freeze({ s0: "0a".repeat(16), s1: "0b".repeat(16) });

/** Two players with inboxes and a game between them, ready for entropy. */
async function world(options = {}) {
  const setup = await buildTestApp(options);
  const content = setup.app.catalog.current().content;
  const deck = (id) => content.preconDecks.find((candidate) => candidate.id === id).entries;
  const player = async (account, deckId) => {
    const user = await setup.users.findOrCreate({ network: "steem", account }, setup.clock.now(), uuidV4(deterministicRandom(`user:${account}`)));
    const inbox = [];
    const connection = { send: (message) => inbox.push(JSON.parse(message)), close: () => undefined };
    setup.app.hub.attach(user.id, connection);
    return { user, inbox, connection, entrant: { userId: user.id, account, deckId: null, deck: deck(deckId) } };
  };
  const alice = await player("alice", "precon_foundry");
  const bob = await player("bob", "precon_harvest");
  const gameId = await setup.app.games.createGame({ entrants: [alice.entrant, bob.entrant] });
  return { setup, alice, bob, gameId, games: setup.app.games };
}

/** Both players send entropy: the game starts. */
async function started(options) {
  const w = await world(options);
  await w.games.entropy(w.alice.user.id, w.gameId, ENTROPY.s0);
  await w.games.entropy(w.bob.user.id, w.gameId, ENTROPY.s1);
  return w;
}

const last = (inbox, type) => inbox.filter((message) => message.t === type).at(-1)?.d;
const seatUser = (w, seat) => (seat === "s0" ? w.alice : w.bob);

/**
 * A legal, varied move for the seat the game waits on, decided from that seat's own view.
 * @param {ChaChaRandom} rng
 * @param {any} snapshot the seat's snapshot
 */
function chooseMove(rng, snapshot) {
  const moves = snapshot.legalMoves;
  const playable = moves.playableCardIds.filter((cardId) => (moves.targetOptions[cardId] ?? []).every((group) => group.length > 0));
  if (playable.length > 0 && rng.nextInt(3) > 0) {
    const cardId = playable[rng.nextInt(playable.length)];
    return { type: "PLAY_CARD", cardId, targets: (moves.targetOptions[cardId] ?? []).map((group) => group[rng.nextInt(group.length)]) };
  }
  if (snapshot.phase === "COMBAT_ATTACKERS") {
    return { type: "DECLARE_ATTACKERS", attackerIds: moves.attackerIds.filter(() => rng.nextInt(10) < 7) };
  }
  if (snapshot.phase === "COMBAT_BLOCKERS") {
    const attackers = snapshot.combat.attackerIds;
    return { type: "DECLARE_BLOCKERS", blocks: moves.blockerIds.slice(0, attackers.length).filter(() => rng.nextInt(2) === 0).map((blockerId, index) => ({ attackerId: attackers[index], blockerId })) };
  }
  return moves.canEndPhase ? { type: "END_PHASE" } : { type: "END_TURN" };
}

/**
 * The quickest way through one's own decisions: no attack, then end the phase or the turn.
 * @param {any} snapshot
 */
function passCommand(snapshot) {
  if (snapshot.phase === "COMBAT_ATTACKERS") {
    return { type: "DECLARE_ATTACKERS", attackerIds: [] };
  }
  return snapshot.legalMoves.canEndTurn ? { type: "END_TURN" } : { type: "END_PHASE" };
}

/** `player` passes while the game waits on them. */
async function passTurn(w, player, label) {
  for (let step = 0; step < 30; step += 1) {
    const own = await w.games.view(player.user.id, w.gameId);
    if (own.status !== "ACTIVE" || own.snapshot.awaitingPlayerId !== own.seat) {
      return;
    }
    await w.games.command(player.user.id, { gameId: w.gameId, commandId: uuidV4(deterministicRandom(`${label}:${step}`)), expectedVersion: own.version, command: passCommand(own.snapshot) });
  }
}

/** Plays whoever is awaited until the game ends; returns the number of accepted commands. */
async function playOut(w, { seed = "moves", maxCommands = 800 } = {}) {
  const rng = ChaChaRandom.fromSeed("5e".repeat(16) + Buffer.from(seed).toString("hex").padEnd(32, "0").slice(0, 32));
  for (let commands = 0; commands < maxCommands; commands += 1) {
    const view = await w.games.view(w.alice.user.id, w.gameId);
    if (view.status !== "ACTIVE") {
      return commands;
    }
    const seat = view.snapshot.awaitingPlayerId;
    const mover = seatUser(w, seat);
    const own = await w.games.view(mover.user.id, w.gameId);
    const command = commands + 1 >= maxCommands ? { type: "CONCEDE" } : chooseMove(rng, own.snapshot);
    const ack = await w.games.command(mover.user.id, { gameId: w.gameId, commandId: uuidV4(deterministicRandom(`${seed}:${commands}`)), expectedVersion: own.version, command });
    assert.equal(ack.ok, true, JSON.stringify({ command, ack }));
  }
  throw new Error("the game did not end");
}

describe("GameService", () => {
  it("announces a game with the seed commitment, then starts it once both players send entropy", async () => {
    const w = await world();
    const found = last(w.alice.inbox, "match.found");
    assert.equal(found.gameId, w.gameId);
    assert.match(w.gameId, /^[0-9a-hjkmnp-tv-z]{26}$/);
    assert.equal(found.seat, "s0");
    assert.deepEqual(found.opponent, { account: "bob" });
    assert.match(found.seedCommit, /^[0-9a-f]{64}$/);
    assert.equal(last(w.bob.inbox, "match.found").seat, "s1");
    assert.equal((await w.games.view(w.alice.user.id, w.gameId)).snapshot, null, "nothing to see before the start");

    await w.games.entropy(w.alice.user.id, w.gameId, ENTROPY.s0);
    assert.equal(last(w.alice.inbox, "game.events"), undefined, "waits for both players");
    await w.games.entropy(w.bob.user.id, w.gameId, ENTROPY.s1);
    const aliceView = last(w.alice.inbox, "game.events");
    const bobView = last(w.bob.inbox, "game.events");
    assert.equal(aliceView.status, "ACTIVE");
    assert.ok(aliceView.events.length > 0, "the opening draws are shown");
    const events = await w.setup.database.rows("SELECT kind, actor, payload FROM game_events WHERE game_id = $1 ORDER BY seq", [w.gameId]);
    assert.deepEqual(events.map((event) => event.kind), ["GAME_CREATED", "PLAYER_JOINED", "PLAYER_JOINED", "GAME_STARTED"]);
    const first = events[3].payload.first;
    assert.equal(aliceView.snapshot.activePlayerId, first, "the first player is decided by lot from the seed");
    const [game] = await w.setup.database.rows("SELECT status, first_seat FROM games WHERE id = $1", [w.gameId]);
    assert.deepEqual(game, { status: "ACTIVE", first_seat: first });

    const aliceSelf = aliceView.snapshot.players.find((player) => player.id === "s0");
    const aliceOther = aliceView.snapshot.players.find((player) => player.id === "s1");
    assert.ok(Array.isArray(aliceSelf.hand) && aliceSelf.hand.length > 0, "own hand visible");
    assert.ok(!Array.isArray(aliceOther.hand) || aliceOther.hand.every((card) => card === null || card.definitionId === undefined), "the opponent's hand is hidden");
    assert.equal(bobView.snapshot.perspectivePlayerId, "s1");
  });

  it("decides the first player by lot: both seats start across games", async () => {
    const firsts = new Set();
    for (let index = 0; index < 16; index += 1) {
      firsts.add(firstSeatFor(`${index.toString(16).padStart(2, "0")}${"ab".repeat(31)}`));
    }
    assert.deepEqual([...firsts].sort(), ["s0", "s1"]);
  });

  it("plays a whole game and keeps its whole history, hash-chained, in the database", async () => {
    const w = await started();
    const commands = await playOut(w);
    assert.ok(commands > 10, `${commands} commands`);
    const over = last(w.alice.inbox, "game.over");
    assert.equal(last(w.bob.inbox, "game.over").winner, over.winner);
    const [game] = await w.setup.database.rows("SELECT status, winner_seat, end_reason FROM games WHERE id = $1", [w.gameId]);
    assert.equal(game.status, "FINISHED");
    assert.equal(game.winner_seat, over.winner);
    const results = await w.setup.database.rows("SELECT seat, result FROM game_players WHERE game_id = $1 ORDER BY seat", [w.gameId]);
    assert.deepEqual(results.map((row) => row.result).sort(), over.winner === null ? ["draw", "draw"] : ["loss", "win"]);

    // The history stays in the database, each event chained to the one before it; nothing goes to the chain.
    const [{ protocol_version: version }] = await w.setup.database.rows("SELECT protocol_version FROM games WHERE id = $1", [w.gameId]);
    const events = await w.setup.database.rows("SELECT seq, kind, actor, turn, ms, payload, head FROM game_events WHERE game_id = $1 ORDER BY seq", [w.gameId]);
    let head = genesisHead(w.gameId);
    for (const row of events) {
      head = nextHead(head, w.gameId, { i: row.seq, k: row.kind, a: row.actor, t: row.turn, ms: row.ms, d: row.payload }, version);
      assert.equal(row.head, head, `event ${row.seq} chains from the one before`);
    }
    assert.equal(events.at(-1).kind, "GAME_FINISHED");
    const published = await w.setup.database.rows("SELECT kind, game_id, payload FROM blockchain_events");
    assert.deepEqual(published.map((row) => [row.kind, row.game_id]), [["RESULT", w.gameId]], "only the result is published");
    assert.equal(parseGameResultRecord(published[0].payload).h, head, "committing to the head of the whole history");
  });

  it("refuses hostile and out-of-order commands, and never lets a player act for the other", async () => {
    const w = await started();
    const view = await w.games.view(w.alice.user.id, w.gameId);
    const awaited = view.snapshot.awaitingPlayerId;
    const idle = awaited === "s0" ? w.bob : w.alice;
    const mover = seatUser(w, awaited);
    const send = (who, fields) => w.games.command(who.user.id, { gameId: w.gameId, commandId: uuidV4(deterministicRandom(JSON.stringify(fields) + who.user.id)), expectedVersion: view.version, command: { type: "END_TURN" }, ...fields });

    const outsider = await w.setup.users.findOrCreate({ network: "steem", account: "mallory" }, w.setup.clock.now(), uuidV4(deterministicRandom("mallory")));
    assert.equal((await w.games.command(outsider.id, { gameId: w.gameId, commandId: uuidV4(deterministicRandom("m")), expectedVersion: view.version, command: { type: "END_TURN" } })).error.code, "NOT_IN_GAME");
    assert.equal((await send(idle, {})).error.code, "NOT_YOUR_TURN");
    const spoof = await send(idle, { command: { type: "END_TURN", playerId: awaited } });
    assert.equal(spoof.error.code, "NOT_YOUR_TURN", "playerId is ignored: the seat comes from the user");
    assert.equal((await send(mover, { expectedVersion: view.version - 1 })).error.code, "STALE_VERSION");
    assert.equal((await send(mover, { commandId: "not-a-uuid" })).error.code, "INVALID_COMMAND");
    assert.equal((await send(mover, { command: { type: "PLAY_CARD", cardId: "x".repeat(2000), targets: [] } })).error.code, "INVALID_COMMAND");
    assert.equal((await send(mover, { command: { type: "SUMMON_EVERYTHING" } })).ok, false);
    assert.equal((await w.games.command(mover.user.id, { gameId: "nope", commandId: uuidV4(deterministicRandom("x")), expectedVersion: 0, command: {} })).error.code, "NOT_IN_GAME");
    assert.equal((await w.games.view(w.alice.user.id, w.gameId)).version, view.version, "nothing changed");
  });

  it("answers a re-sent command with the same ack, and lets only one of two racing commands through", async () => {
    const w = await started();
    const view = await w.games.view(w.alice.user.id, w.gameId);
    const mover = seatUser(w, view.snapshot.awaitingPlayerId);
    const commandId = uuidV4(deterministicRandom("resend"));
    const request = { gameId: w.gameId, commandId, expectedVersion: view.version, command: { type: "END_PHASE" } };
    const first = await w.games.command(mover.user.id, request);
    const again = await w.games.command(mover.user.id, request);
    assert.equal(first.ok, true);
    assert.deepEqual(again, first, "same ack");
    const moves = await w.setup.database.rows("SELECT count(*)::integer AS n FROM game_events WHERE game_id = $1 AND kind = 'MOVE'", [w.gameId]);
    assert.equal(moves[0].n, 1, "executed once");

    const now = await w.games.view(mover.user.id, w.gameId);
    const racing = await Promise.all(
      ["a", "b", "c"].map((label) => w.games.command(mover.user.id, { gameId: w.gameId, commandId: uuidV4(deterministicRandom(`race:${label}`)), expectedVersion: now.version, command: { type: "END_PHASE" } })),
    );
    assert.equal(racing.filter((ack) => ack.ok).length, 1);
    assert.deepEqual(racing.filter((ack) => !ack.ok).map((ack) => ack.error.code), ["STALE_VERSION", "STALE_VERSION"]);
  });

  it("uses server entropy when a player does not send any in time", async () => {
    const w = await world();
    await w.games.entropy(w.alice.user.id, w.gameId, ENTROPY.s0);
    w.setup.clock.advance(16 * SECOND);
    await w.games.tick();
    const joined = await w.setup.database.rows("SELECT actor, payload FROM game_events WHERE game_id = $1 AND kind = 'PLAYER_JOINED' ORDER BY seq", [w.gameId]);
    assert.deepEqual(joined.map((row) => [row.actor, row.payload.src]), [["s0", "client"], ["s1", "server"]]);
    assert.equal((await w.games.view(w.bob.user.id, w.gameId)).status, "ACTIVE");
    assert.equal((await w.games.entropy(w.bob.user.id, w.gameId, ENTROPY.s1)).ok, true, "late entropy is ignored");
  });

  it("ends a turn for a player who runs out of time, and forfeits after three in a row", async () => {
    const w = await started();
    const view = await w.games.view(w.alice.user.id, w.gameId);
    const slow = view.snapshot.awaitingPlayerId;
    w.setup.clock.advance(181 * SECOND);
    await w.games.tick();
    const forced = await w.setup.database.rows("SELECT actor, payload FROM game_events WHERE game_id = $1 AND kind = 'FORCED_MOVE' ORDER BY seq", [w.gameId]);
    assert.ok(forced.length >= 1);
    assert.ok(forced.every((row) => row.actor === slow && row.payload.why === "timeout"));
    const after = await w.games.view(w.alice.user.id, w.gameId);
    assert.notEqual(after.snapshot.activePlayerId, slow, "the turn passed to the opponent");
    assert.equal(after.clock.reserveMs[slow], 90000, "a forced move does not charge the reserve");

    // The opponent keeps passing; the slow player keeps timing out.
    for (let turn = 0; turn < 3 && (await w.games.view(w.alice.user.id, w.gameId)).status === "ACTIVE"; turn += 1) {
      const current = await w.games.view(w.alice.user.id, w.gameId);
      if (current.snapshot.awaitingPlayerId !== slow) {
        await passTurn(w, seatUser(w, current.snapshot.awaitingPlayerId), `pass:${turn}`);
      }
      w.setup.clock.advance(245 * SECOND);
      await w.games.tick();
    }
    const over = last(seatUser(w, slow).inbox, "game.over");
    assert.ok(over, "the game ended");
    assert.notEqual(over.winner, slow);
    const abandon = await w.setup.database.rows("SELECT payload FROM game_events WHERE game_id = $1 AND kind = 'FORCED_MOVE' AND payload->>'why' = 'abandon'", [w.gameId]);
    assert.equal(abandon.length, 1);
  });

  it("acts sooner for a disconnected player, and forfeits them after a long absence", async () => {
    const w = await started();
    const view = await w.games.view(w.alice.user.id, w.gameId);
    const away = seatUser(w, view.snapshot.awaitingPlayerId);
    await w.games.presence(away.user.id, false);
    w.setup.clock.advance(61 * SECOND);
    await w.games.tick();
    const forced = await w.setup.database.rows("SELECT payload FROM game_events WHERE game_id = $1 AND kind = 'FORCED_MOVE'", [w.gameId]);
    assert.ok(forced.length >= 1 && forced.every((row) => row.payload.why === "disconnect"), JSON.stringify(forced));

    const other = away === w.alice ? w.bob : w.alice;
    await passTurn(w, other, "other");
    w.setup.clock.advance(180 * SECOND);
    await w.games.tick();
    const over = last(other.inbox, "game.over");
    assert.ok(over, "the game ended");
    assert.equal(over.winner, other === w.alice ? "s0" : "s1", "the absent player forfeited");
    const why = await w.setup.database.rows("SELECT payload->>'why' AS why FROM game_events WHERE game_id = $1 AND kind = 'FORCED_MOVE' ORDER BY seq DESC LIMIT 1", [w.gameId]);
    assert.equal(why[0].why, "abandon");
  });

  it("resumes games after a restart, identical, and keeps playing", async () => {
    const w = await started();
    const rng = ChaChaRandom.fromSeed("7a".repeat(32));
    for (let step = 0; step < 12; step += 1) {
      const view = await w.games.view(w.alice.user.id, w.gameId);
      const mover = seatUser(w, view.snapshot.awaitingPlayerId);
      const own = await w.games.view(mover.user.id, w.gameId);
      await w.games.command(mover.user.id, { gameId: w.gameId, commandId: uuidV4(deterministicRandom(`pre:${step}`)), expectedVersion: own.version, command: chooseMove(rng, own.snapshot) });
    }
    const before = await w.games.view(w.alice.user.id, w.gameId);

    const restarted = new GameService({
      repository: new PgGameRepository(w.setup.database),
      currentContent: () => w.setup.app.catalog.current(),
      contentVersion: (hash) => w.setup.app.catalog.version(hash),
      effects: createCoreEffectRegistry(),
      secrets: /** @type {any} */ (w.setup.app).secrets,
      notifier: w.setup.app.hub,
      clock: w.setup.clock,
      random: deterministicRandom("restart"),
      unitOfWork: (work) => w.setup.database.transaction(work),
      audit: w.setup.app.audit,
      logger: w.setup.logger,
      network: "steem",
    });
    assert.equal(await restarted.restoreAll(), 1);
    const after = await restarted.view(w.alice.user.id, w.gameId);
    assert.equal(after.version, before.version);
    assert.equal(after.head, before.head);
    assert.deepEqual(after.snapshot, before.snapshot, "replayed to the same state");
    const w2 = { ...w, games: restarted };
    assert.ok((await playOut(w2, { seed: "after-restart" })) > 0);
  });

  it("keeps a game on the content it started with when the server restarts on new content", async () => {
    const w = await started();
    await passTurn(w, seatUser(w, (await w.games.view(w.alice.user.id, w.gameId)).snapshot.activePlayerId), "before-change");
    const before = await w.games.view(w.alice.user.id, w.gameId);
    const oldHash = w.setup.app.catalog.current().hash;

    const bundled = await bundledContent();
    const raw = structuredClone(bundled.raw);
    raw.cardSets[0].cards[0].name = `${raw.cardSets[0].cards[0].name} (revised)`;
    const restarted = await buildTestApp({ database: w.setup.database, clock: w.setup.clock, random: deterministicRandom("new-content"), content: { ...bundled, raw } });
    assert.notEqual(restarted.app.catalog.current().hash, oldHash, "a new content version");
    assert.equal(await restarted.app.games.restoreAll(), 1, "the running game resumes");
    const after = await restarted.app.games.view(w.alice.user.id, w.gameId);
    assert.deepEqual(after.snapshot, before.snapshot, "on its own content");
    const [game] = await restarted.database.rows("SELECT content_hash FROM games WHERE id = $1", [w.gameId]);
    assert.equal(game.content_hash, oldHash);
    assert.ok((await playOut({ ...w, games: restarted.app.games }, { seed: "old-content" })) > 0);
  });

  it("rebuilds an actor from the database when a write fails", async () => {
    const w = await started();
    const view = await w.games.view(w.alice.user.id, w.gameId);
    const mover = seatUser(w, view.snapshot.awaitingPlayerId);
    const repository = /** @type {any} */ (w.setup.app).gameRepository;
    const append = repository.appendEvents.bind(repository);
    repository.appendEvents = async () => {
      throw new Error("disk full");
    };
    await assert.rejects(w.games.command(mover.user.id, { gameId: w.gameId, commandId: uuidV4(deterministicRandom("fail")), expectedVersion: view.version, command: { type: "END_PHASE" } }), /disk full/);
    repository.appendEvents = append;
    const rebuilt = await w.games.view(w.alice.user.id, w.gameId);
    assert.equal(rebuilt.version, view.version, "the failed move never happened");
    const retry = await w.games.command(mover.user.id, { gameId: w.gameId, commandId: uuidV4(deterministicRandom("retry")), expectedVersion: view.version, command: { type: "END_PHASE" } });
    assert.equal(retry.ok, true);
  });
});
