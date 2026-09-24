/**
 * Process entry point: reads configuration, opens and migrates the database,
 * builds real adapters, starts the HTTP server and the periodic jobs, shuts
 * down cleanly on SIGINT/SIGTERM.
 */
import { createServer } from "node:http";
import { join, resolve } from "node:path";

import { SteemBlockchainProvider, SteemRpcClient, SteemTransferPaymentProvider, SteemWalletProvider, STEEM_NETWORK } from "@magic8/steem";
import { createServerApp } from "./app.js";
import { ConfigError, loadConfig } from "./config.js";
import { readServerContent } from "./contentFiles.js";
import { createJsonLogger } from "./kernel/logger.js";
import { nodeSecureRandom } from "./kernel/random.js";
import { systemClock } from "./kernel/time.js";
import { openDatabase } from "./platform/db/openDatabase.js";
import { StaticFiles } from "./platform/http/StaticFiles.js";

const KEY_AUDIT_INTERVAL_MS = 10 * 60 * 1000;
const CHALLENGE_PURGE_INTERVAL_MS = 5 * 60 * 1000;
const PAYMENT_POLL_INTERVAL_MS = 5000;
const ORDER_EXPIRY_INTERVAL_MS = 60 * 1000;
const EPOCH_REVEAL_INTERVAL_MS = 10 * 60 * 1000;
const GAME_TICK_INTERVAL_MS = 1000;
const RECORD_SEAL_INTERVAL_MS = 5000;
const SHUTDOWN_GRACE_MS = 10_000;
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
  const logger = createJsonLogger({ write: (line) => process.stdout.write(line), level: config.logLevel });
  const database = await openDatabase({ url: config.databaseUrl, baseDirectory: REPOSITORY_ROOT, logger });
  const rpc = new SteemRpcClient({ nodes: config.steemNodes });
  const chain = new SteemBlockchainProvider({ rpc });
  const wallet = new SteemWalletProvider({ chain, appName: config.appName });
  // Payments are confirmed by asking each node directly, never through failover (T21).
  const verifiers = config.steemNodes.map((node) => new SteemBlockchainProvider({ rpc: new SteemRpcClient({ nodes: [node] }) }));
  const steemPayments = new SteemTransferPaymentProvider({ history: chain, verifiers });
  const staticFiles = config.serveClient
    ? new StaticFiles([
        { prefix: "/data/", directory: join(REPOSITORY_ROOT, "data") },
        { prefix: "/engine/", directory: join(REPOSITORY_ROOT, "packages", "engine", "src") },
        { prefix: "/", directory: join(REPOSITORY_ROOT, "packages", "client") },
      ], { connectSources: [config.publicOrigin.replace(/^http/, "ws")] })
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
  });

  const restored = await app.games.restoreAll();
  logger.info("games restored", { restored });
  const server = createServer({ headersTimeout: 15_000, requestTimeout: 30_000 }, app.http.listener);
  server.maxHeadersCount = 64;
  app.realtime.attach(server);
  const jobs = [
    setInterval(() => app.keyAuditor.run().catch((error) => logger.error("session key audit failed", { error })), KEY_AUDIT_INTERVAL_MS),
    setInterval(() => app.challenges.purgeExpired(systemClock.now()).catch((error) => logger.error("challenge purge failed", { error })), CHALLENGE_PURGE_INTERVAL_MS),
    every(PAYMENT_POLL_INTERVAL_MS, "payment settlement", async () => {
      await app.settlement.runOnce();
      await app.fulfilment.fulfilVerified();
    }, logger),
    every(ORDER_EXPIRY_INTERVAL_MS, "order expiry", () => app.marketplace.expireDue(), logger),
    every(EPOCH_REVEAL_INTERVAL_MS, "pack epoch reveal", () => app.epochs.revealSettled(), logger),
    every(GAME_TICK_INTERVAL_MS, "game timers", () => app.games.tick(), logger),
    every(RECORD_SEAL_INTERVAL_MS, "record sealing", () => app.games.sealStale(), logger),
    every(ORDER_EXPIRY_INTERVAL_MS, "matchmaking", async () => {
      await app.matchmaking.expireStale();
      await app.matchmaking.pair();
    }, logger),
  ];
  server.listen(config.port, config.host, () => logger.info("server listening", { host: config.host, port: config.port, origin: config.publicOrigin }));

  const shutdown = (signal) => {
    logger.info("shutting down", { signal });
    jobs.forEach(clearInterval);
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
