/**
 * The house players' process: reads the configuration (config.js), brings
 * every bot online and keeps them there until the process is stopped. With
 * no bot configured it says so and waits, so a container can run it
 * whether or not bots are wanted.
 */
import { WebSocket } from "ws";
import { Bot } from "./Bot.js";
import { BotFleet } from "./BotFleet.js";
import { BotHttp } from "./BotHttp.js";
import { BotConfigError, loadBotConfig } from "./config.js";
import { createLineLogger } from "./logger.js";

const timers = Object.freeze({ setTimeout: (/** @type {() => void} */ fn, /** @type {number} */ ms) => setTimeout(fn, ms), clearTimeout: (/** @type {any} */ handle) => clearTimeout(handle) });
const delay = (/** @type {number} */ ms) => new Promise((resolve) => setTimeout(resolve, ms)).then(() => undefined);

function main() {
  let config;
  try {
    config = loadBotConfig(process.env);
  } catch (error) {
    if (error instanceof BotConfigError) {
      process.stderr.write(`bots: ${error.message}\n`);
      process.exit(2);
    }
    throw error;
  }
  const logger = createLineLogger({ write: (line) => process.stdout.write(line), level: config.logLevel });
  if (config.bots.length === 0) {
    logger.info("no bot configured (M8_BOT_KEYS is empty): nothing to do");
    setInterval(() => undefined, 24 * 60 * 60 * 1000);
    return;
  }
  const socketUrl = `${config.server.replace(/^http/, "ws")}/ws`;
  const bots = config.bots.map(
    (account, index) =>
      new Bot({
        account: account.account,
        postingKey: account.postingKey,
        style: account.style,
        starterIndex: index,
        http: new BotHttp({ server: config.server, origin: config.origin }),
        openSocket: ({ cookie, origin }) => /** @type {any} */ (new WebSocket(socketUrl, { headers: { Cookie: cookie, Origin: origin } })),
        timers,
        delay,
        random: Math.random,
        now: Date.now,
        crypto: globalThis.crypto,
        thinkMs: config.thinkMs,
        logger,
      }),
  );
  const fleet = new BotFleet({ bots, timers, now: Date.now, random: Math.random, logger });
  const names = config.bots.map((bot) => "@" + bot.account + " (" + bot.style + ")").join(", ");
  logger.info(`bots: ${names} on ${config.server}`);
  fleet.start();
  const shutdown = () => {
    logger.info("bots: stopping");
    fleet.stop().then(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

main();
