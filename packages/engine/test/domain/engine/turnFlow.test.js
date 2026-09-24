import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { concede, endPhase, endTurn } from "../../../src/domain/commands/commandFactories.js";
import { GameEndReason, GameEventType } from "../../../src/domain/game/GameEventType.js";
import { GamePhase } from "../../../src/domain/game/GamePhase.js";
import { DeckList } from "../../../src/domain/decks/DeckList.js";
import { P1, P2, createEngine, eventsOfType, player, rulesWith, view } from "./fixtures.js";

describe("match start", () => {
  it("deals opening hands, enters MAIN_1 for the first player and grants the first resource", () => {
    const { engine, startResult } = createEngine();
    assert.equal(startResult.ok, true);
    const snapshot = view(engine);
    assert.equal(snapshot.phase, GamePhase.MAIN_1);
    assert.equal(snapshot.activePlayerId, P1);
    assert.equal(snapshot.awaitingPlayerId, P1);
    assert.equal(snapshot.turnNumber, 1);
    assert.equal(player(engine, P1).handSize, 5, "first player skips the first draw");
    assert.equal(player(engine, P2).handSize, 5);
    assert.equal(player(engine, P1).librarySize, 25);
    assert.deepEqual(player(engine, P1).resources, { current: 1, max: 1 });
    assert.deepEqual(player(engine, P2).resources, { current: 0, max: 0 });
    assert.equal(player(engine, P1).life, 20);
    assert.equal(eventsOfType(startResult.value.events, GameEventType.GAME_STARTED).length, 1);
    assert.equal(eventsOfType(startResult.value.events, GameEventType.TURN_STARTED).length, 1);
    assert.equal(eventsOfType(startResult.value.events, GameEventType.CARD_DRAWN).length, 0);
  });

  it("refuses to start twice or execute before start", () => {
    const { engine } = createEngine({ start: false });
    assert.equal(engine.execute(endTurn(P1)).ok, false);
    assert.equal(engine.start().ok, true);
    assert.equal(engine.start().ok, false);
  });

  it("allocates deterministic instance ids across both decks", () => {
    const { engine } = createEngine();
    const ids = view(engine).players.flatMap((p) => [...p.hand, ...p.battlefield, ...p.graveyard].map((card) => card.instanceId));
    assert.ok(ids.every((id) => /^c\d+$/.test(id)));
    assert.equal(new Set(ids).size, ids.length);
  });
});

describe("phase progression", () => {
  it("END_PHASE walks MAIN_1 → COMBAT_ATTACKERS → MAIN_2 (blockers and damage skipped without attackers) → next turn", () => {
    const { engine } = createEngine();
    assert.equal(engine.execute(endPhase(P1)).ok, true);
    assert.equal(view(engine).phase, GamePhase.COMBAT_ATTACKERS);
    assert.equal(engine.execute(endPhase(P1)).ok, true);
    assert.equal(view(engine).phase, GamePhase.MAIN_2);
    const result = engine.execute(endPhase(P1));
    assert.equal(result.ok, true);
    const snapshot = view(engine);
    assert.equal(snapshot.phase, GamePhase.MAIN_1);
    assert.equal(snapshot.activePlayerId, P2);
    assert.equal(snapshot.awaitingPlayerId, P2);
    assert.equal(snapshot.turnNumber, 2);
    const phases = eventsOfType(result.value.events, GameEventType.PHASE_CHANGED).map((event) => event.to);
    assert.deepEqual(phases, [GamePhase.TURN_END, GamePhase.TURN_START, GamePhase.MAIN_1]);
  });

  it("END_TURN jumps straight to the opponent's main phase and draws them a card", () => {
    const { engine } = createEngine();
    const result = engine.execute(endTurn(P1));
    assert.equal(result.ok, true);
    assert.equal(view(engine).activePlayerId, P2);
    assert.equal(view(engine).phase, GamePhase.MAIN_1);
    assert.equal(player(engine, P2).handSize, 6);
    assert.equal(player(engine, P2).librarySize, 24);
    assert.deepEqual(player(engine, P2).resources, { current: 1, max: 1 });
    const drawn = eventsOfType(result.value.events, GameEventType.CARD_DRAWN);
    assert.equal(drawn.length, 1);
    assert.equal(drawn[0].playerId, P2);
  });

  it("grows resources by one per turn up to the configured cap", () => {
    const { engine } = createEngine({ rules: rulesWith({ resource: { type: "incremental", gainPerTurn: 1, max: 3, startingMax: 0 } }) });
    for (let turn = 0; turn < 10; turn += 1) {
      assert.equal(engine.execute(endTurn(view(engine).activePlayerId)).ok, true);
    }
    assert.deepEqual(player(engine, P1).resources, { current: 3, max: 3 });
    assert.deepEqual(player(engine, P2).resources, { current: 3, max: 3 });
  });

  it("discards down to the hand limit at end of turn (most recent cards first)", () => {
    const { engine } = createEngine({ rules: rulesWith({ maxHandSize: 5 }) });
    engine.execute(endTurn(P1));
    assert.equal(player(engine, P2).handSize, 6);
    const result = engine.execute(endTurn(P2));
    assert.equal(player(engine, P2).handSize, 5);
    assert.equal(player(engine, P2).graveyard.length, 1);
    assert.equal(eventsOfType(result.value.events, GameEventType.CARD_DISCARDED).length, 1);
  });

  it("allows END_TURN during COMBAT_ATTACKERS but not during the opponent's turn", () => {
    const { engine } = createEngine();
    engine.execute(endPhase(P1));
    assert.equal(view(engine).phase, GamePhase.COMBAT_ATTACKERS);
    assert.equal(engine.execute(endTurn(P2)).error.code, "NOT_YOUR_TURN");
    assert.equal(engine.execute(endTurn(P1)).ok, true);
  });
});

describe("empty library", () => {
  const tinyDeck = new DeckList({ id: "tiny", name: "Tiny", faction: "ember", entries: [{ cardId: "ember_imp", count: 6 }] });

  it("fatigue mode deals damage per failed draw and the game ends through state-based actions", () => {
    const rules = rulesWith({ startingLife: 2, startingHandSize: 5 });
    const { engine } = createEngine({ rules, decks: [tinyDeck, tinyDeck] });
    // P1: 5 in hand, 1 in library. Turn 1 skips the draw.
    engine.execute(endTurn(P1)); // P2 draws its last card
    engine.execute(endTurn(P2)); // P1 draws its last card
    engine.execute(endTurn(P1)); // P2: empty library → fatigue 1 → life 1
    assert.equal(player(engine, P2).life, 1);
    assert.equal(view(engine).isOver, false);
    const result = engine.execute(endTurn(P2)); // P1: fatigue → life 1
    assert.equal(player(engine, P1).life, 1);
    assert.equal(eventsOfType(result.value.events, GameEventType.FATIGUE_DAMAGE).length, 1);
    const fatal = engine.execute(endTurn(P1)); // P2: fatigue → life 0 → loses
    const snapshot = view(engine);
    assert.equal(snapshot.isOver, true);
    assert.equal(snapshot.winnerId, P1);
    assert.equal(snapshot.endReason, GameEndReason.LIFE_DEPLETED);
    assert.equal(snapshot.awaitingPlayerId, null);
    assert.equal(eventsOfType(fatal.value.events, GameEventType.GAME_ENDED).length, 1);
    assert.equal(engine.execute(endTurn(P1)).error.code, "GAME_OVER");
  });

  it("lose mode ends the game on the first failed draw", () => {
    const rules = rulesWith({ emptyLibrary: { mode: "lose", damagePerDraw: 0 } });
    const { engine } = createEngine({ rules, decks: [tinyDeck, tinyDeck] });
    engine.execute(endTurn(P1));
    engine.execute(endTurn(P2));
    const result = engine.execute(endTurn(P1));
    assert.equal(view(engine).isOver, true);
    assert.equal(view(engine).winnerId, P1);
    assert.equal(eventsOfType(result.value.events, GameEventType.GAME_ENDED).length, 1);
  });
});

describe("concede", () => {
  it("is legal for either player at any time and ends the game", () => {
    const { engine } = createEngine();
    const result = engine.execute(concede(P2));
    assert.equal(result.ok, true);
    const snapshot = view(engine);
    assert.equal(snapshot.isOver, true);
    assert.equal(snapshot.winnerId, P1);
    assert.equal(snapshot.endReason, GameEndReason.CONCEDE);
    assert.deepEqual(
      result.value.events.map((event) => event.type),
      [GameEventType.PLAYER_CONCEDED, GameEventType.GAME_ENDED],
    );
  });
});
