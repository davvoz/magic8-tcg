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
import { hexToBytes } from "@magic8/protocol";
import { SecretBox } from "./kernel/crypto/SecretBox.js";
import { unitOfWorkOf } from "./kernel/unitOfWork.js";
import { PgAuditStore } from "./platform/audit/PgAuditStore.js";
import { HttpApp } from "./platform/http/HttpApp.js";
import { RateLimiter } from "./platform/http/RateLimiter.js";
import { Router } from "./platform/http/Router.js";
import { CatalogService, PgContentRepository, registerCatalogRoutes } from "./modules/catalog/index.js";
import { InventoryService, PgInventoryRepository, registerCollectionRoutes } from "./modules/collection/index.js";
import { DeckService, PgDeckRepository, registerDeckRoutes } from "./modules/decks/index.js";
import { EconomyService, validateAssets } from "./modules/economy/index.js";
import { ChainOutbox, PgOutboxRepository } from "./modules/chain/index.js";
import { DEFAULT_MARKETPLACE_POLICY, FulfilmentService, MarketplaceService, PackEpochService, PaymentSettlement, PgMarketplaceRepository, buildMarketCatalog, registerMarketplaceRoutes } from "./modules/marketplace/index.js";
import { PAYMENT_PROVIDER_METHODS, PaymentService, PgPaymentRepository } from "./modules/payments/index.js";
import { GameService, PgGameRepository, registerGameMessages } from "./modules/gameplay/index.js";
import { MatchmakingService, PgMatchmakingRepository, registerQueueMessages } from "./modules/matchmaking/index.js";
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
 *   timePolicy?: Partial<import("./modules/gameplay/domain/TurnClock.js").TimePolicy>,
 * }} deps
 */
export async function createServerApp({ config, clock, random, logger, wallets, paymentProviders, defaultNetwork, database, content, staticFiles = null, identityPolicyOverrides = {}, marketplacePolicy = {}, timePolicy = {} }) {
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
  const policy = { ...DEFAULT_MARKETPLACE_POLICY, ...marketplacePolicy };
  const epochs = new PackEpochService({ repository: marketRepository, secrets, random, clock, unitOfWork, maxAgeMs: policy.epochMaxAgeMs });
  const receiverFor = (network) => {
    const account = /** @type {Record<string, string>} */ (config.shopAccounts)[network];
    if (account === undefined) {
      throw new Error(`no shop account configured for ${network}`);
    }
    return account;
  };
  const payments = new PaymentService({ repository: new PgPaymentRepository(database), random, clock, unitOfWork });
  const outbox = new ChainOutbox({ repository: new PgOutboxRepository(database), clock });
  const fulfilment = new FulfilmentService({ orders: marketRepository, catalog: market.value, inventory, decks, epochs, payments, outbox, audit, clock, unitOfWork, logger });
  const marketplace = new MarketplaceService({ catalog: market.value, economy, repository: marketRepository, epochs, receiverFor, audit, clock, random, unitOfWork, policy, describeFulfilment: (order) => fulfilment.describe(order) });
  await marketplace.syncProducts();
  const hub = new ConnectionHub({ logger });
  const gameRepository = new PgGameRepository(database);
  const games = new GameService({ repository: gameRepository, currentContent: () => catalog.current(), effects: createCoreEffectRegistry(), secrets, notifier: hub, clock, random, unitOfWork, audit, logger, network: defaultNetwork, timePolicy });
  const matchmaking = new MatchmakingService({ repository: new PgMatchmakingRepository(database), decks, games, notifier: hub, clock, random, unitOfWork, logger });
  const settlement = new PaymentSettlement({ orders: marketRepository, payments, providers: paymentProviders, receiverFor, audit, clock, unitOfWork, logger });

  const router = new Router();
  registerIdentityRoutes({ router, auth, cookie: { name: config.sessionCookieName, secure: config.secure }, clock });
  registerCatalogRoutes({ router, catalog });
  registerCollectionRoutes({ router, inventory });
  registerDeckRoutes({ router, decks });
  registerStarterRoutes({ router, starters });
  registerMarketplaceRoutes({ router, marketplace, epochs, settlement });
  const http = new HttpApp({
    router,
    config: { allowedOrigins: config.allowedOrigins, trustProxy: config.trustProxy, maxBodyBytes: config.maxBodyBytes, hsts: config.secure, sessionCookieName: config.sessionCookieName },
    logger,
    rateLimiter: new RateLimiter({ now: () => clock.now() }),
    authenticate: (token) => auth.authenticate(token),
    staticFiles,
  });
  const messages = new MessageRouter();
  registerSessionMessages({ router: messages, games, matchmaking, clock });
  registerGameMessages({ router: messages, games });
  registerQueueMessages({ router: messages, matchmaking });
  const realtime = new WebSocketGateway({
    hub,
    router: messages,
    authenticate: (token) => auth.authenticate(token),
    onPresence: presenceHandler({ games, matchmaking }),
    clock,
    logger,
    config: { allowedOrigins: config.allowedOrigins, sessionCookieName: config.sessionCookieName, trustProxy: config.trustProxy },
  });
  logger.info("content published", { hash: published.hash, engineVersion: published.engineVersion });
  if (config.dataKeyIsDevelopment) {
    logger.warn("using the public development data key: set M8_DATA_KEY before selling anything");
  }
  return Object.freeze({ http, auth, keyAuditor, audit, users, sessions, challenges, catalog, inventory, decks, starters, economy, marketplace, epochs, payments, settlement, fulfilment, outbox, hub, games, gameRepository, secrets, matchmaking, realtime });
}
