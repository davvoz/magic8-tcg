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
 *   /tools/preview/?scene=match&turns=6      a match after N auto-played turns (seeded)
 *   /tools/preview/?scene=match&deck=precon_shadow   playing that deck (default: the first playable one)
 *   /tools/preview/?scene=match&inspect=1    plus the inspect overlay on a hand card
 *
 * Nothing here is imported by src/.
 */
import { ContentResource } from "../../src/application/ports/ContentSource.contract.js";
import { loadContent } from "../../src/application/content/ContentService.js";
import { DeckBuildingService } from "../../src/application/decks/DeckBuildingService.js";
import { DeckSelectionService } from "../../src/application/decks/DeckSelectionService.js";
import { BasicAiController } from "../../src/application/match/BasicAiController.js";
import { humanController } from "../../src/application/match/HumanController.js";
import { MatchSetupService } from "../../src/application/match/MatchSetupService.js";
import { declareAttackers, declareBlockers, endTurn, playCard } from "@magic8/engine/domain/commands/commandFactories.js";
import { CommandType } from "@magic8/engine/domain/commands/CommandType.js";
import { createCoreEffectRegistry } from "@magic8/engine/domain/effects/registerCoreEffects.js";
import { GamePhase } from "@magic8/engine/domain/game/GamePhase.js";
import { FetchContentSource } from "../../src/infrastructure/config/FetchContentSource.js";
import { ConsoleLogger } from "../../src/infrastructure/logging/ConsoleLogger.js";
import { InMemoryStore } from "../../src/infrastructure/persistence/InMemoryStore.js";
import { StoredDeckRepository } from "../../src/infrastructure/persistence/StoredDeckRepository.js";
import { immediateScheduler } from "../../src/infrastructure/time/ImmediateScheduler.js";
import { InputManager } from "../../src/input/InputManager.js";
import { CardNode } from "../../src/rendering/board/CardNode.js";
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
});
const SEED = 20260921;
const MAX_STEPS_PER_TURN = 40;
const HUMAN = Object.freeze({ id: "player", name: "You" });
const AI = Object.freeze({ id: "ai", name: "Opponent" });

const logger = new ConsoleLogger();

/**
 * @param {import("../../src/application/content/ContentService.js").GameContent} content
 * @returns {import("../../src/application/AppContext.js").AppContext}
 */
function buildApp(content) {
  const repository = new StoredDeckRepository({ store: new InMemoryStore(), logger });
  return Object.freeze({
    content,
    deckSelection: new DeckSelectionService({ content, repository, logger }),
    deckBuilding: new DeckBuildingService({ content, repository }),
    matchSetup: new MatchSetupService({ content, effects: createCoreEffectRegistry(), scheduler: immediateScheduler, logger }),
    createSeed: () => SEED,
    logger,
    environment: Object.freeze({ version: "preview", storage: "memory" }),
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
  const host = new CanvasHost({ canvas, viewport, window, onResize: () => loop.requestRender() });
  const sceneManager = new SceneManager({ theme, viewport, logger, requestRender: () => loop.requestRender() });
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
 * @param {{ scene: string, turns: number, inspect: boolean, deckId: string | null }} request
 */
async function show(sceneManager, app, { scene, turns, inspect, deckId }) {
  if (scene === "decks") {
    sceneManager.navigate(SceneId.DECK_SELECTION);
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

async function boot() {
  const query = new URL(window.location.href).searchParams;
  const request = {
    scene: query.get("scene") ?? "menu",
    turns: Number.parseInt(query.get("turns") ?? "6", 10) || 0,
    inspect: query.get("inspect") === "1",
    deckId: query.get("deck"),
  };
  const source = new FetchContentSource(MANIFEST, (url, init) => fetch(url, init));
  const [rawTheme, content] = await Promise.all([source.load("theme"), loadContent(source, createCoreEffectRegistry())]);
  if (!content.ok) {
    throw new Error(content.error.message);
  }
  const theme = rawTheme.ok ? validateTheme(rawTheme.value) : rawTheme;
  if (!theme.ok) {
    throw new Error(theme.error.message);
  }
  const app = buildApp(content.value);
  const sceneManager = buildPresentation(theme.value);
  registerScenes(sceneManager, app);
  await show(sceneManager, app, request);
  document.title = `Magic8 preview: ${request.scene}`;
}

boot().catch((error) => {
  logger.error("preview failed", error instanceof Error ? error.message : String(error));
});
