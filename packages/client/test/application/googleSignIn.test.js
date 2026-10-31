/**
 * Signing in with Google, the wallet KIJAM keeps (docs/tcg/29-google.md):
 * what the address says when the server sends the browser back, choosing
 * the new account's name, Google sessions restored as Google's, and the
 * wallet that asks the server to sign.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fail, ok } from "@magic8/engine/shared/Result.js";
import { GoogleSignInService, readGoogleReturn } from "../../src/application/identity/GoogleSignInService.js";
import { IdentityService, IdentityStatus, SignInMethod } from "../../src/application/identity/IdentityService.js";
import { WalletExport, WalletExportStatus, walletFileName, walletFileText } from "../../src/application/wallet/WalletExport.js";
import { WalletSwitch } from "../../src/application/wallet/WalletSwitch.js";
import { HttpCustodyApi } from "../../src/infrastructure/api/HttpCustodyApi.js";
import { HttpGoogleApi } from "../../src/infrastructure/api/HttpGoogleApi.js";
import { CustodialWallet } from "../../src/infrastructure/wallet/CustodialWallet.js";

const USER = Object.freeze({ id: "u1", network: "steem", account: "newbie" });
const TX_ID = "ab".repeat(20);

/** @param {(url: string, init: any) => Response | Promise<Response>} answer */
function fetchWith(answer) {
  /** @type {{ url: string, init: any }[]} */
  const calls = [];
  const fetch = async (/** @type {string} */ url, /** @type {any} */ init) => (calls.push({ url, init }), answer(url, init));
  return { fetch: /** @type {typeof globalThis.fetch} */ (/** @type {unknown} */ (fetch)), calls };
}

/** @param {number} status @param {unknown} body */
const json = (status, body) => new Response(JSON.stringify(body), { status });

describe("readGoogleReturn", () => {
  it("reads what the server sent the browser back with, and nothing else", () => {
    assert.deepEqual(readGoogleReturn("?google=new"), { kind: "new" });
    assert.deepEqual(readGoogleReturn("?google=existing&account=bobby"), { kind: "existing", account: "bobby", ownKeys: false });
    assert.deepEqual(readGoogleReturn("?google=existing&account=bobby&keys=own"), { kind: "existing", account: "bobby", ownKeys: true });
    assert.deepEqual(readGoogleReturn("?google=error&reason=cancelled"), { kind: "error", reason: "cancelled" });
    assert.deepEqual(readGoogleReturn("?google=error&reason=<script>"), { kind: "error", reason: "failed" }, "an unknown reason is a failure");
    assert.equal(readGoogleReturn("?google=existing&account=Not%20A%20Name"), null);
    assert.equal(readGoogleReturn("?google=elsewhere"), null);
    assert.equal(readGoogleReturn(""), null);
  });
});

describe("GoogleSignInService", () => {
  /** @param {object} [overrides] */
  function service(overrides = {}) {
    const adopted = [];
    const visits = [];
    const api = { startPath: "/api/auth/google/start", offered: async () => ok(true), nameStatus: async (name) => ok({ name, available: true, reason: null }), createAccount: async () => ok(USER), ...overrides };
    const google = new GoogleSignInService({ api, identity: { adoptGoogleSession: (user) => adopted.push(user) }, navigate: (path) => visits.push(path), pending: { kind: "new" } });
    return { google, adopted, visits };
  }

  it("goes to Google through the server, and says whether the server offers it", async () => {
    const { google, visits } = service();
    assert.equal(google.offered, false, "not until asked");
    assert.equal(await google.refresh(), true);
    google.start();
    assert.deepEqual(visits, ["/api/auth/google/start"]);
    assert.equal(await service({ offered: async () => fail("NETWORK", "down") }).google.refresh(), false, "a server that cannot say does not offer it");
  });

  it("hands what the sign-in came back with to one screen only", () => {
    const { google } = service();
    assert.deepEqual(google.pending, { kind: "new" });
    assert.deepEqual(google.take(), { kind: "new" });
    assert.equal(google.take(), null);
  });

  it("checks a name as typed, and refuses one the chain would refuse without asking", async () => {
    const asked = [];
    const { google } = service({ nameStatus: async (name) => (asked.push(name), ok({ name, available: false, reason: "taken" })) });
    assert.deepEqual(await google.nameStatus(" @Alice "), { ok: true, value: { name: "alice", available: false, reason: "taken" } });
    assert.deepEqual((await google.nameStatus("ab")).value, { name: "ab", available: false, reason: "invalid" });
    assert.deepEqual(asked, ["alice"]);
  });

  it("creates the account and adopts its session", async () => {
    const { google, adopted } = service();
    assert.deepEqual(await google.createAccount("Newbie"), { ok: true, value: USER });
    assert.deepEqual(adopted, [USER]);
    assert.equal(google.pending, null);
    const refused = service({ createAccount: async () => fail("NAME_TAKEN", "taken") });
    assert.equal((await refused.google.createAccount("newbie")).error.code, "NAME_TAKEN");
    assert.deepEqual(refused.adopted, []);
    assert.equal((await refused.google.createAccount("x")).error.code, "INVALID_NAME");
  });
});

describe("IdentityService with Google", () => {
  it("restores a Google session as Google's, whatever key this browser holds", async () => {
    const log = [];
    const keys = { restore: async () => "newbie", forget: () => log.push("forget"), usePostingKey: async () => ok(undefined), save: async () => ok(undefined), signMessage: async () => ok("") };
    let kept = null;
    const record = { read: () => kept, write: (entry) => (kept = entry), clear: () => (kept = null) };
    const api = { currentSession: async () => ok({ user: USER, viaGoogle: true }), createChallenge: async () => fail("X", "x"), createSession: async () => fail("X", "x"), deleteSession: async () => ok(null) };
    const identity = new IdentityService({ api, wallet: { name: "Steem Keychain", isAvailable: () => true, signMessage: async () => ok("") }, keys, record });
    await identity.restore();
    assert.deepEqual(identity.state, { status: IdentityStatus.SIGNED_IN, user: USER, method: SignInMethod.GOOGLE, error: null });
    assert.deepEqual(kept, { account: "newbie", method: SignInMethod.GOOGLE });
    assert.deepEqual(log, ["forget"], "no posting key stays behind a Google session");
  });

  it("pays, signs and posts with the wallet KIJAM keeps for a Google player, and only for them", async () => {
    let method = SignInMethod.GOOGLE;
    const named = (name) => ({ name, isAvailable: () => true, signMessage: async () => ok(name), requestTransfer: async () => ok(name), postComment: async () => ok(name) });
    const wallet = new WalletSwitch({ identity: { get state() { return /** @type {any} */ ({ method }); } }, keychain: named("Steem Keychain"), keys: named("your keys"), custodial: named("your KIJAM wallet") });
    assert.equal(wallet.name, "your KIJAM wallet");
    assert.equal(wallet.usesKeys, false);
    method = SignInMethod.KEYS;
    assert.equal(wallet.name, "your keys");
    method = SignInMethod.KEYCHAIN;
    assert.equal(wallet.name, "Steem Keychain");
  });
});

describe("CustodialWallet over HttpCustodyApi", () => {
  const transfer = { from: "newbie", to: "magic8.shop", amount: "1.000", asset: "STEEM", memo: "m8tcg-abc" };
  /** @param {Parameters<typeof fetchWith>[0]} answer */
  const walletWith = (answer) => {
    const http = fetchWith(answer);
    return { wallet: new CustodialWallet({ api: new HttpCustodyApi({ fetch: http.fetch }) }), calls: http.calls };
  };

  it("asks the server to pay, sign and post, with nothing to approve", async () => {
    const { wallet, calls } = walletWith((url) => json(201, url.endsWith("/messages") ? { signature: "1f".repeat(65) } : { txId: TX_ID }));
    assert.equal(wallet.isAvailable(), true);
    assert.deepEqual(await wallet.requestTransfer(transfer), { ok: true, value: TX_ID });
    assert.deepEqual(JSON.parse(calls[0].init.body), transfer);
    assert.equal(calls[0].init.headers["X-M8-Request"], "1");
    assert.deepEqual(await wallet.signMessage({ account: "newbie", message: "m8tcg session g k", keyRole: "Posting" }), { ok: true, value: "1f".repeat(65) });
    const ping = { author: "newbie", parentAuthor: "micro.cur8", parentPermlink: "wall", permlink: "p", title: "", body: "gg", jsonMetadata: "{}" };
    assert.deepEqual(await wallet.postComment(ping), { ok: true, value: TX_ID });
    assert.deepEqual(calls.map((call) => call.url), ["/api/custody/transfers", "/api/custody/messages", "/api/custody/pings"]);
    assert.equal("author" in JSON.parse(calls[2].init.body), false, "the server knows whose account it keeps");
  });

  it("takes a payment already sent as paid, and never sends one again whose fate is unknown", async () => {
    const already = walletWith(() => json(409, { error: { code: "ALREADY_PAID", message: "sent", details: { txId: TX_ID } } }));
    assert.deepEqual(await already.wallet.requestTransfer(transfer), { ok: true, value: TX_ID });
    const unknown = walletWith(() => json(503, { error: { code: "CHAIN_UNAVAILABLE", message: "maybe", details: { txId: TX_ID } } }));
    assert.equal((await unknown.wallet.requestTransfer(transfer)).error.code, "WALLET_TIMEOUT");
    const offline = walletWith(() => Promise.reject(new TypeError("offline")));
    assert.equal((await offline.wallet.requestTransfer(transfer)).error.code, "WALLET_TIMEOUT");
    const refused = walletWith(() => json(409, { error: { code: "PAYMENT_NOT_OPEN", message: "this transfer does not pay anything the game is waiting for" } }));
    assert.deepEqual((await refused.wallet.requestTransfer(transfer)).error, { code: "WALLET_REJECTED", message: "this transfer does not pay anything the game is waiting for", details: null });
  });
});

describe("HttpGoogleApi", () => {
  it("asks whether Google is offered, checks names and creates the account", async () => {
    const { fetch, calls } = fetchWith((url) => {
      if (url === "/api/auth/options") {
        return json(200, { google: true });
      }
      if (url.startsWith("/api/auth/google/names")) {
        return json(200, { name: "new.bie", available: true, reason: null });
      }
      return json(201, { user: USER, expiresAt: 1 });
    });
    const api = new HttpGoogleApi({ fetch });
    assert.deepEqual(await api.offered(), { ok: true, value: true });
    assert.deepEqual((await api.nameStatus("new.bie")).value, { name: "new.bie", available: true, reason: null });
    assert.deepEqual(await api.createAccount("newbie"), { ok: true, value: USER });
    assert.deepEqual(calls.map((call) => call.url), ["/api/auth/options", "/api/auth/google/names?name=new.bie", "/api/auth/google/accounts"]);
    assert.deepEqual(JSON.parse(calls[2].init.body), { account: "newbie" });
    assert.equal((await new HttpGoogleApi({ fetch: fetchWith(() => json(200, { name: 1 })).fetch }).nameStatus("x")).error.code, "BAD_RESPONSE");
  });
});

describe("WalletExport", () => {
  const WALLET = Object.freeze({ account: "newbie", masterPassword: "P5master", owner: "5owner", active: "5active", posting: "5posting", memo: "5memo" });

  /** @param {any[]} answers */
  function exporter(answers) {
    const trips = [];
    const copied = [];
    const saved = [];
    const walletExport = new WalletExport({
      api: { exportWallet: async () => answers.shift() ?? fail("X", "x") },
      reauthenticate: () => trips.push("google"),
      clipboard: { write: async (text) => (copied.push(text), ok(undefined)) },
      files: { save: (name, text) => (saved.push({ name, text }), ok(undefined)) },
    });
    return { walletExport, trips, copied, saved };
  }

  it("goes to Google first when the server wants a fresh sign-in, and shows the wallet once back", async () => {
    const before = exporter([fail("REAUTH_REQUIRED", "sign in again")]);
    await before.walletExport.open();
    assert.deepEqual(before.trips, ["google"]);
    assert.equal(before.walletExport.state.status, WalletExportStatus.OPENING, "the page is leaving");

    const back = exporter([ok(WALLET)]);
    await back.walletExport.resume();
    assert.deepEqual(back.walletExport.state, { status: WalletExportStatus.SHOWN, wallet: WALLET, error: null });
    back.walletExport.close();
    assert.equal(back.walletExport.state.wallet, null, "the keys go once closed");
  });

  it("never sends the player to Google twice in a row", async () => {
    const { walletExport, trips } = exporter([fail("REAUTH_REQUIRED", "sign in again")]);
    await walletExport.resume();
    assert.deepEqual(trips, []);
    assert.equal(walletExport.state.status, WalletExportStatus.FAILED);
    assert.equal(walletExport.state.error?.code, "REAUTH_REQUIRED");
  });

  it("copies a key and saves the whole wallet as a file", async () => {
    const { walletExport, copied, saved } = exporter([ok(WALLET)]);
    assert.equal(walletExport.download().ok, false, "nothing to save before it is shown");
    await walletExport.open();
    await walletExport.copy(WALLET.active);
    assert.deepEqual(copied, ["5active"]);
    assert.equal(walletExport.download().ok, true);
    assert.equal(saved[0].name, walletFileName(WALLET));
    for (const secret of Object.values(WALLET)) {
      assert.ok(saved[0].text.includes(secret));
    }
    assert.ok(walletFileText(WALLET).includes("Keep this file private"));
  });

  it("reads the wallet from the server, and the address Google sends the player back to", async () => {
    const http = fetchWith(() => json(200, { wallet: WALLET }));
    assert.deepEqual(await new HttpCustodyApi({ fetch: http.fetch }).exportWallet(), { ok: true, value: WALLET });
    assert.equal(http.calls[0].url, "/api/custody/export");
    assert.equal((await new HttpCustodyApi({ fetch: fetchWith(() => json(200, { wallet: { account: "x" } })).fetch }).exportWallet()).error.code, "BAD_RESPONSE");
    assert.deepEqual(readGoogleReturn("?google=export"), { kind: "export" });
    const visits = [];
    new GoogleSignInService({ api: /** @type {any} */ ({ startPath: "/api/auth/google/start" }), identity: { adoptGoogleSession: () => undefined }, navigate: (path) => visits.push(path) }).reauthenticate();
    assert.deepEqual(visits, ["/api/auth/google/start?purpose=export"]);
  });
});
