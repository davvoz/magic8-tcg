/**
 * Signing in with Google, the wallet KIJAM keeps (docs/tcg/29-google.md).
 *
 * The sign-in is a full-page visit: `start` hands the browser to the game
 * server, which sends it to Google and back to the game. The outcome comes
 * back in the address (readGoogleReturn), read once at start-up:
 * - nothing to say: the session is open, IdentityService finds it;
 * - "new": this Google account has no game account yet: the player chooses
 *   a name (nameStatus, createAccount), and the session opens;
 * - "existing": it already has one whose keys the player holds (made on
 *   join.cur8, or taken over after exporting the wallet): sign in with them;
 * - "error": why the sign-in did not complete.
 */
import { fail, ok } from "@magic8/engine/shared/Result.js";

export const GoogleReturnKind = Object.freeze({ NEW: "new", EXISTING: "existing", ERROR: "error" });
/** Why a sign-in did not complete, as the server says it. */
export const GoogleReturnReason = Object.freeze({ CANCELLED: "cancelled", EXPIRED: "expired", UNAVAILABLE: "unavailable", FAILED: "failed" });

/** Loose client-side check for early feedback; the server applies the chain's rules. */
const NAME_PATTERN = /^[a-z][a-z0-9.-]{2,15}$/;
const ACCOUNT_IN_ADDRESS = /^[a-z][a-z0-9.-]{2,15}$/;
/** @type {readonly string[]} */
const REASONS = Object.freeze(Object.values(GoogleReturnReason));

/**
 * @typedef {Readonly<{ kind: "new" }>
 *   | Readonly<{ kind: "existing", account: string, ownKeys: boolean }>
 *   | Readonly<{ kind: "error", reason: string }>} GoogleReturn
 *   `ownKeys`: the account was KIJAM's to keep, and the player took it over with its keys
 */

/**
 * What the address the server sent the browser back to says, if anything.
 * @param {string} search the address's query ("?google=new")
 * @returns {GoogleReturn | null}
 */
export function readGoogleReturn(search) {
  const query = new globalThis.URLSearchParams(search);
  switch (query.get("google")) {
    case GoogleReturnKind.NEW:
      return Object.freeze({ kind: GoogleReturnKind.NEW });
    case GoogleReturnKind.EXISTING: {
      const account = query.get("account") ?? "";
      return ACCOUNT_IN_ADDRESS.test(account) ? Object.freeze({ kind: GoogleReturnKind.EXISTING, account, ownKeys: query.get("keys") === "own" }) : null;
    }
    case GoogleReturnKind.ERROR: {
      const reason = query.get("reason") ?? "";
      return Object.freeze({ kind: GoogleReturnKind.ERROR, reason: REASONS.includes(reason) ? reason : GoogleReturnReason.FAILED });
    }
    default:
      return null;
  }
}

export const GoogleNameError = Object.freeze({ INVALID_NAME: "INVALID_NAME", BUSY: "BUSY" });

export class GoogleSignInService {
  #api;
  #identity;
  #navigate;
  /** @type {GoogleReturn | null} */
  #pending;
  #offered = false;
  #creating = false;

  /**
   * @param {{
   *   api: import("../ports/GoogleApi.contract.js").GoogleApi,
   *   identity: Pick<import("./IdentityService.js").IdentityService, "adoptGoogleSession">,
   *   navigate: (path: string) => void,
   *   pending?: GoogleReturn | null,
   * }} deps `navigate`: a full-page visit; `pending`: what the address said at start-up
   */
  constructor({ api, identity, navigate, pending = null }) {
    this.#api = api;
    this.#identity = identity;
    this.#navigate = navigate;
    this.#pending = pending;
  }

  /** Whether the server offers signing in with Google (known after `refresh`). */
  get offered() {
    return this.#offered;
  }

  /** What the last Google sign-in came back with, until a screen took it. */
  get pending() {
    return this.#pending;
  }

  /** Asks the server whether it offers signing in with Google; a server that cannot say does not. */
  async refresh() {
    const answer = await this.#api.offered();
    this.#offered = answer.ok && answer.value;
    return this.#offered;
  }

  /**
   * The outcome of the last sign-in, once: the screen that shows it takes it.
   * @returns {GoogleReturn | null}
   */
  take() {
    const pending = this.#pending;
    this.#pending = null;
    return pending;
  }

  /** Off to Google, through the game server. */
  start() {
    this.#navigate(this.#api.startPath);
  }

  /**
   * Whether a name can be the new account's.
   * @param {string} rawName as typed
   */
  async nameStatus(rawName) {
    const name = normalized(rawName);
    if (!NAME_PATTERN.test(name)) {
      return ok(Object.freeze({ name, available: false, reason: /** @type {const} */ ("invalid") }));
    }
    return this.#api.nameStatus(name);
  }

  /**
   * Creates the account with this name, keeps its wallet and signs in.
   * @param {string} rawName as typed
   * @returns {Promise<import("@magic8/engine/shared/Result.js").Ok<import("../ports/AuthApi.contract.js").SessionUser> | import("@magic8/engine/shared/Result.js").Fail>}
   */
  async createAccount(rawName) {
    const name = normalized(rawName);
    if (!NAME_PATTERN.test(name)) {
      return fail(GoogleNameError.INVALID_NAME, "this name cannot be an account name");
    }
    if (this.#creating) {
      return fail(GoogleNameError.BUSY, "the account is already being created");
    }
    this.#creating = true;
    try {
      const created = await this.#api.createAccount(name);
      if (created.ok) {
        this.#pending = null;
        this.#identity.adoptGoogleSession(created.value);
      }
      return created;
    } finally {
      this.#creating = false;
    }
  }
}

/** @param {string} rawName */
function normalized(rawName) {
  return String(rawName).trim().replace(/^@/, "").toLowerCase();
}
