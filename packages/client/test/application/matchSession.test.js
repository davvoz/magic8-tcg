import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BasicAiController } from "../../src/application/match/BasicAiController.js";
import { humanController } from "../../src/application/match/HumanController.js";
import { MatchSetupError, MatchSetupService } from "../../src/application/match/MatchSetupService.js";
import { endTurn, playCard } from "@magic8/engine/domain/commands/commandFactories.js";
import { DeckList } from "@magic8/engine/domain/decks/DeckList.js";
import { GameEventType } from "@magic8/engine/domain/game/GameEventType.js";
import { MemoryLogger } from "../../src/infrastructure/logging/MemoryLogger.js";
import { createSeed } from "../../src/infrastructure/random/seedProvider.js";
import { immediateScheduler } from "../../src/infrastructure/time/ImmediateScheduler.js";
import { effects, loadBundledContent } from "./fixtures.js";

const content = await loadBundledContent();
const [ember, iron] = content.preconDecks;

/** @param {{ p1?: object, p2?: object, seed?: number | string, logger?: MemoryLogger }} [options] */
function setup(options = {}) {
  const logger = options.logger ?? new MemoryLogger();
  const service = new MatchSetupService({ content, effects, scheduler: immediateScheduler, logger });
  const result = service.createMatch({
    seats: [
      { id: "p1", name: "Alice", deckList: ember, controller: humanController, ...options.p1 },
      { id: "p2", name: "Bob", deckList: iron, controller: new BasicAiController(), ...options.p2 },
    ],
    seed: options.seed ?? 42,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  return { session: result.value, logger };
}

describe("match seeds", () => {
  it("accepts the seeds the browser produces (32-byte hex keys)", async () => {
    const { session } = setup({ p1: { controller: new BasicAiController() }, seed: createSeed() });
    assert.equal(session.start().ok, true);
    await session.whenIdle();
    assert.equal(session.snapshotFor(null).isOver, true);
  });
});

describe("AI vs AI", () => {
  for (const seed of [1, 2, 3, 7, 42, 1234]) {
    it(`completes a full match headlessly (seed ${seed})`, async () => {
      const { session, logger } = setup({ p1: { controller: new BasicAiController() }, seed });
      const updates = [];
      session.subscribe((update) => updates.push(update));
      assert.equal(session.start().ok, true);
      await session.whenIdle();
      const final = session.snapshotFor(null);
      assert.equal(final.isOver, true, `seed ${seed}: game did not finish (turn ${final.turnNumber})`);
      assert.ok(final.winnerId === "p1" || final.winnerId === "p2" || final.endReason === "draw");
      assert.notEqual(final.endReason, "concede", `seed ${seed}: a controller was abandoned: ${JSON.stringify(logger.entries)}`);
      assert.deepEqual(logger.entries, [], "no diagnostics during a healthy match");
      assert.ok(updates.length > 10);
      assert.ok(updates.some((update) => update.events.some((event) => event.type === GameEventType.CARD_PLAYED)));
      assert.ok(updates.some((update) => update.events.some((event) => event.type === GameEventType.ATTACKERS_DECLARED)));
      assert.equal(updates.at(-1).version, session.version);
    });
  }

  it("is deterministic for a given seed", async () => {
    const run = async () => {
      const { session } = setup({ p1: { controller: new BasicAiController() }, seed: 99 });
      session.start();
      await session.whenIdle();
      return session.snapshotFor(null);
    };
    assert.deepEqual(await run(), await run());
  });
});

describe("human vs AI", () => {
  it("waits for the human, then lets the AI play its whole turn and hands control back", async () => {
    const { session } = setup();
    session.start();
    await session.whenIdle();
    let snapshot = session.snapshotFor("p1");
    assert.equal(snapshot.awaitingPlayerId, "p1");
    assert.equal(snapshot.turnNumber, 1);
    assert.deepEqual(session.humanPlayerIds, ["p1"]);
    assert.equal(session.controllerKindOf("p2"), "ai");

    const result = session.submit(endTurn("p1"));
    assert.equal(result.ok, true);
    await session.whenIdle();
    snapshot = session.snapshotFor("p1");
    assert.equal(snapshot.turnNumber, 3, "AI finished turn 2");
    assert.equal(snapshot.awaitingPlayerId, "p1");
    assert.equal(snapshot.players.find((p) => p.id === "p2").hand, null, "opponent hand stays hidden");
  });

  it("rejects illegal human commands without publishing", async () => {
    const { session } = setup();
    const updates = [];
    session.subscribe((update) => updates.push(update));
    session.start();
    await session.whenIdle();
    const before = updates.length;
    assert.equal(session.submit(endTurn("p2")).ok, false);
    assert.equal(session.submit({ type: "HACK" }).ok, false);
    assert.equal(session.submit(playCard("p1", "c999")).ok, false);
    assert.equal(updates.length, before);
  });

  it("redacts opponent draws in events for the human perspective", async () => {
    const { session } = setup();
    const updates = [];
    session.subscribe((update) => updates.push(update));
    session.start();
    session.submit(endTurn("p1"));
    await session.whenIdle();
    const aiDraw = updates.flatMap((update) => update.events).find((event) => event.type === GameEventType.CARD_DRAWN && event.playerId === "p2");
    assert.equal(typeof aiDraw.definitionId, "string");
    const redacted = session.eventsFor([aiDraw], "p1")[0];
    assert.equal(redacted.definitionId, undefined);
  });
});

describe("controller failure handling", () => {
  it("a controller that returns no command forfeits instead of freezing the match", async () => {
    const logger = new MemoryLogger();
    const stuck = { kind: "ai", decide: () => null };
    const { session } = setup({ p2: { controller: stuck }, logger });
    session.start();
    session.submit(endTurn("p1"));
    await session.whenIdle();
    const snapshot = session.snapshotFor(null);
    assert.equal(snapshot.isOver, true);
    assert.equal(snapshot.winnerId, "p1");
    assert.equal(snapshot.endReason, "concede");
    assert.ok(logger.entries.some((entry) => entry.level === "warn"));
  });

  it("a controller that throws or plays illegally forfeits and is logged", async () => {
    const logger = new MemoryLogger();
    const rogue = { kind: "ai", decide: () => endTurn("p1") };
    const { session } = setup({ p2: { controller: rogue }, logger });
    session.start();
    session.submit(endTurn("p1"));
    await session.whenIdle();
    assert.equal(session.snapshotFor(null).winnerId, "p1");
    assert.ok(logger.entries.some((entry) => entry.level === "error"));
  });
});

describe("MatchSetupService", () => {
  it("refuses illegal decks with the rule report", () => {
    const service = new MatchSetupService({ content, effects, scheduler: immediateScheduler, logger: new MemoryLogger() });
    const tiny = new DeckList({ id: "tiny", name: "Tiny", entries: [{ cardId: "ember_imp", count: 3 }] });
    const result = service.createMatch({
      seats: [
        { id: "p1", name: "A", deckList: tiny, controller: humanController },
        { id: "p2", name: "B", deckList: iron, controller: humanController },
      ],
      seed: 1,
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, MatchSetupError.ILLEGAL_DECK);
    assert.equal(result.error.details.seatId, "p1");
  });
});
