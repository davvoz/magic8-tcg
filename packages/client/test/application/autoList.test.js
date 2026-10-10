/**
 * The auto list on the client (docs/tcg/23-automatica.md): joining prepares
 * a ticket first and draws the browser's entropy only once the server is
 * bound to its secret; the server's word on the ticket is the state; and a
 * played auto game is replayed on a local session, refused when its record
 * does not play to its end.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BasicAi } from "@magic8/engine/domain/ai/BasicAi.js";
import { createCoreCommandRegistry } from "@magic8/engine/domain/commands/registerCoreCommands.js";
import { SPECTATOR } from "@magic8/engine/domain/game/GameSnapshot.js";
import { fail, ok } from "@magic8/engine/shared/Result.js";
import { GameMode, GameProtocol, GameRecorder, SEATS, createGameEngine } from "@magic8/protocol";
import { AutoListService, AutoListStatus } from "../../src/application/auto/AutoListService.js";
import { AutoReplayService, ReplayError, replaySession } from "../../src/application/auto/AutoReplayService.js";
import { ReplayPace, ReplaySpeed } from "../../src/application/auto/ReplayPace.js";
import { MemoryLogger } from "../../src/infrastructure/logging/MemoryLogger.js";
import { buildRecordedGameEngine } from "../../src/infrastructure/random/recordedGameEngine.js";
import { immediateScheduler } from "../../src/infrastructure/time/ImmediateScheduler.js";
import { effects, loadBundledContent } from "./fixtures.js";

const content = await loadBundledContent();
const GAME = "01j8x3r6h2qkq4w0v7m5a9c1dz";
const TICKET = "33333333-3333-4333-8333-333333333333";

/** A connection whose server answers from `replies`, recording what was asked and when. */
function scriptedConnection(replies) {
  const listeners = new Set();
  const asked = [];
  return {
    asked,
    status: "open",
    connect: () => undefined,
    close: () => undefined,
    request: async (t, d) => {
      asked.push({ t, d });
      return replies[t]?.(d) ?? ok({ t: "error", d: { code: "NOT_FOUND", message: "unknown" } });
    },
    subscribe: (listener) => (listeners.add(listener), () => listeners.delete(listener)),
    onStatus: () => () => undefined,
    push: (t, d) => listeners.forEach((listener) => listener({ t, d })),
  };
}

/**
 * An auto game recorded as the game server records one: the AI plays both seats, every move a MOVE event.
 * @param {{ styles?: readonly string[], decks?: readonly string[] }} [options]
 */
function recordedGame({ styles = ["aggressive", "defensive"], decks = ["precon_foundry", "precon_shadow"] } = {}) {
  const lists = decks.map((id) => content.preconDecks.find((deck) => deck.id === id).entries.map((entry) => [entry.cardId, entry.count]));
  const recorder = new GameRecorder({ gameId: GAME, secret: "5e".repeat(32), decks: lists, version: GameProtocol.V1 });
  const events = [recorder.created({ mode: GameMode.AUTO, network: "steem", engineVersion: "1", contentHash: "c".repeat(64), accounts: ["alice", "bob"], ms: 0 })];
  events.push(recorder.joined({ seat: "s0", entropy: "0f".repeat(16), ms: 0 }), recorder.joined({ seat: "s1", entropy: "f0".repeat(16), ms: 0 }), recorder.started({ ms: 0 }));
  const engine = createGameEngine({ content: { rules: content.gameRules, catalog: content.catalog, effects, createCommands: createCoreCommandRegistry }, accounts: ["alice", "bob"], decks: recorder.decks, firstSeat: recorder.firstSeat, engineSeed: recorder.engineSeed }).value;
  engine.start();
  const players = new Map(SEATS.map((seat, index) => [seat, new BasicAi(styles[index])]));
  while (!engine.isOver) {
    const seat = engine.getSnapshot(null).awaitingPlayerId;
    const command = players.get(seat).decide(engine.getSnapshot(seat));
    assert.equal(engine.execute(command).ok, true);
    events.push(recorder.move({ seat, command, clock: { turn: engine.getSnapshot(null).turnNumber, ms: 0 } }));
  }
  const end = engine.getSnapshot(SPECTATOR);
  events.push(recorder.finished({ winner: end.winnerId, reason: end.endReason, engineVersion: engine.version, digest: engine.getStateDigest(), clock: { turn: end.turnNumber, ms: 0 } }));
  return Object.freeze({
    gameId: GAME,
    mode: "auto",
    contentHash: "c".repeat(64),
    winnerSeat: end.winnerId,
    endReason: end.endReason,
    finishedAt: 0,
    players: [{ seat: "s0", account: "alice" }, { seat: "s1", account: "bob" }],
    aiVersion: 1,
    tickets: [],
    events: events.map(({ event }) => event),
  });
}

describe("AutoListService", () => {
  it("prepares a ticket, then draws the entropy and joins with the deck and the style", async () => {
    const drawn = [];
    const connection = scriptedConnection({
      "auto.prepare": () => ok({ t: "auto.prepared", d: { ticket: TICKET, commit: "c".repeat(64) } }),
      "auto.join": (d) => ok({ t: "auto.status", d: { state: "waiting", waiting: 2, ticket: d.ticket, since: 1000, deckId: d.deckId, style: d.style, entries: 1 } }),
    });
    const auto = new AutoListService({ connection, randomHex: (bytes) => (drawn.push(connection.asked.length), "ab".repeat(bytes)), logger: new MemoryLogger() });
    const joined = await auto.join("deck-1", "defensive");
    assert.equal(joined.ok, true);
    assert.deepEqual(connection.asked.map((request) => request.t), ["auto.prepare", "auto.join"]);
    assert.deepEqual(drawn, [1], "the entropy is drawn after the server committed to the ticket");
    assert.deepEqual(connection.asked[1].d, { ticket: TICKET, deckId: "deck-1", style: "defensive", entropy: "ab".repeat(16) });
    assert.equal(auto.state.status, AutoListStatus.WAITING);
    assert.deepEqual(auto.state.ticket, { ticket: TICKET, since: 1000, deckId: "deck-1", style: "defensive", entries: 1 });
    assert.equal(auto.state.waiting, 2);
    assert.equal((await auto.join("deck-1", "balanced")).ok, false, "once in, the player stays in");
    assert.equal(connection.asked.length, 2);
  });

  it("keeps the player out of the list, with the server's reason, when joining is refused", async () => {
    const connection = scriptedConnection({
      "auto.prepare": () => ok({ t: "auto.prepared", d: { ticket: TICKET, commit: "c".repeat(64) } }),
      "auto.join": () => ok({ t: "error", d: { code: "ENTRY_REQUIRED", message: "a ranked game costs 1 ranked entry: buy them in the shop" } }),
    });
    const auto = new AutoListService({ connection, randomHex: (bytes) => "ab".repeat(bytes), logger: new MemoryLogger() });
    auto.start();
    await auto.refresh();
    const joined = await auto.join("deck-1", "balanced");
    assert.equal(joined.ok, false);
    assert.equal(auto.state.error?.code, "ENTRY_REQUIRED");
    assert.notEqual(auto.state.status, AutoListStatus.WAITING);
  });

  it("follows the server: the ticket played, closed at the season's end, or still waiting after a reconnection", async () => {
    const connection = scriptedConnection({ "auto.status": () => ok({ t: "auto.status", d: { state: "waiting", waiting: 1, ticket: TICKET, since: 5, deckId: "deck-1", style: "aggressive", entries: 1 } }) });
    const auto = new AutoListService({ connection, randomHex: (bytes) => "ab".repeat(bytes), logger: new MemoryLogger() });
    const seen = [];
    auto.subscribe((state) => seen.push(state.status));
    auto.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(auto.state.status, AutoListStatus.WAITING);
    connection.push("auto.status", { state: "idle", game: GAME });
    assert.deepEqual([auto.state.status, auto.state.lastGame, auto.state.ticket], [AutoListStatus.IDLE, GAME, null]);
    connection.push("auto.status", { state: "idle", reason: "season_ended" });
    assert.equal(auto.state.closed, "season_ended");
    auto.stop();
    assert.equal(auto.state.status, AutoListStatus.UNKNOWN);
    assert.ok(seen.includes(AutoListStatus.WAITING));
  });
});

describe("replaying an auto game", () => {
  it("replays the recorded game on a local session, the coin first, to the recorded end", async () => {
    const replay = recordedGame();
    const built = replaySession({ replay, content, effects, buildEngine: buildRecordedGameEngine, scheduler: immediateScheduler, logger: new MemoryLogger() });
    assert.equal(built.ok, true, JSON.stringify(built.error));
    const session = built.value;
    assert.deepEqual(session.humanPlayerIds, [], "watched, not played");
    assert.equal(session.openingToss?.firstPlayerId, replay.events.find((event) => event.k === "GAME_STARTED").d.first);
    assert.deepEqual([session.accountOf("s0"), session.accountOf("s1")], ["alice", "bob"]);
    session.begin();
    await session.whenIdle();
    const end = session.snapshotFor(null);
    assert.equal(end.isOver, true);
    assert.equal(end.winnerId, replay.winnerSeat);
  });

  it("refuses a record that does not play to its recorded end, or is not a whole game", () => {
    const replay = recordedGame();
    const finished = replay.events.at(-1);
    const otherWinner = { ...replay, events: [...replay.events.slice(0, -1), { ...finished, d: { ...finished.d, win: finished.d.win === "s0" ? "s1" : "s0" } }] };
    const refused = replaySession({ replay: otherWinner, content, effects, buildEngine: buildRecordedGameEngine, scheduler: immediateScheduler, logger: new MemoryLogger() });
    assert.equal(refused.ok, false);
    assert.equal(refused.error.code, ReplayError.UNREPLAYABLE);

    const firstMove = replay.events.findIndex((event) => event.k === "MOVE");
    const garbled = { ...replay, events: replay.events.map((event, index) => (index === firstMove ? { ...event, d: { type: "PLAY_CARD", cardId: "nope", targets: [] } } : event)) };
    assert.equal(replaySession({ replay: garbled, content, effects, buildEngine: buildRecordedGameEngine, scheduler: immediateScheduler, logger: new MemoryLogger() }).error.code, ReplayError.UNREPLAYABLE);

    const unfinished = { ...replay, events: replay.events.slice(0, -1) };
    assert.equal(replaySession({ replay: unfinished, content, effects, buildEngine: buildRecordedGameEngine, scheduler: immediateScheduler, logger: new MemoryLogger() }).error.code, ReplayError.MALFORMED);
  });

  it("reads the game from the server before replaying it, and passes on what the server says", async () => {
    const replay = recordedGame();
    const replays = (answer) => new AutoReplayService({ api: { replay: async () => answer }, content, effects, buildEngine: buildRecordedGameEngine, scheduler: immediateScheduler, logger: new MemoryLogger() });
    const opened = await replays(ok(replay)).open(GAME);
    assert.equal(opened.ok, true);
    assert.equal(opened.value.replay.gameId, GAME);
    assert.equal((await replays(fail("NOT_FOUND", "no such auto game")).open(GAME)).error.code, "NOT_FOUND");
  });

  it("seats a player who played the game on their side; anyone else watches it as a spectator", async () => {
    const replays = new AutoReplayService({ api: { replay: async () => ok(recordedGame()) }, content, effects, buildEngine: buildRecordedGameEngine, scheduler: immediateScheduler, logger: new MemoryLogger() });
    const seatOf = async (viewer) => (await replays.open(GAME, { viewer })).value.session;
    const bob = await seatOf("bob");
    assert.deepEqual([bob.viewerId, bob.humanPlayerIds], ["s1", []], "seen from bob's seat, played by the AI");
    assert.equal((await seatOf("alice")).viewerId, "s0");
    assert.equal((await seatOf("carol")).viewerId, null);
    assert.equal((await seatOf(null)).viewerId, null);
  });

  it("plays at the speed picked last", async () => {
    const replays = new AutoReplayService({ api: { replay: async () => ok(recordedGame()) }, content, effects, buildEngine: buildRecordedGameEngine, scheduler: immediateScheduler, logger: new MemoryLogger() });
    const first = (await replays.open(GAME)).value.session;
    assert.ok(first.pace instanceof ReplayPace);
    assert.equal(first.pace.speed, ReplaySpeed.NORMAL);
    first.pace.setSpeed(ReplaySpeed.FAST);
    assert.equal((await replays.open(GAME)).value.session.pace.speed, ReplaySpeed.FAST);
  });
});

describe("ReplayPace", () => {
  /** A scheduler that answers at once, noting every pause asked of it. */
  const recording = () => {
    const delays = [];
    return { delays, scheduler: { delay: async (ms) => void delays.push(ms) } };
  };

  it("at Normal and Fast, waits for the board to show the move before, then pauses", async () => {
    const { delays, scheduler } = recording();
    const pace = new ReplayPace({ scheduler });
    let busyFor = 2;
    pace.follow(() => busyFor-- > 0);
    await pace.wait();
    assert.deepEqual(delays, [50, 50, 50, 1000], "looked three times, the board busy twice, then the pause");
    delays.length = 0;
    pace.setSpeed(ReplaySpeed.FAST);
    await pace.wait();
    assert.deepEqual(delays, [50, 300]);
  });

  it("at Very fast keeps its beat whatever the board shows; with no board, it only pauses", async () => {
    const { delays, scheduler } = recording();
    const pace = new ReplayPace({ scheduler, speed: ReplaySpeed.VERY_FAST });
    pace.follow(() => true);
    await pace.wait();
    assert.deepEqual(delays, [260]);
    delays.length = 0;
    pace.setSpeed(ReplaySpeed.NORMAL);
    pace.follow(null);
    await pace.wait();
    assert.deepEqual(delays, [50, 1000], "the board left: nothing to wait for");
  });

  it("tells of a change of speed, and ignores a speed it does not know", () => {
    const told = [];
    const pace = new ReplayPace({ scheduler: { delay: async () => undefined }, speed: "warp", onSpeed: (speed) => told.push(speed) });
    assert.equal(pace.speed, ReplaySpeed.NORMAL, "an unknown speed starts at Normal");
    pace.setSpeed("warp");
    pace.setSpeed(ReplaySpeed.NORMAL);
    pace.setSpeed(ReplaySpeed.VERY_FAST);
    assert.deepEqual(told, [ReplaySpeed.VERY_FAST]);
    assert.equal(pace.speed, ReplaySpeed.VERY_FAST);
  });
});
