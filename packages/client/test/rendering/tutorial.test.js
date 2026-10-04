/**
 * The tutorial on the board: the whole lesson played through the match
 * screen the way a player would (lesson cards, Next, only the cards and
 * buttons the coach allows), on a desktop and on the smallest phone; every
 * lesson fits its card; and the menus that start it.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MatchSetupService } from "../../src/application/match/MatchSetupService.js";
import { TutorialService } from "../../src/application/tutorial/TutorialService.js";
import { TUTORIAL_STEPS } from "../../src/application/tutorial/tutorialScript.js";
import { MemoryLogger } from "../../src/infrastructure/logging/MemoryLogger.js";
import { immediateScheduler } from "../../src/infrastructure/time/ImmediateScheduler.js";
import { Highlight } from "../../src/input/interaction/MatchInteraction.js";
import { computeBoardLayout } from "../../src/rendering/board/BoardLayout.js";
import { CardNode } from "../../src/rendering/board/CardNode.js";
import { coachCardLayout } from "../../src/rendering/board/CoachCard.js";
import { Viewport } from "../../src/rendering/canvas/Viewport.js";
import { RICH_LINE_GAP, plainRich, wrapRich } from "../../src/rendering/ui/RichText.js";
import { InfoScene } from "../../src/rendering/scenes/InfoScene.js";
import { MainMenuScene } from "../../src/rendering/scenes/MainMenuScene.js";
import { MatchScene } from "../../src/rendering/scenes/MatchScene.js";
import { SceneId } from "../../src/rendering/scenes/sceneIds.js";
import { DeckBuildingService } from "../../src/application/decks/DeckBuildingService.js";
import { DeckSelectionService } from "../../src/application/decks/DeckSelectionService.js";
import { InMemoryStore } from "../../src/infrastructure/persistence/InMemoryStore.js";
import { StoredDeckRepository } from "../../src/infrastructure/persistence/StoredDeckRepository.js";
import { effects, loadBundledContent } from "../application/fixtures.js";
import { loadTheme } from "./fakes.js";

const theme = loadTheme();
const content = await loadBundledContent();
const DESKTOP = Object.freeze({ cssWidth: 1600, cssHeight: 900 });
const SMALL_PHONE = Object.freeze({ cssWidth: 667, cssHeight: 375 });

function services(size, overrides = {}) {
  const viewport = new Viewport(theme.layout);
  viewport.resize(size);
  return { theme, viewport, logger: new MemoryLogger(), requestRender: () => undefined, navigate: () => undefined, hasScene: () => true, ...overrides };
}

function app() {
  const logger = new MemoryLogger();
  const repository = new StoredDeckRepository({ store: new InMemoryStore(), logger });
  const matchSetup = new MatchSetupService({ content, effects, scheduler: immediateScheduler, logger });
  return {
    content,
    deckSelection: new DeckSelectionService({ content, repository, logger }),
    deckBuilding: new DeckBuildingService({ content, repository }),
    matchSetup,
    tutorial: new TutorialService({ matchSetup, content }),
    createSeed: () => "9f".repeat(32),
    logger,
    environment: { version: "test", storage: "memory" },
  };
}

/** The tutorial's board, as the menus open it. */
async function tutorialBoard(size, overrides = {}) {
  const started = app().tutorial.start();
  assert.equal(started.ok, true);
  const navigated = [];
  const scene = new MatchScene(services(size, { navigate: (id, params) => navigated.push({ id, params }), ...overrides }));
  scene.enter({ session: started.value.session, coach: started.value.coach, againScene: SceneId.DECK_SELECTION });
  return { scene, session: started.value.session, coach: started.value.coach, navigated };
}

const byId = (scene, id) => scene.root.findById(id);
const cardsNamed = (scene, name) => {
  const found = [];
  const visit = (node) => {
    if (node instanceof CardNode && node.card.name === name) {
      found.push(node);
    }
    node.children.forEach(visit);
  };
  visit(scene.root);
  return found;
};
const cardNamed = (scene, name) => cardsNamed(scene, name)[0] ?? null;
const tap = (node, label) => {
  assert.ok(node, `${label} is on the board`);
  assert.equal(node.isEffectivelyEnabled, true, `${label} can be tapped`);
  node.activate();
};

/**
 * Lets the AI move and the board play it all out, until a lesson card is up
 * or (with `untilFree`) the board is open to the player again.
 */
async function play(scene, session, { untilFree = false } = {}) {
  for (let elapsed = 0; elapsed < 20000; elapsed += 40) {
    await session.whenIdle();
    if (byId(scene, "coach") !== null || (untilFree && !scene.isBusy)) {
      return;
    }
    scene.update(40);
  }
  assert.fail("the board never settled");
}

/**
 * Reads the lessons on show one after the other, checking each is the
 * expected one and points at what it is about, and presses Next.
 */
async function readLessons(scene, session, ids) {
  for (const id of ids) {
    await play(scene, session);
    const step = TUTORIAL_STEPS.find((candidate) => candidate.id === id);
    assert.equal(byId(scene, "coach.title").text, step.title, `the "${id}" lesson is up`);
    assert.equal(scene.focusedNode?.id, "coach.next", "Next has the focus: Enter reads on");
    assert.equal(byId(scene, "endTurn").isEffectivelyEnabled, false, "nothing is played while a lesson is read");
    assert.ok(byId(scene, "coach.spotlight"), "the table dims round what the lesson is about");
    const focus = byId(scene, "coach.focus");
    const card = byId(scene, "coach").bounds;
    for (const { tip } of focus.arrows) {
      assert.ok(!(tip.x > card.x && tip.x < card.x + card.width && tip.y > card.y && tip.y < card.y + card.height), `"${id}": its card does not hide what an arrow points at`);
    }
    byId(scene, "coach.next").activate();
    scene.update(16);
  }
}

/** The line over the table during a task, as it reads. */
const hintOn = (scene) => plainRich(byId(scene, "coach.hint")?.text ?? "");

/** Plays a hand card: tapped, then on a phone confirmed with "Play". */
function playFromHand(scene, name, picking) {
  tap(cardNamed(scene, name), name);
  if (picking) {
    tap(byId(scene, "confirm"), "Play");
  }
}

for (const [label, size] of [["a desktop", DESKTOP], ["the smallest phone", SMALL_PHONE]]) {
  describe(`The tutorial on ${label}`, () => {
    const picking = size === SMALL_PHONE;

    it("is played through lesson by lesson, with only what each task allows, to a victory", async () => {
      const { scene, session, navigated } = await tutorialBoard(size);
      await readLessons(scene, session, ["welcome", "goal", "hand", "mana", "cost"]);

      // Turn 1: only the Golem glows; End phase stays shut.
      assert.equal(byId(scene, "coach"), null, "the lesson card is gone");
      assert.equal(cardNamed(scene, "Scrap Golem").highlight, Highlight.PLAYABLE);
      assert.equal(cardNamed(scene, "Ember Imp").highlight, null, "the Imp could be played, but it is not the lesson");
      assert.equal(cardNamed(scene, "Ember Imp").isEffectivelyEnabled, false);
      assert.equal(byId(scene, "endPhase").isEffectivelyEnabled, false);
      assert.equal(byId(scene, "endTurn").isEffectivelyEnabled, false);
      assert.equal(hintOn(scene), "Tap Scrap Golem in your hand to play it.");
      assert.ok(byId(scene, "coach.focus").arrows.length > 0, "an arrow points at the Golem");
      playFromHand(scene, "Scrap Golem", picking);
      await readLessons(scene, session, ["creatures", "not-yet"]);
      await play(scene, session, { untilFree: true });
      assert.equal(byId(scene, "endPhase").isEffectivelyEnabled, false);
      tap(byId(scene, "endTurn"), "End turn");

      // Turn 2: block the Sprite with the Golem.
      await readLessons(scene, session, ["under-attack"]);
      await play(scene, session, { untilFree: true });
      assert.equal(byId(scene, "confirm").text, "No blocks");
      assert.equal(byId(scene, "confirm").isEffectivelyEnabled, false, "not blocking is not the lesson");
      assert.equal(hintOn(scene), "Tap your Scrap Golem to block with it.");
      tap(cardNamed(scene, "Scrap Golem"), "the Golem");
      assert.equal(hintOn(scene), "Now tap Kindling Sprite: the attacker it blocks.", "the line follows the player's choices");
      tap(cardNamed(scene, "Kindling Sprite"), "the Sprite");
      assert.equal(hintOn(scene), "Press Confirm 1 block.");
      tap(byId(scene, "confirm"), "Confirm 1 block");
      await readLessons(scene, session, ["blocked", "damage-stays"]);

      // Turn 3: the Scout, then attack with both.
      await readLessons(scene, session, ["new-turn", "haste"]);
      await play(scene, session, { untilFree: true });
      playFromHand(scene, "Flame Scout", picking);
      await play(scene, session, { untilFree: true });
      tap(byId(scene, "endPhase"), "End phase");
      await play(scene, session, { untilFree: true });
      assert.equal(byId(scene, "confirm").text, "Skip combat");
      assert.equal(byId(scene, "confirm").isEffectivelyEnabled, false);
      tap(cardNamed(scene, "Flame Scout"), "the Scout");
      assert.equal(byId(scene, "confirm").isEffectivelyEnabled, false, "one attacker is not enough");
      tap(cardNamed(scene, "Scrap Golem"), "the Golem");
      tap(byId(scene, "confirm"), "Attack with 2");
      await readLessons(scene, session, ["direct-hit", "exhausted"]);
      await play(scene, session, { untilFree: true });
      tap(byId(scene, "endTurn"), "End turn");

      // Turn 5: Bolt the Hound (not the face), attack, play the Imp.
      await readLessons(scene, session, ["new-enemy", "spells"]);
      await play(scene, session, { untilFree: true });
      playFromHand(scene, "Ember Bolt", picking);
      assert.equal(byId(scene, "trainer").isEffectivelyEnabled, false, "the opponent's portrait is no target in this lesson");
      tap(cardNamed(scene, "Rivet Hound"), "the Hound");
      await play(scene, session, { untilFree: true });
      tap(byId(scene, "endPhase"), "End phase");
      await play(scene, session, { untilFree: true });
      tap(cardNamed(scene, "Flame Scout"), "the Scout");
      tap(cardNamed(scene, "Scrap Golem"), "the Golem");
      tap(byId(scene, "confirm"), "Attack with 2");
      await play(scene, session, { untilFree: true });
      playFromHand(scene, "Ember Imp", picking);
      await play(scene, session, { untilFree: true });
      tap(byId(scene, "endTurn"), "End turn");

      // Turn 7: free play.
      await readLessons(scene, session, ["finish"]);
      await play(scene, session, { untilFree: true });
      assert.equal(byId(scene, "endPhase").isEffectivelyEnabled, true, "no more hints, no more limits");
      playFromHand(scene, "Ember Bolt", picking);
      tap(byId(scene, "trainer"), "the opponent's portrait");
      await play(scene, session, { untilFree: true });
      tap(byId(scene, "endPhase"), "End phase");
      await play(scene, session, { untilFree: true });
      for (const name of ["Flame Scout", "Scrap Golem", "Ember Imp"]) {
        tap(cardNamed(scene, name), name);
      }
      tap(byId(scene, "confirm"), "Attack with 3");
      for (let elapsed = 0; elapsed < 30000 && scene.modal?.id !== "gameOver"; elapsed += 40) {
        await session.whenIdle();
        scene.update(40);
      }
      assert.equal(scene.modal?.id, "gameOver", "the result is offered");
      assert.equal(session.snapshotFor("player").winnerId, "player");
      const again = scene.modal.findById("gameOver.again");
      assert.equal(again.text, "Practice vs AI");
      again.activate();
      assert.equal(navigated.at(-1).id, SceneId.DECK_SELECTION);
    });
  });
}

describe("The tutorial board", () => {
  it("is left, not conceded: the player goes back to the menu", async () => {
    const { scene, session, navigated } = await tutorialBoard(DESKTOP);
    await play(scene, session);
    const leave = byId(scene, "leave");
    assert.equal(leave.text, "Leave tutorial");
    leave.activate();
    assert.equal(scene.modal?.id !== undefined, true, "it asks first");
    const confirm = scene.modal.focusableNodes().find((node) => node.text === "Leave");
    confirm.activate();
    assert.equal(navigated.at(-1).id, SceneId.MAIN_MENU);
    assert.equal(session.isStopped, true);
    assert.equal(session.snapshotFor("player").isOver, false, "nobody conceded");
  });

  it("fits every lesson on its card, on a desktop and on the smallest phone", () => {
    // Text measured as it is set: about half an em per character.
    for (const size of [DESKTOP, SMALL_PHONE]) {
      const viewport = new Viewport(theme.layout);
      viewport.resize(size);
      const { session } = app().tutorial.start().value;
      const layout = computeBoardLayout(session.snapshotFor("player"), "player", viewport.safeBounds, { compact: viewport.compact });
      const { text } = coachCardLayout(layout);
      const fontSize = theme.fonts.sizes[text.size];
      const lineHeight = fontSize + RICH_LINE_GAP;
      for (const step of TUTORIAL_STEPS.filter((candidate) => candidate.text !== undefined)) {
        // Names are bold: a little wider.
        const lines = wrapRich((piece, style) => piece.length * fontSize * (style === "plain" ? 0.5 : 0.56), step.text, text.width);
        assert.ok(lines.length * lineHeight <= text.height, `"${step.id}" takes ${lines.length} lines; ${Math.floor(text.height / lineHeight)} fit at ${size.cssWidth}×${size.cssHeight}`);
      }
    }
  });
});

describe("Starting the tutorial", () => {
  it("from the main menu, while its column has room", () => {
    const navigated = [];
    const scene = new MainMenuScene(services(DESKTOP, { navigate: (id, params) => navigated.push({ id, params }) }), app());
    scene.enter();
    const button = byId(scene, "tutorial");
    assert.equal(button.text, "Tutorial");
    button.activate();
    assert.equal(navigated[0].id, SceneId.MATCH);
    assert.ok(navigated[0].params.coach, "the board comes with its coach");
  });

  it("from how to play, on the Info screen", () => {
    const navigated = [];
    const scene = new InfoScene(services(SMALL_PHONE, { navigate: (id, params) => navigated.push({ id, params }) }), app());
    scene.enter({});
    byId(scene, "info.tutorial").activate();
    assert.equal(navigated[0].id, SceneId.MATCH);
    scene.root.findById("info.tab.account").activate();
    assert.equal(byId(scene, "info.tutorial"), null, "only under how to play");
  });
});
