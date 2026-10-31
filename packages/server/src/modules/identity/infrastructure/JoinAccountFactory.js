/**
 * join.cur8's partner API (docs/tcg/29-google.md): it creates the accounts of
 * players who sign in with Google, with cur8's tickets, and hands their keys
 * to this server once. Server to server, with the partner key.
 */
import { fail, ok } from "@magic8/engine/shared/Result.js";
import { parseJson } from "../../../kernel/json.js";
import { AccountFactoryFailure } from "../application/ports.js";

const LOOKUP_TIMEOUT_MS = 10_000;
/** Creating an account waits for the chain to take the operation. */
const CREATE_TIMEOUT_MS = 60_000;
const KEY_FIELDS = Object.freeze({ masterPassword: "master_password", owner: "owner_key", active: "active_key", posting: "posting_key", memo: "memo_key" });

export class JoinAccountFactory {
  #baseUrl;
  #partnerKey;
  #fetch;
  #app;

  /**
   * @param {{ baseUrl: string, partnerKey: string, fetch: typeof globalThis.fetch, app: string }} deps
   *   `baseUrl`: join's origin; `app`: written in the new accounts' metadata
   */
  constructor({ baseUrl, partnerKey, fetch, app }) {
    this.#baseUrl = baseUrl;
    this.#partnerKey = partnerKey;
    this.#fetch = fetch;
    this.#app = app;
  }

  /** @param {string} sub */
  async accountOf(sub) {
    const answer = await this.#call(`/api/partner/google/${encodeURIComponent(sub)}`, { method: "GET" }, LOOKUP_TIMEOUT_MS);
    if (!answer.ok) {
      return answer;
    }
    const account = /** @type {any} */ (answer.value.body)?.steem_username;
    if (answer.value.status !== 200 || !(account === null || typeof account === "string")) {
      return fail(AccountFactoryFailure.UNAVAILABLE, `join answered ${answer.value.status}`);
    }
    return ok(account);
  }

  /** @param {{ sub: string, email: string | null, account: string }} request */
  async createAccount({ sub, email, account }) {
    const answer = await this.#call("/api/partner/accounts", { method: "POST", body: JSON.stringify({ google_sub: sub, email, username: account, app: this.#app }) }, CREATE_TIMEOUT_MS);
    if (!answer.ok) {
      return answer;
    }
    const { status, body } = answer.value;
    const fields = /** @type {Record<string, unknown>} */ (body ?? {});
    if (status === 200) {
      return createdAccount(fields, account);
    }
    if (status === 409 && fields.code === "ALREADY_CREATED") {
      return fail(AccountFactoryFailure.ALREADY_CREATED, "this Google account already created an account", { account: typeof fields.steem_username === "string" ? fields.steem_username : null });
    }
    if (status === 409 && fields.code === "USERNAME_TAKEN") {
      return fail(AccountFactoryFailure.NAME_TAKEN, "this name is taken");
    }
    if (status === 400 || status === 422) {
      return fail(AccountFactoryFailure.INVALID_ACCOUNT, typeof fields.detail === "string" ? fields.detail : "this name cannot be used");
    }
    return fail(AccountFactoryFailure.UNAVAILABLE, `join answered ${status}`);
  }

  /**
   * @param {string} path
   * @param {{ method: string, body?: string }} request
   * @param {number} timeoutMs
   * @returns {Promise<import("@magic8/engine/shared/Result.js").Ok<{ status: number, body: unknown }> | import("@magic8/engine/shared/Result.js").Fail>}
   */
  async #call(path, { method, body }, timeoutMs) {
    let response;
    try {
      response = await this.#fetch(`${this.#baseUrl}${path}`, {
        method,
        headers: { "X-Partner-Key": this.#partnerKey, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        body,
        signal: globalThis.AbortSignal.timeout(timeoutMs),
      });
    } catch {
      return fail(AccountFactoryFailure.UNAVAILABLE, "join could not be reached");
    }
    let parsed = null;
    try {
      parsed = parseJson(await response.text());
    } catch {
      // A body that is not JSON: the status alone tells what happened.
    }
    return ok({ status: response.status, body: parsed });
  }
}

/**
 * @param {Record<string, unknown>} fields join's answer
 * @param {string} account the name asked for
 */
function createdAccount(fields, account) {
  const keys = Object.fromEntries(Object.entries(KEY_FIELDS).map(([name, field]) => [name, fields[field]]));
  if (fields.username !== account || Object.values(keys).some((value) => typeof value !== "string")) {
    return fail(AccountFactoryFailure.UNAVAILABLE, "join answered keys for another account, or none");
  }
  return ok(Object.freeze({ account, keys: /** @type {import("../application/ports.js").NewAccountKeys} */ (Object.freeze(keys)) }));
}
