import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fail, ok } from "@magic8/engine/shared/Result.js";
import { IdentityService, IdentityStatus, SignInMethod } from "../../src/application/identity/IdentityService.js";
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
    assert.deepEqual(service.state, { status: IdentityStatus.SIGNED_IN, user: USER, method: SignInMethod.KEYCHAIN, error: null });
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

/**
 * A scripted LocalKeys: `accepts` decides usePostingKey; `saved` is the account restore() finds.
 * @param {{ saved?: string | null, accepts?: (account: string, wif: string) => any, save?: () => any }} [options]
 */
function fakeKeys({ saved = null, accepts = async () => ok(undefined), save = async () => ok(undefined) } = {}) {
  const log = [];
  const keys = {
    account: saved,
    name: "your keys",
    isAvailable: () => keys.account !== null,
    restore: async () => (log.push("restore"), saved),
    usePostingKey: async (account, wif) => {
      log.push(`use ${account} ${wif}`);
      const result = await accepts(account, wif);
      if (result.ok) {
        keys.account = account;
      }
      return result;
    },
    save: async () => (log.push("save"), save()),
    forget: () => {
      log.push("forget");
      keys.account = null;
    },
    signMessage: async (request) => (log.push(`sign ${request.account} ${request.keyRole}`), ok(SIGNATURE)),
  };
  return { keys, log };
}

/**
 * A SignInRecord in memory.
 * @param {{ account: string, method: string } | null} [entry] what it remembers at first
 */
function fakeRecord(entry = null) {
  let kept = entry;
  return { record: { read: () => kept, write: (next) => (kept = { ...next }), clear: () => (kept = null) } };
}

describe("IdentityService: signing as the session was opened", () => {
  it("remembers how the player signed in, and forgets it on signing out", async () => {
    const record = fakeRecord();
    const service = new IdentityService({ api: fakeApi().api, wallet: fakeWallet().wallet, keys: fakeKeys().keys, record: record.record });
    await service.signInWithKey("alice", "5Kkey");
    assert.deepEqual(record.record.read(), { account: "alice", method: SignInMethod.KEYS });
    await service.signOut();
    assert.equal(record.record.read(), null);
    await service.signIn("alice");
    assert.deepEqual(record.record.read(), { account: "alice", method: SignInMethod.KEYCHAIN });
  });

  it("closes a posting-key session whose key this browser no longer holds, and never takes it for a Keychain one", async () => {
    const { api, calls } = fakeApi({ currentUser: async () => ok(USER) });
    const keychain = fakeWallet({ available: true });
    const record = fakeRecord({ account: "alice", method: SignInMethod.KEYS });
    const service = new IdentityService({ api, wallet: keychain.wallet, keys: fakeKeys({ saved: null }).keys, record: record.record });
    const state = await service.restore();
    assert.equal(state.status, IdentityStatus.SIGNED_OUT);
    assert.equal(state.method, null);
    assert.equal(state.error.code, "KEY_MISSING");
    assert.match(state.error.message, /sign in again/);
    assert.equal(calls.at(-1).name, "deleteSession", "the session is closed on the server too");
    assert.equal(keychain.requests.length, 0, "Keychain is never asked, though it is here");
    assert.equal(record.record.read(), null);
  });

  it("keeps a Keychain session Keychain's, even before the extension shows up", async () => {
    const record = fakeRecord({ account: "alice", method: SignInMethod.KEYCHAIN });
    const service = new IdentityService({ api: fakeApi({ currentUser: async () => ok(USER) }).api, wallet: fakeWallet({ available: false }).wallet, keys: fakeKeys().keys, record: record.record });
    assert.deepEqual(await service.restore(), { status: IdentityStatus.SIGNED_IN, user: USER, method: SignInMethod.KEYCHAIN, error: null });
  });

  it("with nothing remembered, takes a keyless session for Keychain's only where Keychain is", async () => {
    const withKeychain = new IdentityService({ api: fakeApi({ currentUser: async () => ok(USER) }).api, wallet: fakeWallet({ available: true }).wallet, keys: fakeKeys().keys, record: fakeRecord().record });
    assert.equal((await withKeychain.restore()).method, SignInMethod.KEYCHAIN);
    const without = new IdentityService({ api: fakeApi({ currentUser: async () => ok(USER) }).api, wallet: fakeWallet({ available: false }).wallet, keys: fakeKeys().keys, record: fakeRecord().record });
    const state = await without.restore();
    assert.deepEqual([state.status, state.error.code], [IdentityStatus.SIGNED_OUT, "KEY_MISSING"], "a phone without Keychain: sign in again, never a Keychain that is not there");
  });

  it("signs with the key it holds, whatever was remembered", async () => {
    const service = new IdentityService({ api: fakeApi({ currentUser: async () => ok(USER) }).api, wallet: fakeWallet().wallet, keys: fakeKeys({ saved: "alice" }).keys, record: fakeRecord({ account: "alice", method: SignInMethod.KEYCHAIN }).record });
    assert.equal((await service.restore()).method, SignInMethod.KEYS);
  });
});

describe("IdentityService with the player's own keys", () => {
  it("signs in with a posting key: checked on the chain, signs the challenge, saved once the server accepted it", async () => {
    const { api, calls } = fakeApi();
    const { keys, log } = fakeKeys();
    const keychain = fakeWallet();
    const service = new IdentityService({ api, wallet: keychain.wallet, keys });
    const result = await service.signInWithKey(" @Alice ", "5Kkey");
    assert.deepEqual(result, { ok: true, value: USER });
    assert.deepEqual(log, ["use alice 5Kkey", "sign alice Posting", "save"]);
    assert.deepEqual(calls.map((call) => call.name), ["createChallenge", "createSession"]);
    assert.equal(keychain.requests.length, 0, "Keychain is not asked");
    assert.deepEqual(service.state, { status: IdentityStatus.SIGNED_IN, user: USER, method: SignInMethod.KEYS, error: null });
  });

  it("refuses a key the chain does not accept before signing anything, and keeps nothing", async () => {
    const { api, calls } = fakeApi();
    const { keys, log } = fakeKeys({ accepts: async () => fail("KEY_TOO_POWERFUL", "this key can move your funds") });
    const service = new IdentityService({ api, wallet: fakeWallet().wallet, keys });
    assert.equal((await service.signInWithKey("alice", "5Kactive")).error.code, "KEY_TOO_POWERFUL");
    assert.deepEqual(log, ["use alice 5Kactive", "forget"]);
    assert.equal(calls.length, 0, "the server is not asked");
    assert.equal(service.state.status, IdentityStatus.SIGNED_OUT);
    assert.equal(service.state.error.code, "KEY_TOO_POWERFUL");
  });

  it("forgets the key when the server refuses the signature", async () => {
    const { keys, log } = fakeKeys();
    const service = new IdentityService({ api: fakeApi({ createSession: async () => fail("LOGIN_FAILED", "no") }).api, wallet: fakeWallet().wallet, keys });
    assert.equal((await service.signInWithKey("alice", "5Kkey")).error.code, "LOGIN_FAILED");
    assert.equal(log.at(-1), "forget");
    assert.ok(!log.includes("save"));
  });

  it("stays signed in when the key could not be saved, and says so", async () => {
    const { keys } = fakeKeys({ save: async () => fail("KEY_STORAGE", "this browser could not store the key") });
    const service = new IdentityService({ api: fakeApi().api, wallet: fakeWallet().wallet, keys });
    assert.equal((await service.signInWithKey("alice", "5Kkey")).ok, true);
    assert.equal(service.state.status, IdentityStatus.SIGNED_IN);
    assert.equal(service.state.error.code, "KEY_STORAGE");
  });

  it("restores a session signed with the saved key, and signs in again with it once the session has expired", async () => {
    const restored = new IdentityService({ api: fakeApi({ currentUser: async () => ok(USER) }).api, wallet: fakeWallet().wallet, keys: fakeKeys({ saved: "alice" }).keys });
    assert.equal((await restored.restore()).method, SignInMethod.KEYS);

    const { api, calls } = fakeApi();
    const { keys, log } = fakeKeys({ saved: "alice" });
    const expired = new IdentityService({ api, wallet: fakeWallet().wallet, keys });
    const state = await expired.restore();
    assert.deepEqual(state, { status: IdentityStatus.SIGNED_IN, user: USER, method: SignInMethod.KEYS, error: null });
    assert.deepEqual(calls.map((call) => call.name), ["currentUser", "createChallenge", "createSession"]);
    assert.deepEqual(log, ["restore", "sign alice Posting"]);
  });

  it("forgets a saved key the chain no longer accepts, keeps one it could not check", async () => {
    const revoked = fakeKeys({ saved: "alice" });
    const service = new IdentityService({ api: fakeApi({ createSession: async () => fail("LOGIN_FAILED", "no") }).api, wallet: fakeWallet().wallet, keys: revoked.keys });
    assert.equal((await service.restore()).status, IdentityStatus.SIGNED_OUT);
    assert.equal(revoked.log.at(-1), "forget");

    const unreachable = fakeKeys({ saved: "alice" });
    const offline = new IdentityService({ api: fakeApi({ createChallenge: async () => fail("CHAIN_UNAVAILABLE", "down") }).api, wallet: fakeWallet().wallet, keys: unreachable.keys });
    assert.equal((await offline.restore()).status, IdentityStatus.SIGNED_OUT);
    assert.ok(!unreachable.log.includes("forget"));
  });

  it("drops a saved key of another account than the session's, and any key on a Keychain sign-in or a sign-out", async () => {
    const other = fakeKeys({ saved: "bob" });
    const restored = new IdentityService({ api: fakeApi({ currentUser: async () => ok(USER) }).api, wallet: fakeWallet().wallet, keys: other.keys });
    assert.equal((await restored.restore()).method, SignInMethod.KEYCHAIN);
    assert.deepEqual(other.log, ["restore", "forget"]);

    const viaKeychain = fakeKeys({ saved: "alice" });
    const service = new IdentityService({ api: fakeApi().api, wallet: fakeWallet().wallet, keys: viaKeychain.keys });
    await service.signIn("carol");
    assert.equal(service.state.method, SignInMethod.KEYCHAIN);
    assert.equal(viaKeychain.log.at(-1), "forget");

    const out = fakeKeys();
    const signedIn = new IdentityService({ api: fakeApi().api, wallet: fakeWallet().wallet, keys: out.keys });
    await signedIn.signInWithKey("alice", "5Kkey");
    await signedIn.signOut();
    assert.equal(out.log.at(-1), "forget");
    assert.equal(signedIn.state.method, null);
  });

  it("keeps the saved key when signing in again fails for any reason but the chain refusing it", async () => {
    for (const code of ["INTERNAL", "CHALLENGE_INVALID", "VALIDATION", "MAINTENANCE"]) {
      const held = fakeKeys({ saved: "alice" });
      const record = fakeRecord({ account: "alice", method: SignInMethod.KEYS });
      const service = new IdentityService({ api: fakeApi({ createSession: async () => fail(code, "not now") }).api, wallet: fakeWallet().wallet, keys: held.keys, record: record.record });
      assert.equal((await service.restore()).status, IdentityStatus.SIGNED_OUT, code);
      assert.ok(!held.log.includes("forget"), `${code}: the key stays for the next start`);
      assert.deepEqual(record.record.read(), { account: "alice", method: SignInMethod.KEYS }, `${code}: and how it signs`);
    }
  });

  it("offers key sign-in only with keys to sign with", async () => {
    const service = new IdentityService({ api: fakeApi().api, wallet: fakeWallet().wallet });
    assert.equal(service.keysAvailable, false);
    assert.equal((await service.signInWithKey("alice", "5Kkey")).error.code, "KEYS_UNSUPPORTED");
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
