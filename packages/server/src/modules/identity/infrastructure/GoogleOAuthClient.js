/**
 * Google's OAuth 2.0 / OpenID Connect endpoints for the game's web client
 * (docs/tcg/29-google.md): the address the browser signs in at, and the
 * server-to-server exchange of the code for an ID token. Asks only for
 * `openid email`: Google reviews nothing more for that.
 */
import { fail, ok } from "@magic8/engine/shared/Result.js";
import { parseJson } from "../../../kernel/json.js";

const AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_ID_TOKEN_LENGTH = 8192;

export class GoogleOAuthClient {
  #clientId;
  #clientSecret;
  #fetch;
  #timeoutMs;

  /**
   * @param {{ clientId: string, clientSecret: string, fetch: typeof globalThis.fetch, timeoutMs?: number }} deps
   */
  constructor({ clientId, clientSecret, fetch, timeoutMs = DEFAULT_TIMEOUT_MS }) {
    this.#clientId = clientId;
    this.#clientSecret = clientSecret;
    this.#fetch = fetch;
    this.#timeoutMs = timeoutMs;
  }

  /** @param {{ state: string, nonce: string, codeChallenge: string, redirectUri: string }} request */
  authorizationUrl({ state, nonce, codeChallenge, redirectUri }) {
    const url = new URL(AUTHORIZATION_ENDPOINT);
    url.search = new globalThis.URLSearchParams({
      client_id: this.#clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid email",
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      prompt: "select_account",
    }).toString();
    return url.href;
  }

  /** @param {{ code: string, codeVerifier: string, redirectUri: string }} request */
  async exchangeCode({ code, codeVerifier, redirectUri }) {
    let response;
    try {
      response = await this.#fetch(TOKEN_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new globalThis.URLSearchParams({ code, client_id: this.#clientId, client_secret: this.#clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code", code_verifier: codeVerifier }).toString(),
        signal: globalThis.AbortSignal.timeout(this.#timeoutMs),
      });
    } catch {
      return fail("UNAVAILABLE", "Google could not be reached");
    }
    if (!response.ok) {
      return fail(response.status >= 500 ? "UNAVAILABLE" : "CODE_REFUSED", `Google refused the sign-in code (${response.status})`);
    }
    let body;
    try {
      body = parseJson(await response.text());
    } catch {
      return fail("UNAVAILABLE", "Google answered something unreadable");
    }
    const claims = idTokenClaims(/** @type {any} */ (body)?.id_token);
    return claims === null ? fail("ID_TOKEN_INVALID", "Google sent no readable ID token") : ok(claims);
  }
}

/**
 * The payload of a JWT, unverified: it came straight from Google's token endpoint over TLS.
 * @param {unknown} token
 * @returns {unknown}
 */
function idTokenClaims(token) {
  if (typeof token !== "string" || token.length > MAX_ID_TOKEN_LENGTH) {
    return null;
  }
  const parts = token.split(".");
  if (parts.length !== 3 || !/^[A-Za-z0-9_-]+$/.test(parts[1])) {
    return null;
  }
  try {
    return parseJson(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}
