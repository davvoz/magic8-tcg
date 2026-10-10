/**
 * The board of an auto game's replay (docs/tcg/23-automatica.md): a player
 * watching their own game sees it from their seat, as they see a game they
 * play — their hand face up, the help when they turn it on — but nothing
 * can be played on it; its side panel picks how fast it plays, and the
 * pace waits while the board is still showing a move.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ReplayPace, ReplaySpeed } from "../../src/application/auto/ReplayPace.js";
import { BasicAiController } from "../../src/application/match/BasicAiController.js";
import { MatchSession } from "../../src/application/match/MatchSession.js";
import { HelpSettings } from "../../src/application/help/HelpSettings.js";
import { MemoryLogger } from "../../src/infrastructure/logging/MemoryLogger.js";
import { InMemoryStore } from "../../src/infrastructure/persistence/InMemoryStore.js";
import { StoredHelpPreferences } from "../../src/infrastructure/persistence/StoredHelpPreferences.js";
import { CardNode } from "../../src/rendering/board/CardNode.js";
import { HelpHeadline, HelpPointers } from "../../src/rendering/board/HelpOverlay.js";
import { Viewport } from "../../src/rendering/canvas/Viewport.js";
import { MatchScene } from "../../src/rendering/scenes/MatchScene.js";
import { P1, P2 } from "@magic8/engine/testing/fixtures.js";
import { createScenario } from "@magic8/engine/testing/scenario.js";
import { loadTheme } from "./fakes.js";

const theme = loadTheme();

function services() {
  const viewport = new Viewport(theme.layout);
  viewport.resize({ cssWidth: 1600, cssHeight: 900 });
  return { theme, viewport, logger: new MemoryLogger(), requestRender: () => undefined, navigate: () => undefined, hasScene: () => true };
}

/**
 * A replay on the board, held before its first move: its pace never lets the AI move.
 * @param {string | null} viewerId
 * @param {ReplayPace} [pace]
 */
function replayBoard(viewerId, pace = new ReplayPace({ scheduler: { delay: () => new Promise(() => undefined) } })) {
  const { engine } = createScenario({ p1: { hand: ["ember_imp"], resources: 2 } });
  const session = new MatchSession({ engine, controllers: new Map([[P1, new BasicAiController()], [P2, new BasicAiController()]]), scheduler: { delay: async () => undefined }, logger: new MemoryLogger(), pace, viewerId });
  const help = new HelpSettings({ preferences: new StoredHelpPreferences({ store: new InMemoryStore(), logger: new MemoryLogger() }) });
  const scene = new MatchScene(services(), { help });
  scene.enter({ session, againScene: "notifications" });
  return { scene, session, pace, help };
}

const byId = (scene, id) => scene.root.findById(id);
const cardNamed = (scene, name) => {
  let found = null;
  const visit = (node) => {
    if (node instanceof CardNode && node.card.name === name) {
      found = node;
    }
    node.children.forEach(visit);
  };
  visit(scene.root);
  return found;
};

describe("the board of a replay", () => {
  it("is seen from the player's seat: their hand face up, and the help", () => {
    const { scene, help } = replayBoard(P1);
    const imp = cardNamed(scene, "Ember Imp");
    assert.notEqual(imp, null, "the player's own hand, face up");
    assert.notEqual(byId(scene, "help"), null, "the ? is there");
    assert.ok(byId(scene, "help.headline") instanceof HelpHeadline);
    const pointers = byId(scene, "help.pointers");
    assert.ok(pointers instanceof HelpPointers);
    assert.deepEqual(pointers.pointers.map((pointer) => pointer.label), ["PLAY"], "what the player's AI could do now");
    byId(scene, "help").activate();
    assert.equal(help.enabled, false);
    assert.equal(byId(scene, "help.headline"), null, "turned off like in any game");
  });

  it("plays nothing for the player: taps, keys and the side panel make no move", () => {
    const { scene, session } = replayBoard(P1);
    const version = session.version;
    cardNamed(scene, "Ember Imp").activate();
    scene.onKey({ type: "keydown", key: "e", repeat: false });
    assert.equal(session.version, version);
    assert.equal(scene.interaction.pickedCardId, null);
    for (const id of ["endPhase", "endTurn", "confirm"]) {
      assert.equal(byId(scene, id), null, `no ${id}`);
    }
    assert.equal(byId(scene, "leave").text, "Leave", "leaving is not conceding");
    assert.match(byId(scene, "prompt").text, /Replay of .*: the AI plays both decks/);
  });

  it("picks how fast it plays, the speed it plays at lit", () => {
    const { scene, pace } = replayBoard(P1);
    const lit = () => [ReplaySpeed.NORMAL, ReplaySpeed.FAST, ReplaySpeed.VERY_FAST].filter((speed) => byId(scene, `speed.${speed}`).variant === "primary");
    assert.deepEqual([byId(scene, "speed.normal").text, byId(scene, "speed.fast").text, byId(scene, "speed.very_fast").text], ["Normal", "Fast", "Very fast"]);
    assert.deepEqual(lit(), [ReplaySpeed.NORMAL]);
    byId(scene, "speed.very_fast").activate();
    assert.equal(pace.speed, ReplaySpeed.VERY_FAST);
    assert.deepEqual(lit(), [ReplaySpeed.VERY_FAST]);
  });

  it("tells the pace while it is still showing a move, and stops when the player leaves", () => {
    const pace = new ReplayPace({ scheduler: { delay: () => new Promise(() => undefined) } });
    /** @type {((() => boolean) | null)[]} */
    const followed = [];
    pace.follow = (isBusy) => void followed.push(isBusy);
    const { scene } = replayBoard(P1, pace);
    assert.equal(followed.length, 1);
    assert.equal(followed[0]?.(), scene.isBusy);
    scene.exit();
    assert.deepEqual(followed.slice(1), [null], "nothing left to wait for");
  });

  it("is a spectator's for someone who did not play it: no hand, no help", () => {
    const { scene } = replayBoard(null);
    assert.equal(cardNamed(scene, "Ember Imp"), null, "nobody's hand is shown");
    assert.equal(byId(scene, "help"), null);
    assert.notEqual(byId(scene, "speed.normal"), null, "the speed is theirs to pick too");
    assert.match(byId(scene, "prompt").text, /Replay of/);
  });
});
