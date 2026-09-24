/**
 * A browser-like API client for HTTP tests: signs in the way the real client
 * does (challenge → Keychain signature → session cookie) and sends the
 * headers our same-origin client sends.
 */
import assert from "node:assert/strict";

import { CLIENT_HEADERS, keychainSign } from "../helpers.js";

export class ApiClient {
  #base;
  /** @type {string | null} */
  #cookie = null;

  /** @param {string} base */
  constructor(base) {
    this.#base = base;
  }

  /**
   * @param {string} account
   * @param {Uint8Array} privateKey
   */
  async signIn(account, privateKey) {
    const challenge = await this.post("/api/auth/challenges", { account });
    assert.equal(challenge.status, 201, JSON.stringify(challenge.json));
    const session = await this.post("/api/auth/sessions", { challengeId: challenge.json.challengeId, signature: keychainSign(challenge.json.message, privateKey) });
    assert.equal(session.status, 201, JSON.stringify(session.json));
    const cookie = session.headers.getSetCookie().find((value) => value.startsWith("m8_session="));
    this.#cookie = cookie === undefined ? null : cookie.split(";")[0];
    return session.json.user;
  }

  /** @param {string} path @param {Record<string, string>} [headers] */
  get(path, headers = {}) {
    return this.request("GET", path, undefined, headers);
  }

  /** @param {string} path @param {unknown} body @param {Record<string, string>} [headers] */
  post(path, body, headers = {}) {
    return this.request("POST", path, body, headers);
  }

  /** @param {string} path @param {unknown} body @param {Record<string, string>} [headers] */
  put(path, body, headers = {}) {
    return this.request("PUT", path, body, headers);
  }

  /** @param {string} path @param {Record<string, string>} [headers] */
  delete(path, headers = {}) {
    return this.request("DELETE", path, undefined, headers);
  }

  /**
   * @param {string} method
   * @param {string} path
   * @param {unknown} body
   * @param {Record<string, string>} headers
   */
  async request(method, path, body, headers) {
    const response = await fetch(`${this.#base}${path}`, {
      method,
      headers: { ...(method === "GET" ? {} : CLIENT_HEADERS), ...(this.#cookie === null ? {} : { Cookie: this.#cookie }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, headers: response.headers, text, json: text === "" ? null : JSON.parse(text) };
  }
}
