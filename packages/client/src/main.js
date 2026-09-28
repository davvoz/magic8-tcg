/**
 * Composition root: the only module that imports from every layer.
 *
 * Wires infrastructure adapters into application services, builds the
 * rendering/input stack around the canvas, registers scenes and starts the
 * loop. Nothing here contains game logic; if the content or the theme fails
 * validation the ErrorScene explains why instead of a broken screen.
 */
import { ContentResource } from "./application/ports/ContentSource.contract.js";
import { AccountService, AccountStatus } from "./application/account/AccountService.js";
import { CollectionService } from "./application/collection/CollectionService.js";
import { loadContent } from "./application/content/ContentService.js";
import { buildCardRarities } from "./application/content/CardRarities.js";
import { NO_ILLUSTRATIONS, buildIllustrationManifest } from "./application/content/IllustrationManifest.js";
import { COLLECTION_CHANGING_KINDS, describeNotification } from "./application/notifications/describeNotification.js";
import { NotificationService } from "./application/notifications/NotificationService.js";
import { AccountDeckRepository, DeckStorage } from "./application/decks/AccountDeckRepository.js";
import { AckReceipts } from "./application/online/AckReceipts.js";
import { OnlineService } from "./application/online/OnlineService.js";
import { RankingService } from "./application/ranking/RankingService.js";
import { TradingService } from "./application/trading/TradingService.js";
import { SalesService } from "./application/sales/SalesService.js";
import { ShopService } from "./application/shop/ShopService.js";
import { DeckBuildingService } from "./application/decks/DeckBuildingService.js";
import { DeckSelectionService } from "./application/decks/DeckSelectionService.js";
import { IdentityService } from "./application/identity/IdentityService.js";
import { CoinFace } from "./application/match/CoinToss.js";
import { MatchSetupService } from "./application/match/MatchSetupService.js";
import { createCoreEffectRegistry } from "@magic8/engine/domain/effects/registerCoreEffects.js";
import { HttpAuthApi } from "./infrastructure/api/HttpAuthApi.js";
import { HttpCollectionApi } from "./infrastructure/api/HttpCollectionApi.js";
import { HttpMarketApi } from "./infrastructure/api/HttpMarketApi.js";
import { HttpLiveGamesApi } from "./infrastructure/api/HttpLiveGamesApi.js";
import { verifySignedAck } from "./infrastructure/crypto/ackVerifier.js";
import { WebCryptoSessionKeys } from "./infrastructure/crypto/webSessionKeys.js";
import { HttpRankingApi } from "./infrastructure/api/HttpRankingApi.js";
import { HttpTradingApi } from "./infrastructure/api/HttpTradingApi.js";
import { HttpSalesApi } from "./infrastructure/api/HttpSalesApi.js";
import { HttpNotificationsApi } from "./infrastructure/api/HttpNotificationsApi.js";
import { WebSocketConnection } from "./infrastructure/realtime/WebSocketConnection.js";
import { RemoteDeckRepository } from "./infrastructure/api/RemoteDeckRepository.js";
import { FetchContentSource } from "./infrastructure/config/FetchContentSource.js";
import { loadBrowserImage } from "./infrastructure/images/loadBrowserImage.js";
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
import { CardIllustrations } from "./rendering/cards/CardIllustrations.js";
import { CoinArt } from "./rendering/board/CoinArt.js";
import { TableArt, TablePiece } from "./rendering/images/TableArt.js";
import { ToastLayer } from "./rendering/ui/ToastLayer.js";
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
  rarities: "data/economy/rarities.json",
  illustrations: "data/art/illustrations.json",
});
/** Where the illustration files named in data/art/illustrations.json live. */
const ART_DIRECTORY = "data/art/";
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
  const httpFetch = (url, init) => fetch(url, init);
  const source = new FetchContentSource(CONTENT_MANIFEST, httpFetch);
  const wallet = new KeychainWalletConnector({
    locate: () => globalThis.steem_keychain,
    timers: { setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms), clearTimeout: (id) => globalThis.clearTimeout(id) },
  });
  const identity = new IdentityService({ api: new HttpAuthApi({ fetch: httpFetch }), wallet });
  const [rawTheme, content, rawRarities, rawIllustrations] = await Promise.all([source.load("theme"), loadContent(source, createCoreEffectRegistry()), source.load("rarities"), source.load("illustrations"), identity.restore()]);
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
  // The painted coin of the opening toss; a face whose image is not ready is drawn procedurally.
  const coinArt = new CoinArt({
    urls: Object.fromEntries(Object.entries(COIN_ART.files).map(([face, file]) => [face, `${ART_DIRECTORY}${file}`])),
    disc: COIN_ART.disc,
    loadImage: loadBrowserImage,
    onLoaded: () => presentation?.loop.requestRender(),
    logger,
  });
  // The mat, the card back and the panel stone; a piece whose image is not ready is drawn procedurally.
  const tableArt = new TableArt({
    urls: Object.fromEntries(Object.entries(TABLE_ART_FILES).map(([piece, file]) => [piece, `${ART_DIRECTORY}${file}`])),
    loadImage: loadBrowserImage,
    onLoaded: () => presentation?.loop.requestRender(),
    logger,
  });

  const localStore = new LocalStorageStore(globalThis.localStorage);
  const storageAvailable = localStore.isAvailable();
  if (!storageAvailable) {
    logger.warn("local storage unavailable; decks will not persist");
  }
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
  const online = new OnlineService({
    connection: realtime,
    randomHex: (bytes) => Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (byte) => byte.toString(16).padStart(2, "0")).join(""),
    newCommandId: () => crypto.randomUUID(),
    // The account's decks as the server judged them (ownership included).
    accountDecks: () =>
      accountDecks.list().value.flatMap((deck) => {
        const ref = accountDecks.describe(deck.id);
        return ref === undefined ? [] : [{ id: ref.serverId, name: deck.name, faction: deck.faction, totalCards: deck.totalCards, playable: ref.playable, problem: ref.problems[0]?.message ?? null }];
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
  const ranking = new RankingService({ api: new HttpRankingApi({ fetch: httpFetch }) });
  // Trades move copies between collections: the account reloads after each one.
  const trading = new TradingService({ api: new HttpTradingApi({ fetch: httpFetch }), newKey: () => crypto.randomUUID(), scheduler: browserScheduler, onCollectionChanged: () => account.refresh() });
  // The player market: payments go from the buyer's wallet straight to the seller; the collection reloads when a card moves.
  const sales = new SalesService({ api: new HttpSalesApi({ fetch: httpFetch }), wallet, account, scheduler: browserScheduler, newKey: () => crypto.randomUUID(), onCollectionChanged: () => account.refresh(), connection: realtime });
  // A purchase, a connection and a standing belong to the account that started them.
  // What happened to the player's orders, trades and sales: read at sign-in, pushed while here.
  const notifications = new NotificationService({ api: new HttpNotificationsApi({ fetch: httpFetch }), connection: realtime, logger });
  account.subscribe((state) => {
    if (state.status === AccountStatus.READY) {
      notifications.start();
    }
    if (state.account === null) {
      notifications.stop();
      shop.dismiss();
      online.stop();
      ranking.reset();
      trading.reset();
      sales.reset();
    }
  });

  /** @type {import("./application/AppContext.js").AppContext} */
  const app = Object.freeze({
    content: content.value,
    // Signed in, the player's decks are the account's; the preconstructed ones are offline practice only.
    deckSelection: new DeckSelectionService({ content: content.value, repository, logger, showPreconstructed: () => repository.storage === DeckStorage.BROWSER }),
    deckBuilding,
    matchSetup: new MatchSetupService({ content: content.value, effects: createCoreEffectRegistry(), scheduler: browserScheduler, logger }),
    createSeed,
    logger,
    environment: Object.freeze({ version: ENGINE_VERSION, storage: storageAvailable ? "local" : "memory" }),
    identity,
    account,
    shop,
    online,
    ranking,
    trading,
    sales,
    notifications,
    ...rarities,
  });

  const { sceneManager, loop } = buildPresentation(Object.freeze({ ...theme.value, illustrations, coinArt, tableArt }));
  registerScenes(sceneManager, app);
  // A notification that arrives shows as a toast on any screen; a click opens the feed.
  const toasts = new ToastLayer({ viewport: theme.value.layout, onOpen: () => sceneManager.navigate(SceneId.NOTIFICATIONS), requestRender: () => loop.requestRender() });
  sceneManager.setOverlay(toasts);
  notifications.onArrival((notification) => {
    toasts.show(describeNotification(notification, content.value.catalog));
    if (COLLECTION_CHANGING_KINDS.includes(notification.kind)) {
      account.refresh();
    }
  });
  sceneManager.navigate(SceneId.MAIN_MENU);
  // Fetched in the background so cards rarely appear procedural first; each one redraws as it arrives.
  void illustrations.preload(illustrations.cardIds);
  // Ready before the first match, so the coin is the painted one from its first frame.
  void coinArt.preload();
  // Small and seen everywhere (the menu's card fan, every match): fetched straight away.
  void tableArt.preload();
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
    loadImage: loadBrowserImage,
    onLoaded: () => presentation?.loop.requestRender(),
    logger,
  });
}

window.addEventListener("error", (event) => showFatal("Unexpected error", describeError(event.error ?? event.message)));
window.addEventListener("unhandledrejection", (event) => showFatal("Unexpected error", describeError(event.reason)));

boot().catch((error) => {
  showFatal("Startup failed", describeError(error));
});
