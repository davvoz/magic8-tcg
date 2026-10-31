/**
 * The adapters of signing in with Google (docs/tcg/29-google.md): Google's
 * OAuth endpoints and join.cur8's partner API, over a fake fetch.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { GoogleOAuthClient, JoinAccountFactory } from "../../src/modules/identity/index.js";

/**
 * @param {(url: string, init: any) => { status: number, body?: unknown } | Error} answer
 */
function fakeFetch(answer) {
  /** @type {{ url: string, init: any }[]} */
  const calls = [];
  const fetch = async (/** @type {string} */ url, /** @type {any} */ init) => {
    calls.push({ url, init });
    const result = answer(url, init);
    if (result instanceof Error) {
      throw result;
    }
    return new Response(result.body === undefined ? "" : JSON.stringify(result.body), { status: result.status });
  };
  return { fetch: /** @type {typeof globalThis.fetch} */ (/** @type {unknown} */ (fetch)), calls };
}

/** @param {object} claims */
const idToken = (claims) => `header.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`;

describe("GoogleOAuthClient", () => {
  it("builds the sign-in address with PKCE and asks only for openid and email", () => {
    const client = new GoogleOAuthClient({ clientId: "id.apps.googleusercontent.com", clientSecret: "secret", fetch: fakeFetch(() => ({ status: 200 })).fetch });
    const url = new URL(client.authorizationUrl({ state: "s", nonce: "n", codeChallenge: "c", redirectUri: "https://game.example/api/auth/google/callback" }));
    assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
    assert.deepEqual(Object.fromEntries(url.searchParams), { client_id: "id.apps.googleusercontent.com", redirect_uri: "https://game.example/api/auth/google/callback", response_type: "code", scope: "openid email", state: "s", nonce: "n", code_challenge: "c", code_challenge_method: "S256", prompt: "select_account" });
  });

  it("exchanges the code for the ID token's claims, server to server", async () => {
    const { fetch, calls } = fakeFetch(() => ({ status: 200, body: { id_token: idToken({ sub: "42", aud: "id" }) } }));
    const client = new GoogleOAuthClient({ clientId: "id", clientSecret: "secret", fetch });
    assert.deepEqual(await client.exchangeCode({ code: "the-code", codeVerifier: "verifier", redirectUri: "https://game.example/cb" }), { ok: true, value: { sub: "42", aud: "id" } });
    assert.equal(calls[0].url, "https://oauth2.googleapis.com/token");
    assert.deepEqual(Object.fromEntries(new globalThis.URLSearchParams(calls[0].init.body)), { code: "the-code", client_id: "id", client_secret: "secret", redirect_uri: "https://game.example/cb", grant_type: "authorization_code", code_verifier: "verifier" });
  });

  it("tells an unreachable Google from a refused code or an unreadable token", async () => {
    const exchange = (/** @type {Parameters<typeof fakeFetch>[0]} */ answer) => new GoogleOAuthClient({ clientId: "id", clientSecret: "s", fetch: fakeFetch(answer).fetch }).exchangeCode({ code: "c", codeVerifier: "v", redirectUri: "r" });
    assert.equal((await exchange(() => new Error("offline"))).error.code, "UNAVAILABLE");
    assert.equal((await exchange(() => ({ status: 503 }))).error.code, "UNAVAILABLE");
    assert.equal((await exchange(() => ({ status: 400, body: { error: "invalid_grant" } }))).error.code, "CODE_REFUSED");
    assert.equal((await exchange(() => ({ status: 200, body: { id_token: "not-a-jwt" } }))).error.code, "ID_TOKEN_INVALID");
  });
});

describe("JoinAccountFactory", () => {
  const KEYS = { username: "newbie", master_password: "P5x", owner_key: "5o", active_key: "5a", posting_key: "5p", memo_key: "5m" };
  const factory = (/** @type {Parameters<typeof fakeFetch>[0]} */ answer) => {
    const fake = fakeFetch(answer);
    return { factory: new JoinAccountFactory({ baseUrl: "https://join.example", partnerKey: "k".repeat(40), fetch: fake.fetch, app: "kijam" }), calls: fake.calls };
  };

  it("asks which account a Google identity created, with the partner key", async () => {
    const { factory: join, calls } = factory(() => ({ status: 200, body: { steem_username: "bobby" } }));
    assert.deepEqual(await join.accountOf("sub/1"), { ok: true, value: "bobby" });
    assert.equal(calls[0].url, "https://join.example/api/partner/google/sub%2F1");
    assert.equal(calls[0].init.headers["X-Partner-Key"], "k".repeat(40));
    assert.deepEqual(await factory(() => ({ status: 200, body: { steem_username: null } })).factory.accountOf("x"), { ok: true, value: null });
    assert.equal((await factory(() => ({ status: 401 })).factory.accountOf("x")).error.code, "UNAVAILABLE");
  });

  it("creates an account and hands its keys over", async () => {
    const { factory: join, calls } = factory(() => ({ status: 200, body: KEYS }));
    assert.deepEqual(await join.createAccount({ sub: "42", email: null, account: "newbie" }), { ok: true, value: { account: "newbie", keys: { masterPassword: "P5x", owner: "5o", active: "5a", posting: "5p", memo: "5m" } } });
    assert.deepEqual(JSON.parse(calls[0].init.body), { google_sub: "42", email: null, username: "newbie", app: "kijam" });
  });

  it("maps join's refusals", async () => {
    const create = (/** @type {Parameters<typeof fakeFetch>[0]} */ answer) => factory(answer).factory.createAccount({ sub: "42", email: null, account: "newbie" });
    const already = await create(() => ({ status: 409, body: { code: "ALREADY_CREATED", steem_username: "bobby" } }));
    assert.deepEqual([already.error.code, already.error.details], ["ALREADY_CREATED", { account: "bobby" }]);
    assert.equal((await create(() => ({ status: 409, body: { code: "USERNAME_TAKEN" } }))).error.code, "NAME_TAKEN");
    assert.equal((await create(() => ({ status: 400, body: { detail: "too short" } }))).error.code, "INVALID_ACCOUNT");
    assert.equal((await create(() => ({ status: 503 }))).error.code, "UNAVAILABLE");
    assert.equal((await create(() => new Error("offline"))).error.code, "UNAVAILABLE");
    assert.equal((await create(() => ({ status: 200, body: { ...KEYS, username: "other" } }))).error.code, "UNAVAILABLE", "keys of another account");
  });
});
