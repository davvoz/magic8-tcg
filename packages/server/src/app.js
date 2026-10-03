/**
 * Composition of the server application from its dependencies. Pure wiring:
 * no environment, no timers — main.js supplies the real adapters, an open,
 * migrated database and the raw content; tests supply fakes and a PGlite
 * database. Composing publishes the content (idempotent) and validates the
 * data-driven offers against it, so a bad data file stops the start.
 */
import { createCoreEffectRegistry } from "@magic8/engine/domain/effects/registerCoreEffects.js";
import { ENGINE_VERSION } from "@magic8/engine/version.js";
import { AuditTrail } from "./kernel/audit/AuditTrail.js";
import { hexToBytes, packEpochAnnouncement, sha256Hex, utf8 } from "@magic8/protocol";
import { SecretBox } from "./kernel/crypto/SecretBox.js";
import { unitOfWorkOf } from "./kernel/unitOfWork.js";
import { PgAuditStore } from "./platform/audit/PgAuditStore.js";
import { HttpApp } from "./platform/http/HttpApp.js";
import { RateLimiter } from "./platform/http/RateLimiter.js";
import { Router } from "./platform/http/Router.js";
import { CatalogService, PgContentRepository, registerCatalogRoutes } from "./modules/catalog/index.js";
import { InventoryService, PgInventoryRepository, registerCollectionRoutes } from "./modules/collection/index.js";
import { DeckService, PgDeckRepository, registerDeckRoutes } from "./modules/decks/index.js";
import { EconomyService, formatAmount, parseAmount, validateAssets } from "./modules/economy/index.js";
import { ChainBroadcaster, ChainOutbox, ChainTracker, ManifestWatcher, PUBLICATION_READER_METHODS, PgChainRepository, PgOutboxRepository, RcMonitor, TRANSACTION_PROVIDER_METHODS } from "./modules/chain/index.js";
import { DEFAULT_MARKETPLACE_POLICY, FulfilmentService, MarketplaceService, PackEpochService, PaymentSettlement, PgMarketplaceRepository, buildMarketCatalog, registerMarketplaceRoutes } from "./modules/marketplace/index.js";
import { PAYMENT_PROVIDER_METHODS, PaymentService, PgPaymentRepository, RefundWatcher } from "./modules/payments/index.js";
import { AdminService, Monitor, PgOperationsReadModel, registerAdminRoutes, registerMonitoringRoutes } from "./modules/admin/index.js";
import { GameService, PgGameRepository, registerGameMessages, registerGameRoutes } from "./modules/gameplay/index.js";
import { MatchmakingService, PgMatchmakingRepository, registerQueueMessages } from "./modules/matchmaking/index.js";
import { LobbyService, registerLobbyMessages } from "./modules/lobby/index.js";
import { PgRankingRepository, RankingService, registerRankingRoutes, validateRankedSettings } from "./modules/ranking/index.js";
import { JackpotService, PgJackpotRepository, PrizePayoutWatcher, registerJackpotRoutes, validatePrizePools } from "./modules/jackpot/index.js";
import { PgTradeRepository, TradeService, registerTradeRoutes } from "./modules/trading/index.js";
import { BoardRelay, PgSalesRepository, SaleSettlement, SalesService, registerSalesRoutes } from "./modules/sales/index.js";
import { NotificationRelay, NotificationService, PgNotificationRepository, registerNotificationRoutes } from "./modules/notifications/index.js";
import { MaintenanceService, PgMaintenanceRepository, registerMaintenanceRoutes } from "./modules/maintenance/index.js";
import { MessageRouter } from "./platform/realtime/MessageRouter.js";
import { WebSocketGateway } from "./platform/realtime/WebSocketGateway.js";
import { presenceHandler, registerSessionMessages } from "./realtimeSession.js";
import { ConnectionHub } from "./platform/realtime/ConnectionHub.js";
import { assertImplements } from "./kernel/contracts.js";
import { AuthService, PgChallengeRepository, PgSessionRepository, PgUserRepository, SessionKeyAuditor, identityPolicy, registerIdentityRoutes } from "./modules/identity/index.js";
import { StarterService, registerStarterRoutes, validateStarterOffer } from "./modules/onboarding/index.js";

/**
 * @param {{
 *   config: ReturnType<typeof import("./config.js").loadConfig>,
 *   clock: import("./kernel/time.js").Clock,
 *   random: import("./kernel/random.js").SecureRandom,
 *   logger: import("./kernel/logger.js").Logger,
 *   wallets: ReadonlyMap<string, import("./modules/identity/application/ports.js").WalletProvider>,
 *   paymentProviders: ReadonlyMap<string, import("./modules/payments/application/ports.js").PaymentProvider>,
 *   defaultNetwork: string,
 *   database: import("./platform/db/Database.js").Database,
 *   content: Awaited<ReturnType<typeof import("./contentFiles.js").readServerContent>>,
 *   staticFiles?: import("./platform/http/HttpApp.js").StaticHandler | null,
 *   identityPolicyOverrides?: Parameters<typeof identityPolicy>[0],
 *   marketplacePolicy?: Partial<typeof DEFAULT_MARKETPLACE_POLICY>,
 *   salesPolicy?: Partial<typeof import("./modules/sales/index.js").DEFAULT_SALES_POLICY>,
 *   timePolicy?: Partial<import("./modules/gameplay/domain/TurnClock.js").TimePolicy>,
 *   lobbyPolicy?: Partial<typeof import("./modules/lobby/index.js").DEFAULT_LOBBY_POLICY>,
 *   publishing?: { transactions: import("./modules/chain/application/ports.js").TransactionProvider, reader: import("./modules/chain/application/ports.js").PublicationReader } | null,
 *   alarmPolicy?: Partial<typeof import("./modules/admin/index.js").DEFAULT_ALARM_POLICY>,
 *   chainPolicies?: { broadcast?: object, tracker?: object, rc?: object },
 *   ackSigner?: import("./modules/gameplay/application/ports.js").AckSigner | null,
 *   verifyMoveSignature?: (message: string, signature: string, sessionKey: string) => boolean,
 *   version?: string | null,
 * }} deps `verifyMoveSignature` (P-256) is needed for games in protocol v2; `version`: the product's (root package.json)
 */
export async function createServerApp(deps) {
  const { config, clock, random, logger, wallets, paymentProviders, defaultNetwork, database, content } = deps;
  const { staticFiles, publishing, ackSigner, verifyMoveSignature, version } = optionalAdapters(deps);
  const { identityPolicyOverrides, marketplacePolicy, salesPolicy, timePolicy, chainPolicies, alarmPolicy, lobbyPolicy } = policiesOf(deps);
  const unitOfWork = unitOfWorkOf(database);
  const audit = new AuditTrail({ store: new PgAuditStore(database), clock });

  const users = new PgUserRepository(database);
  const challenges = new PgChallengeRepository(database);
  const sessions = new PgSessionRepository(database);
  const auth = new AuthService({ wallets, defaultNetwork, users, challenges, sessions, audit, clock, random, policy: identityPolicy(identityPolicyOverrides), unitOfWork });
  const keyAuditor = new SessionKeyAuditor({ wallets, users, sessions, audit, clock, unitOfWork });

  const catalog = new CatalogService({ repository: new PgContentRepository(database) });
  const published = await catalog.publish({ raw: content.raw, effects: createCoreEffectRegistry(), engineVersion: ENGINE_VERSION });
  const offer = validateStarterOffer(content.starterOffer, published.content);
  if (!offer.ok) {
    throw new Error(`starter offer is invalid: ${offer.error.message}`);
  }
  const currentContent = () => catalog.current().content;
  const inventory = new InventoryService({ repository: new PgInventoryRepository(database), isKnownCard: (id) => currentContent().catalog.has(id), random, clock, unitOfWork });
  const decks = new DeckService({ repository: new PgDeckRepository(database), ownedCards: (userId) => inventory.activeCounts(userId), content: currentContent, random, clock, unitOfWork });
  const starters = new StarterService({ offer: offer.value, inventory, decks, audit, unitOfWork });

  for (const provider of paymentProviders.values()) {
    assertImplements(provider, PAYMENT_PROVIDER_METHODS, "PaymentProvider");
  }
  const assets = validateAssets(content.assets, (network) => paymentProviders.get(network)?.supportedAssets() ?? []);
  if (!assets.ok) {
    throw new Error(`accepted assets are invalid: ${assets.error.message}`);
  }
  const market = buildMarketCatalog(content.market, published.content, assets.value);
  if (!market.ok) {
    throw new Error(`marketplace data is invalid: ${market.error.message}`);
  }
  const economy = new EconomyService({ assets: assets.value });
  const secrets = new SecretBox({ keys: new Map([...config.dataKeys].map(([id, hex]) => [id, hexToBytes(hex)])), currentKeyId: config.dataKeyId, random });
  const marketRepository = new PgMarketplaceRepository(database);
  const hub = new ConnectionHub({ logger });
  const publish = (channel, payload) => database.query("SELECT pg_notify($1, $2)", [channel, payload]);
  const listen = (channel, onPayload, options) => database.listen(channel, onPayload, options);
  // An announced maintenance closes new payments and games (the gate of the shop, the sales and the queue).
  const maintenance = new MaintenanceService({ repository: new PgMaintenanceRepository(database), publish, listen, hub, audit, clock, unitOfWork, logger });
  const policy = { ...DEFAULT_MARKETPLACE_POLICY, ...marketplacePolicy };

  const receiverFor = (network) => {
    const account = /** @type {Record<string, string>} */ (config.shopAccounts)[network];
    if (account === undefined) {
      throw new Error(`no shop account configured for ${network}`);
    }
    return account;
  };
  const paymentRepository = new PgPaymentRepository(database);
  const payments = new PaymentService({ repository: paymentRepository, random, clock, unitOfWork });
  const refunds = new RefundWatcher({ repository: paymentRepository, providers: paymentProviders, senderFor: receiverFor, audit, clock, logger });
  const outbox = new ChainOutbox({ repository: new PgOutboxRepository(database), clock });
  // What a player should hear about is written with the change; each process pushes it to the players connected to it.
  const notifications = new NotificationService({ repository: new PgNotificationRepository(database), clock, unitOfWork });
  const epochs = new PackEpochService({ repository: marketRepository, secrets, random, clock, unitOfWork, maxAgeMs: policy.epochMaxAgeMs, firstEpochId: config.firstEpochId, publisher: { publishEpoch: (payload) => outbox.enqueueEpoch({ network: defaultNetwork, payload }) } });
  const fulfilment = new FulfilmentService({ orders: marketRepository, catalog: market.value, inventory, decks, epochs, payments, outbox, notifications, audit, clock, unitOfWork, logger });
  const rootAccount = /** @type {Record<string, string>} */ (config.rootAccounts)[defaultNetwork];
  const chain = publishing === null ? null : buildPublishing({ publishing, rootAccount, database, clock, random, unitOfWork, logger, policies: chainPolicies, ackKey: ackSigner?.publicKey ?? null });
  const chainRepository = new PgChainRepository(database);
  // With publishing on, a pack is sold only once its epoch's commitment is on chain (T12).
  const commitmentAnchored = chain === null ? null : async (epoch) => ANCHORED.has(await chainRepository.payloadStatus(sha256Hex(utf8(packEpochAnnouncement(epoch.id, epoch.commit))))) ;
  const marketplace = new MarketplaceService({ catalog: market.value, economy, repository: marketRepository, epochs, receiverFor, audit, clock, random, unitOfWork, policy, describeFulfilment: (order) => fulfilment.describe(order), commitmentAnchored, gate: maintenance });
  await marketplace.syncProducts();
  const gameRepository = new PgGameRepository(database);
  const games = new GameService({ repository: gameRepository, currentContent: () => catalog.current(), contentVersion: (hash) => catalog.version(hash), effects: createCoreEffectRegistry(), secrets, notifier: hub, clock, random, unitOfWork, audit, logger, network: defaultNetwork, results: outbox, timePolicy, ackSigner, gameProtocol: config.gameProtocol, signatures: moveSignatures(wallets.get(defaultNetwork), verifyMoveSignature) });
  const trading = new TradeService({ repository: new PgTradeRepository(database), inventory, findUser: (network, account) => users.findByAccount(network, account), isKnownCard: (id) => currentContent().catalog.has(id), outbox, notifier: hub, notifications, audit, clock, random, unitOfWork, logger, network: defaultNetwork });
  // Sales between players: paid straight to the seller, watched with the shop's payment providers.
  const salesRepository = new PgSalesRepository(database);
  const sales = new SalesService({ repository: salesRepository, inventory, assets: () => economy.acceptedAssets(), providers: paymentProviders, publish, notifications, audit, clock, random, unitOfWork, logger, policy: salesPolicy, gate: maintenance });
  const saleSettlement = new SaleSettlement({ repository: salesRepository, sales, inventory, providers: paymentProviders, outbox, notifications, audit, clock, unitOfWork, logger });
  const rankedSettings = validateRankedSettings(content.ranked);
  if (!rankedSettings.ok) {
    throw new Error(`ranked settings are invalid: ${rankedSettings.error.message}`);
  }
  const ranking = new RankingService({ repository: new PgRankingRepository(database), settings: rankedSettings.value, games, clock, unitOfWork, logger });
  games.onGameFinished((summary) => ranking.record(summary).then(() => undefined));
  // A season's jackpot: a share of the bank (the shop account, where every pack sale lands), split among its first places.
  const { jackpot, prizePayouts } = buildJackpot({ settings: rankedSettings.value, wallets, paymentProviders, bankFor: receiverFor, cursors: paymentRepository, ranking, notifications, database, audit, clock, unitOfWork, logger });
  const matchmaking = new MatchmakingService({ repository: new PgMatchmakingRepository(database), decks, games, notifier: hub, clock, random, unitOfWork, logger, ranking, gate: maintenance });
  // Who is online, and challenges between them (a game without the queue).
  const lobby = new LobbyService({
    hub,
    accountsOf: (ids) => users.accountsOf(ids),
    findUser: (account) => users.findByAccount(defaultNetwork, account),
    matchmaking,
    decks,
    games,
    ranking,
    clock,
    random,
    logger,
    gate: maintenance,
    policy: lobbyPolicy,
  });
  maintenance.onClose(() => matchmaking.closeQueue());
  maintenance.onClose(async () => lobby.closeAll());
  const settlement = new PaymentSettlement({ orders: marketRepository, payments, providers: paymentProviders, receiverFor, audit, notifications, formatAmount: (units, asset) => formatAmount(units, precisionOf(paymentProviders, asset)), clock, unitOfWork, logger });
  const notificationRelay = new NotificationRelay({ notifications, listen, hub, logger });
  const boardRelay = new BoardRelay({ listen, hub, logger });

  const router = new Router();
  registerIdentityRoutes({ router, auth, cookie: { name: config.sessionCookieName, secure: config.secure }, clock });
  registerCatalogRoutes({ router, catalog });
  registerCollectionRoutes({ router, inventory });
  registerTradeRoutes({ router, trading });
  registerSalesRoutes({ router, sales, settlement: saleSettlement });
  registerNotificationRoutes({ router, notifications });
  registerDeckRoutes({ router, decks });
  registerStarterRoutes({ router, starters });
  registerMarketplaceRoutes({ router, marketplace, epochs, settlement });
  registerRankingRoutes({ router, ranking });
  registerGameRoutes({ router, games });
  const readModel = new PgOperationsReadModel(database);
  const runtime = () => ({ connections: hub.size, broadcasters: chain === null ? null : { signers: chain.signers, resourceCredits: chain.rc.levels() } });
  const monitor = new Monitor({ readModel, runtime, clock, logger, policy: alarmPolicy });
  registerMonitoringRoutes({ router, monitor, metricsToken: config.metricsToken });
  const admin = new AdminService({
    admins: config.adminAccounts,
    readModel,
    chainRepository,
    payments,
    audit,
    runtime,
    monitor,
    shopAccount: receiverFor,
    formatAmount: (units, asset) => formatAmount(units, precisionOf(paymentProviders, asset)),
    ranking,
    clock,
  });
  registerAdminRoutes({ router, admin });
  registerJackpotRoutes({ router, jackpot, admin });
  registerMaintenanceRoutes({ router, maintenance, admin, version, build: config.build });
  const rateLimiter = new RateLimiter({ now: () => clock.now() });
  const http = new HttpApp({
    router,
    config: { allowedOrigins: config.allowedOrigins, trustProxy: config.trustProxy, maxBodyBytes: config.maxBodyBytes, hsts: config.secure, sessionCookieName: config.sessionCookieName },
    logger,
    rateLimiter,
    authenticate: (token) => auth.authenticate(token),
    staticFiles,
  });
  const messages = new MessageRouter();
  registerSessionMessages({ router: messages, games, matchmaking, clock });
  registerLobbyMessages({ router: messages, lobby });
  registerGameMessages({ router: messages, games });
  registerQueueMessages({ router: messages, matchmaking });
  const realtime = new WebSocketGateway({
    hub,
    router: messages,
    authenticate: (token) => auth.authenticate(token),
    onPresence: presenceHandler({ games, matchmaking, lobby }),
    clock,
    logger,
    config: { allowedOrigins: config.allowedOrigins, sessionCookieName: config.sessionCookieName, trustProxy: config.trustProxy },
    rateLimiter,
  });
  logger.info("content published", { hash: published.hash, engineVersion: published.engineVersion });
  if (chain === null) {
    logger.warn("publishing is off (no broadcaster keys, or they could not be checked): records wait in the outbox");
  }
  if (config.dataKeyIsDevelopment) {
    logger.warn("using the public development data key: set M8_DATA_KEY before selling anything");
  }
  return Object.freeze({ http, auth, keyAuditor, audit, users, sessions, challenges, catalog, inventory, decks, starters, economy, marketplace, epochs, payments, settlement, fulfilment, outbox, chain, refunds, admin, monitor, ranking, jackpot, prizePayouts, trading, sales, saleSettlement, notifications, notificationRelay, boardRelay, maintenance, hub, games, gameRepository, secrets, matchmaking, lobby, realtime });
}

/**
 * The jackpot of the seasons with a prize pool, and the watcher of its payouts. Fails the start on a bad pool, an unknown bank or asset.
 * @param {{
 *   settings: import("./modules/ranking/domain/RankedSettings.js").RankedSettings,
 *   wallets: ReadonlyMap<string, import("./modules/identity/application/ports.js").WalletProvider>,
 *   paymentProviders: ReadonlyMap<string, import("./modules/payments/application/ports.js").PaymentProvider>,
 *   bankFor: (network: string) => string,
 *   cursors: PgPaymentRepository,
 *   ranking: RankingService,
 *   notifications: NotificationService,
 *   database: import("./platform/db/Database.js").Database,
 *   audit: AuditTrail,
 *   clock: import("./kernel/time.js").Clock,
 *   unitOfWork: import("./kernel/unitOfWork.js").UnitOfWork,
 *   logger: import("./kernel/logger.js").Logger,
 * }} deps
 */
function buildJackpot({ settings, wallets, paymentProviders, bankFor, cursors, ranking, notifications, database, audit, clock, unitOfWork, logger }) {
  const pools = validatePrizePools(settings.prizePools, settings.seasons);
  if (!pools.ok) {
    throw new Error(`prize pools are invalid: ${pools.error.message}`);
  }
  for (const pool of pools.value.values()) {
    // Fails the start now rather than at the season's end: the bank and the asset must be known.
    bankFor(pool.network);
    precisionOf(paymentProviders, pool.asset);
  }
  const repository = new PgJackpotRepository(database);
  const jackpot = new JackpotService({
    settings,
    pools: pools.value,
    bankFor,
    readBalance: (network, account, asset) => readWalletBalance(wallets.get(network), account, asset, precisionOf(paymentProviders, asset)),
    formatAmount: (units, asset) => formatAmount(units, precisionOf(paymentProviders, asset)),
    ranking,
    repository,
    notifications,
    audit,
    clock,
    unitOfWork,
    logger,
  });
  const networks = [...new Set([...pools.value.values()].map((pool) => pool.network))];
  const prizePayouts = new PrizePayoutWatcher({ repository, cursors, providers: paymentProviders, bankFor, networks, audit, clock, logger });
  return { jackpot, prizePayouts };
}

/**
 * What `account` holds of `asset` on the chain, in units; null when the wallet cannot tell.
 * @param {import("./modules/identity/application/ports.js").WalletProvider | undefined} wallet
 * @param {string} account
 * @param {string} asset
 * @param {number} precision
 */
async function readWalletBalance(wallet, account, asset, precision) {
  const balances = await wallet?.balancesOf?.(account);
  const amount = balances?.ok ? balances.value.find((balance) => balance.asset === asset)?.amount : undefined;
  return amount === undefined ? null : parseAmount(amount, precision);
}

/** Anchoring states that prove a payload is on chain. */
const ANCHORED = new Set(["INCLUDED", "IRREVERSIBLE"]);

/**
 * The precision of any asset a payment provider can verify (refunds may be
 * in an asset the shop does not accept, e.g. SBD sent by mistake).
 * @param {ReadonlyMap<string, { supportedAssets: () => readonly { asset: string, precision: number }[] }>} providers
 * @param {string} asset
 */
function precisionOf(providers, asset) {
  for (const provider of providers.values()) {
    const found = provider.supportedAssets().find((candidate) => candidate.asset === asset);
    if (found !== undefined) {
      return found.precision;
    }
  }
  throw new Error(`no payment provider knows the asset ${asset}`);
}

/**
 * The checks of signed moves (docs/tcg/12): session keys are authorised by a
 * posting key of the account (the wallet checks it like a login), moves are
 * signed by the session key (P-256).
 * @param {import("./modules/identity/application/ports.js").WalletProvider | undefined} wallet
 * @param {((message: string, signature: string, key: string) => boolean) | undefined} verifyMoveSignature
 * @returns {import("./modules/gameplay/application/ports.js").MoveSignatures | null}
 */
function moveSignatures(wallet, verifyMoveSignature) {
  if (wallet === undefined || verifyMoveSignature === undefined) {
    return null;
  }
  return Object.freeze({
    authorizesSession: async ({ account, message, signature }) => (await wallet.verifyLogin({ account, message, signature })).ok,
    verifiesMove: verifyMoveSignature,
  });
}

/**
 * The optional adapters of createServerApp, with their defaults.
 * @param {Parameters<typeof createServerApp>[0]} deps
 */
function optionalAdapters({ staticFiles = null, publishing = null, ackSigner = null, verifyMoveSignature = undefined, version = null }) {
  return { staticFiles, publishing, ackSigner, verifyMoveSignature, version };
}

/**
 * The tunable policies of createServerApp (tests shorten times, lower limits).
 * @param {Parameters<typeof createServerApp>[0]} deps
 */
function policiesOf({ identityPolicyOverrides = {}, marketplacePolicy = {}, salesPolicy = {}, timePolicy = {}, chainPolicies = {}, alarmPolicy = {}, lobbyPolicy = {} }) {
  return { identityPolicyOverrides, marketplacePolicy, salesPolicy, timePolicy, chainPolicies, alarmPolicy, lobbyPolicy };
}

/**
 * The broadcaster, the tracker and the Resource Credits monitor of one network.
 * @param {{ publishing: { transactions: any, reader: any }, rootAccount: string, database: import("./platform/db/Database.js").Database, clock: any, random: any, unitOfWork: any, logger: any, policies: { broadcast?: object, tracker?: object, rc?: object }, ackKey: string | null }} deps
 */
function buildPublishing({ publishing, rootAccount, database, clock, random, unitOfWork, logger, policies, ackKey }) {
  const { transactions, reader } = publishing;
  assertImplements(transactions, TRANSACTION_PROVIDER_METHODS, "TransactionProvider");
  assertImplements(reader, PUBLICATION_READER_METHODS, "PublicationReader");
  const repository = new PgChainRepository(database);
  const rc = new RcMonitor({ transactions, reader, repository, clock, logger, policy: policies.rc });
  const manifests = new ManifestWatcher({ reader, rootAccount, logger, ackKey });
  const broadcaster = new ChainBroadcaster({ repository, transactions, resources: rc, authorization: manifests, clock, random, unitOfWork, logger, policy: policies.broadcast });
  const tracker = new ChainTracker({ repository, reader, signers: transactions.signers, clock, unitOfWork, logger, policy: policies.tracker });
  return Object.freeze({ network: transactions.network, signers: transactions.signers, repository, rc, manifests, broadcaster, tracker });
}
