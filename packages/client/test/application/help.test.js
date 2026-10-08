/**
 * The match help: whether it is on (a player's choice, kept between visits)
 * and what it says in each phase, from the snapshots of real matches.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CommandType } from "@magic8/engine/domain/commands/CommandType.js";
import { GamePhase } from "@magic8/engine/domain/game/GamePhase.js";
import { ZoneType } from "@magic8/engine/domain/game/ZoneType.js";
import { P1, P2 } from "@magic8/engine/testing/fixtures.js";
import { createScenario } from "@magic8/engine/testing/scenario.js";
import { DEFAULT_HELP_ENABLED, HelpSettings, parseHelpEnabled } from "../../src/application/help/HelpSettings.js";
import { HelpTone, helpFor } from "../../src/application/help/matchHelp.js";
import { NO_INTENT } from "../../src/application/tutorial/TutorialCoach.js";
import { MemoryLogger } from "../../src/infrastructure/logging/MemoryLogger.js";
import { InMemoryStore } from "../../src/infrastructure/persistence/InMemoryStore.js";
import { HELP_STORAGE_KEY, StoredHelpPreferences } from "../../src/infrastructure/persistence/StoredHelpPreferences.js";

describe("HelpSettings", () => {
  it("is on for a new player, and remembers being turned off", () => {
    const store = new InMemoryStore();
    const preferences = new StoredHelpPreferences({ store, logger: new MemoryLogger() });
    const help = new HelpSettings({ preferences });
    assert.equal(help.enabled, true);
    assert.equal(DEFAULT_HELP_ENABLED, true);
    const heard = [];
    const unsubscribe = help.subscribe((enabled) => heard.push(enabled));
    help.toggle();
    assert.equal(help.enabled, false);
    help.setEnabled(false);
    assert.deepEqual(heard, [false], "nothing changed the second time, nobody is told");
    assert.equal(new HelpSettings({ preferences }).enabled, false, "the next visit starts with it off");
    unsubscribe();
    help.toggle();
    assert.deepEqual(heard, [false]);
    assert.equal(new HelpSettings({ preferences }).enabled, true);
  });

  it("falls back to the default for anything stored that it cannot read", () => {
    assert.equal(parseHelpEnabled(null), true);
    assert.equal(parseHelpEnabled("off"), true);
    assert.equal(parseHelpEnabled({ enabled: "no" }), true);
    assert.equal(parseHelpEnabled({ enabled: false }), false);
    const store = new InMemoryStore();
    store.write(HELP_STORAGE_KEY, "{not json");
    const logger = new MemoryLogger();
    assert.equal(new HelpSettings({ preferences: new StoredHelpPreferences({ store, logger }) }).enabled, true);
    assert.equal(logger.entries.some((entry) => entry.level === "warn"), true, "the unreadable value is reported");
  });
});

describe("helpFor", () => {
  const moment = (snapshot, intent = {}, playerId = P1) => helpFor({ snapshot, playerId, intent: { ...NO_INTENT, ...intent } });
  /** Each button the help talks about, "id:label", starred when it is the move suggested. */
  const buttons = (help) => help.buttons.map(({ id, label, primary }) => `${id}:${label}${primary ? "*" : ""}`);

  it("in the main phase: PLAY on the cards, and what each way on does; on to combat when nothing can be paid for", () => {
    const { engine, id } = createScenario({ p1: { hand: ["ember_imp"], resources: 3 } });
    const help = moment(engine.getSnapshot(P1));
    assert.deepEqual([help.headline, help.tone, help.marks.playable], ["PLAY A CARD!", HelpTone.PLAY, "PLAY"]);
    assert.deepEqual(buttons(help), ["endPhase:COMBAT", "endTurn:END TURN"]);
    const picked = moment(engine.getSnapshot(P1), { pickedCardId: id(P1, ZoneType.HAND) });
    assert.deepEqual(buttons(picked), ["confirm:PLAY!*", "cancel:CANCEL"]);
    const broke = createScenario({ p1: { hand: ["blazing_titan"], resources: 1 } }).engine;
    const nothing = moment(broke.getSnapshot(P1));
    assert.deepEqual([nothing.headline, nothing.tone, nothing.marks.playable, ...buttons(nothing)], ["TO COMBAT!", HelpTone.NEXT, null, "endPhase:COMBAT*", "endTurn:END TURN"]);
  });

  it("while a target is chosen: TARGET on the targets", () => {
    const { engine, id } = createScenario({ p1: { hand: ["ember_bolt"], resources: 2 }, p2: { battlefield: ["cinder_hound"] } });
    const help = moment(engine.getSnapshot(P1), { targetingCardId: id(P1, ZoneType.HAND) });
    assert.deepEqual([help.headline, help.tone, help.marks.targetable, help.marks.playable, ...buttons(help)], ["PICK A TARGET!", HelpTone.TARGET, "TARGET", null, "cancel:CANCEL"]);
  });

  it("in combat: ATTACK on the creatures, the ways to skip it, GO! once one is chosen; after it, both ways end the turn", () => {
    const { engine, id } = createScenario({ p1: { battlefield: ["blazing_titan"] } });
    assert.equal(engine.execute({ type: CommandType.END_PHASE, playerId: P1 }).ok, true);
    const snapshot = engine.getSnapshot(P1);
    assert.equal(snapshot.phase, GamePhase.COMBAT_ATTACKERS);
    const help = moment(snapshot);
    assert.deepEqual([help.headline, help.tone, help.marks.playable, ...buttons(help)], ["ATTACK!", HelpTone.ATTACK, "ATTACK", "confirm:SKIP", "endPhase:SKIP", "endTurn:END TURN"]);
    assert.deepEqual(buttons(moment(snapshot, { attackerIds: [id(P1, ZoneType.BATTLEFIELD)] })), ["confirm:GO!*", "cancel:CANCEL", "endPhase:SKIP", "endTurn:END TURN"]);
    assert.equal(engine.execute({ type: CommandType.DECLARE_ATTACKERS, playerId: P1, attackerIds: [] }).ok, true);
    const after = engine.getSnapshot(P1);
    assert.equal(after.phase, GamePhase.MAIN_2);
    const second = moment({ ...after, legalMoves: { ...after.legalMoves, playableCardIds: [] } });
    assert.deepEqual([second.headline, ...buttons(second)], ["END YOUR TURN!", "endPhase:END TURN", "endTurn:END TURN*"]);
  });

  it("when attacked: BLOCK on the blockers, then THIS ONE? on the attackers, GO! once blocked", () => {
    const { engine, id } = createScenario({ p1: { battlefield: ["steel_sentinel"] }, p2: { battlefield: ["lava_brute"] } });
    assert.equal(engine.execute({ type: CommandType.END_TURN, playerId: P1 }).ok, true);
    assert.equal(engine.execute({ type: CommandType.END_PHASE, playerId: P2 }).ok, true);
    assert.equal(engine.execute({ type: CommandType.DECLARE_ATTACKERS, playerId: P2, attackerIds: [id(P2, ZoneType.BATTLEFIELD)] }).ok, true);
    const snapshot = engine.getSnapshot(P1);
    assert.equal(snapshot.phase, GamePhase.COMBAT_BLOCKERS);
    const help = moment(snapshot);
    assert.deepEqual([help.headline, help.tone, help.marks.playable, ...buttons(help)], ["BLOCK!", HelpTone.BLOCK, "BLOCK", "confirm:NO BLOCK"]);
    const pending = moment(snapshot, { pendingBlockerId: id(P1, ZoneType.BATTLEFIELD) });
    assert.deepEqual([pending.marks.playable, pending.marks.targetable, ...buttons(pending)], [null, "THIS ONE?", "confirm:NO BLOCK", "cancel:CANCEL"]);
    const blocked = moment(snapshot, { blocks: [{ attackerId: id(P2, ZoneType.BATTLEFIELD), blockerId: id(P1, ZoneType.BATTLEFIELD) }] });
    assert.deepEqual(buttons(blocked), ["confirm:GO!*", "cancel:CANCEL"]);
    assert.equal(moment(engine.getSnapshot(P2), {}, P2), null, "the attacker waits: nothing to shout");
  });

  it("is silent on the opponent's turn and once the match is over", () => {
    const { engine } = createScenario({});
    assert.equal(engine.execute({ type: CommandType.END_TURN, playerId: P1 }).ok, true);
    assert.equal(moment(engine.getSnapshot(P1)), null);
    assert.equal(engine.execute({ type: CommandType.CONCEDE, playerId: P1 }).ok, true);
    assert.equal(moment(engine.getSnapshot(P1)), null);
  });
});
