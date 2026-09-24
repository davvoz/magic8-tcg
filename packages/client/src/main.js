/**
 * Composition root: the only module that imports from every layer.
 *
 * Wires infrastructure adapters into application services, builds the
 * rendering/input stack around the canvas, registers scenes and starts the
 * loop. Nothing here contains game logic; if the content or the theme fails
 * validation the ErrorScene explains why instead of a broken screen.
 */
import { ContentResource } from "./application/ports/ContentSource.contract.js";
import { loadContent } from "./application/content/ContentService.js";
import { DeckBuildingService } from "./application/decks/DeckBuildingService.js";
import { DeckSelectionService } from "./application/decks/DeckSelectionService.js";
import { IdentityService } from "./application/identity/IdentityService.js";
import { MatchSetupService } from "./application/match/MatchSetupService.js";
import { createCoreEffectRegistry } from "@magic8/engine/domain/effects/registerCoreEffects.js";
import { HttpAuthApi } from "./infrastructure/api/HttpAuthApi.js";
import { FetchContentSource } from "./infrastructure/config/FetchContentSource.js";
import { ConsoleLogger } from "./infrastructure/logging/ConsoleLogger.js";
import { InMemoryStore } from "./infrastructure/persistence/InMemoryStore.js";
import { LocalStorageStore } from "./infrastructure/persistence/LocalStorageStore.js";
import { StoredDeckRepository } from "./infrastructure/persistence/StoredDeckRepository.js";
import { createSeed } from "./infrastructure/random/seedProvider.js";
import { browserScheduler } from "./infrastructure/time/BrowserScheduler.js";
import { KeychainWalletConnector } from "./infrastructure/wallet/KeychainWalletConnector.js";
import { InputManager } from "./input/InputManager.js";
import { CanvasHost } from "./rendering/canvas/CanvasHost.js";
import { GameLoop } from "./rendering/canvas/GameLoop.js";
import { Viewport } from "./rendering/canvas/Viewport.js";
import { ErrorScene } from "./rendering/scenes/ErrorScene.js";
import { SceneManager } from "./rendering/scenes/SceneManager.js";
import { registerScenes } from "./rendering/scenes/registerScenes.js";
import { SceneId } from "./rendering/scenes/sceneIds.js";
import { validateTheme } from "./rendering/theme/Theme.js";

const ENGINE_VERSION = "0.9.0";

/** Content files. This list is code, not data: only these paths are ever fetched. */
const CONTENT_MANIFEST = Object.freeze({
  [ContentResource.CARD_SETS]: Object.freeze(["data/cards/core.cards.json"]),
  [ContentResource.PRECON_DECKS]: Object.freeze([
    "data/decks/precon_ember.deck.json",
    "data/decks/precon_iron.deck.json",
    "data/decks/precon_wildfire.deck.json",
    "data/decks/precon_foundry.deck.json",
    "data/decks/precon_shadow.deck.json",
    "data/decks/precon_verdant.deck.json",
    "data/decks/precon_harvest.deck.json",
    "data/decks/precon_wildhunt.deck.json",
    "data/decks/precon_arcane.deck.json",
    "data/decks/precon_bastion.deck.json",
  ]),
  [ContentResource.GAME_RULES]: "data/rules/game-rules.json",
  [ContentResource.DECK_RULES]: "data/rules/deck-rules.json",
  theme: "data/ui/theme.json",
});

/** Theme used only to render the error screen when the real theme cannot be loaded. */
const FALLBACK_THEME_RAW = Object.freeze({
  schemaVersion: 2,
  layout: { logicalWidth: 1600, logicalHeight: 900 },
  colors: {
    background: "#0a0c14", backgroundGlow: "#1d2238", letterbox: "#000000",
    panel: "#151a27", panelLight: "#232a3d", panelDark: "#0d1019", panelBorder: "#33405a",
    text: "#eef0f5", textMuted: "#8f98ad",
    accent: "#e2b25c", accentLight: "#f7dfa0", accentDark: "#8a5f1e", accentText: "#1c1305",
    danger: "#e0483f", success: "#4fc48a", disabled: "#2a3040", disabledText: "#5f677a", focus: "#78c6ff", hover: "#2b3348",
    resource: "#4d9dff", attack: "#ff7a45", health: "#5ad36f", cardFace: "#11141d", cardText: "#1b1f2c",
    factions: {},
  },
  fonts: { family: "system-ui, sans-serif", displayFamily: "Georgia, serif", sizes: { title: 72, heading: 32, body: 20, small: 15, tiny: 12, micro: 10 } },
  spacing: { unit: 8, radius: 10 },
  animation: { shortMs: 120, mediumMs: 260, longMs: 500 },
});

const logger = new ConsoleLogger();

/**
 * Built once; a fatal error after start-up reuses it instead of attaching a
 * second canvas host and input manager to the same element.
 * @type {{ sceneManager: SceneManager, loop: GameLoop, restart: () => void } | null}
 */
let presentation = null;
let fatalShown = false;

/**
 * @param {import("./rendering/theme/Theme.js").Theme} theme
 * @returns {{ sceneManager: SceneManager, loop: GameLoop, restart: () => void }}
 */
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
  const target = {
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
    onError: (error) => showFatal("Unexpected error", describeError(error)),
  };
  loop.start(target);
  presentation = { sceneManager, loop, restart: () => loop.start(target) };
  return presentation;
}

/** @param {unknown} error */
function describeError(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Shows the error screen on the existing presentation (restarting the loop
 * if a frame threw), or builds one with the fallback theme when the failure
 * happened before anything could be drawn. Only the first fatal error is shown.
 * @param {string} title
 * @param {string} message
 */
function showFatal(title, message) {
  logger.error(title, message);
  if (fatalShown) {
    return;
  }
  fatalShown = true;
  if (presentation === null) {
    const theme = validateTheme(FALLBACK_THEME_RAW);
    if (!theme.ok) {
      throw new Error("fallback theme invalid");
    }
    buildPresentation(theme.value);
  }
  const { sceneManager, restart } = /** @type {NonNullable<typeof presentation>} */ (presentation);
  if (!sceneManager.has(SceneId.ERROR)) {
    sceneManager.register(SceneId.ERROR, (services) => new ErrorScene(services));
  }
  sceneManager.navigate(SceneId.ERROR, { title, message });
  restart();
}

async function boot() {
  const source = new FetchContentSource(CONTENT_MANIFEST, (url, init) => fetch(url, init));
  const identity = new IdentityService({
    api: new HttpAuthApi({ fetch: (url, init) => fetch(url, init) }),
    wallet: new KeychainWalletConnector({
      locate: () => globalThis.steem_keychain,
      timers: { setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms), clearTimeout: (id) => globalThis.clearTimeout(id) },
    }),
  });
  const [rawTheme, content] = await Promise.all([source.load("theme"), loadContent(source, createCoreEffectRegistry()), identity.restore()]);
  if (!content.ok) {
    showFatal("Content failed to load", content.error.message);
    return;
  }
  const theme = rawTheme.ok ? validateTheme(rawTheme.value) : rawTheme;
  if (!theme.ok) {
    showFatal("Theme failed to load", theme.error.message);
    return;
  }

  const localStore = new LocalStorageStore(globalThis.localStorage);
  const storageAvailable = localStore.isAvailable();
  if (!storageAvailable) {
    logger.warn("local storage unavailable; decks will not persist");
  }
  const repository = new StoredDeckRepository({ store: storageAvailable ? localStore : new InMemoryStore(), logger });

  /** @type {import("./application/AppContext.js").AppContext} */
  const app = Object.freeze({
    content: content.value,
    deckSelection: new DeckSelectionService({ content: content.value, repository, logger }),
    deckBuilding: new DeckBuildingService({ content: content.value, repository }),
    matchSetup: new MatchSetupService({ content: content.value, effects: createCoreEffectRegistry(), scheduler: browserScheduler, logger }),
    createSeed,
    logger,
    environment: Object.freeze({ version: ENGINE_VERSION, storage: storageAvailable ? "local" : "memory" }),
    identity,
  });

  const { sceneManager } = buildPresentation(theme.value);
  registerScenes(sceneManager, app);
  sceneManager.navigate(SceneId.MAIN_MENU);
}

window.addEventListener("error", (event) => showFatal("Unexpected error", describeError(event.error ?? event.message)));
window.addEventListener("unhandledrejection", (event) => showFatal("Unexpected error", describeError(event.reason)));

boot().catch((error) => {
  showFatal("Startup failed", describeError(error));
});
