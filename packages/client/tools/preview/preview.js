/**
 * Visual preview harness for design review (development only; not part of
 * the game). It boots the real presentation stack against the bundled
 * content and jumps straight to a screen chosen by the query string, so
 * every screen can be screenshotted headlessly without clicking through:
 *
 *   /tools/preview/?scene=menu
 *   /tools/preview/?scene=home               Home, signed in, over the lobby's and the challenges' scripted servers
 *   /tools/preview/?scene=home&eligible=0    ...a player new to ranked play, so the guide is not over (onlineWorld.js lists the other options)
 *   /tools/preview/?scene=home&done=2        ...with that many of the guide's milestones kept here (tutorial, challenge, online game)
 *   /tools/preview/?scene=home&hidden=1      ...with the guide hidden
 *   /tools/preview/?scene=decks
 *   /tools/preview/?scene=builder            deck builder, library view
 *   /tools/preview/?scene=editor             deck builder, editing a copy of the first deck
 *   /tools/preview/?scene=editor&inspect=1   plus the inspect overlay
 *   /tools/preview/?scene=starter            the starter offer (data/economy/starter-offer.json), signed in as a stand-in
 *   /tools/preview/?scene=match&turns=6      a match after N auto-played turns (seeded)
 *   /tools/preview/?scene=match&deck=precon_shadow   playing that deck (default: the first playable one)
 *   /tools/preview/?scene=match&inspect=1    plus the inspect overlay on a hand card
 *   /tools/preview/?scene=match&help=0       with the match help off (it is on, as for a new player)
 *   /tools/preview/?scene=match&say=Kneel.   the opponent speaks, as a daily challenge's character does (a bubble by its seat)
 *   /tools/preview/?scene=match&share=1      the match conceded, its result shared as a ping on cur8.fun (the dialog; nothing is posted)
 *   /tools/preview/?scene=match&over=1       the match conceded, its result closed: the board, with See result
 *   /tools/preview/?scene=sharecard          the picture a shared game carries, as the JPEG it is saved to
 *   /tools/preview/?scene=info&topic=ranked  the Info screen on a topic (default: how to play)
 *   /tools/preview/?scene=tutorial&next=5    the tutorial, after N clicks as the coach asks (Next, or what it points at)
 *   /tools/preview/?scene=online&tab=ranked  the online lobby against a scripted server (onlineWorld.js lists its options)
 *   /tools/preview/?scene=daily&stage=1      the challenges screen over a day of the real roster (dailyWorld.js lists its options)
 *   ...&art=procedural                       every card and the table with procedural art, ignoring data/art/
 *   ...&press=settings                       then presses a control of the screen by id (the shell's too: settings, profile, shell.nav.market)
 *
 * Illustrations are all loaded before the first frame, so a screenshot never
 * catches a card still procedural because its image was on its way.
 *
 * Nothing here is imported by src/.
 */
import { AccountStatus } from "../../src/application/account/AccountService.js";
import { ContentResource } from "../../src/application/ports/ContentSource.contract.js";
import { ANY_ID, NO_ILLUSTRATIONS, buildIllustrationManifest } from "../../src/application/content/IllustrationManifest.js";
import { loadContent } from "../../src/application/content/ContentService.js";
import { DeckBuildingService } from "../../src/application/decks/DeckBuildingService.js";
import { DeckSelectionService } from "../../src/application/decks/DeckSelectionService.js";
import { BasicAiController } from "../../src/application/match/BasicAiController.js";
import { TutorialService } from "../../src/application/tutorial/TutorialService.js";
import { HelpSettings } from "../../src/application/help/HelpSettings.js";
import { CharacterVoice } from "../../src/application/daily/CharacterVoice.js";
import { pingText } from "../../src/application/social/pingText.js";
import { shareCardOf } from "../../src/application/social/shareCard.js";
import { CanvasShareImage } from "../../src/rendering/share/ShareCard.js";
import { humanController } from "../../src/application/match/HumanController.js";
import { MatchSetupService } from "../../src/application/match/MatchSetupService.js";
import { declareAttackers, declareBlockers, endTurn, playCard } from "@magic8/engine/domain/commands/commandFactories.js";
import { CommandType } from "@magic8/engine/domain/commands/CommandType.js";
import { createCoreEffectRegistry } from "@magic8/engine/domain/effects/registerCoreEffects.js";
import { GamePhase } from "@magic8/engine/domain/game/GamePhase.js";
import { dailyServices } from "./dailyWorld.js";
import { Milestone, OnboardingProgress } from "../../src/application/onboarding/OnboardingProgress.js";
import { IdentityStatus } from "../../src/application/identity/IdentityService.js";
import { onlineServices } from "./onlineWorld.js";
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
import { UiArt } from "../../src/rendering/images/UiArt.js";
import { UI_ART } from "../../src/rendering/images/uiArtFiles.js";
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
  characterArt: "/data/art/characters.json",
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
    voice: new CharacterVoice({ now: () => Date.now() }),
    // Shares nothing: the dialog is shown, Post answers after a moment.
    sharing: {
      canShare: () => true,
      textFor: (_gameId, game) => pingText({ ...game, mode: "ranked", url: window.location.origin }),
      cardFor: (_gameId, game) => shareCardOf({ ...game, mode: "ranked", url: window.location.origin }, { name: "@alice", account: "alice" }),
      pictureFor: async () => ({ ok: /** @type {const} */ (false), error: { code: "NO_PICTURE", message: "the preview paints none", details: null } }),
      share: () => new Promise((resolve) => window.setTimeout(() => resolve({ ok: true, value: "" }), 1500)),
    },
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
  redraw = () => loop.requestRender();
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
 * The picture of a won boss challenge, saved as a JPEG and shown as an image in place of the game.
 * @param {import("../../src/rendering/theme/Theme.js").Theme} theme
 */
async function showShareCard(theme) {
  await /** @type {any} */ (theme.uiArt)?.preload?.();
  await characterPortrait(theme, "gravelord");
  // Stand-ins for the players' profile pictures (the game server passes the real ones through).
  const photos = { alice: "/data/art/character_sira.jpg", bob: "/data/art/character_rook.jpg" };
  const painter = new CanvasShareImage({ theme, createCanvas: () => document.createElement("canvas"), pictureOf: (account) => (account in photos ? loadBrowserImage(photos[/** @type {keyof typeof photos} */ (account)]) : Promise.resolve(null)) });
  const url = window.location.origin;
  const games = [
    { game: { outcome: /** @type {const} */ ("win"), opponent: { name: "The Gravelord", account: "ai_gravelord", character: true }, turns: 14, myLife: 7, theirLife: 0, mode: "daily", challenge: { boss: true, track: "Hard" }, url } },
    { game: { outcome: /** @type {const} */ ("loss"), opponent: { name: "bob", account: "bob", character: false }, turns: 11, myLife: 0, theirLife: 9, mode: "ranked", url } },
  ];
  const images = [];
  for (const { game } of games) {
    const painted = await painter.render(shareCardOf(game, { name: "@alice", account: "alice" }));
    if (!painted.ok) {
      throw new Error(painted.error.message);
    }
    const image = document.createElement("img");
    image.src = `data:image/jpeg;base64,${painted.value.base64}`;
    image.style.cssText = "display:block;width:1200px;height:630px";
    images.push(image);
  }
  document.body.replaceChildren(...images);
  document.body.style.overflow = "auto";
}

/**
 * Waits until a character's portrait is loaded (asked for, then given time).
 * @param {import("../../src/rendering/theme/Theme.js").Theme} theme
 * @param {string} id
 */
async function characterPortrait(theme, id) {
  for (let attempt = 0; attempt < 50 && theme.characterArt?.imageFor(id) === null; attempt += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 100));
  }
}

/**
 * Concedes the match, then once its result is offered does `then` with the scene (share it, close it).
 * @param {SceneManager} sceneManager
 * @param {any} session
 * @param {(scene: any) => void} then
 */
function endMatch(sceneManager, session, then) {
  session.submit({ type: CommandType.CONCEDE, playerId: session.humanPlayerIds[0] });
  const wait = () => {
    if (sceneManager.current?.modal?.id !== "gameOver") {
      window.setTimeout(wait, 200);
      return;
    }
    then(sceneManager.current);
  };
  wait();
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

/** Screens shown as they open, with nothing to set up. */
const PLAIN_SCENES = Object.freeze({ home: SceneId.HOME, daily: SceneId.DAILY, decks: SceneId.DECK_SELECTION, starter: SceneId.STARTER, builder: SceneId.DECK_BUILDER });

/**
 * @param {import("../../src/rendering/scenes/SceneManager.js").SceneManager} sceneManager
 * @param {import("../../src/application/AppContext.js").AppContext} app
 * @param {{ scene: string, turns: number, inspect: boolean, deckId: string | null, topic: string | null, say: string | null, share: boolean, over: boolean }} request
 */
async function show(sceneManager, app, request) {
  const { scene, inspect, topic } = request;
  const plain = PLAIN_SCENES[/** @type {keyof typeof PLAIN_SCENES} */ (scene)];
  if (plain !== undefined) {
    sceneManager.navigate(plain);
  } else if (scene === "info") {
    sceneManager.navigate(SceneId.INFO, topic === null ? {} : { topic });
  } else if (scene === "editor") {
    app.deckBuilding.edit(app.deckSelection.listDecks()[0].deck);
    sceneManager.navigate(SceneId.DECK_BUILDER);
    if (inspect) {
      sceneManager.current?.root.findById(`catalog.info.${app.content.catalog.all()[0].id}`)?.activate();
    }
  } else if (scene === "match") {
    await showMatch(sceneManager, app, request);
  } else {
    sceneManager.navigate(SceneId.MAIN_MENU);
  }
}

/**
 * A match after a few turns, with what the request adds: the opponent speaking, a card inspected, the match ended and its result shared or closed.
 * @param {import("../../src/rendering/scenes/SceneManager.js").SceneManager} sceneManager
 * @param {import("../../src/application/AppContext.js").AppContext} app
 * @param {{ turns: number, inspect: boolean, deckId: string | null, say: string | null, share: boolean, over: boolean }} request
 */
async function showMatch(sceneManager, app, { turns, inspect, deckId, say, share, over }) {
  const session = await createMatch(app, { turns, deckId });
  // The game stands for an online one (a challenge's), so the character's line is heard at its table.
  Object.defineProperty(session, "gameId", { value: "preview" });
  sceneManager.navigate(SceneId.MATCH, { session });
  if (say !== null) {
    // Said again every few seconds, so a screenshot taken whenever catches it.
    const speak = () => app.voice?.say({ opponent: /** @type {any} */ ({ name: "The Gravelord" }), kind: "intro", line: say, gameId: "preview" });
    speak();
    window.setInterval(speak, 4000);
  }
  if (inspect) {
    inspectFirstCard(sceneManager);
  }
  if (share || over) {
    endMatch(sceneManager, session, (board) => (share ? board.modal?.findById("gameOver.share")?.activate() : board.onCancel()));
  }
}

/** @typedef {{ tab: string | null, way: string | null, guide: boolean, entries: number, eligible: boolean }} OnlineRequest */

/**
 * The online lobby, on the tab (and the way to play ranked) asked for, with the phone's guide open if asked.
 * @param {import("../../src/rendering/scenes/SceneManager.js").SceneManager} sceneManager
 * @param {OnlineRequest} request
 */
async function showOnline(sceneManager, { tab, way, guide }) {
  sceneManager.navigate(SceneId.ONLINE);
  // The standing and the entries come from the scripted server first: ranked opens once they have.
  await new Promise((resolve) => window.setTimeout(resolve, 100));
  const press = (/** @type {string} */ id) => sceneManager.current?.root.findById(id)?.activate();
  if (tab === "ranked") {
    press("online.mode.ranked");
  }
  if (way === "auto") {
    press("online.mode.auto");
  }
  if (guide) {
    press("online.guide.open");
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
 * @param {URLSearchParams} query
 * @param {string} name
 * @returns {number | null} the count, or null when the query does not give one
 */
function optionalCount(query, name) {
  const value = countParam(query, name, -1);
  return value < 0 ? null : value;
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

/**
 * The app the screen asked for needs: a signed-in account still owed its starter, the online lobby's services, or neither.
 * @param {{ scene: string, help: boolean, online: OnlineRequest, daily: { opponents: string | null, stage: number | null } }} request
 * @param {import("../../src/application/content/ContentService.js").GameContent} content
 * @returns {Promise<import("../../src/application/AppContext.js").AppContext>}
 */
async function appFor(request, content) {
  const app = buildApp(content, request.help);
  if (request.scene === "starter") {
    return Object.freeze({ ...app, account: /** @type {any} */ (await starterAccount(content)) });
  }
  if (request.scene === "daily") {
    // The day's services stand in for a server: casting them is the harness's business.
    return Object.freeze({ ...app, .../** @type {any} */ (await dailyServices(content, request.daily)) });
  }
  if (request.scene === "online") {
    // The lobby's services stand in for a server: casting them is the harness's business.
    return Object.freeze({ ...app, .../** @type {any} */ (onlineServices(content, request.online, logger)) });
  }
  if (request.scene === "home") {
    const lobby = /** @type {any} */ (onlineServices(content, request.online, logger));
    const { daily } = await dailyServices(content, request.daily);
    const onboarding = new OnboardingProgress({ preferences: { load: () => null, save: () => undefined } });
    [Milestone.TUTORIAL, Milestone.CHALLENGE, Milestone.ONLINE].slice(0, request.home.done).forEach((milestone) => onboarding.reach(milestone, lobby.account?.state.account ?? "preview"));
    if (request.home.hidden) {
      onboarding.dismiss();
    }
    const account = lobby.account?.state.account ?? "preview";
    // Signed in, as the lobby's stand-in account: the guide and the cards read it.
    const identity = { state: { status: IdentityStatus.SIGNED_IN, user: { id: "u-preview", account, network: "steem" }, method: null, error: null }, subscribe: () => () => undefined };
    return Object.freeze({ ...app, ...lobby, daily, onboarding, identity });
  }
  return app;
}

async function boot() {
  const query = new URL(window.location.href).searchParams;
  const request = {
    scene: query.get("scene") ?? "menu",
    turns: countParam(query, "turns", 6),
    inspect: query.get("inspect") === "1",
    say: query.get("say"),
    share: query.get("share") === "1",
    over: query.get("over") === "1",
    deckId: query.get("deck"),
    topic: query.get("topic"),
    next: countParam(query, "next", 0),
    procedural: query.get("art") === "procedural",
    help: query.get("help") !== "0",
    online: { tab: query.get("tab"), way: query.get("way"), guide: query.get("guide") === "1", entries: countParam(query, "entries", 3), eligible: query.get("eligible") !== "0" },
    daily: { opponents: query.get("opponents"), stage: optionalCount(query, "stage") },
    press: query.get("press"),
    home: { done: countParam(query, "done", 0), hidden: query.get("hidden") === "1" },
  };
  const source = new FetchContentSource(MANIFEST, (url, init) => fetch(url, init));
  const [rawTheme, content, rawIllustrations, rawCharacterArt] = await Promise.all([source.load("theme"), loadContent(source, createCoreEffectRegistry()), source.load("illustrations"), source.load("characterArt")]);
  if (!content.ok) {
    throw new Error(content.error.message);
  }
  const theme = rawTheme.ok ? validateTheme(rawTheme.value) : rawTheme;
  if (!theme.ok) {
    throw new Error(theme.error.message);
  }
  const app = await appFor(request, content.value);
  const illustrations = await loadIllustrations(request.procedural || !rawIllustrations.ok ? null : rawIllustrations.value, content.value.catalog);
  const characterArt = await loadIllustrations(request.procedural || !rawCharacterArt.ok ? null : rawCharacterArt.value, ANY_ID, "characters");
  const tableArt = request.procedural ? undefined : await loadTableArt();
  const uiArt = paintedMenus();
  // The title face too, so the menu's name is never caught in the fallback one.
  await document.fonts.load(`900 72px ${theme.value.fonts.titleFamily}`);
  await present(Object.freeze({ ...theme.value, illustrations, characterArt, tableArt, uiArt }), app, request);
  document.title = `KIJAM preview: ${request.scene}`;
}

/**
 * The screen the request asks for: the share card alone, or the game on a scene.
 * @param {import("../../src/rendering/theme/Theme.js").Theme} theme
 * @param {import("../../src/application/AppContext.js").AppContext} app
 * @param {any} request
 */
async function present(theme, app, request) {
  if (request.scene === "sharecard") {
    await showShareCard(theme);
    return;
  }
  const sceneManager = buildPresentation(theme);
  registerScenes(sceneManager, app);
  if (request.scene === "tutorial") {
    await showTutorial(sceneManager, app, request.next);
  } else if (request.scene === "online") {
    await showOnline(sceneManager, request.online);
  } else {
    await show(sceneManager, app, request);
  }
  if (request.press !== null) {
    sceneManager.current?.findNode(request.press)?.activate();
  }
}

/**
 * Every illustration, already downloaded; none when `raw` is null.
 * @param {unknown} raw the illustrations file (or the character portraits')
 * @param {{ has: (id: string) => boolean }} catalog
 * @param {string} [section] "cards", or "characters"
 */
async function loadIllustrations(raw, catalog, section = "cards") {
  const built = raw === null ? null : buildIllustrationManifest(raw, catalog, section);
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

/** Draws the screen again: set once the presentation is built (painted art that arrives later asks for it). */
let redraw = () => undefined;

/**
 * The painted menus (backdrop, panel corners, button plates), as the game draws them: procedural until each image
 * arrives, the screen drawn again then.
 */
function paintedMenus() {
  const urls = Object.fromEntries(Object.entries(UI_ART.files).map(([piece, file]) => [piece, `/data/art/${file}`]));
  const uiArt = new UiArt({ urls, layout: UI_ART.layout, loadImage: loadBrowserImage, onLoaded: () => redraw(), logger });
  void uiArt.preload();
  return uiArt;
}

boot().catch((error) => {
  logger.error("preview failed", error instanceof Error ? error.message : String(error));
});
