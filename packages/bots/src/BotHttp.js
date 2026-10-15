/**
 * What a bot's browser tab would ask the game server over HTTP: signing in
 * (the login challenge signed with the posting key, as Keychain signs it),
 * the account's decks, the free starter deck. Requests carry what the
 * site's own pages carry — the session cookie, the site's Origin, the
 * anti-CSRF header — and failures come back as Results, never exceptions.
 */
import { fail, ok } from "@magic8/engine/shared/Result.js";
import { signMessage } from "@magic8/steem";

const JSON_HEADERS = Object.freeze({ "Content-Type": "application/json", "X-M8-Request": "1" });
const SESSION_COOKIE = "m8_session=";

/**
 * @typedef {Readonly<{ id: string, name: string, playable: boolean }>} BotDeck
 * @typedef {import("@magic8/engine/shared/Result.js").Ok<any> | import("@magic8/engine/shared/Result.js").Fail} Reply
 */

export class BotHttp {
  #server;
  #origin;
  #fetch;
  /** "m8_session=…", once signed in. @type {string | null} */
  #cookie = null;

  /**
   * @param {{ server: string, origin: string, fetch?: typeof fetch }} deps `server`: where the game server answers; `origin`: the site's public origin
   */
  constructor({ server, origin, fetch: fetchImpl = globalThis.fetch }) {
    this.#server = server;
    this.#origin = origin;
    this.#fetch = fetchImpl;
  }

  /** The session cookie, for opening the WebSocket as this account. */
  get cookie() {
    return this.#cookie;
  }

  get origin() {
    return this.#origin;
  }

  /**
   * Signs in: the server's login challenge, signed with the posting key.
   * @param {string} account
   * @param {Uint8Array} postingKey
   * @returns {Promise<Reply>}
   */
  async signIn(account, postingKey) {
    this.#cookie = null;
    const challenge = await this.#request("POST", "/api/auth/challenges", { account });
    if (!challenge.ok) {
      return challenge;
    }
    const { challengeId, message } = challenge.value.body;
    const session = await this.#request("POST", "/api/auth/sessions", { challengeId, signature: signMessage(String(message), postingKey) });
    if (!session.ok) {
      return session;
    }
    const cookie = session.value.headers.getSetCookie().find((/** @type {string} */ value) => value.startsWith(SESSION_COOKIE));
    if (cookie === undefined) {
      return fail("NO_SESSION", "the server signed us in without a session cookie");
    }
    this.#cookie = cookie.split(";")[0];
    return ok(session.value.body.user);
  }

  /** @returns {Promise<import("@magic8/engine/shared/Result.js").Ok<readonly BotDeck[]> | import("@magic8/engine/shared/Result.js").Fail>} */
  async decks() {
    const reply = await this.#request("GET", "/api/decks");
    if (!reply.ok) {
      return reply;
    }
    const decks = Array.isArray(reply.value.body?.decks) ? reply.value.body.decks : [];
    return ok(Object.freeze(decks.map((/** @type {any} */ deck) => Object.freeze({ id: String(deck.id), name: String(deck.name), playable: deck.playable === true }))));
  }

  /**
   * The free starter deck: whether it was claimed, and the decks offered.
   * @returns {Promise<import("@magic8/engine/shared/Result.js").Ok<{ claimed: boolean, choices: readonly string[] }> | import("@magic8/engine/shared/Result.js").Fail>}
   */
  async starter() {
    const reply = await this.#request("GET", "/api/starter");
    if (!reply.ok) {
      return reply;
    }
    const body = reply.value.body ?? {};
    return ok({ claimed: body.claimed === true, choices: Array.isArray(body.choices) ? body.choices.map((/** @type {any} */ choice) => String(choice.id)) : [] });
  }

  /** @param {string} starterId */
  async claimStarter(starterId) {
    return this.#request("POST", "/api/starter", { starterId });
  }

  /**
   * @param {"GET" | "POST"} method
   * @param {string} path
   * @param {unknown} [body]
   * @returns {Promise<import("@magic8/engine/shared/Result.js").Ok<{ body: any, headers: Headers }> | import("@magic8/engine/shared/Result.js").Fail>}
   */
  async #request(method, path, body) {
    let response;
    try {
      response = await this.#fetch(`${this.#server}${path}`, {
        method,
        headers: { Accept: "application/json", Origin: this.#origin, ...(method === "GET" ? {} : JSON_HEADERS), ...(this.#cookie === null ? {} : { Cookie: this.#cookie }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      return fail("NETWORK", `the game server could not be reached (${error instanceof Error ? error.message : String(error)})`);
    }
    const payload = await readPayload(response);
    if (!response.ok) {
      const error = payload?.error;
      return typeof error?.code === "string" ? fail(error.code, String(error.message ?? "")) : fail(`HTTP_${response.status}`, `the game server answered ${response.status} to ${method} ${path}`);
    }
    return ok({ body: payload, headers: response.headers });
  }
}

/**
 * The response's JSON body, or null when there is none (or it is not JSON).
 * @param {Response} response
 * @returns {Promise<any>}
 */
async function readPayload(response) {
  const text = await response.text().catch(() => "");
  try {
    return text === "" ? null : JSON.parse(text);
  } catch {
    return null;
  }
}
