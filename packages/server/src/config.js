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
    shopAccounts: Object.freeze({ steem: parseAccount(env.M8_SHOP_ACCOUNT ?? "luciojolly", "M8_SHOP_ACCOUNT") }),
    ...parseChainSettings(env),
    ...parseDataKeys(env, secure),
  });
}

/** Development only: a fixed, public data key so local epochs survive restarts. Never accepted over https. */
export const DEVELOPMENT_DATA_KEY = "6d38746367206465762064617461206b6579206e6f7420736563726574202020";

/**
 * Keys that encrypt secrets at rest (SecretBox). M8_DATA_KEY is the current
 * key, 64 hex characters; M8_DATA_KEY_ID its id (0..255, default 1).
 * M8_DATA_KEYS_OLD lists retired keys as "id:hex,id:hex" so rows sealed
 * before a rotation still open.
 * @param {Readonly<Record<string, string | undefined>>} env
 * @param {boolean} secure
 */
function parseDataKeys(env, secure) {
  const current = env.M8_DATA_KEY;
  if ((current === undefined || current === "") && secure) {
    throw new ConfigError("M8_DATA_KEY: required for an https deployment (64 hex characters, e.g. openssl rand -hex 32)");
  }
  const dataKeyId = parseKeyId(env.M8_DATA_KEY_ID ?? "1", "M8_DATA_KEY_ID");
  /** @type {Map<number, string>} */
  const keys = new Map([[dataKeyId, parseKeyHex(current || DEVELOPMENT_DATA_KEY, "M8_DATA_KEY")]]);
  for (const entry of (env.M8_DATA_KEYS_OLD ?? "").split(",").filter((text) => text.trim() !== "")) {
    const [id, hex] = entry.trim().split(":");
    const oldId = parseKeyId(id ?? "", "M8_DATA_KEYS_OLD");
    if (keys.has(oldId)) {
      throw new ConfigError(`M8_DATA_KEYS_OLD: key id ${oldId} is listed twice`);
    }
    keys.set(oldId, parseKeyHex(hex ?? "", "M8_DATA_KEYS_OLD"));
  }
  return { dataKeyId, dataKeys: keys, dataKeyIsDevelopment: current === undefined || current === "" };
}

/**
 * @param {string} value
 * @param {string} name
 */
function parseKeyId(value, name) {
  const id = Number(value);
  if (!/^\d{1,3}$/.test(value) || id > 255) {
    throw new ConfigError(`${name}: key ids are integers 0..255`);
  }
  return id;
}

/**
 * @param {string} value
 * @param {string} name
 */
function parseKeyHex(value, name) {
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new ConfigError(`${name}: expected 64 lowercase hex characters`);
  }
  return value;
}

/**
 * The root account whose manifests authorise the broadcasters (docs/tcg/03 §11), and the broadcaster keys.
 * @param {Readonly<Record<string, string | undefined>>} env
 */
function parseChainSettings(env) {
  return {
    rootAccounts: Object.freeze({ steem: parseAccount(env.M8_ROOT_ACCOUNT ?? "luciojolly", "M8_ROOT_ACCOUNT") }),
    broadcasterKeys: parseBroadcasterKeys(env.M8_BROADCASTER_KEYS ?? ""),
  };
}

/**
 * M8_BROADCASTER_KEYS: "account:WIF,account:WIF", the posting keys of the
 * broadcaster accounts (docs/tcg/03 §2). Never an active or owner key: the
 * server checks the account's authorities at startup and refuses to run.
 * Empty: nothing is published, records wait in the outbox.
 * @param {string} value
 * @returns {ReadonlyMap<string, string>}
 */
function parseBroadcasterKeys(value) {
  /** @type {Map<string, string>} */
  const keys = new Map();
  for (const entry of value.split(",").map((text) => text.trim()).filter((text) => text !== "")) {
    const separator = entry.indexOf(":");
    const account = parseAccount(entry.slice(0, Math.max(separator, 0)), "M8_BROADCASTER_KEYS");
    const wif = entry.slice(separator + 1);
    if (!/^5[1-9A-HJ-NP-Za-km-z]{50}$/.test(wif)) {
      throw new ConfigError(`M8_BROADCASTER_KEYS: the key of ${account} is not a WIF private key`);
    }
    if (keys.has(account)) {
      throw new ConfigError(`M8_BROADCASTER_KEYS: ${account} is listed twice`);
    }
    keys.set(account, wif);
  }
  return keys;
}

/**
 * @param {string} value
 * @param {string} name
 */
function parseAccount(value, name) {
  if (!/^[a-z][a-z0-9.-]{2,15}$/.test(value)) {
    throw new ConfigError(`${name}: not a valid account name`);
  }
  return value;
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
