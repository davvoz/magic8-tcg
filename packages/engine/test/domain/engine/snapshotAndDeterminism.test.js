import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { endPhase, endTurn } from "../../../src/domain/commands/commandFactories.js";
import { GameEventType } from "../../../src/domain/game/GameEventType.js";
import { SPECTATOR, redactEventsFor } from "../../../src/domain/game/GameSnapshot.js";
import { createInitialState, SetupError } from "../../../src/domain/game/MatchSetup.js";
import { createResourceSystem } from "../../../src/domain/resources/IncrementalResourceSystem.js";
import { ChaChaRandom } from "../../../src/domain/random/ChaChaRandom.js";
import { DeckList } from "../../../src/domain/decks/DeckList.js";
import { GameEngine } from "../../../src/domain/game/GameEngine.js";
import { createCoreCommandRegistry } from "../../../src/domain/commands/registerCoreCommands.js";
import { P1, P2, catalog, createEngine, effects, emberDeck, rulesWith, view } from "./fixtures.js";

describe("GameSnapshot", () => {
  it("is deep-frozen plain data", () => {
    const { engine } = createEngine();
    const snapshot = engine.getSnapshot(P1);
    assert.ok(Object.isFrozen(snapshot));
    assert.ok(Object.isFrozen(snapshot.players[0].hand[0]));
    assert.ok(Object.isFrozen(snapshot.legalMoves));
    assert.equal(Object.getPrototypeOf(snapshot), Object.prototype);
    assert.throws(() => {
      "use strict";
      snapshot.players[0].life = 0;
    }, TypeError);
  });

  it("hides the opponent's hand and both libraries for a player perspective", () => {
    const { engine } = createEngine();
    const mine = engine.getSnapshot(P1);
    const me = mine.players.find((p) => p.id === P1);
    const them = mine.players.find((p) => p.id === P2);
    assert.equal(me.hand.length, 5);
    assert.equal(them.hand, null);
    assert.equal(them.handSize, 5);
    assert.equal(them.librarySize, 25);
    assert.equal(mine.perspectivePlayerId, P1);
    assert.equal(mine.legalMoves.canEndPhase, true);
    assert.equal(mine.legalMoves.canEndTurn, true);
    assert.equal(mine.legalMoves.canConcede, true);

    const theirs = engine.getSnapshot(P2);
    assert.equal(theirs.players.find((p) => p.id === P1).hand, null);
    assert.equal(theirs.legalMoves.canEndPhase, false, "not their turn");
    assert.equal(theirs.legalMoves.canConcede, true);
  });

  it("omniscient view reveals everything and carries no legal moves", () => {
    const snapshot = view(createEngine().engine);
    assert.ok(snapshot.players.every((p) => Array.isArray(p.hand)));
    assert.equal(snapshot.legalMoves, null);
  });

  it("spectator view hides both hands and carries no legal moves", () => {
    const snapshot = createEngine().engine.getSnapshot(SPECTATOR);
    assert.ok(snapshot.players.every((p) => p.hand === null && p.handSize > 0));
    assert.equal(snapshot.legalMoves, null);
    assert.equal(snapshot.perspectivePlayerId, SPECTATOR);
  });

  it("projects cards with current stats and printed values", () => {
    const { engine } = createEngine();
    const card = engine.getSnapshot(P1).players[0].hand[0];
    const definition = catalog.get(card.definitionId);
    assert.equal(card.name, definition.name);
    assert.equal(card.cost, definition.cost);
    assert.equal(card.ownerId, P1);
    assert.equal(card.zone, "hand");
    assert.equal(typeof card.summoningSick, "boolean");
  });

  it("redacts the drawn card identity from the opponent's events", () => {
    const { engine } = createEngine();
    const result = engine.execute(endTurn(P1));
    const drawn = result.value.events.find((event) => event.type === GameEventType.CARD_DRAWN);
    assert.equal(typeof drawn.definitionId, "string");
    const forP1 = redactEventsFor(result.value.events, P1).find((event) => event.type === GameEventType.CARD_DRAWN);
    const forP2 = redactEventsFor(result.value.events, P2).find((event) => event.type === GameEventType.CARD_DRAWN);
    assert.equal(forP1.definitionId, undefined);
    assert.equal(forP1.instanceId, drawn.instanceId);
    assert.equal(forP2.definitionId, drawn.definitionId);
    assert.equal(redactEventsFor(result.value.events, null), result.value.events);
    const forSpectator = redactEventsFor(result.value.events, SPECTATOR).find((event) => event.type === GameEventType.CARD_DRAWN);
    assert.equal(forSpectator.definitionId, undefined, "a spectator sees no drawn card");
  });
});

describe("determinism", () => {
  it("same seed and commands produce identical snapshots and events", () => {
    const script = [endPhase(P1), endPhase(P1), endTurn(P1), endTurn(P2), endPhase(P1), endTurn(P1)];
    const run = () => {
      const { engine, startResult } = createEngine({ seed: 777 });
      const events = [...startResult.value.events];
      for (const command of script) {
        const result = engine.execute(command);
        assert.equal(result.ok, true);
        events.push(...result.value.events);
      }
      return { snapshot: view(engine), events };
    };
    const a = run();
    const b = run();
    assert.deepEqual(a.snapshot, b.snapshot);
    assert.deepEqual(a.events, b.events);
  });

  it("different seeds produce different opening hands", () => {
    const hand = (seed) => view(createEngine({ seed }).engine).players[0].hand.map((card) => card.definitionId).join(",");
    assert.notEqual(hand(1), hand(2));
  });
});

describe("createInitialState", () => {
  const deps = () => ({ rules: rulesWith(), catalog, resourceSystem: createResourceSystem(rulesWith()), rng: ChaChaRandom.fromSeed(1) });

  it("rejects wrong player counts, bad ids, duplicates and bad names", () => {
    const setup = (players) => createInitialState({ ...deps(), players });
    const valid = { id: "p1", name: "A", deckList: emberDeck };
    assert.equal(setup([valid]).error.code, SetupError.INVALID_PLAYERS);
    assert.equal(setup([valid, { ...valid }]).error.code, SetupError.INVALID_PLAYERS);
    assert.equal(setup([valid, { ...valid, id: "P 2" }]).error.code, SetupError.INVALID_PLAYERS);
    assert.equal(setup([valid, { ...valid, id: "p2", name: "" }]).error.code, SetupError.INVALID_PLAYERS);
  });

  it("rejects unknown cards and empty decks", () => {
    const ghost = new DeckList({ id: "g", name: "G", entries: [{ cardId: "ghost", count: 1 }] });
    const empty = new DeckList({ id: "e", name: "E", entries: [] });
    const players = (deck) => [
      { id: "p1", name: "A", deckList: emberDeck },
      { id: "p2", name: "B", deckList: deck },
    ];
    assert.equal(createInitialState({ ...deps(), players: players(ghost) }).error.code, SetupError.UNKNOWN_CARD);
    assert.equal(createInitialState({ ...deps(), players: players(empty) }).error.code, SetupError.EMPTY_DECK);
  });

  it("GameEngine.create rejects a seed that is neither a 32-byte key nor a safe integer", () => {
    const result = GameEngine.create({
      rules: rulesWith(),
      catalog,
      effects,
      commands: createCoreCommandRegistry(),
      players: [
        { id: "p1", name: "A", deckList: emberDeck },
        { id: "p2", name: "B", deckList: emberDeck },
      ],
      seed: 1.5,
    });
    assert.equal(result.ok, false);
  });

  it("GameEngine.create accepts a 32-byte key as hex or bytes, with identical results", () => {
    const key = "ab".repeat(32);
    const create = (seed) =>
      GameEngine.create({
        rules: rulesWith(),
        catalog,
        effects,
        commands: createCoreCommandRegistry(),
        players: [
          { id: "p1", name: "A", deckList: emberDeck },
          { id: "p2", name: "B", deckList: emberDeck },
        ],
        seed,
      });
    const fromHex = create(key);
    const fromBytes = create(new Uint8Array(32).fill(0xab));
    assert.equal(fromHex.ok, true);
    assert.equal(fromBytes.ok, true);
    assert.deepEqual(fromHex.value.getStateDigest(), fromBytes.value.getStateDigest());
    assert.equal(create(key.toUpperCase()).ok, false);
  });
});
