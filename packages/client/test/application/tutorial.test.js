/**
 * The tutorial: its scripted opponent, its coach, and the whole lesson
 * played through against a real session, step by step, the way the coach
 * asks (and with only what it allows).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { declareAttackers, declareBlockers, endPhase, endTurn, playCard } from "@magic8/engine/domain/commands/commandFactories.js";
import { CommandType } from "@magic8/engine/domain/commands/CommandType.js";
import { ZoneType } from "@magic8/engine/domain/game/ZoneType.js";
import { P1, P2 } from "@magic8/engine/testing/fixtures.js";
import { createScenario } from "@magic8/engine/testing/scenario.js";
import { MatchSetupService } from "../../src/application/match/MatchSetupService.js";
import { ScriptedAiController } from "../../src/application/match/ScriptedAiController.js";
import { TutorialCoach } from "../../src/application/tutorial/TutorialCoach.js";
import { TutorialService } from "../../src/application/tutorial/TutorialService.js";
import { OPPONENT_DECK, PLAYER_DECK, TUTORIAL_LIFE, TUTORIAL_STEPS } from "../../src/application/tutorial/tutorialScript.js";
import { validateDeck } from "@magic8/engine/domain/decks/DeckValidator.js";
import { MemoryLogger } from "../../src/infrastructure/logging/MemoryLogger.js";
import { immediateScheduler } from "../../src/infrastructure/time/ImmediateScheduler.js";
import { effects, loadBundledContent } from "./fixtures.js";

const content = await loadBundledContent();
const PLAYER = "player";

function startTutorial() {
  const matchSetup = new MatchSetupService({ content, effects, scheduler: immediateScheduler, logger: new MemoryLogger() });
  const started = new TutorialService({ matchSetup, content }).start();
  assert.equal(started.ok, true, JSON.stringify(started));
  return started.value;
}

/** The player's side of the board, as the coach sees it. */
function cardsOf(session, side, zone) {
  const snapshot = session.snapshotFor(PLAYER);
  const player = snapshot.players.find((candidate) => (candidate.id === PLAYER) === (side === "mine"));
  return player[zone];
}
const idOf = (session, side, zone, definitionId) => cardsOf(session, side, zone).find((card) => card.definitionId === definitionId)?.instanceId;

describe("ScriptedAiController", () => {
  it("plays the scripted cards, attacks with the scripted creatures, then ends its turn", () => {
    const { engine, id } = createScenario({ p1: { hand: ["ember_imp", "kindling_sprite"], resources: 1 } });
    const ai = new ScriptedAiController({ script: { 1: { play: ["kindling_sprite"], attack: ["kindling_sprite"] } } });
    const first = ai.decide(engine.getSnapshot(P1));
    assert.equal(first.type, CommandType.PLAY_CARD);
    assert.equal(first.cardId, id(P1, ZoneType.HAND, 1), "the Sprite, not the Imp the practice AI might pick");
    assert.equal(engine.execute(first).ok, true);
    assert.equal(ai.decide(engine.getSnapshot(P1)).type, CommandType.END_PHASE, "on to combat: it has an attack planned");
    assert.equal(engine.execute(endPhase(P1)).ok, true);
    const attack = ai.decide(engine.getSnapshot(P1));
    assert.deepEqual(attack.attackerIds, [id(P1, ZoneType.HAND, 1)], "the Sprite has Haste");
    assert.equal(engine.execute(attack).ok, true);
    assert.equal(engine.execute(declareBlockers(P2, [])).ok, true);
    assert.equal(ai.decide(engine.getSnapshot(P1)).type, CommandType.END_TURN, "after combat, the turn ends");
  });

  it("never blocks on a scripted turn of the other player, and leaves unscripted turns to its fallback", () => {
    const { engine, id } = createScenario({ p1: { battlefield: ["lava_brute"] }, p2: { battlefield: ["iron_colossus"] } });
    assert.equal(engine.execute(endPhase(P1)).ok, true);
    assert.equal(engine.execute(declareAttackers(P1, [id(P1, ZoneType.BATTLEFIELD)])).ok, true);
    const snapshot = engine.getSnapshot(P2);
    assert.deepEqual(new ScriptedAiController({ script: { 1: {} } }).decide(snapshot).blocks, [], "scripted: no block, though the Colossus would win the fight");
    assert.equal(new ScriptedAiController({ script: {} }).decide(snapshot).blocks.length, 1, "past the script, the practice AI blocks a 4/3 with a 5/7");
  });

  it("skips a scripted card that is not in hand, and falls back on one that needs a target", () => {
    const fallback = { kind: "ai", decide: () => endTurn(P1) };
    const missing = createScenario({ p1: { hand: ["ember_imp"], resources: 1 } });
    assert.equal(new ScriptedAiController({ script: { 1: { play: ["kindling_sprite"], attack: ["kindling_sprite"] } }, fallback }).decide(missing.engine.getSnapshot(P1)).type, CommandType.END_PHASE, "nothing to play: on to the planned attack");
    const targeted = createScenario({ p1: { hand: ["ember_bolt"], resources: 2 } });
    assert.equal(new ScriptedAiController({ script: { 1: { play: ["ember_bolt"] } }, fallback }).decide(targeted.engine.getSnapshot(P1)).type, CommandType.END_TURN, "the fallback aims what needs aiming");
  });
});

describe("TutorialCoach", () => {
  const steps = [
    { id: "wait", until: (view) => view.myMainPhaseFrom(1) },
    { id: "lesson", title: "Hello", text: "Read me." },
    { id: "task", hint: "Play the Imp.", taps: (view) => view.ids("ember_imp", "mine", "hand"), buttons: ["endTurn"], until: (view) => view.has("ember_imp", "mine", "battlefield") },
    { id: "free", hint: "Anything goes.", free: true, until: (view) => view.isOver },
  ];

  it("waits, holds the board for a lesson, then lets through only what the task names", () => {
    const { engine, id } = createScenario({ p1: { hand: ["ember_imp", "kindling_sprite"], resources: 1 } });
    const coach = new TutorialCoach({ steps, playerId: P1 });
    assert.equal(coach.sync(engine.getSnapshot(P1)), true, "the wait is over at once: it is P1's main phase");
    assert.deepEqual(coach.lesson, { title: "Hello", text: "Read me.", number: 1, of: 1 });
    assert.equal(coach.holdsBoard, true);
    assert.equal(coach.hintFor(), null);
    assert.equal(coach.allowsTap(id(P1, ZoneType.HAND, 0)), false, "nothing is played while a lesson is read");
    assert.equal(coach.allowsButton("endTurn"), false);
    assert.equal(coach.sync(engine.getSnapshot(P1)), false, "a lesson waits for its Next");

    assert.equal(coach.next(), true);
    assert.equal(coach.hintFor(), "Play the Imp.");
    assert.equal(coach.allowsTap(id(P1, ZoneType.HAND, 0)), true);
    assert.equal(coach.allowsTap(id(P1, ZoneType.HAND, 1)), false, "the Sprite is not part of the task");
    assert.equal(coach.allowsButton("endTurn"), true);
    assert.equal(coach.allowsButton("endPhase"), false);
    assert.equal(coach.allowsConfirm({ pickedCardId: id(P1, ZoneType.HAND, 0), attackerIds: [], blocks: [] }), true, "playing the picked Imp");
    assert.equal(coach.allowsConfirm({ pickedCardId: id(P1, ZoneType.HAND, 1), attackerIds: [], blocks: [] }), false);
    assert.equal(coach.next(), false, "Next only ends a lesson");

    assert.equal(engine.execute(playCard(P1, id(P1, ZoneType.HAND, 0))).ok, true);
    assert.equal(coach.sync(engine.getSnapshot(P1)), true);
    assert.equal(coach.step?.id, "free");
    assert.equal(coach.allowsTap("anything"), true);
    assert.equal(coach.allowsButton("endPhase"), true);
    assert.equal(coach.isFinished, false);
  });
});

describe("TutorialService", () => {
  it("deals legal decks, unshuffled, for a short game the player starts", () => {
    for (const deck of [PLAYER_DECK, OPPONENT_DECK]) {
      assert.equal(validateDeck(deck, content.deckRules, content.catalog).valid, true, deck.name);
    }
    const { session, coach } = startTutorial();
    assert.equal(session.openingToss, null, "no coin toss: the player goes first");
    session.start();
    const snapshot = session.snapshotFor(PLAYER);
    assert.equal(snapshot.activePlayerId, PLAYER);
    assert.deepEqual(snapshot.players.map((player) => player.life), [TUTORIAL_LIFE, TUTORIAL_LIFE]);
    assert.deepEqual(snapshot.players[0].hand.map((card) => card.definitionId), ["scrap_golem", "flame_scout", "ember_bolt", "ember_bolt", "ember_imp"]);
    assert.equal(coach.step?.id, TUTORIAL_STEPS[0].id);
  });

  it("plays through: every task can be done with what it allows, and the player wins", async () => {
    const { session, coach } = startTutorial();
    const lessons = [];
    const sync = async () => {
      await session.whenIdle();
      coach.sync(session.snapshotFor(PLAYER));
      while (coach.holdsBoard) {
        lessons.push(coach.step.id);
        coach.next();
      }
    };
    /** Submits a command the coach must allow: `allowed` says how it was let through. */
    const act = async (command, allowed) => {
      assert.equal(allowed, true, `step ${coach.step?.id} allows ${command.type}`);
      const result = session.submit(command);
      assert.equal(result.ok, true, JSON.stringify(result));
      await sync();
    };
    const none = { pickedCardId: null, attackerIds: [], blocks: [] };
    session.start();
    await sync();

    // Turn 1: play the Golem (the Imp is not allowed), end the turn.
    const golem = idOf(session, "mine", "hand", "scrap_golem");
    assert.equal(coach.allowsTap(idOf(session, "mine", "hand", "ember_imp")), false);
    await act(playCard(PLAYER, golem), coach.allowsTap(golem));
    assert.equal(coach.allowsButton("endPhase"), false);
    await act(endTurn(PLAYER), coach.allowsButton("endTurn"));

    // Turn 2: the Sprite attacks; block it with the Golem.
    assert.equal(coach.step?.id, "block");
    const sprite = idOf(session, "theirs", "battlefield", "kindling_sprite");
    assert.ok(coach.allowsTap(golem) && coach.allowsTap(sprite));
    assert.equal(coach.allowsConfirm(none), false, "\"No blocks\" is not the lesson");
    const block = { attackerId: sprite, blockerId: golem };
    await act(declareBlockers(PLAYER, [block]), coach.allowsConfirm({ ...none, blocks: [block] }));
    assert.equal(idOf(session, "theirs", "battlefield", "kindling_sprite"), undefined, "the Sprite died");

    // Turn 3: play the Scout, go to combat, attack with both.
    assert.equal(coach.step?.id, "play-scout");
    const scout = idOf(session, "mine", "hand", "flame_scout");
    await act(playCard(PLAYER, scout), coach.allowsTap(scout));
    await act(endPhase(PLAYER), coach.allowsButton("endPhase"));
    assert.equal(coach.allowsConfirm({ ...none, attackerIds: [scout] }), false, "both creatures attack");
    await act(declareAttackers(PLAYER, [scout, golem]), coach.allowsConfirm({ ...none, attackerIds: [scout, golem] }));
    assert.equal(session.snapshotFor(PLAYER).players[1].life, TUTORIAL_LIFE - 3);
    await act(endTurn(PLAYER), coach.allowsButton("endTurn"));

    // Turn 5: Ember Bolt on the Rivet Hound, attack again, play the Imp.
    assert.equal(coach.step?.id, "cast-bolt");
    const bolt = idOf(session, "mine", "hand", "ember_bolt");
    const hound = idOf(session, "theirs", "battlefield", "rivet_hound");
    assert.equal(coach.allowsTap("trainer"), false, "the Bolt goes to the Hound, not the face");
    await act(playCard(PLAYER, bolt, [hound]), coach.allowsTap(bolt) && coach.allowsTap(hound));
    await act(endPhase(PLAYER), coach.allowsButton("endPhase"));
    await act(declareAttackers(PLAYER, [scout, golem]), coach.allowsConfirm({ ...none, attackerIds: [golem, scout] }));
    const imp = idOf(session, "mine", "hand", "ember_imp");
    await act(playCard(PLAYER, imp), coach.allowsTap(imp));
    await act(endTurn(PLAYER), coach.allowsButton("endTurn"));

    // Turn 7: free play. Bolt to the face, everyone attacks.
    assert.equal(coach.step?.id, "free-play");
    assert.equal(session.snapshotFor(PLAYER).players[1].life, 4);
    assert.ok(idOf(session, "theirs", "battlefield", "wandering_sellsword"), "the opponent played its Sellsword");
    await act(playCard(PLAYER, idOf(session, "mine", "hand", "ember_bolt"), ["trainer"]), coach.allowsTap("trainer"));
    await act(endPhase(PLAYER), coach.allowsButton("endPhase"));
    await act(declareAttackers(PLAYER, [scout, golem, imp]), true);
    const end = session.snapshotFor(PLAYER);
    assert.equal(end.isOver, true);
    assert.equal(end.winnerId, PLAYER);
    assert.equal(coach.isFinished, true);
    assert.deepEqual(lessons, TUTORIAL_STEPS.filter((step) => step.text !== undefined).map((step) => step.id), "every lesson was shown, in order");
  });
});
