/**
 * Composition root: the only module that imports from every layer.
 *
 * Wires infrastructure adapters into application services, builds the
 * rendering/input stack around the canvas, registers scenes and starts the
 * loop. Nothing here contains game logic; if the content or the theme fails
 * validation the ErrorScene explains why instead of a broken screen.
 */
import { ContentResource } from "./application/ports/ContentSource.contract.js";
import { AudioService } from "./application/audio/AudioService.js";
import { HelpSettings } from "./application/help/HelpSettings.js";
import { MusicTrack, SoundCue } from "./application/audio/SoundCue.js";
import { AccountService, AccountStatus } from "./application/account/AccountService.js";
import { CollectionService } from "./application/collection/CollectionService.js";
import { loadContent } from "./application/content/ContentService.js";
import { buildCardRarities } from "./application/content/CardRarities.js";
import { NO_ILLUSTRATIONS, buildIllustrationManifest } from "./application/content/IllustrationManifest.js";
import { COLLECTION_CHANGING_KINDS, describeNotification } from "./application/notifications/describeNotification.js";
import { NotificationService } from "./application/notifications/NotificationService.js";
import { AccountDeckRepository, DeckStorage } from "./application/decks/AccountDeckRepository.js";
import { AckReceipts } from "./application/online/AckReceipts.js";
import { OnlineService, OnlineStatus } from "./application/online/OnlineService.js";
import { LobbyService } from "./application/lobby/LobbyService.js";
import { describeLobbyEvent } from "./application/lobby/describeLobbyEvent.js";
import { RankingService } from "./application/ranking/RankingService.js";
import { JackpotService } from "./application/jackpot/JackpotService.js";
import { EntryService } from "./application/entries/EntryService.js";
import { TradingService } from "./application/trading/TradingService.js";
import { BuyStage, SalesService } from "./application/sales/SalesService.js";
import { PurchaseStage, ShopService } from "./application/shop/ShopService.js";
import { ActiveKeyPrompt } from "./application/wallet/ActiveKeyPrompt.js";
import { BalanceService } from "./application/wallet/BalanceService.js";
import { WalletSwitch } from "./application/wallet/WalletSwitch.js";
import { DeckBuildingService } from "./application/decks/DeckBuildingService.js";
import { deckMix } from "./application/decks/deckMix.js";
import { DeckSelectionService } from "./application/decks/DeckSelectionService.js";
import { IdentityService } from "./application/identity/IdentityService.js";
import { CoinFace } from "./application/match/CoinToss.js";
import { MatchSetupService } from "./application/match/MatchSetupService.js";
import { TutorialService } from "./application/tutorial/TutorialService.js";
import { createCoreEffectRegistry } from "@magic8/engine/domain/effects/registerCoreEffects.js";
import { WebAudioOutput } from "./infrastructure/audio/WebAudioOutput.js";
import { createBrowserAudioContext, followVisibility, unlockOnGesture } from "./infrastructure/audio/browserAudio.js";
import { createCoreSoundBank } from "./infrastructure/audio/registerCorePatches.js";
import { StoredAudioPreferences } from "./infrastructure/persistence/StoredAudioPreferences.js";
import { StoredHelpPreferences } from "./infrastructure/persistence/StoredHelpPreferences.js";
import { HttpAuthApi } from "./infrastructure/api/HttpAuthApi.js";
import { HttpCollectionApi } from "./infrastructure/api/HttpCollectionApi.js";
import { HttpMarketApi } from "./infrastructure/api/HttpMarketApi.js";
import { HttpGameHistoryApi } from "./infrastructure/api/HttpGameHistoryApi.js";
import { HttpLiveGamesApi } from "./infrastructure/api/HttpLiveGamesApi.js";
import { verifySignedAck } from "./infrastructure/crypto/ackVerifier.js";
import { WebCryptoSessionKeys } from "./infrastructure/crypto/webSessionKeys.js";
import { HttpRankingApi } from "./infrastructure/api/HttpRankingApi.js";
import { HttpJackpotApi } from "./infrastructure/api/HttpJackpotApi.js";
import { HttpEntriesApi } from "./infrastructure/api/HttpEntriesApi.js";
import { HttpTradingApi } from "./infrastructure/api/HttpTradingApi.js";
import { HttpSalesApi } from "./infrastructure/api/HttpSalesApi.js";
import { HttpBalanceApi } from "./infrastructure/api/HttpBalanceApi.js";
import { HttpNotificationsApi } from "./infrastructure/api/HttpNotificationsApi.js";
import { HttpWalletApi } from "./infrastructure/api/HttpWalletApi.js";
import { fetchServerStatus } from "./infrastructure/api/fetchServerStatus.js";
import { WebSocketConnection } from "./infrastructure/realtime/WebSocketConnection.js";
import { RemoteDeckRepository } from "./infrastructure/api/RemoteDeckRepository.js";
import { FetchContentSource } from "./infrastructure/config/FetchContentSource.js";
import { loadBrowserImage, scaledImageLoader } from "./infrastructure/images/loadBrowserImage.js";
import { ConsoleLogger } from "./infrastructure/logging/ConsoleLogger.js";
import { InMemoryStore } from "./infrastructure/persistence/InMemoryStore.js";
import { LocalStorageStore } from "./infrastructure/persistence/LocalStorageStore.js";
import { StoredDeckRepository } from "./infrastructure/persistence/StoredDeckRepository.js";
import { StoredSignIn } from "./infrastructure/persistence/StoredSignIn.js";
import { createSeed } from "./infrastructure/random/seedProvider.js";
import { browserScheduler } from "./infrastructure/time/BrowserScheduler.js";
import { KeychainWalletConnector } from "./infrastructure/wallet/KeychainWalletConnector.js";
import { KeyVault } from "./infrastructure/wallet/KeyVault.js";
import { LocalKeyWallet } from "./infrastructure/wallet/LocalKeyWallet.js";
import { InputManager } from "./input/InputManager.js";
import { CanvasHost } from "./rendering/canvas/CanvasHost.js";
import { GameLoop } from "./rendering/canvas/GameLoop.js";
import { Viewport } from "./rendering/canvas/Viewport.js";
import { TextField } from "./rendering/ui/TextField.js";
import { ErrorScene } from "./rendering/scenes/ErrorScene.js";
import { SceneManager } from "./rendering/scenes/SceneManager.js";
import { registerScenes } from "./rendering/scenes/registerScenes.js";
import { SceneId } from "./rendering/scenes/sceneIds.js";
import { CardIllustrations } from "./rendering/cards/CardIllustrations.js";
import { CoinArt } from "./rendering/board/CoinArt.js";
import { TableArt, TablePiece } from "./rendering/images/TableArt.js";
import { UiArt, UiPiece } from "./rendering/images/UiArt.js";
import { Avatars } from "./rendering/images/Avatars.js";
import { Glimmer } from "./rendering/ui/Glimmer.js";
import { Storm } from "./rendering/ui/Storm.js";
import { ToastLayer } from "./rendering/ui/ToastLayer.js";
import { MusicDirector } from "./rendering/audio/MusicDirector.js";
import { soundOnline, soundSales, soundShop } from "./rendering/audio/serviceSounds.js";
import { validateTheme } from "./rendering/theme/Theme.js";
import { LoadingScreen } from "./rendering/page/LoadingScreen.js";
import { MaintenanceBanner } from "./rendering/page/MaintenanceBanner.js";
import { FieldInputs } from "./rendering/page/FieldInputs.js";
import { describeBanner } from "./application/maintenance/MaintenanceNotice.js";
import { MaintenanceWatch } from "./application/maintenance/MaintenanceWatch.js";
import { registerServiceWorker } from "./infrastructure/pwa/registerServiceWorker.js";
import { RELEASE } from "./release.js";

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
  rarities: "data/economy/rarities.json",
  illustrations: "data/art/illustrations.json",
});
/** Where the illustration files named in data/art/illustrations.json live. */
const ART_DIRECTORY = "data/art/";
/** Notifications after which the player's wallet holds a different amount. */
const WALLET_CHANGING_KINDS = Object.freeze(["shop.fulfilled", "sale.sold", "sale.bought"]);
/**
 * On a phone, card illustrations are kept this wide (enough for the largest
 * card it shows, at twice its pixel density), and fetched as cards are shown
 * rather than all at start-up: the full set is tens of megabytes to download
 * and hundreds to hold decoded.
 */
const PHONE_ILLUSTRATION_WIDTH = 512;
/**
 * The longest the loading screen waits for the first screen's painted art
 * once the game is ready: past it the menu shows, drawn procedurally until
 * its images arrive.
 */
const FIRST_SCREEN_ART_WAIT_MS = 8000;
/** How often the maintenance countdown moves. */
const MAINTENANCE_TICK_MS = 1000;
/** How often the page asks again, for tabs without a realtime connection (signed out) and pushes that went missing. */
const SERVER_STATUS_POLL_MS = 60_000;
/**
 * The painted coin of the opening toss: one image per face (1024², the coin
 * seen slightly from above with its rim painted beneath), and where the face
 * sits in them, as fractions of the image.
 */
const COIN_ART = Object.freeze({
  files: Object.freeze({ [CoinFace.HEADS]: "coin_testa.png", [CoinFace.TAILS]: "coin_croce.png" }),
  disc: Object.freeze({ x: 0.5, y: 0.465, radius: 0.36 }),
});

/** The painted table, in ART_DIRECTORY: the match mat, the card back (portrait, near card proportions) and the panel stone. */
const TABLE_ART_FILES = Object.freeze({ [TablePiece.MAT]: "Tappeto.jpg", [TablePiece.CARD_BACK]: "Dorso.jpg", [TablePiece.PANEL]: "Texture.jpg" });
/**
 * The painted menus, in ART_DIRECTORY (gold on black, 1168×784 or 784×1168),
 * and where things are in each image, as fractions of it (measured on these
 * files: regenerating one means measuring it again).
 */
const UI_ART = Object.freeze({
  files: Object.freeze({
    [UiPiece.BACKDROP]: "Sfondo_Menu.jpg",
    [UiPiece.CORNER]: "Angolo_decorativo_pannelli.jpg",
    [UiPiece.DIVIDER]: "DIVISORE_TITOLI.jpg",
    [UiPiece.BUTTON_PRIMARY]: "BOTTONE_PRIMARIO.jpg",
    [UiPiece.BUTTON_SECONDARY]: "BOTTONE_SECONDARIO.jpg",
    // Cut out on transparency (1100×663), not gold on black: the name, "Trading card game" and their scrolls.
    [UiPiece.TITLE]: "Logo_KIJAM.webp",
  }),
  layout: Object.freeze({
    title: Object.freeze({ top: 0.39, bottom: 0.72, stops: Object.freeze([0.083, 0.285, 0.39, 0.479, 0.68, 0.93]), star: Object.freeze({ x: 0.4943, y: 0.2905 }) }),
    corner: Object.freeze({ extent: Object.freeze({ x: 0.0485, y: 0.0274, width: 0.8954, height: 0.9015 }), lines: Object.freeze({ x: 0.1046, y: 0.0702 }) }),
    divider: Object.freeze({ x: 0.1678, y: 0.1684, width: 0.6644, height: 0.6531 }),
    buttons: Object.freeze({
      primary: Object.freeze({ plate: Object.freeze({ x: 0.0248, y: 0.2653, width: 0.9503, height: 0.4349 }), caps: Object.freeze({ left: 0.2351, right: 0.2369 }), radius: 0.235 }),
      secondary: Object.freeze({ plate: Object.freeze({ x: 0.0411, y: 0.2857, width: 0.9178, height: 0.4145 }), caps: Object.freeze({ left: 0.2071, right: 0.208 }), radius: 0.209 }),
    }),
  }),
});

/**
 * The storm clouds painted in the menu backdrop (Sfondo_Menu.jpg), one in
 * each corner, with the lightning crossing them: where each lies (fractions
 * of the image), the way its painted bolts run (degrees, 90 straight down)
 * and how far (a fraction of the image's width). Measured on the file, like UI_ART.
 */
const STORM_CELLS = Object.freeze([
  Object.freeze({ x: 0.31, y: 0.17, angle: 132, length: 0.2 }),
  Object.freeze({ x: 0.68, y: 0.17, angle: 44, length: 0.2 }),
  Object.freeze({ x: 0.32, y: 0.79, angle: 43, length: 0.2 }),
  Object.freeze({ x: 0.67, y: 0.82, angle: 139, length: 0.2 }),
]);
/** The gold figures on the same backdrop's rim, which gleam when lightning strikes near them: centre and radius, as fractions of the image (its width, for the radius). */
const STORM_FIGURES = Object.freeze([
  Object.freeze({ x: 0.094, y: 0.135, radius: 0.12 }),
  Object.freeze({ x: 0.906, y: 0.135, radius: 0.12 }),
  Object.freeze({ x: 0.094, y: 0.865, radius: 0.12 }),
  Object.freeze({ x: 0.906, y: 0.865, radius: 0.12 }),
  Object.freeze({ x: 0.03, y: 0.49, radius: 0.12 }),
  Object.freeze({ x: 0.97, y: 0.49, radius: 0.12 }),
  Object.freeze({ x: 0.5, y: 0.96, radius: 0.09 }),
]);
/**
 * The gold figures on the same backdrop that shine with their own light: the
 * medallions of the top corners and of the sides, and the stars of the
 * bottom corners — each the star at its heart (fractions of the image) and
 * how far its glow reaches (a fraction of the image's width).
 */
const GLIMMER_FIGURES = Object.freeze([
  Object.freeze({ x: 0.11, y: 0.169, radius: 0.1 }),
  Object.freeze({ x: 0.889, y: 0.17, radius: 0.1 }),
  Object.freeze({ x: 0.014, y: 0.492, radius: 0.13 }),
  Object.freeze({ x: 0.984, y: 0.492, radius: 0.13 }),
  Object.freeze({ x: 0.11, y: 0.826, radius: 0.06 }),
  Object.freeze({ x: 0.889, y: 0.826, radius: 0.06 }),
]);

/**
 * The background music, in AUDIO_DIRECTORY: one looped file per MusicTrack
 * (the same file for both keeps one track playing throughout). MP3 or OGG,
 * at most 5 MB (the server's limit for a file), made to loop seamlessly.
 */
const AUDIO_DIRECTORY = "data/audio/";
const MUSIC_FILES = Object.freeze({ [MusicTrack.MENU]: "background_music.mp3", [MusicTrack.MATCH]: "background_music.mp3" });

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
/** Shown by the page itself before any script ran; lifted when the main menu is ready, or for the error screen. */
const loading = new LoadingScreen(document, window);

/**
 * Built once; a fatal error after start-up reuses it instead of attaching a
 * second canvas host and input manager to the same element.
 * @type {{ sceneManager: SceneManager, loop: GameLoop, viewport: Viewport, restart: () => void } | null}
 */
let presentation = null;
let fatalShown = false;

/**
 * @param {import("./rendering/theme/Theme.js").Theme} theme
 * @param {import("./rendering/scenes/Scene.js").SoundPlayer} [sound] the game's sound (none on the error screen shown before it exists)
 * @returns {{ sceneManager: SceneManager, loop: GameLoop, viewport: Viewport, restart: () => void }}
 */
function buildPresentation(theme, sound) {
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
  // Played by touch, each text field on screen is a real input laid over it: tapped, it opens the phone's own keyboard.
  const fieldInputs = new FieldInputs(document, {
    onChange: () => loop.requestRender(),
    onFocus: (field) => sceneManager.current?.focus(field),
    focusedField: () => {
      const node = sceneManager.current?.focusedNode ?? null;
      return node instanceof TextField ? node : null;
    },
  });
  const touchFirst = isTouchFirst();
  // Opened from a click or a key press, so the browser does not take it for a popup.
  const openLink = (/** @type {string} */ url) => void window.open(url, "_blank", "noopener,noreferrer");
  const sceneManager = new SceneManager({ theme, viewport, logger, requestRender: () => loop.requestRender(), touchFirst, sound, openLink });
  const host = new CanvasHost({
    canvas,
    viewport,
    window,
    onResize: () => {
      sceneManager.resize();
      loop.requestRender();
    },
    insets: readSafeArea,
  });
  const input = new InputManager({ canvas, window, viewport, target: sceneManager });
  host.attach();
  input.attach();
  // A tap on the game, away from the inputs, puts the keyboard away once the tap has done what it does.
  window.addEventListener("pointerup", (event) => {
    if (event.target === canvas) {
      fieldInputs.blur();
    }
  });
  const target = {
    update: (dt) => {
      const scene = sceneManager.update(dt);
      // The lights in the menu backdrop keep their own time, whatever the scene does.
      return (theme.ambience ?? []).reduce((wanted, light) => light.update(dt) || wanted, scene);
    },
    render: () => {
      const context = host.context;
      const { cssWidth, cssHeight } = viewport.letterbox;
      context.setTransform(viewport.devicePixelRatio, 0, 0, viewport.devicePixelRatio, 0, 0);
      context.fillStyle = theme.colors.letterbox;
      context.fillRect(0, 0, cssWidth, cssHeight);
      viewport.applyTransform(context);
      sceneManager.render(context);
      fieldInputs.sync(placeFields(sceneManager.textFields(), viewport));
    },
    onError: (error) => showFatal("Unexpected error", describeError(error)),
  };
  loop.start(target);
  presentation = { sceneManager, loop, viewport, restart: () => loop.start(target) };
  return presentation;
}

/**
 * Where each text field is on the page, in CSS pixels: the canvas fills the window from its top-left corner.
 * @param {readonly TextField[]} fields
 * @param {Viewport} viewport
 * @returns {import("./rendering/page/FieldInputs.js").FieldPlacement[]}
 */
function placeFields(fields, viewport) {
  return fields.map((field) => {
    const { x, y, width, height } = field.bounds;
    const corner = viewport.toCss(x, y);
    return Object.freeze({ field, x: corner.x, y: corner.y, width: width * viewport.scale, height: height * viewport.scale, scale: viewport.scale });
  });
}

/**
 * The screen's unsafe edges (a notch, rounded corners, the home indicator),
 * in CSS pixels: the padding index.html gives #safe-area from env(safe-area-inset-*).
 * @returns {{ top: number, right: number, bottom: number, left: number }}
 */
function readSafeArea() {
  const probe = document.getElementById("safe-area");
  if (probe === null) {
    return { top: 0, right: 0, bottom: 0, left: 0 };
  }
  const style = window.getComputedStyle(probe);
  return { top: parseFloat(style.paddingTop) || 0, right: parseFloat(style.paddingRight) || 0, bottom: parseFloat(style.paddingBottom) || 0, left: parseFloat(style.paddingLeft) || 0 };
}

/** Whether the device is mainly played by touch (a phone, a tablet). */
function isTouchFirst() {
  return window.matchMedia?.("(pointer: coarse)").matches === true;
}

/**
 * The canvas draws the game's name in a fallback face until its own (fonts/)
 * is loaded: then it is drawn again, in it.
 * @param {string} family
 * @param {() => void} redraw
 */
function redrawWithTitleFont(family, redraw) {
  document.fonts?.load(`900 72px ${family}`).then(redraw, (error) => logger.warn("title font unavailable", describeError(error)));
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
  loading.finish();
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
  const httpFetch = (url, init) => fetch(url, init);
  const source = new FetchContentSource(CONTENT_MANIFEST, httpFetch);
  const localStore = new LocalStorageStore(globalThis.localStorage);
  const storageAvailable = localStore.isAvailable();
  const keychain = new KeychainWalletConnector({
    locate: () => globalThis.steem_keychain,
    timers: { setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms), clearTimeout: (id) => globalThis.clearTimeout(id) },
  });
  const { activeKeys, keys, signIns } = buildLocalKeys(localStore, storageAvailable, httpFetch);
  const identity = new IdentityService({ api: new HttpAuthApi({ fetch: httpFetch }), wallet: keychain, keys, record: signIns });
  // Games, the shop and the market sign with whichever the player signed in with.
  const wallet = new WalletSwitch({ identity, keychain, keys });
  // The painted table and menus are downloaded alongside the content: the first screen waits for them.
  const { coinArt, tableArt, uiArt } = buildPaintedArt();
  const firstScreenArt = Promise.all([loading.track(uiArt.preload()), loading.track(tableArt.preload())]);
  loading.say("Shuffling the decks…");
  const track = loading.track.bind(loading);
  const [rawTheme, content, rawRarities, rawIllustrations] = await Promise.all([track(source.load("theme")), track(loadContent(source, createCoreEffectRegistry())), track(source.load("rarities")), track(source.load("illustrations")), track(identity.restore())]);
  loading.say("Gilding the table…");
  if (!content.ok) {
    showFatal("Content failed to load", content.error.message);
    return;
  }
  const theme = rawTheme.ok ? validateTheme(rawTheme.value) : rawTheme;
  if (!theme.ok) {
    showFatal("Theme failed to load", theme.error.message);
    return;
  }

  // Rarity is shown on every card; without the file the game still runs, rarities unknown.
  const builtRarities = rawRarities.ok ? buildCardRarities(rawRarities.value, content.value.catalog) : { ok: /** @type {const} */ (false), message: rawRarities.error.message };
  if (!builtRarities.ok) {
    logger.warn("card rarities unavailable", builtRarities.message);
  }
  const rarities = builtRarities.ok ? { rarities: builtRarities.value } : {};

  // Painted card art: cards without it (or whose image fails) keep their procedural art.
  const illustrations = buildIllustrations(rawIllustrations, content.value.catalog);

  if (!storageAvailable) {
    logger.warn("local storage unavailable; decks will not persist");
  }
  const audio = buildAudio(localStore, storageAvailable);
  const help = buildHelp(localStore, storageAvailable);
  const browserDecks = new StoredDeckRepository({ store: storageAvailable ? localStore : new InMemoryStore(), logger });
  // Signed in, decks live in the account (only owned cards); otherwise in this browser.
  const collectionApi = new HttpCollectionApi({ fetch: httpFetch });
  const collection = new CollectionService({ api: collectionApi });
  const accountDecks = new RemoteDeckRepository({ api: collectionApi });
  const repository = new AccountDeckRepository({ identity, account: accountDecks, browser: browserDecks });
  const deckBuilding = new DeckBuildingService({ content: content.value, repository, ownership: () => collection.ownedCounts() });
  const account = new AccountService({ identity, collection, decks: accountDecks, deckBuilding, logger });
  account.start();
  const shop = new ShopService({ api: new HttpMarketApi({ fetch: httpFetch }), wallet, account, scheduler: browserScheduler, newKey: () => crypto.randomUUID() });
  const timers = { setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms), clearTimeout: (handle) => globalThis.clearTimeout(handle) };
  // One realtime connection per signed-in player, shared by online play and notifications.
  const realtime = new WebSocketConnection({ url: `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`, createSocket: (url) => new WebSocket(url), timers });
  maintenance.follow(realtime);
  const online = new OnlineService({
    connection: realtime,
    randomHex: (bytes) => Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (byte) => byte.toString(16).padStart(2, "0")).join(""),
    newCommandId: () => crypto.randomUUID(),
    // The account's decks as the server judged them (ownership included).
    accountDecks: () =>
      accountDecks.list().value.flatMap((deck) => {
        const ref = accountDecks.describe(deck.id);
        return ref === undefined ? [] : [{ id: ref.serverId, name: deck.name, mix: deckMix(content.value, deck.entries), totalCards: deck.totalCards, playable: ref.playable, problem: ref.problems[0]?.message ?? null }];
      }),
    liveGames: new HttpLiveGamesApi({ fetch: httpFetch }),
    // Signed moves (docs/tcg/12): a key per game that cannot leave the browser, authorised with Keychain.
    sessionKeys: new WebCryptoSessionKeys({ subtle: crypto.subtle }),
    wallet,
    // Signed acks, checked on arrival and kept as proof of what the server accepted (docs/tcg/11).
    receipts: new AckReceipts({
      store: storageAvailable ? localStore : new InMemoryStore(),
      verify: verifySignedAck,
      logger,
    }),
    logger,
  });
  // Who else is online, and challenges: heard on any screen once signed in.
  const lobby = new LobbyService({ connection: realtime, scheduler: browserScheduler, now: () => Date.now(), logger });
  const ranking = new RankingService({ api: new HttpRankingApi({ fetch: httpFetch }) });
  // The ranked season's jackpot: public, shown signed out too, read again every minute while on screen.
  const jackpot = new JackpotService({ api: new HttpJackpotApi({ fetch: httpFetch }), scheduler: browserScheduler, now: () => Date.now() });
  // Ranked entries, bought in the shop: read again once a purchase of them is done, and by the lobby.
  const entries = new EntryService({ api: new HttpEntriesApi({ fetch: httpFetch }) });
  refreshWhenPaid(shop, (state) => state.purchase.stage === PurchaseStage.DONE, entries);
  // Trades move copies between collections: the account reloads after each one.
  const trading = new TradingService({ api: new HttpTradingApi({ fetch: httpFetch }), newKey: () => crypto.randomUUID(), scheduler: browserScheduler, onCollectionChanged: () => account.refresh() });
  // The player market: payments go from the buyer's wallet straight to the seller; the collection reloads when a card moves.
  const sales = new SalesService({ api: new HttpSalesApi({ fetch: httpFetch }), wallet, account, scheduler: browserScheduler, newKey: () => crypto.randomUUID(), onCollectionChanged: () => account.refresh(), connection: realtime });
  // The player's budget where they buy: read from their wallet on the chain, again once a payment is sent.
  const balance = new BalanceService({ api: new HttpBalanceApi({ fetch: httpFetch }) });
  refreshWhenPaid(shop, (state) => state.purchase.stage === PurchaseStage.CONFIRMING, balance);
  refreshWhenPaid(sales, (state) => state.buying.stage === BuyStage.CONFIRMING, balance);
  // A purchase, a connection and a standing belong to the account that started them.
  // What happened to the player's orders, trades and sales: read at sign-in, pushed while here.
  const notifications = new NotificationService({ api: new HttpNotificationsApi({ fetch: httpFetch }), connection: realtime, logger });
  account.subscribe((state) => {
    if (state.status === AccountStatus.READY) {
      notifications.start();
      lobby.start();
      // A challenge can be accepted while the player is on another screen: the game must reach them there.
      online.start();
    }
    if (state.account === null) {
      notifications.stop();
      lobby.stop();
      shop.dismiss();
      online.stop();
      ranking.reset();
      entries.reset();
      trading.reset();
      sales.reset();
      balance.reset();
    }
  });

  const matchSetup = new MatchSetupService({ content: content.value, effects: createCoreEffectRegistry(), scheduler: browserScheduler, logger });
  /** @type {import("./application/AppContext.js").AppContext} */
  const app = Object.freeze({
    content: content.value,
    // Signed in, the player's decks are the account's; the preconstructed ones are offline practice only.
    deckSelection: new DeckSelectionService({ content: content.value, repository, logger, showPreconstructed: () => repository.storage === DeckStorage.BROWSER }),
    deckBuilding,
    matchSetup,
    tutorial: new TutorialService({ matchSetup, content: content.value }),
    createSeed,
    logger,
    environment: Object.freeze({ version: ENGINE_VERSION, release: describeRelease(RELEASE), storage: storageAvailable ? "local" : "memory" }),
    identity,
    account,
    shop,
    balance,
    activeKeys,
    online,
    lobby,
    ranking,
    gameHistory: new HttpGameHistoryApi({ fetch: httpFetch }),
    jackpot,
    entries,
    trading,
    sales,
    notifications,
    audio,
    help,
    ...rarities,
  });

  // Players' STEEM profile pictures; a player is drawn as their initial until theirs is ready.
  const avatars = new Avatars({ loadImage: loadBrowserImage, onLoaded: () => presentation?.loop.requestRender(), logger });
  // The menu backdrop lives: its gold figures shine now and then, and a bolt painted in it wakes every so often, as a storm still on its way.
  const ambience = Object.freeze([
    new Glimmer({ figures: GLIMMER_FIGURES, seed: createSeed() }),
    new Storm({ cells: STORM_CELLS, figures: STORM_FIGURES, seed: createSeed() }),
  ]);
  const { sceneManager, loop, viewport } = buildPresentation(Object.freeze({ ...theme.value, illustrations, coinArt, tableArt, uiArt, avatars, ambience }), audio);
  registerScenes(sceneManager, app);
  redrawWithTitleFont(theme.value.fonts.titleFamily, () => loop.requestRender());
  // The menus have their music, a match its own; what the services do is heard on any screen.
  const music = new MusicDirector({ audio, tracks: { [SceneId.MATCH]: MusicTrack.MATCH, [SceneId.ERROR]: null }, fallback: MusicTrack.MENU });
  music.follow(sceneManager);
  soundShop(shop, audio);
  soundSales(sales, audio);
  soundOnline(online, audio);
  // A notification that arrives shows as a toast on any screen; a click opens the feed (or the lobby, for a challenge).
  const toasts = new ToastLayer({ viewport, onOpen: (message) => sceneManager.navigate(message.opens ?? SceneId.NOTIFICATIONS), requestRender: () => loop.requestRender(), sound: audio });
  sceneManager.setOverlay(toasts);
  // A challenge that arrives has a call of its own: it must be answered within a minute.
  lobby.onEvent((event) => toasts.show({ ...describeLobbyEvent(event), opens: SceneId.ONLINE, ...(event.kind === "received" ? { cue: SoundCue.CHALLENGE } : {}) }));
  // A game found while the player is elsewhere (their challenge was accepted): the lobby shows it and asks Keychain to accept it.
  let onlineStatus = online.state.status;
  online.subscribe((state) => {
    if (state.status === OnlineStatus.MATCHED && onlineStatus !== OnlineStatus.MATCHED && sceneManager.currentId !== SceneId.ONLINE && sceneManager.currentId !== SceneId.MATCH) {
      sceneManager.navigate(SceneId.ONLINE);
    }
    onlineStatus = state.status;
  });
  notifications.onArrival((notification) => {
    toasts.show(describeNotification(notification, content.value.catalog));
    if (COLLECTION_CHANGING_KINDS.includes(notification.kind)) {
      account.refresh();
    }
    // A purchase is final, or a buyer paid the player: the wallet changed too.
    if (WALLET_CHANGING_KINDS.includes(notification.kind)) {
      void balance.refresh();
    }
    if (notification.kind === "shop.fulfilled" && Array.isArray(notification.data.entries) && notification.data.entries.length > 0) {
      void entries.refresh();
    }
  });
  sceneManager.navigate(SceneId.MAIN_MENU);
  preloadArt({ illustrations, coinArt });
  // The menu is lifted into view painted, unless its art is slow to come: then it shows procedurally rather than keep the player waiting.
  await Promise.race([firstScreenArt, new Promise((resolve) => window.setTimeout(resolve, FIRST_SCREEN_ART_WAIT_MS))]);
  loading.finish();
}

/**
 * The painted art that does not depend on the content, made at once so its
 * download starts with the content's.
 */
function buildPaintedArt() {
  const urlsIn = (files) => Object.fromEntries(Object.entries(files).map(([key, file]) => [key, `${ART_DIRECTORY}${file}`]));
  const onLoaded = () => presentation?.loop.requestRender();
  return {
    // The painted coin of the opening toss; a face whose image is not ready is drawn procedurally.
    coinArt: new CoinArt({ urls: urlsIn(COIN_ART.files), disc: COIN_ART.disc, loadImage: loadBrowserImage, onLoaded, logger }),
    // The mat, the card back and the panel stone; a piece whose image is not ready is drawn procedurally.
    tableArt: new TableArt({ urls: urlsIn(TABLE_ART_FILES), loadImage: loadBrowserImage, onLoaded, logger }),
    // The menu backdrop, panel corners, divider medallion and button plates; drawn procedurally until ready.
    uiArt: new UiArt({ urls: urlsIn(UI_ART.files), layout: UI_ART.layout, loadImage: loadBrowserImage, onLoaded, logger }),
  };
}

/**
 * The player's own keys, the other way to sign besides Keychain
 * (docs/tcg/20-chiavi.md): the posting key kept encrypted in local storage,
 * the active key asked for (`activeKeys`, shown by the screens that take
 * payments) when a payment needs it; and how the player signed in
 * (`signIns`), kept beside the key, so a reload signs as the session was
 * opened, never the other way.
 * @param {LocalStorageStore} localStore
 * @param {boolean} storageAvailable without it, a key lasts only as long as the page
 * @param {typeof fetch} httpFetch
 */
function buildLocalKeys(localStore, storageAvailable, httpFetch) {
  const store = storageAvailable ? localStore : new InMemoryStore();
  const activeKeys = new ActiveKeyPrompt();
  const keys = new LocalKeyWallet({
    vault: new KeyVault({ store, subtle: crypto.subtle, randomBytes: (length) => crypto.getRandomValues(new Uint8Array(length)) }),
    api: new HttpWalletApi({ fetch: httpFetch }),
    prompt: activeKeys,
  });
  return { activeKeys, keys, signIns: new StoredSignIn({ store }) };
}

/**
 * The match help: on until the player turns it off, remembered in `store`.
 * @param {LocalStorageStore} localStore
 * @param {boolean} storageAvailable without it, the choice lasts only as long as the page
 */
function buildHelp(localStore, storageAvailable) {
  const store = storageAvailable ? localStore : new InMemoryStore();
  return new HelpSettings({ preferences: new StoredHelpPreferences({ store, logger }) });
}

/**
 * The game's sound: effects synthesised in the browser, the music from
 * AUDIO_DIRECTORY, the player's levels kept in `store`. Sound starts on the
 * player's first gesture (browsers allow nothing sooner) and pauses while
 * the page is hidden.
 * @param {LocalStorageStore} localStore
 * @param {boolean} storageAvailable without it, the levels last only as long as the page
 */
function buildAudio(localStore, storageAvailable) {
  const store = storageAvailable ? localStore : new InMemoryStore();
  const output = new WebAudioOutput({
    createContext: () => createBrowserAudioContext(window),
    bank: createCoreSoundBank(),
    music: {
      urls: Object.fromEntries(Object.entries(MUSIC_FILES).map(([track, file]) => [track, `${AUDIO_DIRECTORY}${file}`])),
      load: async (url) => {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return response.arrayBuffer();
      },
    },
    logger,
  });
  unlockOnGesture(window, output);
  followVisibility(document, output);
  return new AudioService({ output, preferences: new StoredAudioPreferences({ store, logger }), now: () => performance.now(), logger });
}

/**
 * Starts fetching the rest of the painted art in the background (the table and the menus are already on their way).
 * @param {{ illustrations: CardIllustrations, coinArt: CoinArt }} art
 */
function preloadArt({ illustrations, coinArt }) {
  // Fetched in the background so cards rarely appear procedural first; each one redraws as it arrives.
  // A phone fetches each as its card is first shown instead (PHONE_ILLUSTRATION_WIDTH).
  if (!isTouchFirst()) {
    void illustrations.preload(illustrations.cardIds);
  }
  // Ready before the first match, so the coin is the painted one from its first frame.
  void coinArt.preload();
}

/**
 * Reads something again (the wallet, the entries) each time a purchase reaches a stage: its payment sent, its order done.
 * @template S
 * @param {{ state: S, subscribe: (listener: (state: S) => void) => unknown }} service
 * @param {(state: S) => boolean} paid
 * @param {{ refresh: () => Promise<unknown> }} balance
 */
function refreshWhenPaid(service, paid, balance) {
  let wasPaid = paid(service.state);
  service.subscribe((state) => {
    const isPaid = paid(state);
    if (isPaid && !wasPaid) {
      void balance.refresh();
    }
    wasPaid = isPaid;
  });
}

/**
 * @param {import("@magic8/engine/shared/Result.js").Ok<unknown> | import("@magic8/engine/shared/Result.js").Fail} raw the illustrations file
 * @param {{ has: (cardId: string) => boolean }} catalog
 */
function buildIllustrations(raw, catalog) {
  const built = raw.ok ? buildIllustrationManifest(raw.value, catalog) : { ok: /** @type {const} */ (false), message: raw.error.message };
  if (!built.ok) {
    logger.warn("card illustrations unavailable", built.message);
  } else if (built.value.unknownCards.length > 0) {
    logger.warn("card illustrations for unknown cards ignored", built.value.unknownCards);
  }
  return new CardIllustrations({
    manifest: built.ok ? built.value : NO_ILLUSTRATIONS,
    urlFor: (file) => `${ART_DIRECTORY}${file}`,
    loadImage: isTouchFirst() ? scaledImageLoader(PHONE_ILLUSTRATION_WIDTH) : loadBrowserImage,
    onLoaded: () => presentation?.loop.requestRender(),
    logger,
  });
}

/**
 * @param {Readonly<{ version: string, build: string | null }>} release
 * @returns {string} "v0.2.0 (0253e2b)" as deployed, "v0.2.0 dev" in development
 */
function describeRelease({ version, build }) {
  return build === null ? `v${version} dev` : `v${version} (${build.slice(0, 7)})`;
}

/**
 * The maintenance banner starts on its own, before the game: it shows even
 * when the game fails to start. Read once now, every minute, and whenever the
 * player comes back to the page (a phone may have frozen it for hours);
 * boot() hands it the realtime connection, on which the server pushes every
 * change. It also tells a lost connection, and a newer version than this
 * page's release with a button to update (a reload: the service worker never
 * serves an old version).
 */
function watchMaintenance() {
  const watch = new MaintenanceWatch({ load: () => fetchServerStatus((url, init) => fetch(url, init)), now: () => Date.now(), page: RELEASE });
  const banner = new MaintenanceBanner(document);
  const update = Object.freeze({ label: "Update", onActivate: () => window.location.reload() });
  const render = () => {
    const line = describeBanner(watch, Date.now());
    banner.show(line?.text ?? null, line?.reload ? update : null);
  };
  watch.subscribe(render);
  void watch.refresh();
  window.setInterval(render, MAINTENANCE_TICK_MS);
  window.setInterval(() => void watch.refresh(), SERVER_STATUS_POLL_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      void watch.refresh();
    }
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) {
      void watch.refresh();
    }
  });
  return watch;
}

window.addEventListener("error", (event) => showFatal("Unexpected error", describeError(event.error ?? event.message)));
window.addEventListener("unhandledrejection", (event) => showFatal("Unexpected error", describeError(event.reason)));

const maintenance = watchMaintenance();
void registerServiceWorker(navigator.serviceWorker, logger);
boot().catch((error) => {
  showFatal("Startup failed", describeError(error));
});
