/**
 * Playing on a phone: the compact layout profile (a phone in landscape),
 * touch input (no hover, no keyboard focus, flicked lists, the device's own
 * keyboard for text fields) and the match's pick-then-confirm hand.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BasicAiController } from "../../src/application/match/BasicAiController.js";
import { humanController } from "../../src/application/match/HumanController.js";
import { MatchSession } from "../../src/application/match/MatchSession.js";
import { ZoneType } from "@magic8/engine/domain/game/ZoneType.js";
import { MemoryLogger } from "../../src/infrastructure/logging/MemoryLogger.js";
import { immediateScheduler } from "../../src/infrastructure/time/ImmediateScheduler.js";
import { Highlight, InteractionMode, MatchInteraction } from "../../src/input/interaction/MatchInteraction.js";
import { BoardFace, computeBoardLayout } from "../../src/rendering/board/BoardLayout.js";
import { CardNode } from "../../src/rendering/board/CardNode.js";
import { PickedCardNode } from "../../src/rendering/board/PickedCardNode.js";
import { lifeCrystalCentre } from "../../src/rendering/board/PlayerNode.js";
import { CardFaceProfile } from "../../src/rendering/cards/CardFace.js";
import { COMPACT, Viewport } from "../../src/rendering/canvas/Viewport.js";
import { MatchScene } from "../../src/rendering/scenes/MatchScene.js";
import { Scene } from "../../src/rendering/scenes/Scene.js";
import { ScrollList } from "../../src/rendering/ui/ScrollList.js";
import { TextField } from "../../src/rendering/ui/TextField.js";
import { Button } from "../../src/rendering/ui/Button.js";
import { Modal } from "../../src/rendering/ui/Modal.js";
import { P1, P2 } from "@magic8/engine/testing/fixtures.js";
import { createScenario } from "@magic8/engine/testing/scenario.js";
import { FakeContext2D, loadTheme } from "./fakes.js";

const theme = loadTheme();
/** An iPhone 14 held sideways, and the smallest phone supported (an iPhone SE). */
const PHONE = Object.freeze({ cssWidth: 844, cssHeight: 390 });
const SMALL_PHONE = Object.freeze({ cssWidth: 667, cssHeight: 375 });
/** The smallest a target may be under a finger, in CSS pixels. */
const MIN_TOUCH = 40;

function phoneServices(size = PHONE, overrides = {}) {
  const viewport = new Viewport(theme.layout);
  viewport.resize(size);
  return { theme, viewport, logger: new MemoryLogger(), requestRender: () => undefined, navigate: () => undefined, hasScene: () => true, usingTouch: () => true, ...overrides };
}

function sessionFromScenario(spec) {
  const { engine, id } = createScenario(spec);
  const session = new MatchSession({ engine, controllers: new Map([[P1, humanController], [P2, new BasicAiController()]]), scheduler: immediateScheduler, logger: new MemoryLogger() });
  return { session, id };
}

async function phoneMatch(spec, size = PHONE) {
  const { session, id } = sessionFromScenario(spec);
  session.start();
  await session.whenIdle();
  const scene = new MatchScene(phoneServices(size));
  scene.enter({ session });
  return { scene, session, id };
}

const byId = (scene, id) => scene.root.findById(id);
const nodesOf = (root, type) => {
  const found = [];
  const visit = (node) => {
    if (node instanceof type) {
      found.push(node);
    }
    node.children.forEach(visit);
  };
  visit(root);
  return found;
};
const cardNamed = (scene, name) => nodesOf(scene.root, CardNode).find((node) => node.card.name === name) ?? null;
const touch = (type, x, y) => Object.freeze({ type, x, y, button: 0, pointerId: 1, pointerType: "touch" });
const tapAt = (scene, point) => {
  scene.onPointer(touch("down", point.x, point.y));
  scene.onPointer(touch("up", point.x, point.y));
};
const centreOf = (area) => ({ x: area.x + area.width / 2, y: area.y + area.height / 2 });
const inside = (inner, outer) => inner.x >= outer.x - 1e-6 && inner.y >= outer.y - 1e-6 && inner.x + inner.width <= outer.x + outer.width + 1e-6 && inner.y + inner.height <= outer.y + outer.height + 1e-6;

describe("Compact board layout", () => {
  for (const [label, size] of [["iPhone 14", PHONE], ["iPhone SE", SMALL_PHONE]]) {
    it(`keeps everything on a ${label}'s screen, every card readable and every control big enough for a finger`, () => {
      const { session } = sessionFromScenario({ p1: { hand: ["ember_imp", "ember_bolt", "lava_brute", "cinder_hound", "flame_scout", "ash_raider", "magma_hurler"], battlefield: ["lava_brute", "cinder_hound", "ember_imp"] }, p2: { hand: ["ember_imp", "ember_imp"], battlefield: ["cinder_hound", "scrap_golem"] } });
      session.start();
      const viewport = new Viewport(theme.layout);
      viewport.resize(size);
      const area = viewport.safeBounds;
      const layout = computeBoardLayout(session.snapshotFor(P1), P1, area, { compact: true });
      assert.equal(layout.compact, true);
      assert.equal(layout.face, BoardFace.MINI);
      assert.equal(layout.log, null, "no log panel: it opens on demand");
      for (const zone of [layout.me.hud, layout.opponent.hud, layout.sidebar, layout.me.battlefield, layout.opponent.battlefield, layout.me.hand, layout.banner, layout.clock, ...Object.values(layout.cards)]) {
        assert.ok(inside(zone, area), `${JSON.stringify(zone)} stays on screen`);
      }
      assert.ok(layout.opponent.battlefield.y + layout.opponent.battlefield.height <= layout.banner.y && layout.banner.y + layout.banner.height <= layout.me.battlefield.y && layout.me.battlefield.y + layout.me.battlefield.height <= layout.me.hand.y + 1, "the rows do not overlap");
      assert.ok(layout.opponent.hud.y + layout.opponent.hud.height < layout.me.hud.y, "nor do the HUDs");
      assert.ok(layout.sizes.battlefield.width * viewport.scale >= 60, "a creature on the field is at least 60 px wide");
      assert.ok(layout.sizes.hand.height * viewport.scale >= 90, "a hand card is tall enough to tap and read");
      const visibleBacks = layout.opponent.handSlots.filter((slot) => slot.y + slot.height > area.y);
      assert.equal(visibleBacks.length, 2, "the opponent's hand peeks in from the top edge");
    });
  }

  it("leaves the wide board exactly as it was", () => {
    const { session } = sessionFromScenario({ p1: { hand: ["ember_imp"] }, p2: {} });
    session.start();
    const layout = computeBoardLayout(session.snapshotFor(P1), P1, { x: 0, y: 0, width: 1600, height: 900 });
    assert.equal(layout.compact, false);
    assert.equal(layout.face, BoardFace.COMPACT);
    assert.deepEqual(layout.sidebar, { x: 1384, y: 16, width: 200, height: 470 });
    assert.deepEqual(layout.me.hud, { x: 16, y: 700, width: 200, height: 184 });
    assert.deepEqual(layout.sizes.reveal, { width: 210, height: 294 });
  });

  it("shrinks a HUD's insides with it, so effects still find its life crystal", () => {
    const full = lifeCrystalCentre({ x: 0, y: 0, width: 200, height: 184 });
    const small = lifeCrystalCentre({ x: 0, y: 0, width: 156, height: 184 });
    assert.deepEqual(full, { x: 42, y: 76, radius: 30 });
    assert.ok(small.radius < full.radius && small.x < full.x);
  });
});

describe("MatchInteraction with confirmPlays", () => {
  it("picks a hand card first, puts it back on a second tap, and plays it on confirm", async () => {
    const { session, id } = sessionFromScenario({ p1: { hand: ["lava_brute", "ember_imp"], resources: 5 }, p2: {} });
    session.start();
    await session.whenIdle();
    const interaction = new MatchInteraction(P1, { confirmPlays: true });
    interaction.sync(session.snapshotFor(P1));
    const brute = id(P1, ZoneType.HAND, 0);
    const imp = id(P1, ZoneType.HAND, 1);
    assert.equal(interaction.confirmLabel, null);
    assert.equal(interaction.tap(brute), null, "a tap only picks");
    assert.equal(interaction.pickedCardId, brute);
    assert.equal(interaction.highlightFor(brute), Highlight.SELECTED);
    assert.equal(interaction.highlightFor(imp), Highlight.PLAYABLE);
    assert.equal(interaction.confirmLabel, "Play");
    assert.equal(interaction.canCancel, true);
    assert.equal(interaction.prompt, "Play it, or pick another card.");
    interaction.tap(imp);
    assert.equal(interaction.pickedCardId, imp, "another tap picks another card");
    interaction.tap(imp);
    assert.equal(interaction.pickedCardId, null, "the picked one again puts it back");
    interaction.tap(brute);
    interaction.cancel();
    assert.equal(interaction.pickedCardId, null, "cancel puts it back too");
    interaction.tap(brute);
    const command = interaction.confirm();
    assert.equal(command?.cardInstanceId ?? command?.instanceId ?? command?.cardId, brute);
    assert.equal(interaction.pickedCardId, null);
  });

  it("goes on to targeting when the confirmed card needs a target", async () => {
    const { session, id } = sessionFromScenario({ p1: { hand: ["ember_bolt"], resources: 2 }, p2: { battlefield: ["cinder_hound"] } });
    session.start();
    await session.whenIdle();
    const interaction = new MatchInteraction(P1, { confirmPlays: true });
    interaction.sync(session.snapshotFor(P1));
    interaction.tap(id(P1, ZoneType.HAND, 0));
    assert.equal(interaction.confirm(), null);
    assert.equal(interaction.mode, InteractionMode.TARGETING);
    assert.ok(interaction.confirm() === null && interaction.highlightFor(id(P2, ZoneType.BATTLEFIELD, 0)) === Highlight.TARGETABLE);
  });
});

describe("MatchScene on a phone", () => {
  for (const [label, size] of [["iPhone 14", PHONE], ["iPhone SE", SMALL_PHONE]]) {
  it(`lays out the compact board on an ${label}: mini cards, an action column with the log and concede at its foot, no log panel`, async () => {
    const { scene } = await phoneMatch({ p1: { hand: ["lava_brute"], resources: 5 }, p2: { battlefield: ["ember_imp"] } }, size);
    const { viewport } = scene.services;
    assert.equal(viewport.compact, true);
    assert.equal(byId(scene, "log"), null);
    assert.ok(byId(scene, "log.open") && byId(scene, "leave"), "log and concede in the action column");
    assert.equal(byId(scene, "endTurn").text, "End turn", "no keyboard hint on a phone");
    assert.equal(cardNamed(scene, "Lava Brute").profile, CardFaceProfile.MINI);
    for (const button of nodesOf(scene.root, Button)) {
      assert.ok(button.height * viewport.scale >= MIN_TOUCH, `${button.id} is tall enough for a finger`);
      assert.ok(inside(button.bounds, viewport.safeBounds), `${button.id} is on screen`);
    }
    scene.render(new FakeContext2D());
    byId(scene, "log.open").activate();
    assert.equal(scene.modal?.id, "logModal");
    assert.ok(inside(scene.modal.panel.bounds, { x: 0, y: 0, width: viewport.logicalWidth, height: viewport.logicalHeight }), "the log fits the screen");
  });
  }

  it("picks a hand card with a tap, holds it up to be read, and plays it only on Play", async () => {
    const { scene, session } = await phoneMatch({ p1: { hand: ["lava_brute"], resources: 5 }, p2: {} });
    tapAt(scene, centreOf(cardNamed(scene, "Lava Brute").bounds));
    assert.equal(session.snapshotFor(P1).players[0].battlefield.length, 0, "nothing played yet");
    assert.equal(nodesOf(scene.root, PickedCardNode).length, 1, "the card is held up");
    const play = byId(scene, "confirm");
    assert.equal(play.text, "Play");
    tapAt(scene, centreOf(play.bounds));
    assert.equal(session.snapshotFor(P1).players[0].battlefield.length, 1, "played on confirm");
    assert.equal(nodesOf(scene.root, PickedCardNode).length, 0);
  });

  it("inspects a card on a long press in a view that fits the screen", async () => {
    const { scene } = await phoneMatch({ p1: { hand: ["lava_brute"] }, p2: {} });
    const card = cardNamed(scene, "Lava Brute");
    scene.onPointer(touch("down", ...Object.values(centreOf(card.bounds))));
    scene.update(500);
    assert.equal(scene.modal?.id, "inspect");
    const { viewport } = scene.services;
    assert.ok(inside(scene.modal.panel.bounds, { x: 0, y: 0, width: viewport.logicalWidth, height: viewport.logicalHeight }));
  });

  it("re-lays out for the new screen when a desktop window shrinks to a phone's", async () => {
    const { session } = sessionFromScenario({ p1: { hand: ["lava_brute"] }, p2: {} });
    session.start();
    await session.whenIdle();
    const viewport = new Viewport(theme.layout);
    viewport.resize({ cssWidth: 1600, cssHeight: 900 });
    const scene = new MatchScene({ ...phoneServices(), viewport, usingTouch: () => false });
    scene.enter({ session });
    assert.ok(byId(scene, "log"), "the wide board has its log panel");
    viewport.resize(PHONE);
    scene.onResize();
    assert.equal(byId(scene, "log"), null);
    assert.equal(cardNamed(scene, "Lava Brute").profile, CardFaceProfile.MINI);
    assert.equal(scene.interaction.confirmPlays, true, "and a hand card waits for the confirm");
  });
});

describe("Touch input", () => {
  /** A scene with a button, a text field and a long list. */
  function touchScene({ usingTouch = () => true } = {}) {
    const scene = new Scene(phoneServices(PHONE, { usingTouch }));
    const activated = [];
    const button = scene.root.add(new Button({ id: "button", x: 10, y: 10, width: 200, height: 48, text: "Go", onActivate: () => activated.push("button") }));
    const field = scene.root.add(new TextField({ id: "field", x: 10, y: 70, width: 300, height: 48, placeholder: "Name", keyboard: "account" }));
    const list = scene.root.add(new ScrollList({ id: "list", x: 400, y: 0, width: 300, height: 300 }));
    for (let index = 0; index < 40; index += 1) {
      list.add(new Button({ id: `row${index}`, x: 0, y: index * 50, width: 280, height: 44, text: `Row ${index}`, onActivate: () => activated.push(`row${index}`) }));
    }
    list.contentHeight = 40 * 50;
    return { scene, button, field, list, activated };
  }

  it("leaves no hover behind and moves no keyboard focus when a finger taps", () => {
    const { scene, button, activated } = touchScene();
    tapAt(scene, centreOf(button.bounds));
    assert.deepEqual(activated, ["button"]);
    assert.equal(button.hovered, false, "a finger that lifts hovers over nothing");
    assert.equal(scene.focusedNode, null, "no focus ring under a finger");
    scene.focus(button);
    assert.equal(scene.focusedNode, null, "nor where a scene would put it");
  });

  it("keeps the mouse's hover and focus", () => {
    const { scene, button } = touchScene({ usingTouch: () => false });
    const point = centreOf(button.bounds);
    scene.onPointer({ type: "down", x: point.x, y: point.y, button: 0, pointerId: 1, pointerType: "mouse" });
    scene.onPointer({ type: "up", x: point.x, y: point.y, button: 0, pointerId: 1, pointerType: "mouse" });
    assert.equal(button.hovered, true);
    assert.equal(scene.focusedNode, button);
  });

  it("names the text fields the device's inputs go over, and takes their values back filtered", () => {
    const { scene, field } = touchScene();
    assert.deepEqual(scene.textFields(), [field]);
    tapAt(scene, centreOf(field.bounds));
    assert.equal(scene.focusedNode, field, "a text field keeps focus under a finger: a hardware keyboard still types into it");
    assert.equal(field.keyboard, "account");
    const modal = new Modal({ id: "dialog", width: 800, height: 400, panelWidth: 400, panelHeight: 300, onDismiss: () => undefined });
    const inModal = modal.panel.add(new TextField({ id: "dialog.field", x: 10, y: 10, width: 200, height: 48 }));
    modal.panel.add(new TextField({ id: "dialog.off", x: 10, y: 70, width: 200, height: 48, enabled: false }));
    scene.openModal(modal);
    assert.deepEqual(scene.textFields(), [inModal], "only the top layer's, and only those that take text now");
    scene.closeModal();
    assert.equal(field.enter("alice<script>"), "alicescript", "only characters the field allows");
    field.maxLength = 5;
    assert.equal(field.enter("alexander"), "alexa", "capped at its length");
  });

  it("keeps a flicked list gliding after the finger lifts, slowing to a stop", () => {
    const { scene, list, activated } = touchScene();
    const x = list.bounds.x + 100;
    scene.onPointer(touch("down", x, 250));
    for (let y = 230; y >= 90; y -= 20) {
      scene.update(16);
      scene.onPointer(touch("move", x, y));
    }
    scene.update(16);
    scene.onPointer(touch("up", x, 90));
    const released = list.scrollY;
    assert.equal(activated.length, 0, "a drag activates nothing");
    assert.equal(scene.update(16), true, "still moving after the release");
    assert.ok(list.scrollY > released);
    for (let frame = 0; frame < 200; frame += 1) {
      scene.update(16);
    }
    const stopped = list.scrollY;
    assert.equal(scene.update(16), false, "then it comes to rest");
    assert.equal(list.scrollY, stopped);
    tapAt(scene, { x, y: 20 });
    assert.equal(activated.length, 1, "a tap on a resting list still activates its row");
  });

  it("lays a scene out again only when the design area changes", () => {
    const viewport = new Viewport(theme.layout);
    viewport.resize({ cssWidth: 1600, cssHeight: 900 });
    let layouts = 0;
    class Probe extends Scene {
      relayout() {
        layouts += 1;
      }
    }
    const scene = new Probe({ ...phoneServices(), viewport });
    viewport.resize({ cssWidth: 1920, cssHeight: 1080 });
    scene.onResize();
    assert.equal(layouts, 0, "a bigger desktop window keeps the wide design");
    viewport.resize(PHONE);
    scene.onResize();
    assert.equal(layouts, 1, "a phone's screen changes it");
    viewport.resize({ ...PHONE, devicePixelRatio: 3 });
    scene.onResize();
    assert.equal(layouts, 1, "the same screen at another density keeps the design area");
    assert.equal(viewport.logicalHeight, COMPACT.height);
  });
});
