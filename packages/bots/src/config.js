/**
 * The house players' configuration, from environment variables, checked at
 * start-up. A misconfiguration stops the process with a message naming the
 * variable; no bot configured is not one (the process waits, doing nothing).
 *
 * - M8_BOT_KEYS: `account:WIF_posting[:style],…` — posting keys only: they
 *   sign in and accept games, nothing they hold can move funds.
 * - M8_BOT_SERVER: where the game server answers (in Docker, http://app:8080).
 * - M8_BOT_ORIGIN: the site's public origin, sent as a browser would (the
 *   server only accepts its own); by default M8_PUBLIC_ORIGIN.
 * - M8_BOT_THINK_MS: how long a bot thinks before each move, `min-max`.
 */
import { decodeWif, isValidAccountName } from "@magic8/steem";
import { AI_STYLES } from "@magic8/engine/domain/ai/BasicAi.js";

export class BotConfigError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "BotConfigError";
  }
}

/** Styles given in turn to bots that name none: each has a manner of its own. */
const DEFAULT_STYLES = Object.freeze(["balanced", "aggressive", "defensive"]);
const DEFAULT_THINK_MS = Object.freeze({ min: 1200, max: 3200 });

/**
 * @typedef {Readonly<{ account: string, postingKey: Uint8Array, style: string }>} BotAccount
 * @typedef {Readonly<{ bots: readonly BotAccount[], server: string, origin: string, thinkMs: Readonly<{ min: number, max: number }>, logLevel: string }>} BotConfig
 */

/**
 * @param {Readonly<Record<string, string | undefined>>} env
 * @returns {BotConfig}
 */
export function loadBotConfig(env) {
  const server = parseOrigin(env.M8_BOT_SERVER ?? "http://127.0.0.1:8080", "M8_BOT_SERVER");
  const origin = parseOrigin(env.M8_BOT_ORIGIN ?? env.M8_PUBLIC_ORIGIN ?? server, env.M8_BOT_ORIGIN === undefined ? "M8_PUBLIC_ORIGIN" : "M8_BOT_ORIGIN");
  return Object.freeze({
    bots: parseBotKeys(env.M8_BOT_KEYS ?? ""),
    server,
    origin,
    thinkMs: parseRange(env.M8_BOT_THINK_MS, "M8_BOT_THINK_MS", DEFAULT_THINK_MS),
    logLevel: env.M8_LOG_LEVEL ?? "info",
  });
}

/**
 * @param {string} value `account:WIF[:style],…`
 * @returns {readonly BotAccount[]}
 */
export function parseBotKeys(value) {
  const entries = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const bots = entries.map((entry, index) => {
    const [account = "", wif = "", style = DEFAULT_STYLES[index % DEFAULT_STYLES.length], ...rest] = entry.split(":").map((part) => part.trim());
    if (rest.length > 0 || !isValidAccountName(account)) {
      throw new BotConfigError(`M8_BOT_KEYS: entry ${index + 1} must be account:WIF_posting[:style]`);
    }
    if (!(/** @type {readonly string[]} */ (AI_STYLES).includes(style))) {
      throw new BotConfigError(`M8_BOT_KEYS: @${account}'s style must be one of ${AI_STYLES.join(", ")}`);
    }
    const postingKey = decodeWif(wif);
    if (postingKey === null) {
      throw new BotConfigError(`M8_BOT_KEYS: @${account}'s key is not a valid WIF private key`);
    }
    return Object.freeze({ account, postingKey, style });
  });
  if (new Set(bots.map((bot) => bot.account)).size !== bots.length) {
    throw new BotConfigError("M8_BOT_KEYS: an account is listed twice");
  }
  return Object.freeze(bots);
}

/**
 * @param {string} value
 * @param {string} name
 */
function parseOrigin(value, name) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new BotConfigError(`${name}: not a URL`);
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.pathname !== "/" || url.search !== "" || url.hash !== "") {
    throw new BotConfigError(`${name}: expected an origin such as https://play.example.com`);
  }
  return url.origin;
}

/**
 * @param {string | undefined} value `min-max`, in milliseconds
 * @param {string} name
 * @param {Readonly<{ min: number, max: number }>} fallback
 */
function parseRange(value, name, fallback) {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }
  const match = /^(\d{1,6})-(\d{1,6})$/.exec(value.trim());
  const min = Number(match?.[1]);
  const max = Number(match?.[2]);
  if (match === null || min > max || max > 60_000) {
    throw new BotConfigError(`${name}: expected min-max in milliseconds, at most 60000 (e.g. 1200-3200)`);
  }
  return Object.freeze({ min, max });
}
