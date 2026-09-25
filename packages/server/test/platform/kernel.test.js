import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ConfigError, DEFAULT_DEVELOPMENT_DATABASE, loadConfig } from "../../src/config.js";
import { AUDIT_GENESIS, AuditTrail } from "../../src/kernel/audit/AuditTrail.js";
import { PgAuditStore } from "../../src/platform/audit/PgAuditStore.js";
import { DbErrorCode } from "../../src/platform/db/DbError.js";
import { MemoryLogger, createJsonLogger, redact } from "../../src/kernel/logger.js";
import { isUuid, uuidV4 } from "../../src/kernel/random.js";
import { ManualClock } from "../../src/kernel/time.js";
import { parseCookies, serializeCookie } from "../../src/platform/http/cookies.js";
import { RateLimiter } from "../../src/platform/http/RateLimiter.js";
import { Router } from "../../src/platform/http/Router.js";
import { identityPolicy } from "../../src/modules/identity/index.js";
import { deterministicRandom } from "../helpers.js";
import { freshDatabase } from "../support/database.js";

describe("cookies", () => {
  it("parses strictly and keeps the first of duplicate names", () => {
    const cookies = parseCookies("a=1; m8_session=abc_-; bad name=x; a=2; weird=va;lue; __Host-x=y; evil=<script>");
    assert.equal(cookies.get("a"), "1");
    assert.equal(cookies.get("m8_session"), "abc_-");
    assert.equal(cookies.get("__Host-x"), "y");
    assert.equal(cookies.has("evil"), false);
    assert.equal(parseCookies("x".repeat(5000)).size, 0);
    assert.equal(parseCookies(undefined).size, 0);
  });

  it("serialises with explicit attributes and refuses unsafe values", () => {
    assert.equal(serializeCookie({ name: "__Host-s", value: "v", maxAgeSeconds: 60.9, secure: true }), "__Host-s=v; Path=/; Max-Age=60; SameSite=Strict; HttpOnly; Secure");
    assert.throws(() => serializeCookie({ name: "__Host-s", value: "v", maxAgeSeconds: 1, secure: false }), TypeError);
    assert.throws(() => serializeCookie({ name: "s", value: "a;b", maxAgeSeconds: 1, secure: false }), TypeError);
  });
});

describe("Router", () => {
  const noop = async () => ({ status: 204 });

  it("matches parameters with a restricted character set", () => {
    const router = new Router().add({ method: "GET", path: "/api/orders/:id", handler: noop });
    assert.deepEqual(router.match("GET", "/api/orders/0f8e-12").params, { id: "0f8e-12" });
    assert.equal(router.match("GET", "/api/orders/a.b").route, null);
    assert.equal(router.match("GET", "/api/orders").route, null);
    assert.equal(router.match("POST", "/api/orders/x").methodMismatch, true);
  });

  it("defaults CSRF protection on for state-changing methods", () => {
    const router = new Router().add({ method: "POST", path: "/api/x", handler: noop }).add({ method: "GET", path: "/api/x", handler: noop });
    assert.equal(router.match("POST", "/api/x").route.csrf, true);
    assert.equal(router.match("GET", "/api/x").route.csrf, false);
  });

  it("refuses bad definitions", () => {
    assert.throws(() => new Router().add({ method: "PATCH", path: "/api/x", handler: noop }), TypeError);
    assert.throws(() => new Router().add({ method: "GET", path: "api/x", handler: noop }), TypeError);
    assert.throws(() => new Router().add({ method: "GET", path: "/api/X Y", handler: noop }), TypeError);
    const router = new Router().add({ method: "GET", path: "/api/x", handler: noop });
    assert.throws(() => router.add({ method: "GET", path: "/api/x", handler: noop }), TypeError);
  });
});

describe("RateLimiter", () => {
  it("refills over time and isolates keys and buckets", () => {
    const clock = new ManualClock(0);
    const limiter = new RateLimiter({ now: () => clock.now() });
    const policy = { name: "p", capacity: 2, refillPerSecond: 1 };
    assert.equal(limiter.take(policy, "a").allowed, true);
    assert.equal(limiter.take(policy, "a").allowed, true);
    assert.deepEqual(limiter.take(policy, "a"), { allowed: false, retryAfterSeconds: 1 });
    assert.equal(limiter.take(policy, "b").allowed, true);
    assert.equal(limiter.take({ ...policy, name: "q" }, "a").allowed, true);
    clock.advance(1000);
    assert.equal(limiter.take(policy, "a").allowed, true);
  });

  it("bounds its memory", () => {
    const limiter = new RateLimiter({ now: () => 0, maxKeys: 3 });
    const policy = { name: "p", capacity: 1, refillPerSecond: 1 };
    for (const key of ["a", "b", "c", "d"]) {
      limiter.take(policy, key);
    }
    assert.equal(limiter.take(policy, "a").allowed, true, "the oldest key was evicted");
  });
});

describe("config", () => {
  const DATA_KEY = "ab".repeat(32);
  const ACK_KEY = "5JdeC9P7Pbd1uGdFVEsJ41EkEnADbbHGq6p1BwFxm6txNBsQnsw";
  const PRODUCTION = Object.freeze({ M8_PUBLIC_ORIGIN: "https://play.example", M8_DATABASE_URL: "postgres://app@db.internal:5432/tcg?sslmode=require", M8_DATA_KEY: DATA_KEY, M8_ACK_KEY: ACK_KEY });

  it("derives secure settings from an https origin", () => {
    const config = loadConfig({ ...PRODUCTION, M8_PORT: "9000" });
    assert.equal(config.secure, true);
    assert.equal(config.sessionCookieName, "__Host-m8_session");
    assert.deepEqual(config.allowedOrigins, ["https://play.example"]);
    assert.equal(config.port, 9000);
    assert.equal(config.databaseUrl, PRODUCTION.M8_DATABASE_URL);
    assert.equal(config.dataKeyIsDevelopment, false);
    assert.deepEqual([...config.dataKeys], [[1, DATA_KEY]]);
    assert.equal(config.ackKey, ACK_KEY);
  });

  it("keeps retired data keys for rotation, and uses the public development key only locally", () => {
    const rotated = loadConfig({ ...PRODUCTION, M8_DATA_KEY_ID: "2", M8_DATA_KEYS_OLD: `1:${"cd".repeat(32)}` });
    assert.equal(rotated.dataKeyId, 2);
    assert.deepEqual([...rotated.dataKeys.keys()].sort(), [1, 2]);
    const local = loadConfig({});
    assert.equal(local.dataKeyIsDevelopment, true);
    assert.equal(local.shopAccounts.steem, "luciojolly");
    assert.equal(loadConfig({ M8_SHOP_ACCOUNT: "shop.m8" }).shopAccounts.steem, "shop.m8");
  });

  it("reads the broadcaster posting keys and the root account, and refuses malformed ones", () => {
    const wif = "5JRaypasxMx1L97ZUX7YuC5Psb5EAbF821kkAGtBj7xCJFQcbLg";
    const config = loadConfig({ M8_BROADCASTER_KEYS: ` m8tcg-b1:${wif}, m8tcg-b2:${wif} `, M8_ROOT_ACCOUNT: "m8tcg" });
    assert.deepEqual([...config.broadcasterKeys.keys()], ["m8tcg-b1", "m8tcg-b2"]);
    assert.equal(config.rootAccounts.steem, "m8tcg");
    assert.equal(JSON.stringify(config).includes(wif), false, "keys never show up when the configuration is serialized");
    assert.equal(loadConfig({}).broadcasterKeys.size, 0, "none by default: nothing is published");
    assert.equal(loadConfig({}).rootAccounts.steem, "luciojolly");
    assert.throws(() => loadConfig({ M8_BROADCASTER_KEYS: "m8tcg-b1:not-a-key" }), /not a WIF/);
    assert.throws(() => loadConfig({ M8_BROADCASTER_KEYS: `${wif}` }), /M8_BROADCASTER_KEYS/);
    assert.throws(() => loadConfig({ M8_BROADCASTER_KEYS: `m8tcg-b1:${wif},m8tcg-b1:${wif}` }), /twice/);
  });

  it("defaults to the launch settings for local development", () => {
    const config = loadConfig({});
    assert.equal(config.steemNodes[0], "https://api.moecki.online", "moecki is the primary node");
    assert.ok(config.steemNodes.length > 1, "with public fallbacks");
    assert.equal(config.appName, "luciojolly");
    assert.equal(config.databaseUrl, DEFAULT_DEVELOPMENT_DATABASE);
  });

  it("refuses unsafe or malformed settings", () => {
    for (const env of [
      { M8_PUBLIC_ORIGIN: "http://play.example" },
      { M8_PUBLIC_ORIGIN: "https://play.example/path" },
      { M8_PUBLIC_ORIGIN: "ftp://play.example" },
      { M8_PORT: "70000" },
      { M8_TRUST_PROXY: "yes" },
      { M8_LOG_LEVEL: "loud" },
      { M8_STEEM_NODES: " , " },
      { M8_PUBLIC_ORIGIN: "https://play.example" },
      { ...PRODUCTION, M8_DATABASE_URL: "pglite:.data/pglite" },
      { M8_DATABASE_URL: "mysql://db/tcg" },
      { M8_DATABASE_URL: "not a url" },
      { ...PRODUCTION, M8_DATA_KEY: "" },
      { ...PRODUCTION, M8_DATA_KEY: "AB".repeat(32) },
      { ...PRODUCTION, M8_DATA_KEY: "ab".repeat(31) },
      { ...PRODUCTION, M8_DATA_KEY_ID: "256" },
      { ...PRODUCTION, M8_DATA_KEYS_OLD: `1:${"cd".repeat(32)}` },
      { ...PRODUCTION, M8_DATA_KEYS_OLD: "2:short" },
      { M8_SHOP_ACCOUNT: "Not An Account" },
      { ...PRODUCTION, M8_ACK_KEY: "" },
      { ...PRODUCTION, M8_ACK_KEY: "not-a-wif" },
      { ...PRODUCTION, M8_BROADCASTER_KEYS: `m8tcg.b1:${ACK_KEY}` },
    ]) {
      assert.throws(() => loadConfig(env), ConfigError, JSON.stringify(env));
    }
  });
});

describe("logger", () => {
  it("redacts secrets however deeply they are nested", () => {
    const redacted = redact({ user: "alice", token: "t", nested: { sessionToken: "x", list: [{ signature: "s", ok: 1 }] }, cookie: "c", wif: "5K" });
    assert.deepEqual(redacted, { user: "alice", token: "[redacted]", nested: { sessionToken: "[redacted]", list: [{ signature: "[redacted]", ok: 1 }] }, cookie: "[redacted]", wif: "[redacted]" });
  });

  it("writes JSON lines above the configured level", () => {
    const lines = [];
    const logger = createJsonLogger({ write: (line) => lines.push(line), level: "warn", now: () => 0 });
    logger.info("hidden");
    logger.error("shown", { secret: "s", error: new Error("boom") });
    assert.equal(lines.length, 1);
    assert.deepEqual(JSON.parse(lines[0]), { at: "1970-01-01T00:00:00.000Z", level: "error", message: "shown", secret: "[redacted]", error: { name: "Error", message: "boom" } });
    const memory = new MemoryLogger();
    memory.warn("w", { password: "p" });
    assert.deepEqual(memory.entries[0].fields, { password: "[redacted]" });
  });
});

describe("AuditTrail", () => {
  /** Rewrites history the way only someone bypassing the application could: triggers off, then SQL. */
  async function tamper(database, statement) {
    await database.exec("ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_append_only");
    await database.exec(statement);
    await database.exec("ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_append_only");
  }

  it("chains concurrent entries without forking, across trail instances", async () => {
    const database = await freshDatabase();
    const store = new PgAuditStore(database);
    const trails = [new AuditTrail({ store, clock: new ManualClock(1000) }), new AuditTrail({ store, clock: new ManualClock(2000) })];
    await Promise.all([1, 2, 3, 4, 5, 6].map((index) => trails[index % 2].record({ actorKind: "system", action: "test.event", ip: "::1", details: { index, nested: { b: 1, a: "x" } } })));
    const entries = await store.list(1, 10);
    assert.deepEqual(entries.map((entry) => entry.seq), [1, 2, 3, 4, 5, 6], "two processes appending never fork the chain");
    assert.equal(entries[0].prevHash, AUDIT_GENESIS);
    assert.equal(entries[1].prevHash, entries[0].hash);
    assert.equal(await trails[0].verify(2), null, "verification pages through the chain");
  });

  it("refuses edits and deletions, and detects them when the triggers are bypassed", async () => {
    const database = await freshDatabase();
    const trail = new AuditTrail({ store: new PgAuditStore(database), clock: new ManualClock(1000) });
    for (const index of [1, 2, 3, 4]) {
      await trail.record({ actorKind: "system", action: "test.event", details: { index } });
    }
    await assert.rejects(database.query("UPDATE audit_logs SET action = 'test.other' WHERE seq = 2"), (error) => error.code === DbErrorCode.FORBIDDEN_MUTATION);
    await assert.rejects(database.query("DELETE FROM audit_logs WHERE seq = 2"), (error) => error.code === DbErrorCode.FORBIDDEN_MUTATION);

    await tamper(database, `UPDATE audit_logs SET details = '{"index": 99}' WHERE seq = 3`);
    assert.equal(await trail.verify(), 3, "an edited entry breaks its own hash");
    await tamper(database, "DELETE FROM audit_logs WHERE seq = 2");
    assert.equal(await trail.verify(), 2, "a removed entry leaves a gap");
  });

  it("rolls back with the transaction it was recorded in", async () => {
    const database = await freshDatabase();
    const trail = new AuditTrail({ store: new PgAuditStore(database), clock: new ManualClock(1000) });
    await assert.rejects(
      database.transaction(async () => {
        await trail.record({ actorKind: "system", action: "test.event" });
        throw new Error("the operation failed");
      }),
    );
    assert.equal((await database.rows("SELECT seq FROM audit_logs")).length, 0);
    await trail.record({ actorKind: "system", action: "test.event" });
    assert.equal(await trail.verify(), null);
  });

  it("refuses malformed actions", async () => {
    const trail = new AuditTrail({ store: new PgAuditStore(await freshDatabase()), clock: new ManualClock() });
    assert.throws(() => trail.record({ actorKind: "system", action: "Drop Table" }), TypeError);
  });
});

describe("ids and policies", () => {
  it("makes RFC 4122 v4 UUIDs", () => {
    const random = deterministicRandom("uuid");
    const ids = new Set(Array.from({ length: 50 }, () => uuidV4(random)));
    assert.equal(ids.size, 50);
    assert.ok([...ids].every(isUuid));
    assert.equal(isUuid("not-a-uuid"), false);
  });

  it("validates identity policies", () => {
    assert.throws(() => identityPolicy({ challengeTtlMs: 0 }), TypeError);
    assert.throws(() => identityPolicy({ challengeTtlMs: 3_600_000 }), TypeError);
    assert.throws(() => identityPolicy({ sessionIdleTtlMs: 10, sessionAbsoluteTtlMs: 5 }), TypeError);
  });
});

describe("parseJson (untrusted input)", () => {
  it("parses ordinary JSON and refuses prototype keys and deep nesting", async () => {
    const { JsonInputError, parseJson } = await import("../../src/kernel/json.js");
    assert.deepEqual(parseJson('{"a":[1,{"b":null}]}'), { a: [1, { b: null }] });
    for (const hostile of ['{"__proto__":{"admin":true}}', '{"a":{"constructor":{"prototype":{}}}}', '[{"prototype":1}]']) {
      assert.throws(() => parseJson(hostile), JsonInputError, hostile);
    }
    assert.equal({}.admin, undefined, "nothing polluted");
    assert.throws(() => parseJson("[".repeat(40) + "]".repeat(40)), /deeper than 32/);
    assert.doesNotThrow(() => parseJson("[".repeat(32) + "]".repeat(32)));
    assert.throws(() => parseJson("{nope}"), /not valid JSON/);
  });
});

describe("clientAddress", () => {
  const request = (forwarded, remoteAddress = "10.0.0.2") => ({ headers: forwarded === undefined ? {} : { "x-forwarded-for": forwarded }, socket: { remoteAddress } });

  it("trusts only the entry the reverse proxy appended, never what the client wrote", async () => {
    const { clientAddress } = await import("../../src/platform/http/clientAddress.js");
    assert.equal(clientAddress(request("203.0.113.9"), true), "203.0.113.9");
    assert.equal(clientAddress(request("1.2.3.4, 203.0.113.9"), true), "203.0.113.9", "a forged first entry is ignored");
    assert.equal(clientAddress(request("203.0.113.9, not-an-address"), true), "10.0.0.2");
    assert.equal(clientAddress(request(undefined), true), "10.0.0.2");
    assert.equal(clientAddress(request("203.0.113.9"), false), "10.0.0.2", "without a proxy the header means nothing");
  });
});

describe("config: operations", () => {
  it("reads the operator accounts and the metrics token", () => {
    const local = loadConfig({});
    assert.deepEqual(local.adminAccounts.steem, ["luciojolly"], "the shop account by default");
    assert.equal(local.metricsToken, null, "no token: no metrics endpoint");
    const configured = loadConfig({ M8_ADMIN_ACCOUNTS: "ops-one, ops-two", M8_METRICS_TOKEN: "a".repeat(32) });
    assert.deepEqual(configured.adminAccounts.steem, ["ops-one", "ops-two"]);
    assert.equal(configured.metricsToken, "a".repeat(32));
    assert.throws(() => loadConfig({ M8_METRICS_TOKEN: "short" }), /M8_METRICS_TOKEN/);
    assert.throws(() => loadConfig({ M8_ADMIN_ACCOUNTS: "Not Valid" }), /M8_ADMIN_ACCOUNTS/);
  });
});
