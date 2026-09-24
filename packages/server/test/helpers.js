/**
 * Test wiring: the real server application on a real (PGlite) PostgreSQL
 * database, a manual clock, a deterministic CSPRNG and the real STEEM wallet
 * provider on top of a fake chain (accounts are plain DTOs, as
 * SteemBlockchainProvider returns them).
 */
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { resolve as resolvePath } from "node:path";

import { SteemWalletProvider, base58Encode, publicKeyOf, signMessage } from "@magic8/steem";
import { createServerApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { readServerContent } from "../src/contentFiles.js";
import { MemoryLogger } from "../src/kernel/logger.js";
import { ManualClock } from "../src/kernel/time.js";
import { freshDatabase } from "./support/database.js";
import { FakeSteemLedger } from "./support/fakeSteemLedger.js";

export const ORIGIN = "http://127.0.0.1:8080";
export const DATA_DIRECTORY = resolvePath(import.meta.dirname, "../../../data");

/** @type {ReturnType<typeof readServerContent> | null} */
let bundled = null;

/** The repository's real content and starter offer, read once per test process. */
export function bundledContent() {
  bundled ??= readServerContent(DATA_DIRECTORY);
  return bundled;
}

/** Deterministic "CSPRNG" for tests: SHA-256 in counter mode. */
export function deterministicRandom(label = "tests") {
  let counter = 0;
  return {
    bytes(length) {
      const out = new Uint8Array(length);
      for (let offset = 0; offset < length; offset += 32) {
        counter += 1;
        out.set(createHash("sha256").update(`${label}:${counter}`).digest().subarray(0, Math.min(32, length - offset)), offset);
      }
      return out;
    },
  };
}

/** A user's key pair, as Keychain would hold it. */
export function keyPair(seedByte) {
  const privateKey = new Uint8Array(32).fill(seedByte);
  return { privateKey, publicKey: publicKeyOf(privateKey) };
}

/**
 * The WIF form of a private key, as a wallet exports it.
 * @param {Uint8Array} privateKey
 */
export function toWif(privateKey) {
  const payload = Buffer.from([0x80, ...privateKey]);
  const checksum = createHash("sha256").update(createHash("sha256").update(payload).digest()).digest().subarray(0, 4);
  return base58Encode(Uint8Array.from([...payload, ...checksum]));
}

/**
 * A fake chain behind the real SteemWalletProvider.
 */
export class FakeChain {
  /** @type {Map<string, any>} */
  accounts = new Map();
  unavailable = false;
  calls = 0;

  /**
   * @param {string} name
   * @param {readonly string[]} postingKeys
   * @param {{ threshold?: number }} [options]
   */
  setAccount(name, postingKeys, { threshold = 1 } = {}) {
    const authority = { threshold, keys: postingKeys.map((key) => ({ key, weight: 1 })), accounts: [] };
    this.accounts.set(name, { network: "steem", name, posting: authority, active: authority });
  }

  async getAccount(name) {
    this.calls += 1;
    if (this.unavailable) {
      throw new Error("all nodes failed");
    }
    return this.accounts.get(name) ?? null;
  }
}

export const TEST_APP_NAME = "magic8-tcg";


/**
 * The application on an emptied test database. Everything the server keeps
 * lives in `database`: building a second app on it is a server restart.
 * A restarted app needs its own `random` label, or it would mint the same ids again.
 * @param {{ policy?: object, env?: Record<string, string>, database?: import("../src/platform/db/Database.js").Database, clock?: ManualClock, chain?: FakeChain, random?: ReturnType<typeof deterministicRandom> }} [options]
 */
export async function buildTestApp(options = {}) {
  const { policy = {}, marketplacePolicy = {}, timePolicy = {}, sealingPolicy = {}, publishing = null, chainPolicies = {}, env = {}, database } = options;
  const { clock, chain, random, ledger } = testDoubles(options);
  const paymentProviders = new Map([["steem", ledger.paymentProvider()]]);
  const db = database ?? (await freshDatabase());
  const wallet = new SteemWalletProvider({ chain, appName: TEST_APP_NAME });
  const logger = new MemoryLogger();
  const config = loadConfig({ M8_PUBLIC_ORIGIN: ORIGIN, ...env });
  const app = await createServerApp({
    config,
    clock,
    random,
    logger,
    wallets: new Map([["steem", wallet]]),
    paymentProviders,
    defaultNetwork: "steem",
    database: db,
    content: await bundledContent(),
    identityPolicyOverrides: policy,
    marketplacePolicy,
    timePolicy,
    sealingPolicy,
    publishing,
    chainPolicies,
  });
  return { app, clock, chain, ledger, users: app.users, sessions: app.sessions, challenges: app.challenges, logger, config, database: db };
}

/**
 * @param {{ clock?: ManualClock, chain?: FakeChain, random?: ReturnType<typeof deterministicRandom>, ledger?: FakeSteemLedger }} options
 */
function testDoubles({ clock = new ManualClock(Date.UTC(2026, 8, 24, 10, 0, 0)), chain = new FakeChain(), random = deterministicRandom(), ledger = new FakeSteemLedger() }) {
  return { clock, chain, random, ledger };
}

/**
 * Signs a challenge message the way Keychain's requestSignBuffer does.
 * @param {string} message
 * @param {Uint8Array} privateKey
 */
export function keychainSign(message, privateKey) {
  return signMessage(message, privateKey);
}

/**
 * Starts the app's HTTP listener on an ephemeral port.
 * @param {ReturnType<typeof buildTestApp>["app"]} app
 */
export async function listen(app) {
  const server = createServer(app.http.listener);
  app.realtime?.attach(server);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = /** @type {import("node:net").AddressInfo} */ (server.address());
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => {
      app.realtime?.close();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

/** Headers of a legitimate same-origin state-changing request from our client. */
export const CLIENT_HEADERS = Object.freeze({ "Content-Type": "application/json", Origin: ORIGIN, "X-M8-Request": "1", "Sec-Fetch-Site": "same-origin" });
