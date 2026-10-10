/**
 * Practice games counted toward ranked play: a match keeps what it was dealt
 * from and every move it accepted, so the server can play it again; a
 * signed-in player's finished game is sent once, and nothing else is.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fail, ok } from "@magic8/engine/shared/Result.js";
import { createCoreCommandRegistry } from "@magic8/engine/domain/commands/registerCoreCommands.js";
import { endTurn } from "@magic8/engine/domain/commands/commandFactories.js";
import { DeckList } from "@magic8/engine/domain/decks/DeckList.js";
import { GameEngine } from "@magic8/engine/domain/game/GameEngine.js";
import { BasicAiController } from "../../src/application/match/BasicAiController.js";
import { humanController } from "../../src/application/match/HumanController.js";
import { MatchSetupService } from "../../src/application/match/MatchSetupService.js";
import { PracticeReportService } from "../../src/application/practice/PracticeReportService.js";
import { HttpPracticeApi } from "../../src/infrastructure/api/HttpPracticeApi.js";
import { MemoryLogger } from "../../src/infrastructure/logging/MemoryLogger.js";
import { immediateScheduler } from "../../src/infrastructure/time/ImmediateScheduler.js";
import { effects, loadBundledContent } from "./fixtures.js";

const content = await loadBundledContent();
const [ember, iron] = content.preconDecks;
const SEED = "5e".repeat(32);
const COIN = "c0".repeat(32);

/** A practice match: "player" against the AI, both played by the AI unless `human` (then "player" is the human's). */
function practiceMatch({ seed = SEED, human = false, shuffle = true } = {}) {
  const service = new MatchSetupService({ content, effects, scheduler: immediateScheduler, logger: new MemoryLogger() });
  const created = service.createMatch({
    seats: [
      { id: "player", name: "alice", deckList: ember, controller: human ? humanController : new BasicAiController(), account: "alice" },
      { id: "ai", name: "Opponent", deckList: iron, controller: new BasicAiController() },
    ],
    seed,
    coinSeed: COIN,
    shuffle,
  });
  assert.equal(created.ok, true, JSON.stringify(created));
  return created.value;
}

/** Plays a transcript again on a fresh engine, as the server does. */
function replay(transcript) {
  const players = transcript.players.map((seat) => ({ id: seat.id, name: seat.id, deckList: new DeckList({ id: seat.id, name: seat.id, entries: seat.deck }) }));
  const engine = GameEngine.create({ rules: content.gameRules, catalog: content.catalog, effects, commands: createCoreCommandRegistry(), players, seed: transcript.seed }).value;
  engine.start();
  for (const move of JSON.parse(JSON.stringify(transcript.moves))) {
    assert.equal(engine.execute(move).ok, true);
  }
  return engine.getSnapshot(null);
}

describe("match transcript", () => {
  it("keeps the seed, the decks in seating order and every move, so the game plays again to the same end", async () => {
    const session = practiceMatch();
    const first = session.openingToss.firstPlayerId;
    assert.deepEqual(session.transcript.players.map((seat) => seat.id), [first, first === "player" ? "ai" : "player"], "the toss winner is dealt first");
    session.start();
    await session.whenIdle();
    const end = session.snapshotFor(null);
    assert.equal(end.isOver, true);
    const again = replay(session.transcript);
    assert.deepEqual([again.isOver, again.winnerId, again.endReason, again.turnNumber], [true, end.winnerId, end.endReason, end.turnNumber]);
  });

  it("keeps only the moves the engine accepted", async () => {
    const session = practiceMatch({ human: true });
    session.start();
    await session.whenIdle();
    const before = session.transcript.moves.length;
    const refused = session.submit(endTurn("ai"));
    assert.equal(refused.ok, false);
    assert.equal(session.transcript.moves.length, before, "a refused move is not kept");
    const waiting = session.snapshotFor(null).awaitingPlayerId;
    assert.equal(waiting, "player");
    assert.equal(session.submit(endTurn("player")).ok, true);
    assert.deepEqual(session.transcript.moves[before], endTurn("player"));
  });

  it("has none for a match that could not be played again: a test seed, or decks dealt in order", () => {
    assert.equal(practiceMatch({ seed: 42 }).transcript, null);
    assert.equal(practiceMatch({ shuffle: false }).transcript, null);
  });
});

/** A PracticeApi that records what it is sent. */
function fakeApi(answer = ok({ counted: true, practiceGames: 1 })) {
  const reports = [];
  return { reports, report: async (report) => (reports.push(report), answer) };
}

describe("PracticeReportService", () => {
  it("sends a finished game once, with the player's seat", async () => {
    const api = fakeApi();
    const logger = new MemoryLogger();
    const session = practiceMatch();
    new PracticeReportService({ api, logger }).track(session, "player");
    session.start();
    await session.whenIdle();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(api.reports.length, 1);
    const [report] = api.reports;
    assert.equal(report.you, "player");
    assert.equal(report.seed, SEED);
    assert.deepEqual(report.moves, session.transcript.moves);
    assert.ok(logger.entries.some((entry) => entry.message === "practice game sent"));
  });

  it("sends nothing for a game left before its end, or one that cannot be played again, and logs a refusal", async () => {
    const api = fakeApi();
    const reporter = new PracticeReportService({ api, logger: new MemoryLogger() });
    const left = practiceMatch({ human: true });
    reporter.track(left, "player");
    left.start();
    await left.whenIdle();
    left.stop();
    const untracked = practiceMatch({ seed: 7 });
    reporter.track(untracked, "player");
    untracked.start();
    await untracked.whenIdle();
    assert.equal(api.reports.length, 0);

    const logger = new MemoryLogger();
    const refusing = practiceMatch();
    new PracticeReportService({ api: fakeApi(fail("VALIDATION", "a game you conceded does not count")), logger }).track(refusing, "player");
    refusing.start();
    await refusing.whenIdle();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.ok(logger.entries.some((entry) => entry.message === "practice game not counted"));
  });
});

describe("HttpPracticeApi", () => {
  it("posts the report and checks the answer", async () => {
    const sent = [];
    const answer = { body: { counted: true, practiceGames: 2 } };
    const api = new HttpPracticeApi({
      fetch: async (url, init) => {
        sent.push({ url, method: init.method, body: JSON.parse(init.body) });
        return new Response(JSON.stringify(answer.body), { status: 200, headers: { "content-type": "application/json" } });
      },
    });
    const report = { seed: SEED, you: "player", players: [], moves: [] };
    assert.deepEqual((await api.report(report)).value, { counted: true, practiceGames: 2 });
    assert.deepEqual([new URL(sent[0].url, "http://x").pathname, sent[0].method, sent[0].body], ["/api/practice/games", "POST", report]);
    answer.body = { counted: "yes", practiceGames: 2 };
    assert.equal((await api.report(report)).error.code, "BAD_RESPONSE");
  });
});
