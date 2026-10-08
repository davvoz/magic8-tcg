/**
 * Visual preview harness for design review (development only; not part of
 * the game). It boots the real presentation stack against the bundled
 * content and jumps straight to a screen chosen by the query string, so
 * every screen can be screenshotted headlessly without clicking through:
 *
 *   /tools/preview/?scene=menu
 *   /tools/preview/?scene=decks
 *   /tools/preview/?scene=builder            deck builder, library view
 *   /tools/preview/?scene=editor             deck builder, editing a copy of the first deck
 *   /tools/preview/?scene=editor&inspect=1   plus the inspect overlay
 *   /tools/preview/?scene=starter            the starter offer (data/economy/starter-offer.json), signed in as a stand-in
 *   /tools/preview/?scene=match&turns=6      a match after N auto-played turns (seeded)
 *   /tools/preview/?scene=match&deck=precon_shadow   playing that deck (default: the first playable one)
 *   /tools/preview/?scene=match&inspect=1    plus the inspect overlay on a hand card
 *   /tools/preview/?scene=match&help=0       with the match help off (it is on, as for a new player)
 *   /tools/preview/?scene=info&topic=ranked  the Info screen on a topic (default: how to play)
 *   /tools/preview/?scene=tutorial&next=5    the tutorial, after N clicks as the coach asks (Next, or what it points at)
 *   ...&art=procedural                       every card and the table with procedural art, ignoring data/art/
 *
 * Illustrations are all loaded before the first frame, so a screenshot never
 * catches a card still procedural because its image was on its way.
 *
 * Nothing here is imported by src/.
 */
import { AccountStatus } from "../../src/application/account/AccountService.js";
import { ContentResource } from "../../src/application/ports/ContentSource.contract.js";
import { NO_ILLUSTRATIONS, buildIllustrationManifest } from "../../src/application/content/IllustrationManifest.js";
import { loadContent } from "../../src/application/content/ContentService.js";
import { DeckBuildingService } from "../../src/application/decks/DeckBuildingService.js";
import { DeckSelectionService } from "../../src/application/decks/DeckSelectionService.js";
import { BasicAiController } from "../../src/application/match/BasicAiController.js";
import { TutorialService } from "../../src/application/tutorial/TutorialService.js";
import { HelpSettings } from "../../src/application/help/HelpSettings.js";
import { humanController } from "../../src/application/match/HumanController.js";
import { MatchSetupService } from "../../src/application/match/MatchSetupService.js";
import { declareAttackers, declareBlockers, endTurn, playCard } from "@magic8/engine/domain/commands/commandFactories.js";
import { CommandType } from "@magic8/engine/domain/commands/CommandType.js";
import { createCoreEffectRegistry } from "@magic8/engine/domain/effects/registerCoreEffects.js";
import { GamePhase } from "@magic8/engine/domain/game/GamePhase.js";
import { FetchContentSource } from "../../src/infrastructure/config/FetchContentSource.js";
import { ConsoleLogger } from "../../src/infrastructure/logging/ConsoleLogger.js";
import { loadBrowserImage } from "../../src/infrastructure/images/loadBrowserImage.js";
import { InMemoryStore } from "../../src/infrastructure/persistence/InMemoryStore.js";
import { StoredDeckRepository } from "../../src/infrastructure/persistence/StoredDeckRepository.js";
import { immediateScheduler } from "../../src/infrastructure/time/ImmediateScheduler.js";
import { InputManager } from "../../src/input/InputManager.js";
import { CardNode } from "../../src/rendering/board/CardNode.js";
import { CardIllustrations } from "../../src/rendering/cards/CardIllustrations.js";
import { TableArt, TablePiece } from "../../src/rendering/images/TableArt.js";
import { CanvasHost } from "../../src/rendering/canvas/CanvasHost.js";
import { GameLoop } from "../../src/rendering/canvas/GameLoop.js";
import { Viewport } from "../../src/rendering/canvas/Viewport.js";
import { SceneManager } from "../../src/rendering/scenes/SceneManager.js";
import { registerScenes } from "../../src/rendering/scenes/registerScenes.js";
import { SceneId } from "../../src/rendering/scenes/sceneIds.js";
import { validateTheme } from "../../src/rendering/theme/Theme.js";

const MANIFEST = Object.freeze({
  [ContentResource.CARD_SETS]: Object.freeze(["/data/cards/core.cards.json"]),
  [ContentResource.PRECON_DECKS]: Object.freeze([
    "/data/decks/precon_ember.deck.json",
    "/data/decks/precon_iron.deck.json",
    "/data/decks/precon_wildfire.deck.json",
    "/data/decks/precon_foundry.deck.json",
    "/data/decks/precon_shadow.deck.json",
    "/data/decks/precon_verdant.deck.json",
    "/data/decks/precon_harvest.deck.json",
    "/data/decks/precon_wildhunt.deck.json",
    "/data/decks/precon_arcane.deck.json",
    "/data/decks/precon_bastion.deck.json",
  ]),
  [ContentResource.GAME_RULES]: "/data/rules/game-rules.json",
  [ContentResource.DECK_RULES]: "/data/rules/deck-rules.json",
  theme: "/data/ui/theme.json",
  illustrations: "/data/art/illustrations.json",
});
const SEED = 20260921;
const MAX_STEPS_PER_TURN = 40;
const HUMAN = Object.freeze({ id: "player", name: "You" });
const AI = Object.freeze({ id: "ai", name: "Opponent" });

const logger = new ConsoleLogger();

/**
 * @param {import("../../src/application/content/ContentService.js").GameContent} content
 * @param {boolean} help whether the match help is on
 * @returns {import("../../src/application/AppContext.js").AppContext}
 */
function buildApp(content, help) {
  const repository = new StoredDeckRepository({ store: new InMemoryStore(), logger });
  const matchSetup = new MatchSetupService({ content, effects: createCoreEffectRegistry(), scheduler: immediateScheduler, logger });
  return Object.freeze({
    content,
    deckSelection: new DeckSelectionService({ content, repository, logger }),
    deckBuilding: new DeckBuildingService({ content, repository }),
    matchSetup,
    tutorial: new TutorialService({ matchSetup, content }),
    createSeed: () => SEED,
    logger,
    environment: Object.freeze({ version: "preview", storage: "memory" }),
    help: new HelpSettings({ preferences: { load: () => ({ enabled: help }), save: () => undefined } }),
  });
}

/**
 * A signed-in account still owed its starter, offering what the bundled
 * offer file lists; taking one is refused (there is no server here).
 * @param {import("../../src/application/content/ContentService.js").GameContent} content
 */
async function starterAccount(content) {
  const offer = await (await fetch("/data/economy/starter-offer.json")).json();
  const choices = offer.choices
    .map((id) => content.preconDecks.find((deck) => deck.id === id))
    .filter((deck) => deck !== undefined)
    .map((deck) => Object.freeze({ id: deck.id, name: deck.name, size: deck.totalCards, cards: deck.entries }));
  return Object.freeze({
    state: Object.freeze({ status: AccountStatus.READY, error: null, account: "preview" }),
    collection: Object.freeze({ state: Object.freeze({ starter: Object.freeze({ claimed: false, choices }) }) }),
    needsStarter: true,
    subscribe: () => () => undefined,
    claimStarter: async () => ({ ok: false, error: { code: "UNAVAILABLE", message: "no server in the preview" } }),
  });
}

/** @param {import("../../src/rendering/theme/Theme.js").Theme} theme */
function buildPresentation(theme) {
  const canvas = document.getElementById("game");
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error("canvas#game not found");
  }
  const viewport = new Viewport(theme.layout);
  const loop = new GameLoop({
    requestFrame: (callback) => window.requestAnimationFrame(callback),
    cancelFrame: (handle) => window.cancelAnimationFrame(handle),
    now: () => performance.now(),
  });
  const sceneManager = new SceneManager({ theme, viewport, logger, requestRender: () => loop.requestRender() });
  const host = new CanvasHost({
    canvas,
    viewport,
    window,
    onResize: () => {
      sceneManager.resize();
      loop.requestRender();
    },
  });
  const input = new InputManager({ canvas, window, viewport, target: sceneManager });
  host.attach();
  input.attach();
  loop.start({
    update: (dt) => sceneManager.update(dt),
    render: () => {
      const context = host.context;
      const { cssWidth, cssHeight } = viewport.letterbox;
      context.setTransform(viewport.devicePixelRatio, 0, 0, viewport.devicePixelRatio, 0, 0);
      context.fillStyle = theme.colors.letterbox;
      context.fillRect(0, 0, cssWidth, cssHeight);
      viewport.applyTransform(context);
      sceneManager.render(context);
    },
  });
  return sceneManager;
}

/**
 * Plays the human seat greedily for `turns` turns so the board has content:
 * every playable card (first target option), all legal attackers, no blocks, end turn.
 * @param {import("../../src/application/match/MatchSession.js").MatchSession} session
 * @param {number} turns
 */
async function autoPlay(session, turns) {
  for (let turn = 0; turn < turns && !session.isOver; turn += 1) {
    await playOneTurn(session);
  }
}

/** @param {import("../../src/application/match/MatchSession.js").MatchSession} session */
async function playOneTurn(session) {
  for (let step = 0; step < MAX_STEPS_PER_TURN; step += 1) {
    await session.whenIdle();
    const snapshot = session.snapshotFor(HUMAN.id);
    const moves = snapshot.legalMoves;
    if (snapshot.isOver || moves === null) {
      return;
    }
    const command = nextCommand(snapshot, moves);
    if (command === null || !session.submit(command).ok || command.type === CommandType.END_TURN) {
      return;
    }
  }
}

/**
 * @param {ReturnType<import("../../src/application/match/MatchSession.js").MatchSession["snapshotFor"]>} snapshot
 * @param {import("@magic8/engine/domain/game/LegalMoves.js").LegalMoves} moves
 */
function nextCommand(snapshot, moves) {
  const cardId = moves.playableCardIds[0];
  if (cardId !== undefined) {
    const targets = (moves.targetOptions[cardId] ?? []).map((group) => group[0]).filter((id) => id !== undefined);
    return playCard(HUMAN.id, cardId, targets);
  }
  if (snapshot.awaitingPlayerId !== HUMAN.id) {
    return null;
  }
  if (snapshot.phase === GamePhase.COMBAT_ATTACKERS) {
    return declareAttackers(HUMAN.id, [...moves.attackerIds]);
  }
  if (snapshot.phase === GamePhase.COMBAT_BLOCKERS) {
    return declareBlockers(HUMAN.id, []);
  }
  return moves.canEndTurn ? endTurn(HUMAN.id) : null;
}

/**
 * @param {import("../../src/application/AppContext.js").AppContext} app
 * @param {{ turns: number, deckId: string | null }} request
 */
async function createMatch(app, { turns, deckId }) {
  const options = app.deckSelection.listPlayableDecks();
  const mine = options.find((option) => option.deck.id === deckId) ?? options[0];
  const theirs = options.find((option) => option !== mine);
  const created = app.matchSetup.createMatch({
    seats: [
      { ...HUMAN, deckList: mine.deck, controller: humanController },
      { ...AI, deckList: (theirs ?? mine).deck, controller: new BasicAiController() },
    ],
    seed: SEED,
  });
  if (!created.ok) {
    throw new Error(created.error.message);
  }
  created.value.start();
  await autoPlay(created.value, turns);
  return created.value;
}

/**
 * Opens the inspect overlay on the first card node of the current scene.
 * @param {import("../../src/rendering/scenes/SceneManager.js").SceneManager} sceneManager
 */
function inspectFirstCard(sceneManager) {
  const scene = sceneManager.current;
  if (scene === null) {
    return;
  }
  let first = null;
  const visit = (node) => {
    if (first === null && node instanceof CardNode) {
      first = node;
    }
    node.children.forEach(visit);
  };
  visit(scene.root);
  if (first !== null) {
    scene.onSecondary(first);
  }
}

/**
 * @param {import("../../src/rendering/scenes/SceneManager.js").SceneManager} sceneManager
 * @param {import("../../src/application/AppContext.js").AppContext} app
 * @param {{ scene: string, turns: number, inspect: boolean, deckId: string | null, topic: string | null }} request
 */
async function show(sceneManager, app, { scene, turns, inspect, deckId, topic }) {
  if (scene === "info") {
    sceneManager.navigate(SceneId.INFO, topic === null ? {} : { topic });
  } else if (scene === "decks") {
    sceneManager.navigate(SceneId.DECK_SELECTION);
  } else if (scene === "starter") {
    sceneManager.navigate(SceneId.STARTER);
  } else if (scene === "builder") {
    sceneManager.navigate(SceneId.DECK_BUILDER);
  } else if (scene === "editor") {
    app.deckBuilding.edit(app.deckSelection.listDecks()[0].deck);
    sceneManager.navigate(SceneId.DECK_BUILDER);
    if (inspect) {
      sceneManager.current?.root.findById(`catalog.info.${app.content.catalog.all()[0].id}`)?.activate();
    }
  } else if (scene === "match") {
    sceneManager.navigate(SceneId.MATCH, { session: await createMatch(app, { turns, deckId }) });
    if (inspect) {
      inspectFirstCard(sceneManager);
    }
  } else {
    sceneManager.navigate(SceneId.MAIN_MENU);
  }
}

/**
 * A whole number from the query string, `fallback` when absent or not one.
 * @param {URLSearchParams} query
 * @param {string} name
 * @param {number} fallback
 */
function countParam(query, name, fallback) {
  const value = Number.parseInt(query.get(name) ?? "", 10);
  return Number.isNaN(value) ? fallback : value;
}

/**
 * The tutorial, after `next` clicks as the coach asks.
 * @param {SceneManager} sceneManager
 * @param {import("../../src/application/AppContext.js").AppContext} app
 * @param {number} next
 */
async function showTutorial(sceneManager, app, next) {
  const started = /** @type {import("../../src/application/tutorial/TutorialService.js").TutorialService} */ (app.tutorial).start({ aiDelayMs: 0 });
  if (started.ok) {
    sceneManager.navigate(SceneId.MATCH, { session: started.value.session, coach: started.value.coach });
    await followCoach(sceneManager, started.value.coach, next);
  }
}

/**
 * Plays the tutorial on, `count` clicks: Next on a lesson, and on a task
 * what the coach points at (the card to tap, the button to press).
 * @param {SceneManager} sceneManager
 * @param {import("../../src/application/tutorial/TutorialCoach.js").TutorialCoach} coach
 * @param {number} count
 */
async function followCoach(sceneManager, coach, count) {
  for (let clicks = 0; clicks < count; clicks += 1) {
    let target = null;
    for (let frames = 0; frames < 900 && target === null; frames += 1) {
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
      target = coachTarget(sceneManager, coach);
    }
    target?.activate();
  }
}

/**
 * What a player following the coach would click now, if anything.
 * @param {SceneManager} sceneManager
 * @param {import("../../src/application/tutorial/TutorialCoach.js").TutorialCoach} coach
 */
function coachTarget(sceneManager, coach) {
  const scene = /** @type {any} */ (sceneManager.current);
  const next = scene?.root.findById("coach.next") ?? null;
  if (next !== null || scene?.isBusy !== false || coach.lesson !== null) {
    return next;
  }
  const interaction = scene.interaction;
  const intent = { pickedCardId: interaction.pickedCardId, targetingCardId: interaction.targetingCardId, attackerIds: interaction.selectedAttackerIds, pendingBlockerId: interaction.pendingBlockerId, blocks: interaction.pendingBlocks };
  const [token] = coach.focusFor(intent);
  return token === undefined ? null : scene.root.findById(token.slice(token.indexOf(":") + 1));
}

async function boot() {
  const query = new URL(window.location.href).searchParams;
  const request = {
    scene: query.get("scene") ?? "menu",
    turns: countParam(query, "turns", 6),
    inspect: query.get("inspect") === "1",
    deckId: query.get("deck"),
    topic: query.get("topic"),
    next: countParam(query, "next", 0),
    procedural: query.get("art") === "procedural",
    help: query.get("help") !== "0",
  };
  const source = new FetchContentSource(MANIFEST, (url, init) => fetch(url, init));
  const [rawTheme, content, rawIllustrations] = await Promise.all([source.load("theme"), loadContent(source, createCoreEffectRegistry()), source.load("illustrations")]);
  if (!content.ok) {
    throw new Error(content.error.message);
  }
  const theme = rawTheme.ok ? validateTheme(rawTheme.value) : rawTheme;
  if (!theme.ok) {
    throw new Error(theme.error.message);
  }
  const app = request.scene === "starter" ? Object.freeze({ ...buildApp(content.value, request.help), account: /** @type {any} */ (await starterAccount(content.value)) }) : buildApp(content.value, request.help);
  const illustrations = await loadIllustrations(request.procedural || !rawIllustrations.ok ? null : rawIllustrations.value, content.value.catalog);
  const tableArt = request.procedural ? undefined : await loadTableArt();
  // The title face too, so the menu's name is never caught in the fallback one.
  await document.fonts.load(`900 72px ${theme.value.fonts.titleFamily}`);
  const sceneManager = buildPresentation(Object.freeze({ ...theme.value, illustrations, tableArt }));
  registerScenes(sceneManager, app);
  await (request.scene === "tutorial" ? showTutorial(sceneManager, app, request.next) : show(sceneManager, app, request));
  document.title = `KIJAM preview: ${request.scene}`;
}

/**
 * Every illustration, already downloaded; none when `raw` is null.
 * @param {unknown} raw the illustrations file
 * @param {{ has: (cardId: string) => boolean }} catalog
 */
async function loadIllustrations(raw, catalog) {
  const built = raw === null ? null : buildIllustrationManifest(raw, catalog);
  if (built !== null && !built.ok) {
    logger.warn("card illustrations unavailable", built.message);
  }
  const illustrations = new CardIllustrations({
    manifest: built?.ok ? built.value : NO_ILLUSTRATIONS,
    urlFor: (file) => `/data/art/${file}`,
    loadImage: loadBrowserImage,
    logger,
  });
  await illustrations.preload(illustrations.cardIds);
  return illustrations;
}

/** The painted table (same files as the game), already downloaded. */
async function loadTableArt() {
  const tableArt = new TableArt({
    urls: { [TablePiece.MAT]: "/data/art/Tappeto.jpg", [TablePiece.CARD_BACK]: "/data/art/Dorso.jpg", [TablePiece.PANEL]: "/data/art/Texture.jpg" },
    loadImage: loadBrowserImage,
    logger,
  });
  await tableArt.preload();
  return tableArt;
}

boot().catch((error) => {
  logger.error("preview failed", error instanceof Error ? error.message : String(error));
});
