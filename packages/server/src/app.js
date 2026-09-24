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
import { unitOfWorkOf } from "./kernel/unitOfWork.js";
import { PgAuditStore } from "./platform/audit/PgAuditStore.js";
import { HttpApp } from "./platform/http/HttpApp.js";
import { RateLimiter } from "./platform/http/RateLimiter.js";
import { Router } from "./platform/http/Router.js";
import { CatalogService, PgContentRepository, registerCatalogRoutes } from "./modules/catalog/index.js";
import { InventoryService, PgInventoryRepository, registerCollectionRoutes } from "./modules/collection/index.js";
import { DeckService, PgDeckRepository, registerDeckRoutes } from "./modules/decks/index.js";
import { AuthService, PgChallengeRepository, PgSessionRepository, PgUserRepository, SessionKeyAuditor, identityPolicy, registerIdentityRoutes } from "./modules/identity/index.js";
import { StarterService, registerStarterRoutes, validateStarterOffer } from "./modules/onboarding/index.js";

/**
 * @param {{
 *   config: ReturnType<typeof import("./config.js").loadConfig>,
 *   clock: import("./kernel/time.js").Clock,
 *   random: import("./kernel/random.js").SecureRandom,
 *   logger: import("./kernel/logger.js").Logger,
 *   wallets: ReadonlyMap<string, import("./modules/identity/application/ports.js").WalletProvider>,
 *   defaultNetwork: string,
 *   database: import("./platform/db/Database.js").Database,
 *   content: Awaited<ReturnType<typeof import("./contentFiles.js").readServerContent>>,
 *   staticFiles?: import("./platform/http/HttpApp.js").StaticHandler | null,
 *   identityPolicyOverrides?: Parameters<typeof identityPolicy>[0],
 * }} deps
 */
export async function createServerApp({ config, clock, random, logger, wallets, defaultNetwork, database, content, staticFiles = null, identityPolicyOverrides = {} }) {
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

  const router = new Router();
  registerIdentityRoutes({ router, auth, cookie: { name: config.sessionCookieName, secure: config.secure }, clock });
  registerCatalogRoutes({ router, catalog });
  registerCollectionRoutes({ router, inventory });
  registerDeckRoutes({ router, decks });
  registerStarterRoutes({ router, starters });
  const http = new HttpApp({
    router,
    config: { allowedOrigins: config.allowedOrigins, trustProxy: config.trustProxy, maxBodyBytes: config.maxBodyBytes, hsts: config.secure, sessionCookieName: config.sessionCookieName },
    logger,
    rateLimiter: new RateLimiter({ now: () => clock.now() }),
    authenticate: (token) => auth.authenticate(token),
    staticFiles,
  });
  logger.info("content published", { hash: published.hash, engineVersion: published.engineVersion });
  return Object.freeze({ http, auth, keyAuditor, audit, users, sessions, challenges, catalog, inventory, decks, starters });
}
