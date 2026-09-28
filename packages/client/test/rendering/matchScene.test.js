/**
 * The graphical match board: pure layout and interaction pieces, the
 * presenter's animations, and the scene driven against a real MatchSession
 * (human vs BasicAiController) from tap to command to AI reply.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BasicAiController } from "../../src/application/match/BasicAiController.js";
import { humanController } from "../../src/application/match/HumanController.js";
import { MatchSession } from "../../src/application/match/MatchSession.js";
import { CommandType } from "@magic8/engine/domain/commands/CommandType.js";
import { GamePhase } from "@magic8/engine/domain/game/GamePhase.js";
import { ZoneType } from "@magic8/engine/domain/game/ZoneType.js";
import { MemoryLogger } from "../../src/infrastructure/logging/MemoryLogger.js";
import { immediateScheduler } from "../../src/infrastructure/time/ImmediateScheduler.js";
import { Highlight, InteractionMode, MatchInteraction } from "../../src/input/interaction/MatchInteraction.js";
import { Easing, Tween } from "../../src/rendering/animation/Tween.js";
import { CARD_SIZE, computeBoardLayout, slotsFor } from "../../src/rendering/board/BoardLayout.js";
import { CardNode } from "../../src/rendering/board/CardNode.js";
import { CardFaceProfile, cardFaceLayout, statusTextFor, typeLineFor } from "../../src/rendering/cards/CardFace.js";
import { drawCard } from "../../src/rendering/cards/CardRenderer.js";
import { MatchPresenter } from "../../src/rendering/board/MatchPresenter.js";
import { CastReveal } from "../../src/rendering/board/CastReveal.js";
import { TurnBanner } from "../../src/rendering/board/TurnBanner.js";
import { Viewport } from "../../src/rendering/canvas/Viewport.js";
import { MatchScene } from "../../src/rendering/scenes/MatchScene.js";
import { SceneId } from "../../src/rendering/scenes/sceneIds.js";
import { P1, P2 } from "@magic8/engine/testing/fixtures.js";
import { createScenario } from "@magic8/engine/testing/scenario.js";
import { FakeContext2D, loadTheme } from "./fakes.js";

const theme = loadTheme();
const SIZE = { logicalWidth: 1600, logicalHeight: 900 };

function services(overrides = {}) {
  const viewport = new Viewport(theme.layout);
  viewport.resize({ cssWidth: 1600, cssHeight: 900 });
  return { theme, viewport, logger: new MemoryLogger(), requestRender: () => undefined, navigate: () => undefined, hasScene: () => true, ...overrides };
}

/** Wraps a hand-crafted board in a real session: P1 human, P2 AI. */
function sessionFromScenario(spec) {
  const { engine, id } = createScenario(spec);
  const session = new MatchSession({
    engine,
    controllers: new Map([
      [P1, humanController],
      [P2, new BasicAiController()],
    ]),
    scheduler: immediateScheduler,
    logger: new MemoryLogger(),
  });
  return { session, id };
}

async function sceneFor(spec, overrides = {}) {
  const { session, id } = sessionFromScenario(spec);
  session.start();
  await session.whenIdle();
  const scene = new MatchScene(services(overrides));
  scene.enter({ session });
  return { scene, session, id };
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
const tapNode = (node) => {
  assert.ok(node, "node exists");
  assert.equal(node.isEffectivelyEnabled, true, `${node.id} is tappable`);
  node.activate();
};
const rendered = (scene) => {
  const context = new FakeContext2D();
  scene.render(context);
  return context.texts;
};
const key = (name) => ({ type: "keydown", key: name, repeat: false });
const centreOf = (area) => ({ x: area.x + area.width / 2, y: area.y + area.height / 2 });
/** Steps the scene through the end of the match until the result is offered. */
const untilResult = (scene) => advancer(scene, 40, 20000)(() => scene.modal?.id === "gameOver", "the result is offered");
/** Steps the scene until the board has played out what happened and moves are open again. */
const settle = (scene) => advancer(scene)(() => !scene.isBusy, "the board settles");
/** Steps the scene in small frames until `reached`, and reports how long that took. */
const advancer = (scene, step = 40, limitMs = 8000) => (reached, label) => {
  for (let elapsed = 0; elapsed <= limitMs; elapsed += step) {
    if (reached()) {
      return elapsed;
    }
    scene.update(step);
  }
  return assert.fail(`never reached: ${label}`);
};

describe("Tween", () => {
  it("interpolates numeric fields with easing and clamps at the end", () => {
    const tween = new Tween({ from: { x: 0, alpha: 1 }, to: { x: 100, alpha: 0 }, durationMs: 100, easing: Easing.linear });
    assert.deepEqual(tween.update(25), { x: 25, alpha: 0.75 });
    assert.equal(tween.isDone, false);
    assert.deepEqual(tween.update(1000), { x: 100, alpha: 0 });
    assert.equal(tween.isDone, true);
    assert.equal(Easing.easeOutCubic(1), 1);
    assert.ok(Easing.easeOutCubic(0.5) > 0.5, "ease-out is ahead of linear");
    assert.equal(Easing.easeOutBack(0), 0);
    assert.equal(Easing.easeOutBack(1), 1);
    assert.ok([0.6, 0.7, 0.8, 0.9].some((t) => Easing.easeOutBack(t) > 1), "ease-out-back runs past its target before settling");
    assert.ok(Easing.easeInCubic(0.5) < 0.5, "ease-in lags linear");
    assert.equal(new Tween({ from: { x: 0 }, to: { x: 1 }, durationMs: 0 }).current.x, 1, "zero duration is done immediately");
  });
});

describe("BoardLayout", () => {
  it("centres slots that fit and overlaps them evenly when they do not", () => {
    const zone = { x: 0, y: 0, width: 1000, height: 200 };
    const two = slotsFor(2, zone, CARD_SIZE.battlefield);
    assert.equal(two.length, 2);
    assert.equal(two[0].x + two[0].width + 12, two[1].x, "natural gap");
    assert.equal(two[0].x, 1000 - (two[1].x + two[1].width), "centred");
    const many = slotsFor(20, zone, CARD_SIZE.battlefield);
    assert.equal(many[0].x, 0);
    assert.equal(many[19].x + many[19].width, 1000, "last card ends at the zone edge");
    assert.ok(many[1].x - many[0].x < CARD_SIZE.battlefield.width, "overlapping");
    assert.deepEqual(slotsFor(0, zone, CARD_SIZE.battlefield), []);
  });

  it("puts my zones at the bottom, the opponent's at the top, and gives every visible card a slot", async () => {
    const { session } = sessionFromScenario({ p1: { hand: ["ember_imp", "ember_bolt"], battlefield: ["lava_brute"] }, p2: { hand: ["ember_imp"], battlefield: ["cinder_hound", "scrap_golem"] } });
    session.start();
    const snapshot = session.snapshotFor(P1);
    const layout = computeBoardLayout(snapshot, P1, SIZE);
    assert.equal(layout.me.id, P1);
    assert.equal(layout.opponent.id, P2);
    assert.ok(layout.opponent.battlefield.y < layout.banner.y && layout.banner.y < layout.me.battlefield.y && layout.me.battlefield.y < layout.me.hand.y);
    const me = snapshot.players.find((player) => player.id === P1);
    const opponent = snapshot.players.find((player) => player.id === P2);
    for (const card of [...me.hand, ...me.battlefield, ...opponent.battlefield]) {
      assert.ok(layout.cards[card.instanceId], `slot for ${card.name}`);
    }
    assert.equal(Object.keys(layout.cards).length, me.hand.length + me.battlefield.length + opponent.battlefield.length, "no slots for hidden or graveyard cards");
    assert.equal(layout.opponent.handSlots.length, opponent.handSize, "one back per hidden card");
    assert.ok(layout.me.hud.y + layout.me.hud.height <= SIZE.logicalHeight);
    assert.ok(layout.log.y + layout.log.height <= SIZE.logicalHeight);
    assert.ok(layout.clock.x >= layout.banner.x && layout.clock.x + layout.clock.width <= layout.banner.x + layout.banner.width, "the clock docks within the banner row");
  });
});

describe("Decision clock (MatchScene)", () => {
  /** A session-shaped double whose `clock` can be changed between frames, unlike a real MatchSession (always untimed). */
  function fakeTimedSession(snapshot, clock) {
    return {
      humanPlayerIds: [P1],
      clock,
      openingToss: null,
      begin: () => ({ ok: true, value: undefined }),
      subscribe: () => () => undefined,
      snapshotFor: () => snapshot,
      eventsFor: () => [],
      submit: () => ({ ok: true, value: undefined }),
      stop: () => undefined,
    };
  }

  it("shows nothing offline: a real MatchSession is untimed", async () => {
    const { scene } = await sceneFor({ p1: {}, p2: {} });
    assert.equal(scene.update(1000), false, "no deadline, nothing to tick");
    assert.ok(!rendered(scene).some((text) => /^\d:\d\d$/.test(text)), "no clock text drawn");
  });

  it("counts down to the server's deadline, one redraw per second, and disappears once nobody is on the clock", () => {
    const { session } = sessionFromScenario({ p1: {}, p2: {} });
    session.start();
    const snapshot = session.snapshotFor(P1);
    let now = 0;
    const fake = fakeTimedSession(snapshot, { activeSeat: P1, deadline: 5_000, reserveMs: {} });
    const scene = new MatchScene(services(), { now: () => now });
    scene.enter({ session: fake });
    assert.equal(scene.update(0), true, "the first frame draws the clock");
    assert.ok(rendered(scene).includes("0:05"));

    now = 500;
    assert.equal(scene.update(500), false, "still 4.5s left: ceils to the same 0:05");
    now = 1_200;
    assert.equal(scene.update(700), true, "crossed into the next second");
    assert.ok(rendered(scene).includes("0:04"));

    now = 4_600;
    scene.update(3400);
    assert.ok(rendered(scene).includes("0:01"));

    now = 6_000;
    scene.update(1400);
    assert.ok(rendered(scene).includes("0:00"), "never negative");

    fake.clock = null;
    assert.equal(scene.update(1000), true, "the clock just disappeared: redraw once more");
    assert.ok(!rendered(scene).some((text) => /^\d:\d\d$/.test(text)), "gone once nobody is on the clock");
  });

  it("hides once the match is over, even with a deadline still on the wire", () => {
    const { session } = sessionFromScenario({ p1: {}, p2: {} });
    session.start();
    const over = { ...session.snapshotFor(P1), isOver: true };
    const fake = fakeTimedSession(over, { activeSeat: P1, deadline: 5_000, reserveMs: {} });
    const scene = new MatchScene(services(), { now: () => 0 });
    scene.enter({ session: fake });
    assert.ok(!rendered(scene).some((text) => /^\d:\d\d$/.test(text)));
  });
});

describe("MatchInteraction", () => {
  it("plays untargeted cards on tap, walks targeting for targeted ones, and cancels", async () => {
    const { session } = sessionFromScenario({ p1: { hand: ["ember_imp", "ember_bolt"], resources: 5 }, p2: { battlefield: ["cinder_hound"] } });
    session.start();
    const snapshot = session.snapshotFor(P1);
    const interaction = new MatchInteraction(P1);
    assert.equal(interaction.mode, InteractionMode.WAITING);
    interaction.sync(snapshot);
    assert.equal(interaction.mode, InteractionMode.IDLE);
    const [imp, bolt] = snapshot.players[0].hand.map((card) => card.instanceId);
    const hound = snapshot.players[1].battlefield[0].instanceId;
    assert.equal(interaction.highlightFor(imp), Highlight.PLAYABLE);
    assert.equal(interaction.highlightFor(hound), null);
    assert.equal(interaction.tap(hound), null, "tapping a non-playable card does nothing");
    const play = interaction.tap(imp);
    assert.equal(play.type, CommandType.PLAY_CARD);
    assert.equal(play.cardId, imp);

    assert.equal(interaction.tap(bolt), null, "targeted card enters targeting");
    assert.equal(interaction.mode, InteractionMode.TARGETING);
    assert.equal(interaction.highlightFor(bolt), Highlight.SELECTED);
    assert.equal(interaction.highlightFor(hound), Highlight.TARGETABLE);
    assert.equal(interaction.highlightFor(P2), Highlight.TARGETABLE, "players are targets too");
    assert.equal(interaction.highlightFor(imp), null, "other hand cards are not tappable while targeting");
    assert.equal(interaction.canCancel, true);
    interaction.cancel();
    assert.equal(interaction.mode, InteractionMode.IDLE);
    interaction.tap(bolt);
    const command = interaction.tap(hound);
    assert.deepEqual(command.targets, [hound]);
    assert.equal(interaction.mode, InteractionMode.IDLE);
  });

  it("never opens targeting on a card with no legal target: the card is simply not playable", () => {
    const { session } = sessionFromScenario({ p1: { hand: ["bone_colossus"], resources: 5 }, p2: {} });
    session.start();
    const snapshot = session.snapshotFor(P1);
    const colossus = snapshot.players[0].hand[0].instanceId;
    assert.deepEqual(snapshot.legalMoves.playableCardIds, [], "no ally to sacrifice");
    const interaction = new MatchInteraction(P1);
    interaction.sync(snapshot);
    assert.equal(interaction.highlightFor(colossus), null);
    assert.equal(interaction.tap(colossus), null);
    assert.equal(interaction.mode, InteractionMode.IDLE, "tapping it must not strand the player in targeting");
  });

  it("plays a creature whose on_play has nothing to target on the first tap", () => {
    const { session, id } = sessionFromScenario({ p1: { hand: ["spellbinder"], resources: 3 }, p2: {} });
    session.start();
    const interaction = new MatchInteraction(P1);
    interaction.sync(session.snapshotFor(P1));
    const spellbinder = id(P1, ZoneType.HAND);
    assert.equal(interaction.highlightFor(spellbinder), Highlight.PLAYABLE);
    const command = interaction.tap(spellbinder);
    assert.equal(command.type, CommandType.PLAY_CARD);
    assert.deepEqual(command.targets, [], "no enemy creature to bounce, so no target to ask for");
    assert.equal(interaction.mode, InteractionMode.IDLE, "nothing to target, nothing to ask");
  });

  it("toggles attackers and assigns blockers in two taps", async () => {
    const { session, id } = sessionFromScenario({ p1: { battlefield: ["lava_brute", "steel_sentinel"] }, p2: { battlefield: ["cinder_hound"] } });
    session.start();
    session.submit({ type: CommandType.END_PHASE, playerId: P1 });
    const interaction = new MatchInteraction(P1);
    interaction.sync(session.snapshotFor(P1));
    assert.equal(interaction.mode, InteractionMode.ATTACKERS);
    const brute = id(P1, ZoneType.BATTLEFIELD, 0);
    const sentinel = id(P1, ZoneType.BATTLEFIELD, 1);
    assert.equal(interaction.confirmLabel, "Skip combat");
    interaction.tap(brute);
    interaction.tap(sentinel);
    interaction.tap(sentinel);
    assert.deepEqual(interaction.selectedAttackerIds, [brute]);
    assert.equal(interaction.highlightFor(brute), Highlight.SELECTED);
    assert.equal(interaction.highlightFor(sentinel), Highlight.PLAYABLE);
    assert.equal(interaction.confirmLabel, "Attack with 1");
    const attack = interaction.confirm();
    assert.equal(attack.type, CommandType.DECLARE_ATTACKERS);
    assert.deepEqual(attack.attackerIds, [brute]);

    // Blocking side: a fresh scenario where the AI attacks P1.
    const defending = sessionFromScenario({ p1: { battlefield: ["steel_sentinel"] }, p2: { battlefield: ["lava_brute"] } });
    defending.session.start();
    defending.session.submit({ type: CommandType.END_TURN, playerId: P1 });
    await defending.session.whenIdle();
    const snapshot = defending.session.snapshotFor(P1);
    assert.equal(snapshot.phase, GamePhase.COMBAT_BLOCKERS);
    const blockers = new MatchInteraction(P1);
    blockers.sync(snapshot);
    assert.equal(blockers.mode, InteractionMode.BLOCKERS);
    const mySentinel = defending.id(P1, ZoneType.BATTLEFIELD, 0);
    const theirBrute = defending.id(P2, ZoneType.BATTLEFIELD, 0);
    assert.equal(blockers.highlightFor(theirBrute), Highlight.ATTACKING);
    assert.equal(blockers.tap(theirBrute), null, "attacker first does nothing");
    blockers.tap(mySentinel);
    assert.equal(blockers.pendingBlockerId, mySentinel);
    assert.equal(blockers.highlightFor(theirBrute), Highlight.TARGETABLE);
    blockers.tap(theirBrute);
    assert.deepEqual(blockers.pendingBlocks, [{ attackerId: theirBrute, blockerId: mySentinel }]);
    assert.equal(blockers.highlightFor(mySentinel), Highlight.BLOCKING);
    assert.equal(blockers.confirmLabel, "Confirm 1 block");
    blockers.tap(mySentinel);
    assert.deepEqual(blockers.pendingBlocks, [], "tapping an assigned blocker unassigns it");
    blockers.tap(mySentinel);
    blockers.tap(theirBrute);
    const declare = blockers.confirm();
    assert.equal(declare.type, CommandType.DECLARE_BLOCKERS);
    assert.deepEqual(declare.blocks, [{ attackerId: theirBrute, blockerId: mySentinel }]);
  });
});

describe("CardRenderer", () => {
  const base = { name: "Test", type: "creature", faction: "iron", cost: 1, attack: 1, health: 1, maxHealth: 1, damage: 0, summoningSick: false, exhausted: false };
  const at = { x: 0, y: 0, width: 130, height: 182, alpha: 1 };
  const bodyLines = (text) => {
    const context = new FakeContext2D();
    drawCard(context, theme, { ...base, text }, at);
    return context.texts.filter((line) => !["Test", "1", typeLineFor(base)].includes(line));
  };

  it("draws the whole rules text when it fits and ellipsizes only the last line when it does not", () => {
    // The fake context measures 8 px per character (pessimistic for an 11 px font).
    const short = "When Test enters, heal 3 on a friendly creature.";
    const lines = bodyLines(short);
    assert.equal(lines.join(" "), short, "every word drawn, nothing cut");
    assert.ok(lines.length >= 4, "wrapped over several lines at the compact size");

    const long = Array(40).fill("word").join(" ");
    const cut = bodyLines(long);
    const capacity = cardFaceLayout(at, CardFaceProfile.COMPACT, base.type).textLines;
    assert.ok(capacity >= 5, `the compact text box holds at least five lines (${capacity})`);
    assert.equal(cut.length, capacity, "fills the text box between the type ribbon and the stat gems");
    assert.ok(cut.at(-1).endsWith("…"));
    assert.ok(cut.slice(0, -1).every((line) => !line.includes("…")));
  });

  it("marks summoning-sick and exhausted creatures with a readable tag", () => {
    const context = new FakeContext2D();
    drawCard(context, theme, { ...base, text: "", summoningSick: true }, at);
    assert.ok(context.texts.includes(statusTextFor({ ...base, summoningSick: true })));
    const rested = new FakeContext2D();
    drawCard(rested, theme, { ...base, text: "", exhausted: true }, at);
    assert.ok(rested.texts.includes(statusTextFor({ ...base, exhausted: true })));
    assert.equal(statusTextFor(base), null);
  });
});

describe("MatchPresenter", () => {
  it("snaps on first apply, tweens on later ones, fades dead cards toward the owner's HUD and floats damage", async () => {
    const { session, id } = sessionFromScenario({ p1: { hand: ["ember_bolt"], resources: 2 }, p2: { battlefield: ["cinder_hound"] } });
    session.start();
    const presenter = new MatchPresenter(theme.animation);
    const first = session.snapshotFor(P1);
    presenter.apply(first, [], computeBoardLayout(first, P1, SIZE), false);
    const bolt = id(P1, ZoneType.HAND, 0);
    const hound = id(P2, ZoneType.BATTLEFIELD, 0);
    assert.equal(presenter.isAnimating, false, "first display snaps into place");
    assert.deepEqual(presenter.visualFor(hound).state.alpha, 1);
    assert.equal(presenter.update(16), false, "nothing to animate");

    const events = [];
    session.subscribe((update) => events.push(...update.events));
    session.submit({ type: CommandType.PLAY_CARD, playerId: P1, cardId: bolt, targets: [hound] });
    const after = session.snapshotFor(P1);
    const layout = computeBoardLayout(after, P1, SIZE);
    presenter.apply(after, session.eventsFor(events, P1), layout);
    assert.equal(presenter.isAnimating, true);
    const dying = presenter.visualFor(hound);
    assert.equal(dying.isLeaving, true);
    assert.ok(presenter.floats.some((float) => float.spec.text === "-3"), "damage number");
    assert.equal(presenter.update(theme.animation.longMs / 2), true);
    assert.ok(dying.state.alpha < 1 && dying.state.alpha > 0, "fading");
    const hud = layout.opponent.hud;
    assert.ok(Math.abs(dying.state.x - (hud.x + hud.width / 2)) < Math.abs(layout.opponent.battlefield.x + layout.opponent.battlefield.width / 2 - (hud.x + hud.width / 2)), "moving toward the opponent's HUD");
    presenter.update(theme.animation.longMs * 3);
    assert.equal(presenter.visualFor(hound), null, "gone after the exit tween");
    assert.equal(presenter.visualFor(bolt), null, "spell went to the graveyard too");
    assert.deepEqual(presenter.floats, []);
  });
});

describe("MatchScene on the board", () => {
  it("draws both seats, highlights playable cards and plays one by tapping it", async () => {
    const { scene, session, id } = await sceneFor({ p1: { hand: ["lava_brute", "blazing_titan"], resources: 5 }, p2: { battlefield: ["ember_imp"] } });
    const texts = rendered(scene);
    assert.ok(texts.some((text) => text.startsWith("Turn 1 · Your turn")));
    assert.ok(texts.includes("Alice") && texts.includes("YOU"), "my seat is named and tagged");
    assert.ok(texts.includes("Bob"));
    assert.ok(texts.includes("Lava Brute") && texts.includes("Ember Imp"));
    const brute = cardNamed(scene, "Lava Brute");
    const titan = cardNamed(scene, "Blazing Titan");
    assert.equal(brute.highlight, Highlight.PLAYABLE);
    assert.equal(titan.highlight, null, "unaffordable");
    assert.equal(titan.enabled, false);
    assert.equal(byId(scene, "endTurn").enabled, true);
    assert.ok(brute.bounds.y > cardNamed(scene, "Ember Imp").bounds.y, "my hand is below the opponent's creatures");
    tapNode(brute);
    assert.equal(session.snapshotFor(P1).players[0].battlefield[0].instanceId, id(P1, ZoneType.HAND, 0));
    assert.ok(rendered(scene).some((text) => text.includes("Alice played Lava Brute")), "log from session events");
    assert.equal(scene.presenter.isAnimating, true, "the card tweens from the hand to the battlefield");
    assert.equal(scene.update(16), true);
    assert.equal(scene.update(10000), true, "final frame of the tween");
    assert.equal(scene.update(16), false, "then idle: no redraws");
  });

  it("targets by tapping the target, locks End turn while targeting, and Escape cancels", async () => {
    const { scene, session } = await sceneFor({ p1: { hand: ["ember_bolt"], resources: 2 }, p2: { battlefield: ["cinder_hound"] } });
    tapNode(cardNamed(scene, "Ember Bolt"));
    assert.equal(scene.interaction.mode, InteractionMode.TARGETING);
    assert.ok(rendered(scene).includes("Choose a target."));
    assert.equal(byId(scene, "endTurn").enabled, false);
    assert.equal(cardNamed(scene, "Cinder Hound").highlight, Highlight.TARGETABLE);
    assert.equal(byId(scene, P2).enabled, true, "the opponent's HUD is a target");
    scene.onKey(key("Escape"));
    assert.equal(scene.interaction.mode, InteractionMode.IDLE);
    assert.equal(byId(scene, "endTurn").enabled, true);
    tapNode(cardNamed(scene, "Ember Bolt"));
    tapNode(cardNamed(scene, "Cinder Hound"));
    const p2 = session.snapshotFor(P1).players.find((player) => player.id === P2);
    assert.equal(p2.battlefield.length, 0, "hound died");
    assert.equal(cardNamed(scene, "Cinder Hound"), null, "no longer a node");
    assert.equal(scene.presenter.leavingVisuals.length, 2, "hound and bolt are fading out");
  });

  it("declares attackers by tapping creatures and confirming, then the AI replies", async () => {
    const { scene, session } = await sceneFor({ p1: { battlefield: ["blazing_titan"] }, p2: { battlefield: ["scrap_golem"] } });
    tapNode(byId(scene, "endPhase"));
    assert.equal(session.snapshotFor(null).phase, GamePhase.COMBAT_ATTACKERS);
    assert.equal(scene.interaction.mode, InteractionMode.ATTACKERS);
    assert.equal(byId(scene, "confirm").text, "Skip combat");
    tapNode(cardNamed(scene, "Blazing Titan"));
    assert.equal(cardNamed(scene, "Blazing Titan").highlight, Highlight.SELECTED);
    assert.equal(byId(scene, "confirm").text, "Attack with 1");
    tapNode(byId(scene, "confirm"));
    await session.whenIdle();
    const snapshot = session.snapshotFor(null);
    assert.equal(snapshot.phase, GamePhase.MAIN_2, "AI declared (no) blockers and damage resolved");
    assert.equal(snapshot.players[1].life, 14);
    assert.ok(rendered(scene).some((text) => text.includes("deals 6")), "log line (ellipsized to the sidebar width)");
    assert.ok(scene.presenter.floats.some((float) => float.spec.text === "-6"));
  });

  it("plays out the AI's cast: out of their hand, face up over the table, a beam to its target, then into their graveyard", async () => {
    const { scene, session } = await sceneFor({ p1: { battlefield: ["cinder_hound"] }, p2: { hand: ["ember_bolt"], resources: 2 } });
    assert.equal(scene.presenter.reveal, null, "nothing to reveal yet");
    scene.onKey(key("e"));
    await session.whenIdle();
    assert.equal(scene.presenter.reveal, null, "the AI has cast already, but the board is still announcing its turn");
    advancer(scene)(() => scene.presenter.reveal !== null, "the cast comes up in its turn");
    const reveal = scene.presenter.reveal;
    assert.ok(reveal, "the AI's spell is played out");
    assert.equal(reveal.card.name, "Ember Bolt");
    assert.equal(reveal.caption, "Bob casts");
    assert.deepEqual(reveal.targets.map((target) => target.name), ["Cinder Hound"], "aimed at the creature it kills");

    const layout = computeBoardLayout(session.snapshotFor(P1), P1, SIZE);
    assert.equal(reveal.frame.turn, 0, "face down to begin with");
    assert.equal(reveal.frame.width, CARD_SIZE.back.width, "at the size of a card in their hand");
    assert.ok(Math.abs(centreOf(reveal.frame).x - centreOf(layout.opponent.hand).x) < 1, "and where their hand is");
    const advanceTo = advancer(scene);

    advanceTo(() => centreOf(reveal.frame).y === centreOf(layout.banner).y, "risen to the middle of the table");
    assert.ok(reveal.frame.width > CARD_SIZE.back.width * 3, "grown from hand size on the way up");
    assert.equal(reveal.frame.turn, 0, "and still face down");

    advanceTo(() => reveal.frame.turn === 1, "turned face up");
    const texts = rendered(scene);
    assert.ok(texts.includes("Ember Bolt"), "the face is drawn");
    assert.ok(texts.includes("Bob casts"), "so is the caption");
    assert.ok(texts.some((text) => text.includes("Bob cast Ember Bolt on")), "log names the spell and its target");

    advanceTo(() => reveal.frame.strike === 1, "struck its target");
    assert.equal(reveal.frame.ring, 1, "the rune has spread by then");
    assert.ok(rendered(scene).includes("Cinder Hound"), "and the target is named where the beam lands");

    const parked = centreOf(reveal.frame);
    assert.deepEqual(parked, centreOf(layout.banner), "held in the middle of the table");
    scene.update(400);
    assert.deepEqual(centreOf(reveal.frame), parked, "and still there a moment later: it does not drift while it is read");
    const held = 400 + advanceTo(() => reveal.frame.glow < 1, "began to sink");
    assert.ok(held > 1000, `held still for ${held}ms once struck, long enough to read`);
    advanceTo(() => scene.presenter.reveal === null, "gone");
  });

  it("shows what the AI's cast did when its beam strikes, not while it is still in their hand", async () => {
    const { scene, session } = await sceneFor({ p1: { life: 5 }, p2: { hand: ["blood_tithe"], resources: 2 } });
    scene.onKey(key("e"));
    await session.whenIdle();
    assert.equal(session.snapshotFor(null).players[0].life, 3, "the drain has resolved");
    advancer(scene)(() => scene.presenter.reveal !== null, "the cast comes up in its turn");
    const reveal = scene.presenter.reveal;
    assert.equal(reveal?.card.name, "Blood Tithe");
    assert.equal(byId(scene, P1).lifeShown(), 5, "life still reads as before the cast");
    assert.ok(!scene.presenter.floats.some((float) => float.spec.text === "-2"), "no damage number yet");
    const advanceTo = advancer(scene);
    advanceTo(() => reveal.frame.strike === 1, "struck");
    assert.equal(byId(scene, P1).lifeShown(), 3, "life drops as the beam lands");
    assert.ok(scene.presenter.floats.some((float) => float.spec.text === "-2"), "with its number");
  });

  it("announces each turn with a banner across the table, played in order with the AI's cast, never over it", async () => {
    const { scene, session } = await sceneFor({ p1: { battlefield: ["cinder_hound"] }, p2: { hand: ["ember_bolt"], resources: 2 } });
    assert.equal(scene.presenter.moment, null, "nothing announced for a board already in play");
    scene.onKey(key("e"));
    await session.whenIdle();
    const moment = () => scene.presenter.moment;
    assert.ok(moment() instanceof TurnBanner && moment().playerId === P2, "the opponent's turn is announced first");
    assert.equal(scene.presenter.reveal, null, "their cast waits its turn");
    assert.equal(scene.isBusy, true);
    scene.update(theme.animation.longMs);
    assert.ok(rendered(scene).includes("Bob's turn"), "once the banner has swept in");
    assert.ok(!rendered(scene).some((text) => text.includes("Bob cast")), "and the cast is not in the log yet either");
    const advanceTo = advancer(scene);
    advanceTo(() => moment() instanceof CastReveal, "the cast plays once the banner is gone");
    assert.equal(moment().card.name, "Ember Bolt");
    advanceTo(() => moment() instanceof TurnBanner, "then the next turn is announced");
    assert.equal(moment().playerId, P1);
    scene.update(theme.animation.longMs);
    assert.ok(rendered(scene).includes("Your turn"));
    advanceTo(() => moment() === null, "and cleared");
    advanceTo(() => !scene.presenter.isAnimating, "everything settles");
    assert.equal(scene.update(16), false, "then idle: no redraws");
  });

  it("shows the AI's moves one after another, each once the board has finished showing the one before", async () => {
    const { scene, session } = await sceneFor({ p2: { hand: ["ember_imp", "ember_imp"], resources: 2 } });
    scene.onKey(key("e"));
    await session.whenIdle();
    const theirs = () => {
      let count = 0;
      const visit = (node) => {
        count += node instanceof CardNode && node.card.controllerId === P2 ? 1 : 0;
        node.children.forEach(visit);
      };
      visit(scene.root);
      return count;
    };
    const played = session.snapshotFor(P1).players[1].battlefield.length;
    assert.ok(played >= 2, "the AI has played its creatures already");
    assert.equal(theirs(), 0, "the board is still announcing its turn");
    const advanceTo = advancer(scene);
    advanceTo(() => theirs() === 1, "the first creature comes down");
    assert.equal(scene.presenter.isBusy, true, "and is still landing");
    scene.update(16);
    assert.equal(theirs(), 1, "the next waits for it");
    advanceTo(() => theirs() === 2, "then the next");
    advanceTo(() => theirs() === played, "and so on, one by one");
    settle(scene);
    assert.equal(scene.update(16), false, "then idle");
  });

  it("waits for the AI's lethal cast to play out before showing the result", async () => {
    const { scene, session } = await sceneFor({ p1: { life: 2 }, p2: { hand: ["blood_tithe"], resources: 2 } });
    scene.onKey(key("e"));
    await session.whenIdle();
    assert.equal(session.isOver, true);
    assert.equal(scene.modal, null, "the killing spell is shown first");
    let castSeen = false;
    advancer(scene, 40, 20000)(() => {
      castSeen ||= scene.presenter.reveal !== null;
      return scene.modal !== null;
    }, "the result");
    assert.equal(castSeen, true, "the cast played out before it");
    assert.equal(scene.modal?.id, "gameOver");
  });

  it("lets the human block by tapping the blocker then the attacker", async () => {
    const { scene, session } = await sceneFor({ p1: { battlefield: ["steel_sentinel"] }, p2: { battlefield: ["lava_brute"] } });
    scene.onKey(key("e"));
    await session.whenIdle();
    assert.equal(session.snapshotFor(P1).phase, GamePhase.COMBAT_BLOCKERS);
    settle(scene);
    assert.equal(scene.interaction.mode, InteractionMode.BLOCKERS, "asked for blockers once the attack has been shown");
    assert.equal(cardNamed(scene, "Lava Brute").highlight, Highlight.ATTACKING);
    assert.equal(cardNamed(scene, "Lava Brute").enabled, false, "attackers are not tappable until a blocker is picked");
    tapNode(cardNamed(scene, "Steel Sentinel"));
    assert.ok(rendered(scene).join(" ").includes("Now tap the attacker it blocks."), "prompt wraps over two lines");
    tapNode(cardNamed(scene, "Lava Brute"));
    assert.equal(cardNamed(scene, "Steel Sentinel").highlight, Highlight.BLOCKING);
    assert.equal(byId(scene, "confirm").text, "Confirm 1 block");
    const context = new FakeContext2D();
    scene.render(context);
    assert.ok(context.calls.some((call) => call.method === "lineTo"), "block arrow drawn");
    tapNode(byId(scene, "confirm"));
    await session.whenIdle();
    const after = session.snapshotFor(null);
    assert.equal(after.players[0].battlefield.length, 0, "sentinel died blocking");
    assert.equal(after.players[0].life, 20, "but absorbed the damage");
  });

  it("shows the game-over modal, can peek at the board, and stops the session on leave", async () => {
    const navigated = [];
    const { scene, session } = await sceneFor({ p1: { hand: ["ember_bolt"], resources: 2 }, p2: { life: 3 } }, { navigate: (id) => navigated.push(id) });
    tapNode(cardNamed(scene, "Ember Bolt"));
    tapNode(byId(scene, P2));
    untilResult(scene);
    assert.ok(scene.modal, "game over modal");
    assert.ok(rendered(scene).includes("Victory"));
    assert.ok(rendered(scene).includes("Life reached zero."));
    tapNode(byId(scene, "gameOver.board"));
    assert.equal(scene.modal, null);
    assert.equal(byId(scene, "endTurn"), null, "no turn controls after the match");
    assert.equal(byId(scene, "leave").text, "Back to menu");
    tapNode(byId(scene, "leave"));
    assert.deepEqual(navigated, [SceneId.MAIN_MENU]);
    assert.equal(session.isStopped, true);
  });

  it("plays out the end before offering the result: the fallen crystal cracks and bursts, the table shakes, the outcome comes down", async () => {
    const { scene, session } = await sceneFor({ p1: { hand: ["ember_bolt"], resources: 2 }, p2: { life: 3 } });
    tapNode(cardNamed(scene, "Ember Bolt"));
    tapNode(byId(scene, P2));
    assert.equal(session.isOver, true);
    assert.equal(scene.modal, null, "no result yet");
    const advanceTo = advancer(scene, 20, 20000);
    advanceTo(() => scene.isEnding, "the end begins once the blow has played out");
    const ending = byId(scene, "gameOverSequence");
    assert.ok(ending, "drawn over the board");
    assert.equal(scene.isBusy, true, "nothing can be played meanwhile");
    assert.equal(byId(scene, "endTurn"), null);
    const hud = computeBoardLayout(session.snapshotFor(P1), P1, SIZE).opponent.hud;
    const within = (point) => point.x >= hud.x && point.x <= hud.x + hud.width && point.y >= hud.y && point.y <= hud.y + hud.height;
    let shook = false;
    let cracked = false;
    let shattered = false;
    let titled = false;
    advanceTo(() => {
      const shake = scene.ending.shake;
      const context = new FakeContext2D();
      scene.render(context);
      shook ||= (shake.x !== 0 || shake.y !== 0) && context.calls.some((call) => call.method === "translate" && call.args[0] === shake.x && call.args[1] === shake.y);
      const overlay = new FakeContext2D();
      ending.draw(overlay, theme);
      cracked ||= !scene.ending.burst && scene.ending.crack > 0 && overlay.calls.some((call) => call.method === "lineTo" && within({ x: call.args[0], y: call.args[1] }));
      shattered ||= scene.ending.shards.length > 0 && scene.ending.crystals.every(within);
      titled ||= overlay.texts.includes("Victory") && overlay.texts.includes("Life reached zero.");
      return scene.modal !== null;
    }, "the result");
    assert.ok(shook, "the table shakes");
    assert.ok(cracked, "the opponent's crystal cracks");
    assert.ok(shattered, "and bursts into shards");
    assert.ok(titled, "the outcome comes down over the table");
    assert.equal(scene.modal?.id, "gameOver", "then the result is offered");
    assert.equal(scene.isEnding, false);
    tapNode(byId(scene, "gameOver.board"));
    assert.deepEqual(scene.ending.shake, { x: 0, y: 0 }, "the board is left still to be looked at");
    const after = new FakeContext2D();
    ending.draw(after, theme);
    assert.deepEqual(after.calls, [], "with nothing left over it");
  });

  it("breaks no crystal when the match is conceded: the outcome alone comes down", async () => {
    const { scene } = await sceneFor({ p1: { hand: ["ember_imp"], resources: 1 } });
    tapNode(byId(scene, "leave"));
    tapNode(byId(scene, "confirm.ok"));
    advancer(scene)(() => scene.isEnding, "the end begins");
    assert.ok(byId(scene, "gameOverSequence"));
    assert.deepEqual(scene.ending.crystals, [], "no crystal fell");
    let shards = 0;
    let titled = false;
    advancer(scene, 20, 20000)(() => {
      shards = Math.max(shards, scene.ending.shards.length);
      titled ||= rendered(scene).filter((text) => text === "Defeat").length > 1;
      return scene.modal !== null;
    }, "the result");
    assert.equal(shards, 0, "no burst");
    assert.ok(titled, "the outcome comes down over the table (as well as on the ribbon)");
  });

  it("concedes only after confirmation", async () => {
    const { scene, session } = await sceneFor({ p1: { hand: ["ember_imp"], resources: 1 } });
    tapNode(byId(scene, "leave"));
    assert.equal(scene.modal.id, "confirm");
    assert.equal(scene.focusedNode.id, "confirm.cancel");
    scene.onKey(key("Escape"));
    assert.equal(scene.modal, null);
    assert.equal(session.isOver, false);
    tapNode(byId(scene, "leave"));
    tapNode(byId(scene, "confirm.ok"));
    assert.equal(session.isOver, true);
    assert.ok(rendered(scene).includes("Defeat"));
  });

  it("reports rejected commands in the log and keeps following the AI's turns", async () => {
    const { scene, session } = await sceneFor({ p1: { hand: ["ember_imp"], resources: 1 } });
    session.submit({ type: CommandType.END_TURN, playerId: P1 });
    await session.whenIdle();
    assert.equal(session.snapshotFor(null).awaitingPlayerId, P1, "AI turn over, back to the human");
    scene.onKey(key("e"));
    await session.whenIdle();
    assert.equal(session.snapshotFor(null).turnNumber, 3, "E waits while the board is still showing the AI's turn");
    settle(scene);
    assert.ok(rendered(scene).some((text) => text.startsWith("Turn 3")));
    scene.onKey(key("e"));
    await session.whenIdle();
    assert.equal(session.snapshotFor(null).turnNumber, 4, "E ends the turn when legal");
    settle(scene);
    assert.ok(rendered(scene).some((text) => text.startsWith("Turn 4 · Opponent's turn")));
    assert.equal(scene.interaction.mode, InteractionMode.BLOCKERS, "the AI's imp attacks; the board asks for blockers");
  });

  it("inspects any card on right-click or I, even the opponent's, and offers Play again at the end", async () => {
    const navigated = [];
    const { scene, session } = await sceneFor({ p1: { hand: ["ember_bolt"], resources: 2 }, p2: { battlefield: ["iron_colossus"], life: 3 } }, { navigate: (id) => navigated.push(id) });
    const colossus = cardNamed(scene, "Iron Colossus");
    assert.equal(colossus.enabled, false, "not tappable");
    const { x, y } = colossus.bounds;
    scene.onPointer({ type: "down", x: x + 5, y: y + 5, button: 2, pointerId: 1 });
    assert.equal(scene.modal?.id, "inspect");
    assert.ok(rendered(scene).includes("Iron Colossus"));
    assert.ok(rendered(scene).includes(typeLineFor(colossus.card)), "full-size card face");
    scene.onKey(key("Escape"));
    assert.equal(scene.modal, null);
    scene.focus(cardNamed(scene, "Ember Bolt"));
    scene.onKey(key("I"));
    assert.equal(scene.modal?.id, "inspect");
    tapNode(byId(scene, "inspect.close"));
    assert.equal(scene.modal, null);

    tapNode(cardNamed(scene, "Ember Bolt"));
    tapNode(byId(scene, P2));
    untilResult(scene);
    tapNode(byId(scene, "gameOver.again"));
    assert.deepEqual(navigated, [SceneId.DECK_SELECTION]);
    assert.equal(session.isStopped, true);
  });

  it("attacks with the creature that deals damage: it draws back, lunges at its target and returns; the blow shows as it lands", async () => {
    const { scene, session } = await sceneFor({ p1: { battlefield: ["blazing_titan"] }, p2: {} });
    tapNode(byId(scene, "endPhase"));
    tapNode(cardNamed(scene, "Blazing Titan"));
    tapNode(byId(scene, "confirm"));
    await session.whenIdle();
    const titan = scene.presenter.visualFor(cardNamed(scene, "Blazing Titan").id);
    const home = { ...titan.state };
    const { shortMs } = theme.animation;
    const shown = () => scene.presenter.floats.filter((float) => float.progress >= 0).map((float) => float.spec.text);
    assert.equal(titan.isAnimating, true);
    assert.deepEqual(shown(), [], "the number waits for the blow");
    assert.equal(scene.presenter.lifeKickFor(P2), null, "and so does the opponent's crystal");
    scene.update(shortMs);
    assert.ok(titan.state.y > home.y, "drew back, away from the opponent's HUD");
    scene.update(shortMs);
    assert.ok(titan.state.y < home.y, "lunged up toward it");
    assert.deepEqual(shown(), ["-6"], "the blow lands");
    assert.ok(scene.presenter.lifeKickFor(P2).delta < 0, "the crystal takes it");
    scene.update(shortMs * 2);
    assert.deepEqual(titan.state, home, "and back home");
    assert.equal(titan.isAnimating, false);
  });

  it("lets a spell's damage show at once: a spell does not lunge", async () => {
    const { scene, session, id } = await sceneFor({ p1: { hand: ["ember_bolt"], resources: 2 }, p2: { battlefield: ["cinder_hound"] } });
    const hound = id(P2, ZoneType.BATTLEFIELD, 0);
    const bolt = scene.presenter.visualFor(id(P1, ZoneType.HAND, 0));
    const held = { ...bolt.state };
    const standing = { ...scene.presenter.visualFor(hound).state };
    tapNode(cardNamed(scene, "Ember Bolt"));
    tapNode(cardNamed(scene, "Cinder Hound"));
    await session.whenIdle();
    assert.ok(scene.presenter.floats.some((float) => float.spec.text === "-3" && float.progress === 0), "the number is up straight away");
    scene.update(theme.animation.shortMs);
    assert.ok(scene.presenter.visualFor(hound).flash > 0, "and the hound is lit by the blow");
    assert.ok(scene.presenter.visualFor(hound).state.width < standing.width, "and already on its way out");
    assert.ok(bolt.state.width < held.width, "the spell itself shrinks straight into the graveyard");
  });

  it("holds moves back while the board plays out what happened: cards and buttons go quiet, then come back", async () => {
    const { scene, session } = await sceneFor({ p1: { hand: ["lava_brute", "ember_imp"], resources: 6 } });
    tapNode(cardNamed(scene, "Lava Brute"));
    assert.equal(scene.isBusy, true, "the brute is still landing");
    const imp = cardNamed(scene, "Ember Imp");
    assert.equal(imp.highlight, null, "no invitation to play while it lands");
    assert.equal(imp.enabled, false);
    assert.equal(byId(scene, "endTurn").enabled, false);
    assert.equal(byId(scene, "leave").enabled, true, "conceding stays open");
    imp.activate();
    scene.onKey(key("e"));
    assert.equal(session.snapshotFor(P1).players[0].battlefield.length, 1, "taps and keys are ignored meanwhile");
    assert.equal(session.snapshotFor(P1).turnNumber, 1);
    settle(scene);
    assert.equal(cardNamed(scene, "Ember Imp").highlight, Highlight.PLAYABLE, "playable again once the board is still");
    assert.equal(byId(scene, "endTurn").enabled, true);
    tapNode(cardNamed(scene, "Ember Imp"));
    assert.equal(session.snapshotFor(P1).players[0].battlefield.length, 2);
  });

  it("holds moves back while one is on its way to the server, so a second cannot race it", async () => {
    const { session } = sessionFromScenario({ p1: { hand: ["ember_imp"], resources: 1 } });
    session.start();
    await session.whenIdle();
    const sent = [];
    let answer = () => undefined;
    const online = {
      humanPlayerIds: session.humanPlayerIds,
      openingToss: null,
      clock: null,
      subscribe: (listener) => session.subscribe(listener),
      snapshotFor: (playerId) => session.snapshotFor(playerId),
      eventsFor: (events, playerId) => session.eventsFor(events, playerId),
      controllerKindOf: (playerId) => session.controllerKindOf(playerId),
      begin: () => undefined,
      stop: () => undefined,
      submit: (command) => {
        sent.push(command);
        return new Promise((resolve) => {
          answer = resolve;
        });
      },
    };
    const scene = new MatchScene(services());
    scene.enter({ session: online });
    tapNode(byId(scene, "endTurn"));
    assert.equal(scene.isBusy, true, "waiting for the server");
    assert.equal(byId(scene, "endTurn").enabled, false, "End turn is not offered twice");
    scene.onKey(key("e"));
    assert.equal(sent.length, 1, "only the first move went out");
    answer({ ok: true, value: null });
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(scene.isBusy, false, "open again once the server has answered");
    assert.equal(byId(scene, "endTurn").enabled, true);
  });

  it("navigates back to the menu when entered without a session", () => {
    const navigated = [];
    const scene = new MatchScene(services({ navigate: (id) => navigated.push(id) }));
    scene.enter({});
    assert.deepEqual(navigated, [SceneId.MAIN_MENU]);
  });
});
