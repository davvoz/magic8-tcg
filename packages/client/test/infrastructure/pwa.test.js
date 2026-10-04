/**
 * The game as an installable app (PWA), and the release the page runs:
 * - src/release.js is what tools/stamp-release.js writes for the version in
 *   the root package.json (build null: development);
 * - the manifest, its icons and the page's links to them;
 * - the service worker registration, and the worker itself (run in a sandbox):
 *   network first, a copy only when the network fails, never the API.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { runInNewContext } from "node:vm";

import { RELEASE } from "../../src/release.js";
import { registerServiceWorker } from "../../src/infrastructure/pwa/registerServiceWorker.js";
import { productVersion, releaseModule } from "../../../../tools/stamp-release.js";
import { bumpOf, nextVersion } from "../../../../tools/bump-version.js";
import { MemoryLogger } from "../../src/infrastructure/logging/MemoryLogger.js";

const CLIENT = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, CLIENT), "utf8");

/** @param {string} path a PNG under packages/client/ @returns {{ width: number, height: number }} */
function pngSize(path) {
  const bytes = readFileSync(new URL(path, CLIENT));
  assert.equal(bytes.subarray(1, 4).toString("latin1"), "PNG", `${path} is a PNG`);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe("release", () => {
  it("is the one stamped for the package.json version, without a build outside an image", () => {
    assert.deepEqual({ ...RELEASE }, { version: productVersion(), build: null });
    assert.equal(read("src/release.js").replaceAll("\r\n", "\n"), releaseModule({ version: productVersion(), build: null }), "run: node tools/stamp-release.js");
  });

  it("stamps the deployed commit, and refuses what is not a version or a build", () => {
    assert.match(releaseModule({ version: "1.4.0", build: "0253e2b8a1c3" }), /RELEASE = Object\.freeze\(\{ version: "1\.4\.0", build: "0253e2b8a1c3" \}\);/);
    assert.match(releaseModule({ version: "2.0.0-beta.1", build: null }), /version: "2\.0\.0-beta\.1", build: null/);
    assert.throws(() => releaseModule({ version: "v1", build: null }), /semver/);
    assert.throws(() => releaseModule({ version: "1.0.0", build: '"; alert(1); "' }), /M8_BUILD/);
  });
});

describe("automatic versioning", () => {
  it("bumps by the most significant commit since the last release", () => {
    assert.equal(bumpOf(["fix: typo [deploy]", "chore: deps"]), "patch");
    assert.equal(bumpOf(["fix: typo", "feat(shop): budget [deploy][no test]"]), "minor");
    assert.equal(bumpOf(["feat: a", "refactor(api)!: new routes"]), "major");
    assert.equal(bumpOf(["feat: a", "fix: b\n\nBREAKING CHANGE: the old route is gone"]), "major");
    assert.equal(bumpOf(["update readme", "featuring: not a feature"]), "patch", "anything else is a patch");
    assert.equal(bumpOf(["chore(release): v0.3.0", "", "  "]), null, "nothing to release");
    assert.equal(bumpOf(["chore(release): v0.3.0", "feat: x"]), "minor", "release commits do not count");
  });

  it("computes the next semver", () => {
    assert.equal(nextVersion("0.2.0", "patch"), "0.2.1");
    assert.equal(nextVersion("0.2.7", "minor"), "0.3.0");
    assert.equal(nextVersion("0.9.3", "major"), "1.0.0");
    assert.equal(nextVersion("1.4.0-beta.2", "patch"), "1.4.1");
    assert.throws(() => nextVersion("v1", "patch"), /semver/);
  });
});

describe("app manifest", () => {
  const manifest = JSON.parse(read("app.webmanifest"));

  it("makes the game installable: name, start, display and icons that exist at their size", () => {
    assert.equal(manifest.name, "KIJAM");
    assert.equal(manifest.start_url, "/");
    assert.equal(manifest.scope, "/");
    assert.ok(["fullscreen", "standalone"].includes(manifest.display));
    const sizes = new Set();
    for (const icon of manifest.icons) {
      const [width, height] = icon.sizes.split("x").map(Number);
      assert.deepEqual(pngSize(icon.src), { width, height }, icon.src);
      sizes.add(`${icon.sizes} ${icon.purpose}`);
    }
    for (const required of ["192x192 any", "512x512 any", "512x512 maskable"]) {
      assert.ok(sizes.has(required), required);
    }
  });

  it("is linked by the page, with the touch icon", () => {
    const page = read("index.html");
    assert.match(page, /<link rel="manifest" href="app\.webmanifest">/);
    assert.match(page, /<meta name="theme-color" content="#0a0c14">/);
    const touchIcon = /<link rel="apple-touch-icon" href="([^"]+)">/.exec(page)?.[1];
    assert.deepEqual(pngSize(/** @type {string} */ (touchIcon)), { width: 180, height: 180 });
  });
});

describe("registerServiceWorker", () => {
  it("registers sw.js over the whole site, never from the HTTP cache", async () => {
    const calls = [];
    assert.equal(await registerServiceWorker({ register: async (...args) => (calls.push(args), /** @type {any} */ ({})) }, new MemoryLogger()), true);
    assert.deepEqual(calls, [["/sw.js", { scope: "/", updateViaCache: "none" }]]);
  });

  it("lets the game play without one (an old browser, plain http)", async () => {
    const logger = new MemoryLogger();
    assert.equal(await registerServiceWorker(undefined, logger), false);
    assert.equal(await registerServiceWorker({ register: async () => { throw new DOMException("insecure", "SecurityError"); } }, logger), false);
    assert.equal(logger.entries.length, 1, "the failure is logged");
  });
});

describe("service worker", () => {
  const ORIGIN = "https://tcg.example";

  /** Loads sw.js in a sandbox with a network the test controls and an in-memory cache storage. */
  function loadWorker() {
    /** @type {Map<string, (event: any) => void>} */
    const listeners = new Map();
    /** @type {Map<string, Map<string, Response>>} */
    const stores = new Map([["magic8-offline-old", new Map()]]);
    const network = { online: true, /** @type {(request: { url: string }) => Response} */ answer: () => new Response("file"), requests: 0 };
    const state = { skipped: false, claimed: false };
    const open = async (name) => {
      if (!stores.has(name)) {
        stores.set(name, new Map());
      }
      const store = /** @type {Map<string, Response>} */ (stores.get(name));
      return {
        match: async (request) => store.get(typeof request === "string" ? new URL(request, ORIGIN).href : request.url)?.clone(),
        put: async (request, response) => void store.set(request.url, response),
      };
    };
    const caches = {
      keys: async () => [...stores.keys()],
      delete: async (name) => stores.delete(name),
      open,
      match: async (request) => {
        for (const name of stores.keys()) {
          const found = await (await open(name)).match(request);
          if (found !== undefined) {
            return found;
          }
        }
        return undefined;
      },
    };
    const self = {
      location: new URL(`${ORIGIN}/sw.js`),
      addEventListener: (type, listener) => listeners.set(type, listener),
      skipWaiting: () => (state.skipped = true),
      clients: { claim: async () => void (state.claimed = true) },
    };
    const fetch = async (request) => {
      network.requests += 1;
      if (!network.online) {
        throw new TypeError("Failed to fetch");
      }
      return network.answer(request);
    };
    runInNewContext(read("sw.js"), { self, caches, fetch, URL });

    /**
     * What the browser hands the worker for a request (a page load has mode "navigate", which a Request cannot be built with).
     * @param {string} path @param {{ method?: string, mode?: string }} [init]
     * @returns {Promise<Response | null>} null: the worker left it to the browser
     */
    async function fetchThrough(path, { method = "GET", mode = "cors" } = {}) {
      /** @type {Promise<Response> | null} */
      let responded = null;
      /** @type {Promise<unknown>[]} */
      const waits = [];
      const target = { url: new URL(path, ORIGIN).href, method, mode, headers: new Headers() };
      listeners.get("fetch")?.({ request: target, respondWith: (promise) => (responded = promise), waitUntil: (promise) => waits.push(promise) });
      const response = responded === null ? null : await responded;
      await Promise.all(waits);
      return response;
    }

    async function lifecycle() {
      const waits = [];
      listeners.get("install")?.({ waitUntil: (promise) => waits.push(promise) });
      listeners.get("activate")?.({ waitUntil: (promise) => waits.push(promise) });
      await Promise.all(waits);
    }

    return { network, stores, state, fetchThrough, lifecycle };
  }

  it("takes over at once and drops the copies of an older worker", async () => {
    const worker = loadWorker();
    await worker.lifecycle();
    assert.deepEqual(worker.state, { skipped: true, claimed: true });
    assert.deepEqual([...worker.stores.keys()], [], "the old cache is gone");
  });

  it("always asks the network first: a deploy is seen on the next load", async () => {
    const worker = loadWorker();
    worker.network.answer = () => new Response("v1", { headers: { ETag: 'W/"1"' } });
    assert.equal(await (await worker.fetchThrough("/src/main.js"))?.text(), "v1");
    worker.network.answer = () => new Response("v2", { headers: { ETag: 'W/"2"' } });
    assert.equal(await (await worker.fetchThrough("/src/main.js"))?.text(), "v2", "never the copy while online");
    assert.equal(worker.network.requests, 2);
  });

  it("serves the copy only when the network fails, and the game's page for any page", async () => {
    const worker = loadWorker();
    worker.network.answer = (request) => new Response(new URL(request.url).pathname);
    await worker.fetchThrough("/");
    await worker.fetchThrough("/src/main.js");
    worker.network.online = false;
    assert.equal(await (await worker.fetchThrough("/src/main.js"))?.text(), "/src/main.js");
    assert.equal(await (await worker.fetchThrough("/?source=homescreen", { mode: "navigate" }))?.text(), "/", "opened from the home screen offline");
    await assert.rejects(() => worker.fetchThrough("/never-seen.js"), TypeError, "nothing kept: the network error");
  });

  it("passes a server error through (nginx's maintenance page during a deploy) and keeps nothing of it", async () => {
    const worker = loadWorker();
    worker.network.answer = () => new Response("<h1>Maintenance</h1>", { status: 502 });
    assert.equal((await worker.fetchThrough("/"))?.status, 502);
    worker.network.online = false;
    await assert.rejects(() => worker.fetchThrough("/"), TypeError);
  });

  it("leaves the API, the WebSocket, other sites and writes alone", async () => {
    const worker = loadWorker();
    for (const path of ["/api/maintenance", "/ws", "https://steemitimages.com/u/alice/avatar"]) {
      assert.equal(await worker.fetchThrough(path), null, path);
    }
    assert.equal(await worker.fetchThrough("/src/main.js", { method: "POST" }), null);
    assert.equal(worker.network.requests, 0);
  });
});
