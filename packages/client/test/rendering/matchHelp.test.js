/**
 * The match help on the board: its "?" in the banner's left margin, its
 * headline over the table in place of the banner, a labelled arrow on
 * everything that can be used now; turned off and on by the button or H, on
 * a desktop and on a phone; never offered in the tutorial or to a spectator.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BasicAiController } from "../../src/application/match/BasicAiController.js";
import { humanController } from "../../src/application/match/HumanController.js";
import { MatchSession } from "../../src/application/match/MatchSession.js";
import { HelpSettings } from "../../src/application/help/HelpSettings.js";
import { helpFor } from "../../src/application/help/matchHelp.js";
import { NO_INTENT, TutorialCoach } from "../../src/application/tutorial/TutorialCoach.js";
import { CommandType } from "@magic8/engine/domain/commands/CommandType.js";
import { ZoneType } from "@magic8/engine/domain/game/ZoneType.js";
import { MemoryLogger } from "../../src/infrastructure/logging/MemoryLogger.js";
import { InMemoryStore } from "../../src/infrastructure/persistence/InMemoryStore.js";
import { StoredHelpPreferences } from "../../src/infrastructure/persistence/StoredHelpPreferences.js";
import { immediateScheduler } from "../../src/infrastructure/time/ImmediateScheduler.js";
import { computeBoardLayout } from "../../src/rendering/board/BoardLayout.js";
import { CardNode } from "../../src/rendering/board/CardNode.js";
import { HelpHeadline, HelpPointers } from "../../src/rendering/board/HelpOverlay.js";
import { Viewport } from "../../src/rendering/canvas/Viewport.js";
import { MatchScene } from "../../src/rendering/scenes/MatchScene.js";
import { P1, P2 } from "@magic8/engine/testing/fixtures.js";
import { createScenario } from "@magic8/engine/testing/scenario.js";
import { FakeContext2D, loadTheme } from "./fakes.js";

const theme = loadTheme();
const DESKTOP = Object.freeze({ cssWidth: 1600, cssHeight: 900 });
const SMALL_PHONE = Object.freeze({ cssWidth: 667, cssHeight: 375 });

function services(size) {
  const viewport = new Viewport(theme.layout);
  viewport.resize(size);
  return { theme, viewport, logger: new MemoryLogger(), requestRender: () => undefined, navigate: () => undefined, hasScene: () => true };
}

const newHelp = () => new HelpSettings({ preferences: new StoredHelpPreferences({ store: new InMemoryStore(), logger: new MemoryLogger() }) });

async function boardWith(spec, { size = DESKTOP, help = newHelp() } = {}) {
  const { engine } = createScenario(spec);
  const session = new MatchSession({ engine, controllers: new Map([[P1, humanController], [P2, new BasicAiController()]]), scheduler: immediateScheduler, logger: new MemoryLogger() });
  session.start();
  await session.whenIdle();
  const scene = new MatchScene(services(size), { help });
  scene.enter({ session });
  return { scene, session, help };
}

const byId = (scene, id) => scene.root.findById(id);
const rendered = (scene) => {
  const context = new FakeContext2D();
  scene.render(context);
  return context.texts;
};
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
const contains = (outer, inner) => inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const headline = (scene) => {
  const node = byId(scene, "help.headline");
  return node instanceof HelpHeadline ? node.text : null;
};
/** What the arrows point at: "<label>@<id of the card, portrait or button>", starred for the move suggested. */
const pointed = (scene) => {
  const node = byId(scene, "help.pointers");
  if (!(node instanceof HelpPointers)) {
    return [];
  }
  const ids = new Map();
  const visit = (child) => {
    if (child.id !== "" && child.id !== undefined) {
      ids.set(JSON.stringify(child.bounds), child.id);
    }
    child.children.forEach(visit);
  };
  visit(scene.root);
  return node.pointers.map((pointer) => `${pointer.label}@${ids.get(JSON.stringify(pointer.area)) ?? "?"}${pointer.primary === false ? "" : "*"}`).sort();
};

describe("The match help on the board", () => {
  it("shouts the move in place of the banner and points at the card to play and at every way on", async () => {
    const { scene } = await boardWith({ p1: { hand: ["ember_imp", "blazing_titan"], resources: 2 } });
    assert.equal(headline(scene), "PLAY A CARD!");
    assert.ok(!rendered(scene).some((text) => text.startsWith("Turn 1 · Your turn")), "the banner gives way to the headline");
    const imp = cardNamed(scene, "Ember Imp").id;
    assert.deepEqual(pointed(scene), ["COMBAT@endPhase", "END TURN@endTurn", `PLAY@${imp}*`], "not the card that cannot be paid for");
    assert.equal(byId(scene, "help").text, "?");
    assert.equal(byId(scene, "help").variant, "primary", "lit while on");
  });

  it("is turned off by its button and on again by H, and the board goes back to its banner", async () => {
    const { scene, help } = await boardWith({ p1: { hand: ["ember_imp"], resources: 2 } });
    byId(scene, "help").activate();
    assert.equal(help.enabled, false);
    assert.equal(byId(scene, "help.headline"), null);
    assert.equal(byId(scene, "help.pointers"), null);
    assert.equal(byId(scene, "help").variant, "secondary", "dim while off");
    assert.ok(rendered(scene).some((text) => text.startsWith("Turn 1 · Your turn")));
    scene.onKey({ type: "keydown", key: "h", repeat: false });
    assert.equal(help.enabled, true);
    assert.equal(headline(scene), "PLAY A CARD!");
  });

  it("starts off when the player turned it off before", async () => {
    const help = newHelp();
    help.setEnabled(false);
    const { scene } = await boardWith({ p1: {} }, { help });
    assert.ok(byId(scene, "help"), "the button is there to turn it on");
    assert.equal(byId(scene, "help.headline"), null);
  });

  it("follows the player's choices: a card that needs a target points at the targets", async () => {
    const { scene } = await boardWith({ p1: { hand: ["ember_bolt"], resources: 2 }, p2: { battlefield: ["cinder_hound"] } });
    cardNamed(scene, "Ember Bolt").activate();
    assert.equal(headline(scene), "PICK A TARGET!");
    assert.ok(pointed(scene).includes(`TARGET@${cardNamed(scene, "Cinder Hound").id}*`), pointed(scene).join());
    assert.ok(pointed(scene).includes("CANCEL@cancel"), "and at the way back");
    assert.ok(!pointed(scene).some((pointer) => pointer.endsWith("@endTurn")), "not at what cannot be pressed meanwhile");
  });

  it("with nothing to tap suggests the way on, and still shows the other", async () => {
    const { scene } = await boardWith({ p1: { hand: ["blazing_titan"], resources: 1 } });
    assert.equal(headline(scene), "TO COMBAT!");
    assert.deepEqual(pointed(scene), ["COMBAT@endPhase*", "END TURN@endTurn"]);
  });

  it("goes quiet on the opponent's turn: the banner says whose it is", async () => {
    const { scene } = await boardWith({ p1: {} });
    scene.onKey({ type: "keydown", key: "e", repeat: false });
    assert.equal(byId(scene, "help.headline"), null);
    assert.equal(byId(scene, "help.pointers"), null);
  });

  for (const [name, size] of [["a desktop", DESKTOP], ["the smallest phone", SMALL_PHONE]]) {
    it(`on ${name} keeps its button and its headline in the banner, clear of each other and of the clock, and every headline fits`, async () => {
      const { scene, session } = await boardWith({ p1: { hand: ["ember_imp"], resources: 2 } }, { size });
      const { viewport } = scene.services;
      const layout = computeBoardLayout(session.snapshotFor(P1), P1, viewport.safeBounds, { compact: viewport.compact });
      const button = byId(scene, "help");
      const room = byId(scene, "help.headline");
      assert.deepEqual(button.bounds, layout.help);
      assert.ok(contains(layout.banner, room.bounds), "the headline keeps to the banner");
      assert.ok(!overlaps(button.bounds, room.bounds), "it does not cover the button");
      assert.ok(!overlaps(layout.clock, room.bounds), "nor the clock");
      assert.ok(contains(viewport.bounds, button.bounds));
      // Bold capitals are wide: about two thirds of an em each, swollen at the top of a beat, on a padded plate.
      const fontSize = theme.fonts.sizes[viewport.compact ? "body" : "heading"];
      for (const text of everyHeadline()) {
        assert.ok((text.length * fontSize * 0.68 + 44) * 1.06 <= room.width, `${text} fits`);
      }
    });
  }

  it("steps aside while a card is held up to be read on a phone, pointing at Play and Cancel", async () => {
    const { scene } = await boardWith({ p1: { hand: ["ember_bolt"], resources: 2 }, p2: { battlefield: ["cinder_hound"] } }, { size: SMALL_PHONE });
    cardNamed(scene, "Ember Bolt").activate();
    assert.equal(byId(scene, "help.headline"), null, "the card covers the middle of the table");
    assert.deepEqual(pointed(scene), ["CANCEL@cancel", "PLAY!@confirm*"]);
    byId(scene, "confirm").activate();
    assert.equal(headline(scene), "PICK A TARGET!");
  });

  it("is not offered without the setting, in the tutorial, or to a spectator", async () => {
    const { engine } = createScenario({ p1: {} });
    const session = new MatchSession({ engine, controllers: new Map([[P1, humanController], [P2, new BasicAiController()]]), scheduler: immediateScheduler, logger: new MemoryLogger() });
    session.start();
    await session.whenIdle();
    const plain = new MatchScene(services(DESKTOP));
    plain.enter({ session });
    assert.equal(byId(plain, "help"), null);
    plain.onKey({ type: "keydown", key: "h", repeat: false });
    assert.equal(byId(plain, "help.hint"), null);

    const help = newHelp();
    const tutorial = new MatchScene(services(DESKTOP), { help });
    tutorial.enter({ session, coach: new TutorialCoach({ steps: [], playerId: P1 }) });
    assert.equal(byId(tutorial, "help"), null, "the tutorial has its coach");
    tutorial.onKey({ type: "keydown", key: "h", repeat: false });
    assert.equal(help.enabled, true, "H does nothing there");

    const watched = new MatchSession({ engine: createScenario({}).engine, controllers: new Map([[P1, new BasicAiController()], [P2, new BasicAiController()]]), scheduler: immediateScheduler, logger: new MemoryLogger() });
    const spectator = new MatchScene(services(DESKTOP), { help });
    spectator.enter({ session: watched });
    assert.equal(byId(spectator, "help"), null, "a spectator has nothing to play");
  });
});

/** Every headline the help can shout, from every kind of moment of a real match. */
function everyHeadline() {
  const { engine, id } = createScenario({ p1: { hand: ["ember_imp"], battlefield: ["steel_sentinel"], resources: 2 }, p2: { battlefield: ["lava_brute"] } });
  const card = id(P1, ZoneType.HAND);
  const intents = [{}, { targetingCardId: card }, { pickedCardId: card }, { attackerIds: [card] }, { pendingBlockerId: card }, { blocks: [{ attackerId: card, blockerId: card }] }];
  const said = new Set();
  const listen = () => {
    for (const playerId of [P1, P2]) {
      const snapshot = engine.getSnapshot(playerId);
      const none = snapshot.legalMoves && { ...snapshot, legalMoves: { ...snapshot.legalMoves, playableCardIds: [], attackerIds: [], blockerIds: [] } };
      for (const shown of [snapshot, none ?? snapshot]) {
        for (const intent of intents) {
          said.add(helpFor({ snapshot: shown, playerId, intent: { ...NO_INTENT, ...intent } })?.headline);
        }
      }
    }
  };
  listen();
  for (const command of [{ type: CommandType.END_PHASE }, { type: CommandType.DECLARE_ATTACKERS, attackerIds: [] }, { type: CommandType.END_TURN }]) {
    assert.equal(engine.execute({ ...command, playerId: P1 }).ok, true);
    listen();
  }
  assert.equal(engine.execute({ type: CommandType.END_PHASE, playerId: P2 }).ok, true);
  assert.equal(engine.execute({ type: CommandType.DECLARE_ATTACKERS, playerId: P2, attackerIds: [id(P2, ZoneType.BATTLEFIELD)] }).ok, true);
  listen();
  said.delete(undefined);
  assert.ok(said.size >= 10, `every kind of headline is heard (${[...said].join(", ")})`);
  return said;
}
