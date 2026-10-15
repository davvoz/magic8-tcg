import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { keyPair } from "../../server/test/helpers.js";
import { BotHttp } from "../src/BotHttp.js";

/**
 * A server that answers the login challenge, then signs in with this session cookie.
 * @param {string} setCookie
 */
const signingIn = (setCookie) => {
  /** @type {Array<{ url: string, init: any }>} */
  const requests = [];
  /** @type {typeof fetch} */
  const fetchImpl = async (url, init) => {
    requests.push({ url: String(url), init });
    if (String(url).endsWith("/api/auth/challenges")) {
      return Response.json({ challengeId: "c1", message: "sign me" });
    }
    const headers = new Headers({ "Content-Type": "application/json" });
    if (setCookie !== "") {
      headers.append("Set-Cookie", setCookie);
    }
    return new Response(JSON.stringify({ user: { account: "gigi.one" } }), { status: 201, headers });
  };
  return { requests, http: new BotHttp({ server: "http://app:8080", origin: "https://play.example.com", fetch: fetchImpl }) };
};

describe("bot sign-in", () => {
  it("keeps the session cookie over HTTPS, where the server names it __Host-m8_session", async () => {
    const { http } = signingIn("__Host-m8_session=tok1; Path=/; HttpOnly; Secure; SameSite=Strict");
    const signedIn = await http.signIn("gigi.one", keyPair(1).privateKey);
    assert.equal(signedIn.ok, true);
    assert.equal(http.cookie, "__Host-m8_session=tok1");
  });

  it("keeps the plain m8_session cookie (local, over HTTP)", async () => {
    const { http } = signingIn("m8_session=tok2; Path=/; HttpOnly; SameSite=Strict");
    assert.equal((await http.signIn("gigi.one", keyPair(1).privateKey)).ok, true);
    assert.equal(http.cookie, "m8_session=tok2");
  });

  it("fails without a session cookie", async () => {
    const { http } = signingIn("");
    const signedIn = await http.signIn("gigi.one", keyPair(1).privateKey);
    assert.equal(signedIn.ok, false);
    assert.equal(signedIn.ok ? null : signedIn.error.code, "NO_SESSION");
    assert.equal(http.cookie, null);
  });
});
