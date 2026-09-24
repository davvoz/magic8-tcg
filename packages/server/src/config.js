/**
 * Server configuration from environment variables, validated at startup.
 * Nothing secret has a default; a misconfiguration stops the process with a
 * message naming the variable.
 */

/** Priority order: the first healthy node answers; the others are failover. */
export const DEFAULT_STEEM_NODES = Object.freeze(["https://api.moecki.online", "https://api.justyy.com", "https://api.steemit.com", "https://api.steemitdev.com"]);

export const DEFAULT_DEVELOPMENT_DATABASE = "pglite:.data/pglite";

export class ConfigError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "ConfigError";
  }
}

/**
 * @param {Readonly<Record<string, string | undefined>>} env
 */
export function loadConfig(env) {
  const publicOrigin = parseOrigin(env.M8_PUBLIC_ORIGIN ?? "http://127.0.0.1:8080", "M8_PUBLIC_ORIGIN");
  const secure = publicOrigin.startsWith("https://");
  const nodes = (env.M8_STEEM_NODES ?? DEFAULT_STEEM_NODES.join(",")).split(",").map((node) => node.trim()).filter((node) => node.length > 0);
  if (nodes.length === 0) {
    throw new ConfigError("M8_STEEM_NODES: at least one node is required");
  }
  return Object.freeze({
    host: env.M8_HOST ?? "127.0.0.1",
    port: parsePort(env.M8_PORT ?? "8080"),
    publicOrigin,
    allowedOrigins: Object.freeze([publicOrigin]),
    secure,
    trustProxy: parseBoolean(env.M8_TRUST_PROXY ?? "false", "M8_TRUST_PROXY"),
    appName: env.M8_APP_NAME ?? "luciojolly",
    logLevel: parseEnum(env.M8_LOG_LEVEL ?? "info", ["debug", "info", "warn", "error"], "M8_LOG_LEVEL"),
    steemNodes: Object.freeze(nodes),
    sessionCookieName: secure ? "__Host-m8_session" : "m8_session",
    maxBodyBytes: 16 * 1024,
    serveClient: parseBoolean(env.M8_SERVE_CLIENT ?? "true", "M8_SERVE_CLIENT"),
    databaseUrl: parseDatabaseUrl(env.M8_DATABASE_URL, secure),
  });
}

/**
 * Without a URL, local development gets an embedded PGlite database in
 * .data/pglite. A public (https) deployment must name a PostgreSQL server:
 * PGlite is single-process and meant for development.
 * @param {string | undefined} value
 * @param {boolean} secure
 */
function parseDatabaseUrl(value, secure) {
  if (value === undefined || value === "") {
    if (secure) {
      throw new ConfigError("M8_DATABASE_URL: required for an https deployment (postgres://…)");
    }
    return DEFAULT_DEVELOPMENT_DATABASE;
  }
  if (value.startsWith("pglite:")) {
    if (secure) {
      throw new ConfigError("M8_DATABASE_URL: pglite is for local development; use postgres://… in production");
    }
    return value;
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigError("M8_DATABASE_URL: not a URL");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new ConfigError("M8_DATABASE_URL: expected postgres://… or pglite:…");
  }
  return value;
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
    throw new ConfigError(`${name}: not a URL`);
  }
  if (!["https:", "http:"].includes(url.protocol) || url.pathname !== "/" || url.search !== "" || url.hash !== "" || url.username !== "") {
    throw new ConfigError(`${name}: expected an origin like https://play.example`);
  }
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (url.protocol === "http:" && !local) {
    throw new ConfigError(`${name}: plain http is only allowed for localhost`);
  }
  return url.origin;
}

/**
 * @param {string} value
 */
function parsePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigError("M8_PORT: expected a port number");
  }
  return port;
}

/**
 * @param {string} value
 * @param {string} name
 */
function parseBoolean(value, name) {
  if (value !== "true" && value !== "false") {
    throw new ConfigError(`${name}: expected true or false`);
  }
  return value === "true";
}

/**
 * @template {string} T
 * @param {string} value
 * @param {readonly T[]} allowed
 * @param {string} name
 * @returns {T}
 */
function parseEnum(value, allowed, name) {
  if (!allowed.includes(/** @type {T} */ (value))) {
    throw new ConfigError(`${name}: expected one of ${allowed.join(", ")}`);
  }
  return /** @type {T} */ (value);
}
