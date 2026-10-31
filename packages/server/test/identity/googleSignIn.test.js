/**
 * Signing in with Google over real HTTP (docs/tcg/29-google.md): the
 * redirects a browser follows, the cookies it carries, what the server keeps.
 * Google and join.cur8 are fakes; the chain is the fake behind the real
 * STEEM wallet provider.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { fail, ok } from "@magic8/engine/shared/Result.js";

import { CLIENT_HEADERS, buildTestApp, keyPair, listen, toWif } from "../helpers.js";

const CLIENT_ID = "123-test.apps.googleusercontent.com";

/** Google's endpoints: the address it would show, the claims of the ID token it would return. */
class FakeGoogle {
  /** @type {{ state: string, nonce: string, codeChallenge: string, redirectUri: string } | null} */
  lastRequest = null;
  /** @type {Record<string, unknown>} claims of the next ID token (the nonce of the last sign-in is added unless set) */
  claims = {};
  available = true;
  /** @type {string[]} */
  codes = [];

  authorizationUrl(request) {
    this.lastRequest = request;
    return `https://accounts.google.test/auth?state=${request.state}`;
  }

  async exchangeCode({ code }) {
    this.codes.push(code);
    if (!this.available) {
      return fail("UNAVAILABLE", "Google could not be reached");
    }
    return ok({ iss: "https://accounts.google.com", aud: CLIENT_ID, exp: Date.UTC(2030, 0, 1) / 1000, nonce: this.lastRequest?.nonce, email: "player@gmail.com", email_verified: true, ...this.claims });
  }
}

/** join.cur8's partner API: creates accounts on the fake chain, with keys of its own. */
class FakeJoin {
  /** @type {Map<string, string>} Google sub → account created there */
  created = new Map();
  /** @type {{ sub: string, email: string | null, account: string }[]} */
  requests = [];
  available = true;
  /** @type {Record<string, string> | null} the keys of the last account created */
  lastKeys = null;
  #seed = 100;

  /** @param {import("../helpers.js").FakeChain} chain */
  constructor(chain) {
    this.chain = chain;
  }

  async accountOf(sub) {
    return this.available ? ok(this.created.get(sub) ?? null) : fail("UNAVAILABLE", "join could not be reached");
  }

  async createAccount(request) {
    this.requests.push(request);
    if (!this.available) {
      return fail("UNAVAILABLE", "join could not be reached");
    }
    if (this.created.has(request.sub)) {
      return fail("ALREADY_CREATED", "already created", { account: this.created.get(request.sub) });
    }
    if (this.chain.accounts.has(request.account)) {
      return fail("NAME_TAKEN", "taken");
    }
    const [owner, active, posting, memo] = [0, 1, 2, 3].map(() => keyPair((this.#seed += 1)));
    this.chain.setAccount(request.account, [posting.publicKey], { activeKeys: [active.publicKey] });
    this.created.set(request.sub, request.account);
    this.lastKeys = { masterPassword: "P5masterpassword", owner: toWif(owner.privateKey), active: toWif(active.privateKey), posting: toWif(posting.privateKey), memo: toWif(memo.privateKey) };
    return ok({ account: request.account, keys: this.lastKeys });
  }
}

/**
 * @param {string} base
 * @param {string} path
 * @param {{ method?: string, body?: unknown, headers?: Record<string, string>, cookies?: string[] }} [options]
 */
async function call(base, path, { method = "GET", body, headers = {}, cookies = [] } = {}) {
  const response = await fetch(`${base}${path}`, { method, redirect: "manual", headers: { ...headers, ...(cookies.length > 0 ? { Cookie: cookies.join("; ") } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  /** @type {Map<string, string>} */
  const setCookies = new Map(response.headers.getSetCookie().map((cookie) => {
    const [pair] = cookie.split(";");
    const separator = pair.indexOf("=");
    return [pair.slice(0, separator), pair.slice(separator + 1)];
  }));
  return { status: response.status, location: response.headers.get("location"), setCookies, rawCookies: response.headers.getSetCookie(), json: text === "" ? null : JSON.parse(text) };
}

/** @param {Map<string, string>} cookies @param {string} name */
const cookie = (cookies, name) => `${name}=${cookies.get(name)}`;

describe("signing in with Google", () => {
  /** @type {Awaited<ReturnType<typeof buildTestApp>>} */
  let setup;
  /** @type {{ base: string, close: () => Promise<unknown> }} */
  let server;
  /** @type {FakeGoogle} */
  let google;
  /** @type {FakeJoin} */
  let join;

  before(async () => {
    setup = await buildTestApp({ googleSignIn: { oauth: (google = new FakeGoogle()), accounts: { accountOf: (sub) => join.accountOf(sub), createAccount: (request) => join.createAccount(request) }, clientId: CLIENT_ID } });
    join = new FakeJoin(setup.chain);
    setup.chain.setAccount("alice", [keyPair(1).publicKey]);
    server = await listen(setup.app);
  });

  after(() => server.close());

  beforeEach(() => {
    // A minute between tests: the sign-in steps are rate-limited per address.
    setup.clock.advance(60_000);
    google.claims = {};
    google.available = true;
    join.available = true;
  });

  /**
   * Start → Google → callback, as the browser does.
   * @param {{ sub: string, query?: (state: string) => string }} options
   */
  async function signIn({ sub, query = (state) => `code=the-code&state=${state}` }) {
    const start = await call(server.base, "/api/auth/google/start");
    assert.equal(start.status, 302);
    const state = new URL(/** @type {string} */ (start.location)).searchParams.get("state") ?? "";
    google.claims = { sub, ...google.claims };
    return call(server.base, `/api/auth/google/callback?${query(state)}`, { cookies: [cookie(start.setCookies, "m8_google_flow")] });
  }

  it("tells the client the Google button can be shown", async () => {
    assert.deepEqual((await call(server.base, "/api/auth/options")).json, { google: true });
  });

  it("sends the browser to Google with PKCE, remembering the sign-in in a Lax cookie", async () => {
    const start = await call(server.base, "/api/auth/google/start");
    assert.equal(start.status, 302);
    assert.ok(start.location?.startsWith("https://accounts.google.test/auth"));
    assert.equal(google.lastRequest?.redirectUri, "http://127.0.0.1:8080/api/auth/google/callback");
    assert.match(google.lastRequest?.codeChallenge ?? "", /^[A-Za-z0-9_-]{43}$/);
    const flow = start.rawCookies.find((value) => value.startsWith("m8_google_flow="));
    assert.match(flow ?? "", /SameSite=Lax; HttpOnly/);
    assert.match(flow ?? "", /Max-Age=600/);
  });

  it("creates the account of a new player, keeps its keys sealed and opens a Google session", async () => {
    const back = await signIn({ sub: "sub-new" });
    assert.equal(back.status, 302);
    assert.equal(back.location, "/?google=new");
    assert.equal(back.setCookies.get("m8_google_flow"), "", "the sign-in cookie is spent");
    const signup = cookie(back.setCookies, "m8_google_signup");

    assert.deepEqual((await call(server.base, "/api/auth/google/names?name=newbie", { cookies: [signup] })).json, { name: "newbie", available: true, reason: null });
    assert.deepEqual((await call(server.base, "/api/auth/google/names?name=alice", { cookies: [signup] })).json, { name: "alice", available: false, reason: "taken" });
    assert.deepEqual((await call(server.base, "/api/auth/google/names?name=A", { cookies: [signup] })).json, { name: "A", available: false, reason: "invalid" });

    const created = await call(server.base, "/api/auth/google/accounts", { method: "POST", headers: CLIENT_HEADERS, cookies: [signup], body: { account: "newbie" } });
    assert.equal(created.status, 201);
    assert.equal(created.json.user.account, "newbie");
    assert.deepEqual(join.requests.at(-1), { sub: "sub-new", email: "player@gmail.com", account: "newbie" });
    assert.equal(created.setCookies.get("m8_google_signup"), "", "the sign-up cookie is spent");
    const me = await call(server.base, "/api/me", { cookies: [cookie(created.setCookies, "m8_session")] });
    assert.equal(me.json.user.account, "newbie");

    const kept = await setup.database.maybeOne("SELECT * FROM custody_keys WHERE account = 'newbie'");
    const postingPublic = setup.chain.accounts.get("newbie").posting.keys[0].key;
    assert.equal(kept.posting_public, postingPublic);
    const sealed = Buffer.from(kept.keys_encrypted).toString("latin1");
    for (const secret of Object.values(join.lastKeys ?? {})) {
      assert.ok(!sealed.includes(secret), "no key is stored readable");
    }
    const opened = JSON.parse(Buffer.from(setup.app.secrets.open(new Uint8Array(kept.keys_encrypted), `custody_keys:${kept.user_id}`)).toString("utf8"));
    assert.deepEqual(opened, join.lastKeys);
    const session = await setup.database.maybeOne("SELECT method, login_public_key FROM sessions WHERE user_id = $1", [kept.user_id]);
    assert.deepEqual({ ...session }, { method: "google", login_public_key: postingPublic });
    const link = await setup.database.maybeOne("SELECT email FROM google_identities WHERE sub = 'sub-new'");
    assert.equal(link.email, "player@gmail.com");
  });

  it("signs a returning player straight in", async () => {
    const back = await signIn({ sub: "sub-new" });
    assert.equal(back.status, 302);
    assert.equal(back.location, "/");
    assert.equal((await call(server.base, "/api/me", { cookies: [cookie(back.setCookies, "m8_session")] })).json.user.account, "newbie");
  });

  it("sends a Google account that already created one on join.cur8 to that account's keys", async () => {
    join.created.set("sub-join", "bobby");
    const back = await signIn({ sub: "sub-join" });
    assert.equal(back.location, "/?google=existing&account=bobby");
    assert.equal(back.setCookies.has("m8_session"), false);
  });

  it("lands back in the game with the reason when the sign-in does not complete", async () => {
    assert.equal((await signIn({ sub: "x", query: () => "error=access_denied" })).location, "/?google=error&reason=cancelled");
    assert.equal((await signIn({ sub: "x", query: () => "code=c&state=forged" })).location, "/?google=error&reason=expired");
    assert.equal((await call(server.base, "/api/auth/google/callback?code=c&state=s")).location, "/?google=error&reason=expired", "no sign-in cookie");
    google.claims = { nonce: "another" };
    assert.equal((await signIn({ sub: "x" })).location, "/?google=error&reason=failed", "an ID token of another sign-in");
    google.claims = { aud: "someone-else" };
    assert.equal((await signIn({ sub: "x" })).location, "/?google=error&reason=failed", "an ID token for another client");
    google.claims = {};
    google.available = false;
    assert.equal((await signIn({ sub: "x" })).location, "/?google=error&reason=unavailable");
    google.available = true;
    join.available = false;
    assert.equal((await signIn({ sub: "x" })).location, "/?google=error&reason=unavailable");
  });

  it("refuses to create an account without a sign-up, a taken name, or a second one", async () => {
    const without = await call(server.base, "/api/auth/google/accounts", { method: "POST", headers: CLIENT_HEADERS, body: { account: "someone" } });
    assert.equal(without.status, 401);
    assert.equal(without.json.error.code, "SIGNUP_EXPIRED");
    assert.equal((await call(server.base, "/api/auth/google/names?name=someone")).json.error.code, "SIGNUP_EXPIRED");

    const back = await signIn({ sub: "sub-other" });
    const signup = cookie(back.setCookies, "m8_google_signup");
    const taken = await call(server.base, "/api/auth/google/accounts", { method: "POST", headers: CLIENT_HEADERS, cookies: [signup], body: { account: "alice" } });
    assert.equal(taken.status, 409);
    assert.equal(taken.json.error.code, "NAME_TAKEN");
    join.available = false;
    const down = await call(server.base, "/api/auth/google/accounts", { method: "POST", headers: CLIENT_HEADERS, cookies: [signup], body: { account: "carol" } });
    assert.equal(down.status, 503);
    assert.equal(down.json.error.code, "ACCOUNTS_UNAVAILABLE");
    join.available = true;
    join.created.set("sub-other", "elsewhere");
    const twice = await call(server.base, "/api/auth/google/accounts", { method: "POST", headers: CLIENT_HEADERS, cookies: [signup], body: { account: "carol" } });
    assert.equal(twice.status, 409);
    assert.deepEqual(twice.json.error.details, { account: "elsewhere" });
  });

  it("lets a sign-up expire", async () => {
    const back = await signIn({ sub: "sub-late" });
    setup.clock.advance(31 * 60 * 1000);
    const late = await call(server.base, "/api/auth/google/accounts", { method: "POST", headers: CLIENT_HEADERS, cookies: [cookie(back.setCookies, "m8_google_signup")], body: { account: "latecomer" } });
    assert.equal(late.json.error.code, "SIGNUP_EXPIRED");
    assert.equal(setup.chain.accounts.has("latecomer"), false);
  });

  it("closes Google sessions like any other when the kept posting key leaves the account", async () => {
    const back = await signIn({ sub: "sub-new" });
    const session = [cookie(back.setCookies, "m8_session")];
    setup.chain.setAccount("newbie", [keyPair(77).publicKey]);
    await setup.app.keyAuditor.run();
    assert.equal((await call(server.base, "/api/me", { cookies: session })).status, 401);
  });
});

describe("signing in with Google, not configured", () => {
  it("tells the client there is no Google button, and has no Google routes", async () => {
    const setup = await buildTestApp();
    const server = await listen(setup.app);
    try {
      assert.deepEqual((await call(server.base, "/api/auth/options")).json, { google: false });
      assert.equal((await call(server.base, "/api/auth/google/start")).status, 404);
    } finally {
      await server.close();
    }
  });
});
