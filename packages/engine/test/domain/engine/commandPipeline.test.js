import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CommandError } from "../../../src/domain/commands/CommandError.js";
import { CommandRegistry } from "../../../src/domain/commands/CommandRegistry.js";
import { CommandType } from "../../../src/domain/commands/CommandType.js";
import { declareBlockers, endPhase, endTurn, playCard } from "../../../src/domain/commands/commandFactories.js";
import { validateCommandShape } from "../../../src/domain/commands/validateCommandShape.js";
import { GamePhase } from "../../../src/domain/game/GamePhase.js";
import { ok } from "../../../src/shared/Result.js";
import { P1, P2, createEngine, rulesWith, view } from "./fixtures.js";

describe("validateCommandShape", () => {
  it("accepts factory-built commands and normalises optional fields", () => {
    assert.equal(validateCommandShape(endPhase(P1)).ok, true);
    const play = validateCommandShape({ type: "PLAY_CARD", playerId: "p1", cardId: "c3" });
    assert.equal(play.ok, true);
    assert.deepEqual(play.value.targets, []);
    assert.ok(Object.isFrozen(play.value));
    const blocks = validateCommandShape(declareBlockers(P2, [{ attackerId: "c1", blockerId: "c2" }]));
    assert.equal(blocks.ok, true);
  });

  it("rejects unknown types, extra fields, malformed ids and oversized arrays", () => {
    assert.equal(validateCommandShape({ type: "HACK", playerId: "p1" }).ok, false);
    assert.equal(validateCommandShape({ type: "END_TURN", playerId: "p1", extra: 1 }).ok, false);
    assert.equal(validateCommandShape({ type: "END_TURN", playerId: "P1!" }).ok, false);
    assert.equal(validateCommandShape({ type: "PLAY_CARD", playerId: "p1", cardId: "c1", targets: ["a", "b", "c", "d"] }).ok, false);
    assert.equal(validateCommandShape({ type: "DECLARE_ATTACKERS", playerId: "p1", attackerIds: Array(33).fill("c1") }).ok, false);
    assert.equal(validateCommandShape({ type: "DECLARE_BLOCKERS", playerId: "p1", blocks: [{ attackerId: "c1" }] }).ok, false);
    assert.equal(validateCommandShape(null).ok, false);
    assert.equal(validateCommandShape("END_TURN").ok, false);
  });

  it("rejects prototype-polluting keys", () => {
    const polluted = JSON.parse('{"type":"END_TURN","playerId":"p1","__proto__":{"admin":true}}');
    assert.equal(validateCommandShape(polluted).ok, false);
  });
});

describe("GameEngine.execute pipeline", () => {
  it("returns typed errors in pipeline order and leaves the state untouched", () => {
    const { engine } = createEngine();
    const before = view(engine);
    assert.equal(engine.execute({ type: "NOPE", playerId: P1 }).error.code, CommandError.INVALID_COMMAND);
    assert.equal(engine.execute(endTurn("p9")).error.code, CommandError.UNKNOWN_PLAYER);
    const bare = createEngine({ commands: new CommandRegistry() }).engine;
    assert.equal(bare.execute(endTurn(P1)).error.code, CommandError.UNSUPPORTED_COMMAND);
    assert.equal(engine.execute(endTurn(P2)).error.code, CommandError.NOT_YOUR_TURN);
    assert.equal(engine.execute(declareBlockers(P1, [])).error.code, CommandError.NOT_ALLOWED_IN_PHASE);
    assert.equal(engine.execute(playCard(P1, "c999")).error.code, CommandError.CARD_NOT_FOUND);
    assert.deepEqual(view(engine), before);
    assert.equal(engine.version, before.version);
  });

  it("reports NOT_ALLOWED_IN_PHASE for a registered command outside its phases", () => {
    const { engine } = createEngine();
    assert.equal(view(engine).phase, GamePhase.MAIN_1);
    const result = engine.execute({ type: CommandType.DECLARE_ATTACKERS, playerId: P1, attackerIds: [] });
    assert.equal(result.error.code, CommandError.NOT_ALLOWED_IN_PHASE);
  });

  it("increments the version once per committed command", () => {
    const { engine } = createEngine();
    const start = engine.version;
    assert.equal(engine.execute(endPhase(P1)).value.version, start + 1);
    assert.equal(engine.execute(endPhase(P1)).value.version, start + 2);
    assert.equal(engine.version, start + 2);
  });

  it("is transactional: a handler that throws mid-way leaves the committed state unchanged", () => {
    const registry = new CommandRegistry().register({
      type: CommandType.PLAY_CARD,
      requiresPriority: true,
      validate: () => ok(undefined),
      execute: (state) => {
        state.activePlayer.loseLife(10);
        state.passTurn();
        throw new Error("boom");
      },
    });
    const { engine } = createEngine({ commands: registry });
    const before = view(engine);
    const result = engine.execute(playCard(P1, "c1"));
    assert.equal(result.ok, false);
    assert.equal(result.error.code, CommandError.ENGINE_ERROR);
    assert.match(result.error.message, /boom/);
    assert.deepEqual(view(engine), before);
  });

  it("aborts when a command produces more events than the configured limit", () => {
    const registry = new CommandRegistry().register({
      type: CommandType.PLAY_CARD,
      requiresPriority: true,
      validate: () => ok(undefined),
      execute: (_state, _command, context) => {
        for (let i = 0; i < 1000; i += 1) {
          context.events.emit("SPAM", { i });
        }
      },
    });
    const rules = rulesWith({ limits: { maxEffectsPerResolution: 200, maxEventsPerCommand: 50 } });
    const { engine } = createEngine({ commands: registry, rules });
    const before = view(engine);
    const result = engine.execute(playCard(P1, "c1"));
    assert.equal(result.error.code, CommandError.ENGINE_ERROR);
    assert.match(result.error.message, /50 events/);
    assert.deepEqual(view(engine), before);
  });

  it("CommandRegistry rejects malformed handlers and duplicates", () => {
    const registry = new CommandRegistry();
    assert.throws(() => registry.register({ type: "BOGUS" }), TypeError);
    assert.throws(() => registry.register({ type: CommandType.END_TURN, validate: () => ok() }), TypeError);
    registry.register({ type: CommandType.END_TURN, requiresPriority: true, validate: () => ok(), execute: () => undefined });
    assert.throws(() => registry.register({ type: CommandType.END_TURN, requiresPriority: true, validate: () => ok(), execute: () => undefined }), /already/);
  });
});
