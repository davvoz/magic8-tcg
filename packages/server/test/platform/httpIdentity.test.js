/**
 * The identity API over real HTTP: what a browser (or an attacker) sees.
 */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, utimes, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { createServerApp } from "../../src/app.js";
import { StaticFiles, pageCsp } from "../../src/platform/http/StaticFiles.js";
import { CLIENT_HEADERS, ORIGIN, buildTestApp, bundledContent, keyPair, keychainSign, listen } from "../helpers.js";
import { FakeSteemLedger } from "../support/fakeSteemLedger.js";

const alice = keyPair(1);

/**
 * @param {string} base
 * @param {string} path
 * @param {{ method?: string, body?: unknown, headers?: Record<string, string>, raw?: string }} [options]
 */
async function call(base, path, { method = "GET", body, headers = {}, raw } = {}) {
  const response = await fetch(`${base}${path}`, { method, headers, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
  const text = await response.text();
  return { status: response.status, headers: response.headers, json: text === "" ? null : JSON.parse(text) };
}

/** @param {Headers} headers */
function sessionCookieFrom(headers) {
  const cookie = headers.getSetCookie().find((value) => value.startsWith("m8_session="));
  return cookie === undefined ? null : cookie.split(";")[0];
}

describe("identity over HTTP", () => {
  /** @type {Awaited<ReturnType<typeof buildTestApp>>} */
  let setup;
  /** @type {{ base: string, close: () => Promise<unknown> }} */
  let server;

  before(async () => {
    setup = await buildTestApp();
    setup.chain.setAccount("alice", [alice.publicKey]);
    server = await listen(setup.app);
  });

  after(() => server.close());

  async function login() {
    const challenge = await call(server.base, "/api/auth/challenges", { method: "POST", headers: CLIENT_HEADERS, body: { account: "alice" } });
    assert.equal(challenge.status, 201, JSON.stringify(challenge.json));
    const signature = keychainSign(challenge.json.message, alice.privateKey);
    return call(server.base, "/api/auth/sessions", { method: "POST", headers: CLIENT_HEADERS, body: { challengeId: challenge.json.challengeId, signature } });
  }

  it("signs in, sets a hardened session cookie, serves /api/me, and signs out", async () => {
    const session = await login();
    assert.equal(session.status, 201);
    assert.equal(session.json.user.account, "alice");
    const setCookie = session.headers.getSetCookie()[0];
    for (const attribute of ["HttpOnly", "SameSite=Strict", "Path=/", "Max-Age=604800"]) {
      assert.ok(setCookie.includes(attribute), attribute);
    }
    const cookie = sessionCookieFrom(session.headers);
    const me = await call(server.base, "/api/me", { headers: { Cookie: cookie } });
    assert.deepEqual(me.json, { user: session.json.user });

    const logout = await call(server.base, "/api/auth/sessions/current", { method: "DELETE", headers: { ...CLIENT_HEADERS, Cookie: cookie } });
    assert.equal(logout.status, 204);
    assert.ok(logout.headers.getSetCookie()[0].includes("Max-Age=0"));
    assert.equal((await call(server.base, "/api/me", { headers: { Cookie: cookie } })).status, 401);
  });

  it("rejects cross-site and header-less state-changing requests (CSRF)", async () => {
    const attempts = [
      { ...CLIENT_HEADERS, Origin: "https://evil.example" },
      { "Content-Type": "application/json", Origin: ORIGIN },
      { ...CLIENT_HEADERS, "Sec-Fetch-Site": "cross-site" },
      { "Content-Type": "application/json", "X-M8-Request": "1" },
    ];
    for (const headers of attempts) {
      const response = await call(server.base, "/api/auth/challenges", { method: "POST", headers, body: { account: "alice" } });
      assert.equal(response.status, 403, JSON.stringify(headers));
      assert.equal(response.json.error.code, "CSRF_REJECTED");
    }
  });

  it("validates bodies strictly: type, size, JSON, unknown fields", async () => {
    const cases = [
      [{ raw: "account=alice", headers: { ...CLIENT_HEADERS, "Content-Type": "application/x-www-form-urlencoded" } }, 415],
      [{ raw: "{", headers: CLIENT_HEADERS }, 400],
      [{ body: { account: "alice", admin: true }, headers: CLIENT_HEADERS }, 400],
      [{ body: ["alice"], headers: CLIENT_HEADERS }, 400],
      [{ raw: JSON.stringify({ account: "a".repeat(20_000) }), headers: CLIENT_HEADERS }, 413],
      [{ raw: '{"__proto__":{"admin":true},"account":"alice"}', headers: CLIENT_HEADERS }, 400],
    ];
    for (const [options, status] of cases) {
      const response = await call(server.base, "/api/auth/challenges", { method: "POST", ...options });
      assert.equal(response.status, status, JSON.stringify(options).slice(0, 80));
    }
  });

  it("answers errors with stable codes and no internals", async () => {
    const wrong = await call(server.base, "/api/auth/sessions", { method: "POST", headers: CLIENT_HEADERS, body: { challengeId: "00000000-0000-4000-8000-000000000000", signature: "00" } });
    assert.equal(wrong.status, 401);
    assert.deepEqual(Object.keys(wrong.json.error).sort(), ["code", "message"]);
    assert.equal((await call(server.base, "/api/nope")).status, 404);
    assert.equal((await call(server.base, "/api/me", { method: "POST", headers: CLIENT_HEADERS, body: {} })).status, 405);
    assert.equal((await call(server.base, "/api/me")).status, 401);
  });

  it("sends security headers on API responses", async () => {
    const response = await call(server.base, "/api/me");
    for (const [name, value] of [
      ["x-content-type-options", "nosniff"],
      ["x-frame-options", "DENY"],
      ["referrer-policy", "no-referrer"],
      ["cache-control", "no-store"],
      ["content-security-policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"],
    ]) {
      assert.equal(response.headers.get(name), value, name);
    }
    assert.equal(response.headers.get("strict-transport-security"), null, "no HSTS over plain http");
  });
});

describe("rate limiting", () => {
  it("limits sign-in attempts per IP and says when to retry", async () => {
    const setup = await buildTestApp();
    const server = await listen(setup.app);
    try {
      const statuses = [];
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const response = await call(server.base, "/api/auth/challenges", { method: "POST", headers: CLIENT_HEADERS, body: { account: "alice" } });
        statuses.push(response.status);
        if (response.status === 429) {
          assert.ok(Number(response.headers.get("retry-after")) > 0);
          assert.equal(response.json.error.code, "RATE_LIMITED");
        }
      }
      assert.deepEqual(statuses, [...new Array(10).fill(201), 429, 429]);
      setup.clock.advance(60_000);
      assert.equal((await call(server.base, "/api/auth/challenges", { method: "POST", headers: CLIENT_HEADERS, body: { account: "alice" } })).status, 201);
    } finally {
      await server.close();
    }
  });
});

describe("static client files", () => {
  it("serves files from mounts with a hash-based page CSP and refuses traversal", async () => {
    const root = await mkdtemp(join(tmpdir(), "m8-static-"));
    await mkdir(join(root, "client"));
    await mkdir(join(root, "data"));
    const html = '<!DOCTYPE html><style>body{margin:0}</style><script type="importmap">{"imports":{}}</script><script type="module" src="main.js"></script>';
    await writeFile(join(root, "client", "index.html"), html);
    await writeFile(join(root, "client", "main.js"), "export {};");
    await writeFile(join(root, "data", "cards.json"), "{}");
    await mkdir(join(root, "data", "art"));
    for (const name of ["a.webp", "b.png", "c.jpg", "d.jpeg"]) {
      await writeFile(join(root, "data", "art", name), "img");
    }
    await writeFile(join(root, "secret.txt"), "do not serve");
    const setup = await buildTestApp();
    const app = await createServerApp({
      config: setup.config,
      clock: setup.clock,
      random: { bytes: (length) => new Uint8Array(length) },
      logger: setup.logger,
      wallets: new Map([["steem", { network: "steem", loginKeyRole: "Posting", isValidAccountName: () => true, buildLoginMessage: () => "", verifyLogin: async () => null, isPostingKey: async () => null }]]),
      paymentProviders: new Map([["steem", new FakeSteemLedger().paymentProvider()]]),
      defaultNetwork: "steem",
      database: setup.database,
      content: await bundledContent(),
      staticFiles: new StaticFiles([
        { prefix: "/data/", directory: join(root, "data") },
        { prefix: "/", directory: join(root, "client") },
      ]),
    });
    const server = await listen(app);
    try {
      const page = await fetch(`${server.base}/`);
      assert.equal(page.status, 200);
      assert.equal(page.headers.get("content-security-policy"), pageCsp(html));
      assert.match(page.headers.get("content-security-policy"), /script-src 'self' 'sha256-[A-Za-z0-9+/=]+'/);
      assert.doesNotMatch(page.headers.get("content-security-policy"), /unsafe-inline/);
      // Browsers hash inline blocks after newline normalisation, so a CRLF checkout must give the same policy.
      const multiline = "<style>\n  body { margin: 0; }\n</style>";
      assert.equal(pageCsp(multiline.replaceAll("\n", "\r\n")), pageCsp(multiline));
      assert.equal((await fetch(`${server.base}/data/cards.json`)).status, 200);
      // Card illustrations (data/art/) in every format the manifest accepts.
      for (const [name, type] of [["a.webp", "image/webp"], ["b.png", "image/png"], ["c.jpg", "image/jpeg"], ["d.jpeg", "image/jpeg"]]) {
        const image = await fetch(`${server.base}/data/art/${name}`);
        assert.equal(image.status, 200, name);
        assert.equal(image.headers.get("content-type"), type, name);
      }
      for (const path of ["/../secret.txt", "/%2e%2e/secret.txt", "/data/..%2f..%2fsecret.txt", "/missing.js", "/main.exe"]) {
        assert.equal((await fetch(`${server.base}${path}`)).status, 404, path);
      }
    } finally {
      await server.close();
    }
  });

  it("answers 304 to a copy still current (the service worker asks every time), and serves the app manifest", async () => {
    const root = await mkdtemp(join(tmpdir(), "m8-static-"));
    await writeFile(join(root, "main.js"), "export {};");
    await writeFile(join(root, "app.webmanifest"), "{}");
    const files = new StaticFiles([{ prefix: "/", directory: root }]);
    const server = createServer((request, response) => {
      files.handle(request, response, new URL(request.url ?? "/", "http://localhost").pathname).then((served) => served || response.writeHead(404).end());
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(undefined)));
    const address = /** @type {import("node:net").AddressInfo} */ (server.address());
    const base = `http://127.0.0.1:${address.port}`;
    try {
      const first = await fetch(`${base}/main.js`);
      const etag = first.headers.get("etag");
      assert.match(etag ?? "", /^W\/"[0-9a-f]+-[0-9a-f]+"$/);
      assert.equal(first.headers.get("cache-control"), "no-cache");
      const again = await fetch(`${base}/main.js`, { headers: { "If-None-Match": etag } });
      assert.equal(again.status, 304);
      assert.equal(await again.text(), "");
      assert.equal(again.headers.get("etag"), etag);
      assert.equal((await fetch(`${base}/main.js`, { headers: { "If-None-Match": `"other", ${etag}` } })).status, 304, "one of a list");

      await writeFile(join(root, "main.js"), "export const deployed = true;");
      await utimes(join(root, "main.js"), new Date(), new Date(Date.now() + 60_000));
      const changed = await fetch(`${base}/main.js`, { headers: { "If-None-Match": etag } });
      assert.equal(changed.status, 200, "a deploy changed the file");
      assert.equal(await changed.text(), "export const deployed = true;");
      assert.notEqual(changed.headers.get("etag"), etag);

      assert.equal((await fetch(`${base}/app.webmanifest`)).headers.get("content-type"), "application/manifest+json");
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
