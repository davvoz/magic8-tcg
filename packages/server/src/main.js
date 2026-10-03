/**
 * Process entry point: reads configuration, opens and migrates the database,
 * builds real adapters, starts the HTTP server and the periodic jobs, shuts
 * down cleanly on SIGINT/SIGTERM.
 */
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join, resolve } from "node:path";

import { SignerError, SteemBlockchainProvider, SteemPublicationReader, SteemRpcClient, SteemTransactionProvider, SteemTransferPaymentProvider, SteemWalletProvider, STEEM_NETWORK, decodeWif, publicKeyOf, signMessage } from "@magic8/steem";
import { createServerApp } from "./app.js";
import { ConfigError, loadConfig } from "./config.js";
import { readServerContent } from "./contentFiles.js";
import { verifySessionSignature } from "./kernel/crypto/sessionSignatures.js";
import { parseJson } from "./kernel/json.js";
import { createConsoleLogger, createJsonLogger } from "./kernel/logger.js";
import { nodeSecureRandom } from "./kernel/random.js";
import { systemClock } from "./kernel/time.js";
import { openDatabase } from "./platform/db/openDatabase.js";
import { StaticFiles } from "./platform/http/StaticFiles.js";

const KEY_AUDIT_INTERVAL_MS = 10 * 60 * 1000;
const CHALLENGE_PURGE_INTERVAL_MS = 5 * 60 * 1000;
const PAYMENT_POLL_INTERVAL_MS = 5000;
const REFUND_POLL_INTERVAL_MS = 30_000;
const ALARM_INTERVAL_MS = 60_000;
const RANKING_CATCH_UP_MS = 10 * 60 * 1000;
/** Season jackpots: the opening balance of a season that started, the settlement of one that ended, prize payouts. */
const JACKPOT_INTERVAL_MS = 60_000;
const TRADE_EXPIRY_INTERVAL_MS = 60_000;
const SALE_POLL_INTERVAL_MS = 5000;
const ORDER_EXPIRY_INTERVAL_MS = 60 * 1000;
const EPOCH_REVEAL_INTERVAL_MS = 10 * 60 * 1000;
const GAME_TICK_INTERVAL_MS = 1000;
/** The rating window widens while a ticket waits, so the queue is re-run often. */
const MATCHMAKING_INTERVAL_MS = 5000;
/** Unanswered challenges lapse after a minute; both players hear of it within a few seconds. */
const CHALLENGE_EXPIRY_INTERVAL_MS = 5000;
/** One broadcast round per block. */
const BROADCAST_INTERVAL_MS = 3000;
const TRACKER_INTERVAL_MS = 6000;
const RC_INTERVAL_MS = 60 * 1000;
const SHUTDOWN_GRACE_MS = 10_000;
const NOTIFICATION_PURGE_INTERVAL_MS = 60 * 60 * 1000;
const REPOSITORY_ROOT = resolve(import.meta.dirname, "../../..");

async function main() {
  let config;
  try {
    config = loadConfig(process.env);
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`configuration error: ${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }
  const createLogger = config.logFormat === "json" ? createJsonLogger : createConsoleLogger;
  const logger = createLogger({ write: (line) => process.stdout.write(line), level: config.logLevel });
  const database = await openDatabase({ url: config.databaseUrl, baseDirectory: REPOSITORY_ROOT, logger });
  const rpc = new SteemRpcClient({ nodes: config.steemNodes });
  const chain = new SteemBlockchainProvider({ rpc });
  const wallet = new SteemWalletProvider({ chain, appName: config.appName, rpc });
  // Payments are confirmed by asking each node directly, never through failover (T21).
  const verifiers = config.steemNodes.map((node) => new SteemBlockchainProvider({ rpc: new SteemRpcClient({ nodes: [node] }) }));
  const steemPayments = new SteemTransferPaymentProvider({ history: chain, verifiers });
  const publishing = await openPublishing(config, rpc, chain);
  const version = await productVersion();
  const staticFiles = config.serveClient
    ? new StaticFiles([
        { prefix: "/data/", directory: join(REPOSITORY_ROOT, "data") },
        { prefix: "/engine/", directory: join(REPOSITORY_ROOT, "packages", "engine", "src") },
        // The browser pages (the game, manifest.html, admin.html) run the protocol and read STEEM nodes directly.
        { prefix: "/protocol/", directory: join(REPOSITORY_ROOT, "packages", "protocol", "src") },
        { prefix: "/steem/", directory: join(REPOSITORY_ROOT, "packages", "steem", "src") },
        { prefix: "/vendor/noble-hashes/", directory: join(REPOSITORY_ROOT, "node_modules", "@noble", "hashes") },
        { prefix: "/vendor/noble-curves/", directory: join(REPOSITORY_ROOT, "node_modules", "@noble", "curves") },
        { prefix: "/", directory: join(REPOSITORY_ROOT, "packages", "client") },
      ], { connectSources: [config.publicOrigin.replace(/^http/, "ws"), ...config.steemNodes.map((node) => new URL(node).origin)] })
    : null;
  const app = await createServerApp({
    config,
    clock: systemClock,
    random: nodeSecureRandom,
    logger,
    wallets: new Map([[STEEM_NETWORK, wallet]]),
    paymentProviders: new Map([[STEEM_NETWORK, steemPayments]]),
    defaultNetwork: STEEM_NETWORK,
    database,
    content: await readServerContent(join(REPOSITORY_ROOT, "data")),
    staticFiles,
    publishing,
    ackSigner: ackSignerFrom(config, logger),
    verifyMoveSignature: verifySessionSignature,
    version,
  });

  const restored = await app.games.restoreAll();
  logger.info("games restored", { restored });
  const server = createServer({ headersTimeout: 15_000, requestTimeout: 30_000 }, app.http.listener);
  server.maxHeadersCount = 64;
  app.realtime.attach(server);
  // Notifications committed by any process reach the players connected to this one.
  const stopRelay = await app.notificationRelay.start();
  // So do the board's changes, to everyone looking at it.
  const stopBoardRelay = await app.boardRelay.start();
  // An announced maintenance: read now, then followed whoever changes it (the admin page, the command line).
  const stopMaintenance = await app.maintenance.start();
  const jobs = [
    setInterval(() => app.keyAuditor.run().catch((error) => logger.error("session key audit failed", { error })), KEY_AUDIT_INTERVAL_MS),
    setInterval(() => app.challenges.purgeExpired(systemClock.now()).catch((error) => logger.error("challenge purge failed", { error })), CHALLENGE_PURGE_INTERVAL_MS),
    every(PAYMENT_POLL_INTERVAL_MS, "payment settlement", async () => {
      await app.settlement.runOnce();
      await app.fulfilment.fulfilVerified();
    }, logger),
    every(REFUND_POLL_INTERVAL_MS, "refunds", () => app.refunds.runOnce(), logger),
    every(ALARM_INTERVAL_MS, "alarms", () => app.monitor.evaluate(), logger),
    every(RANKING_CATCH_UP_MS, "ranking catch-up", () => app.ranking.catchUp(), logger),
    every(JACKPOT_INTERVAL_MS, "season jackpots", () => app.jackpot.runOnce(), logger),
    every(REFUND_POLL_INTERVAL_MS, "prize payouts", () => app.prizePayouts.runOnce(), logger),
    every(TRADE_EXPIRY_INTERVAL_MS, "trade expiry", () => app.trading.expireDue(), logger),
    every(SALE_POLL_INTERVAL_MS, "sale settlement", () => app.saleSettlement.runOnce(), logger),
    every(TRADE_EXPIRY_INTERVAL_MS, "listing expiry", () => app.sales.expireDue(), logger),
    every(ORDER_EXPIRY_INTERVAL_MS, "order expiry", () => app.marketplace.expireDue(), logger),
    every(EPOCH_REVEAL_INTERVAL_MS, "pack epoch reveal", () => app.epochs.revealSettled(), logger),
    // Keeps a pack epoch open ahead of sales, so its commitment is already on chain when a buyer orders.
    every(ORDER_EXPIRY_INTERVAL_MS, "pack epoch rollover", () => app.epochs.current(), logger),
    every(GAME_TICK_INTERVAL_MS, "game timers", () => app.games.tick(), logger),
    every(NOTIFICATION_PURGE_INTERVAL_MS, "notification retention", () => app.notifications.purge(), logger),
    every(MATCHMAKING_INTERVAL_MS, "matchmaking", () => app.matchmaking.pair(), logger),
    every(ORDER_EXPIRY_INTERVAL_MS, "queue expiry", () => app.matchmaking.expireStale(), logger),
    every(CHALLENGE_EXPIRY_INTERVAL_MS, "challenge expiry", async () => app.lobby.expireDue(), logger),
  ];
  const chainModule = app.chain;
  if (chainModule !== null) {
    jobs.push(
      every(RC_INTERVAL_MS, "resource credits", () => chainModule.rc.runOnce(), logger),
      every(RC_INTERVAL_MS, "root manifests", () => chainModule.manifests.runOnce(), logger),
      every(BROADCAST_INTERVAL_MS, "chain broadcast", () => chainModule.broadcaster.runOnce(), logger),
      every(TRACKER_INTERVAL_MS, "chain tracking", () => chainModule.tracker.runOnce(), logger),
    );
    chainModule.rc.runOnce().catch((error) => logger.warn("resource credits could not be read", { error: error instanceof Error ? error.message : String(error) }));
    chainModule.manifests.runOnce().catch((error) => logger.warn("root manifests could not be read", { error: error instanceof Error ? error.message : String(error) }));
  }
  server.listen(config.port, config.host, () => logger.info("server listening", { host: config.host, port: config.port, origin: config.publicOrigin, version, build: config.build }));

  const shutdown = (signal) => {
    logger.info("shutting down", { signal });
    jobs.forEach(clearInterval);
    stopRelay().catch((error) => logger.warn("notification relay did not stop cleanly", { error }));
    stopBoardRelay().catch((error) => logger.warn("board relay did not stop cleanly", { error }));
    stopMaintenance().catch((error) => logger.warn("maintenance relay did not stop cleanly", { error }));
    app.realtime.close();
    setTimeout(() => process.exit(1), SHUTDOWN_GRACE_MS).unref();
    server.close(() => {
      database.close().then(
        () => process.exit(0),
        (error) => {
          logger.error("database close failed", { error });
          process.exit(1);
        },
      );
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

/** @returns {Promise<string>} the product version (the root package.json's), told to the browser tabs with the build */
async function productVersion() {
  const { version } = /** @type {{ version: string }} */ (parseJson(await readFile(join(REPOSITORY_ROOT, "package.json"), "utf8")));
  return version;
}

/**
 * The broadcaster pool, when keys are configured. Every key is checked
 * against its account first: a key that is not a posting key, or that also
 * controls active or owner, stops the start. If the chain cannot be read,
 * the server starts without publishing (records wait in the outbox).
 * @param {ReturnType<typeof loadConfig>} config
 * @param {SteemRpcClient} rpc
 * @param {SteemBlockchainProvider} chain
 */
async function openPublishing(config, rpc, chain) {
  if (config.broadcasterKeys.size === 0) {
    return null;
  }
  const transactions = new SteemTransactionProvider({ rpc, chain, keys: config.broadcasterKeys });
  try {
    await transactions.verifySigners();
  } catch (error) {
    if (error instanceof SignerError) {
      process.stderr.write(`broadcaster error: ${error.message}\n`);
      process.exit(1);
    }
    // The chain is not on the game's critical path: play on, publish after a restart with the chain reachable.
    process.stderr.write(`broadcaster keys could not be checked (${error instanceof Error ? error.message : String(error)}): nothing will be published until the server restarts with the chain reachable\n`);
    return null;
  }
  return { transactions, reader: new SteemPublicationReader({ chain }) };
}

/**
 * Runs `job` every `intervalMs`, never overlapping itself: a slow chain node
 * delays the next run instead of stacking concurrent ones.
 * @param {number} intervalMs
 * @param {string} name
 * @param {() => Promise<unknown>} job
 * @param {import("./kernel/logger.js").Logger} logger
 */
function every(intervalMs, name, job, logger) {
  let running = false;
  return setInterval(() => {
    if (running) {
      return;
    }
    running = true;
    job()
      .catch((error) => logger.error(`${name} failed`, { error: error instanceof Error ? error.message : String(error) }))
      .finally(() => {
        running = false;
      });
  }, intervalMs);
}

main().catch((error) => {
  process.stderr.write(`startup failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});

/**
 * The key that signs acks (docs/tcg/11-ack-firmati.md): M8_ACK_KEY, or in
 * development a key made for this run, which no manifest names.
 * @param {ReturnType<typeof loadConfig>} config
 * @param {import("./kernel/logger.js").Logger} logger
 */
function ackSignerFrom(config, logger) {
  let privateKey = config.ackKey === null ? null : decodeWif(config.ackKey);
  if (config.ackKey !== null && privateKey === null) {
    process.stderr.write("configuration error: M8_ACK_KEY: the WIF checksum does not match\n");
    process.exit(1);
  }
  if (privateKey === null) {
    privateKey = nodeSecureRandom.bytes(32);
    logger.warn("M8_ACK_KEY is not set: acks are signed with a key made for this run, which verifiers will not trust");
  }
  const key = privateKey;
  return Object.freeze({ publicKey: publicKeyOf(key), sign: (/** @type {string} */ message) => signMessage(message, key) });
}

