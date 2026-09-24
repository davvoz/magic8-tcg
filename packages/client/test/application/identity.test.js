import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fail, ok } from "@magic8/engine/shared/Result.js";
import { IdentityService, IdentityStatus } from "../../src/application/identity/IdentityService.js";
import { HttpAuthApi } from "../../src/infrastructure/api/HttpAuthApi.js";
import { KeychainWalletConnector } from "../../src/infrastructure/wallet/KeychainWalletConnector.js";

const USER = Object.freeze({ id: "u1", network: "steem", account: "alice" });
const SIGNATURE = "20" + "ab".repeat(64);

/** A scripted AuthApi. */
function fakeApi(overrides = {}) {
  const calls = [];
  const api = {
    currentUser: async () => ok(null),
    createChallenge: async (account) => ok({ challengeId: "c1", message: `login ${account}`, keyRole: "Posting", expiresAt: 1 }),
    createSession: async () => ok(USER),
    deleteSession: async () => ok(null),
    ...overrides,
  };
  const recorded = Object.fromEntries(Object.entries(api).map(([name, fn]) => [name, async (...args) => (calls.push({ name, args }), fn(...args))]));
  return { api: recorded, calls };
}

/** A scripted wallet. */
function fakeWallet({ available = true, sign = async () => ok(SIGNATURE) } = {}) {
  const requests = [];
  return {
    wallet: { name: "Steem Keychain", isAvailable: () => available, signMessage: async (request) => (requests.push(request), sign(request)) },
    requests,
  };
}

describe("IdentityService", () => {
  it("restores the signed-in user from the server", async () => {
    const service = new IdentityService({ api: fakeApi({ currentUser: async () => ok(USER) }).api, wallet: fakeWallet().wallet });
    assert.equal(service.state.status, IdentityStatus.UNKNOWN);
    await service.restore();
    assert.deepEqual(service.state, { status: IdentityStatus.SIGNED_IN, user: USER, error: null });
  });

  it("is offline when no game server answers, signed out otherwise", async () => {
    const offline = new IdentityService({ api: fakeApi({ currentUser: async () => fail("NETWORK", "down") }).api, wallet: fakeWallet().wallet });
    assert.equal((await offline.restore()).status, IdentityStatus.OFFLINE);
    const signedOut = new IdentityService({ api: fakeApi().api, wallet: fakeWallet().wallet });
    assert.equal((await signedOut.restore()).status, IdentityStatus.SIGNED_OUT);
  });

  it("signs in: challenge, wallet signature of the exact message with the requested key, session", async () => {
    const { api, calls } = fakeApi();
    const { wallet, requests } = fakeWallet();
    const service = new IdentityService({ api, wallet });
    const states = [];
    service.subscribe((state) => states.push(state.status));
    const result = await service.signIn("  @Alice ");
    assert.deepEqual(result, { ok: true, value: USER });
    assert.deepEqual(requests, [{ account: "alice", message: "login alice", keyRole: "Posting" }]);
    assert.deepEqual(calls.map((call) => call.name), ["createChallenge", "createSession"]);
    assert.deepEqual(calls[1].args[0], { challengeId: "c1", signature: SIGNATURE });
    assert.deepEqual(states, [IdentityStatus.SIGNING_IN, IdentityStatus.SIGNED_IN]);
  });

  it("stops early on an invalid name or a missing wallet, without calling the server", async () => {
    const { api, calls } = fakeApi();
    const invalid = await new IdentityService({ api, wallet: fakeWallet().wallet }).signIn("no spaces allowed");
    assert.equal(invalid.error.code, "INVALID_ACCOUNT");
    const missing = await new IdentityService({ api, wallet: fakeWallet({ available: false }).wallet }).signIn("alice");
    assert.equal(missing.error.code, "WALLET_NOT_INSTALLED");
    assert.equal(calls.length, 0);
  });

  it("reports wallet refusals and server rejections, ending signed out", async () => {
    const rejected = new IdentityService({ api: fakeApi().api, wallet: fakeWallet({ sign: async () => fail("WALLET_REJECTED", "cancel") }).wallet });
    assert.equal((await rejected.signIn("alice")).error.code, "WALLET_REJECTED");
    assert.equal(rejected.state.status, IdentityStatus.SIGNED_OUT);
    assert.equal(rejected.state.error.code, "WALLET_REJECTED");

    const refused = new IdentityService({ api: fakeApi({ createSession: async () => fail("LOGIN_FAILED", "no") }).api, wallet: fakeWallet().wallet });
    assert.equal((await refused.signIn("alice")).error.code, "LOGIN_FAILED");
  });

  it("refuses a second sign-in while one is in progress", async () => {
    let release;
    const pending = new Promise((resolve) => (release = resolve));
    const service = new IdentityService({ api: fakeApi().api, wallet: fakeWallet({ sign: () => pending }).wallet });
    const first = service.signIn("alice");
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal((await service.signIn("alice")).error.code, "BUSY");
    release(ok(SIGNATURE));
    assert.equal((await first).ok, true);
  });

  it("signs out", async () => {
    const { api, calls } = fakeApi({ currentUser: async () => ok(USER) });
    const service = new IdentityService({ api, wallet: fakeWallet().wallet });
    await service.restore();
    await service.signOut();
    assert.equal(service.state.status, IdentityStatus.SIGNED_OUT);
    assert.equal(calls.at(-1).name, "deleteSession");
  });
});

/** A fake of the Keychain extension object. */
function fakeKeychain(respond) {
  const requests = [];
  return {
    requests,
    keychain: { requestSignBuffer: (account, message, keyRole, callback) => (requests.push({ account, message, keyRole }), respond(callback)) },
  };
}

const realTimers = { setTimeout: (callback, ms) => setTimeout(callback, ms), clearTimeout: (id) => clearTimeout(id) };

describe("KeychainWalletConnector", () => {
  it("wraps requestSignBuffer and validates the signature's shape", async () => {
    const { keychain, requests } = fakeKeychain((callback) => callback({ success: true, result: SIGNATURE }));
    const connector = new KeychainWalletConnector({ locate: () => keychain, timers: realTimers });
    assert.equal(connector.isAvailable(), true);
    assert.deepEqual(await connector.signMessage({ account: "alice", message: "m", keyRole: "Posting" }), { ok: true, value: SIGNATURE });
    assert.deepEqual(requests, [{ account: "alice", message: "m", keyRole: "Posting" }]);
  });

  it("maps cancellations, odd results, exceptions, absence and silence to failures", async () => {
    const cases = [
      [(callback) => callback({ success: false, message: "user cancelled" }), "WALLET_REJECTED"],
      [(callback) => callback({ success: true, result: "not hex" }), "WALLET_BAD_SIGNATURE"],
      [(callback) => callback(null), "WALLET_REJECTED"],
      [() => {
        throw new Error("boom");
      }, "WALLET_REJECTED"],
      [() => undefined, "WALLET_TIMEOUT"],
    ];
    for (const [respond, code] of cases) {
      const connector = new KeychainWalletConnector({ locate: () => fakeKeychain(respond).keychain, timers: realTimers, timeoutMs: 20 });
      assert.equal((await connector.signMessage({ account: "a", message: "m", keyRole: "Posting" })).error.code, code);
    }
    const absent = new KeychainWalletConnector({ locate: () => undefined, timers: realTimers });
    assert.equal(absent.isAvailable(), false);
    assert.equal((await absent.signMessage({ account: "a", message: "m", keyRole: "Posting" })).error.code, "WALLET_NOT_INSTALLED");
  });

  it("answers once even if Keychain calls back twice", async () => {
    const { keychain } = fakeKeychain((callback) => {
      callback({ success: true, result: SIGNATURE });
      callback({ success: false, message: "late" });
    });
    const connector = new KeychainWalletConnector({ locate: () => keychain, timers: realTimers });
    assert.equal((await connector.signMessage({ account: "a", message: "m", keyRole: "Posting" })).ok, true);
  });
});

/** @param {(url: string, init: any) => Response | Promise<Response>} handler */
function apiWith(handler) {
  const requests = [];
  const api = new HttpAuthApi({ fetch: async (url, init) => (requests.push({ url, init }), handler(url, init)) });
  return { api, requests };
}

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("HttpAuthApi", () => {
  it("sends the anti-CSRF header and same-origin credentials on mutations", async () => {
    const { api, requests } = apiWith(() => json(201, { challengeId: "c", message: "m", keyRole: "Posting", expiresAt: 5 }));
    assert.equal((await api.createChallenge("alice")).ok, true);
    const [{ url, init }] = requests;
    assert.equal(url, "/api/auth/challenges");
    assert.equal(init.method, "POST");
    assert.equal(init.credentials, "same-origin");
    assert.equal(init.headers["X-M8-Request"], "1");
    assert.equal(init.body, JSON.stringify({ account: "alice" }));
  });

  it("treats 401 on /api/me as signed out and maps transport failures", async () => {
    assert.deepEqual(await apiWith(() => json(401, { error: { code: "UNAUTHENTICATED", message: "x" } })).api.currentUser(), { ok: true, value: null });
    assert.equal((await apiWith(() => json(200, { user: USER })).api.currentUser()).value.account, "alice");
    assert.equal((await apiWith(() => json(200, { user: { id: 1 } })).api.currentUser()).error.code, "BAD_RESPONSE");
    assert.equal((await apiWith(() => new Response("not found", { status: 404 })).api.currentUser()).error.code, "UNAVAILABLE");
    assert.equal((await apiWith(() => Promise.reject(new TypeError("offline"))).api.currentUser()).error.code, "NETWORK");
  });

  it("passes the server's error codes through", async () => {
    const { api } = apiWith(() => json(401, { error: { code: "LOGIN_FAILED", message: "nope" } }));
    assert.deepEqual((await api.createSession({ challengeId: "c", signature: "s" })).error, { code: "LOGIN_FAILED", message: "nope", details: null });
  });

  it("treats logout of an already expired session as done", async () => {
    assert.equal((await apiWith(() => json(401, { error: { code: "UNAUTHENTICATED", message: "x" } })).api.deleteSession()).ok, true);
    assert.equal((await apiWith(() => new Response(null, { status: 204 })).api.deleteSession()).ok, true);
  });
});
