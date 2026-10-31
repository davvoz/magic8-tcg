/**
 * Signing in with Google, the wallet kept by the server (docs/tcg/29-google.md):
 *
 * - start: a fresh state, nonce and PKCE verifier, sealed into a short-lived
 *   cookie (nothing is stored server-side), and Google's address to go to.
 * - complete: Google's answer must carry the state of the cookie; the code
 *   is exchanged server to server, the ID token must answer the nonce. Then:
 *   an identity already linked signs in; one that already created an account
 *   on join.cur8 is told to sign in with that account's keys (we do not have
 *   them); a new one gets a sealed sign-up cookie to choose a name with.
 * - createAccount: join.cur8 creates the account and hands its keys over;
 *   in one unit of work the user is created, the keys are kept (custody),
 *   the identity is linked and a session opens.
 *
 * - Before the wallet is exported, the player signs in at Google again
 *   (purpose EXPORT: Google asks for the password, whatever session it has).
 *   No session opens: a sealed cookie says, for ten minutes, that this user
 *   just proved it is them (reauthenticatedUser).
 *
 * Sessions opened here are of the GOOGLE method and name the kept posting
 * key, so the key audit (T18) closes them if the keys change on chain. A
 * sign-in checks that key first: once the player changed the account's keys
 * (after exporting them), the account is theirs alone, the kept keys are
 * dropped and the player is told to sign in with their own.
 */
import { fail, ok } from "@magic8/engine/shared/Result.js";
import { hexToBytes, sha256Hex, utf8 } from "@magic8/protocol";
import { AppError } from "../../../kernel/AppError.js";
import { assertImplements } from "../../../kernel/contracts.js";
import { parseJson } from "../../../kernel/json.js";
import { base64Url, uuidV4 } from "../../../kernel/random.js";
import { verifiedGoogleIdentity } from "../domain/googleIdentity.js";
import { SessionMethod } from "../domain/Session.js";
import { ACCOUNT_FACTORY_METHODS, AccountFactoryFailure, GOOGLE_IDENTITY_REPOSITORY_METHODS, GOOGLE_OAUTH_METHODS } from "./ports.js";

/** Time to sign in at Google and come back. */
export const FLOW_TTL_MS = 10 * 60 * 1000;
/** Time to choose the new account's name. */
export const SIGNUP_TTL_MS = 30 * 60 * 1000;
/** How long signing in again at Google lets the player export their wallet, and how recent that sign-in must be. */
export const REAUTH_TTL_MS = 10 * 60 * 1000;
const FLOW_CONTEXT = "google_sign_in:flow";
const REAUTH_CONTEXT = "google_sign_in:reauth";
const SIGNUP_CONTEXT = "google_sign_in:signup";
/** What the chain answers when the kept posting key is no longer the account's (the key audit's revoking answer). */
const KEY_GONE = "KEY_NOT_AUTHORIZED";
/** Cookies hold at most 512 characters: a longer address is not carried to join (it is optional there). */
const MAX_CARRIED_EMAIL = 100;
const MAX_SEALED_LENGTH = 512;

export const GoogleOutcome = Object.freeze({ SIGNED_IN: "signed-in", EXISTING: "existing", NEW: "new", REAUTHENTICATED: "reauthenticated", FAILED: "failed" });
/** What a Google sign-in is for: signing in, or proving it is the player again before their wallet is exported. */
export const GooglePurpose = Object.freeze({ SIGN_IN: "sign-in", EXPORT: "export" });
/** Why a sign-in did not complete, in the words the client shows. */
export const GoogleFailure = Object.freeze({ CANCELLED: "cancelled", EXPIRED: "expired", UNAVAILABLE: "unavailable", FAILED: "failed" });

/**
 * @typedef {Readonly<{ user: import("./ports.js").User, token: string, expiresAt: number }>} OpenedSession
 * @typedef {Readonly<{ kind: "signed-in", session: OpenedSession }>
 *   | Readonly<{ kind: "existing", account: string, ownKeys: boolean }>
 *   | Readonly<{ kind: "new", signup: string }>
 *   | Readonly<{ kind: "reauthenticated", reauth: string }>
 *   | Readonly<{ kind: "failed", reason: string }>} GoogleResult
 */

export class GoogleSignIn {
  #oauth;
  #accounts;
  #identities;
  #users;
  #custody;
  #auth;
  #wallet;
  #secrets;
  #clock;
  #random;
  #audit;
  #unitOfWork;
  #logger;
  #clientId;
  #redirectUri;

  /**
   * @param {{
   *   oauth: import("./ports.js").GoogleOAuth,
   *   accounts: import("./ports.js").AccountFactory,
   *   identities: import("./ports.js").GoogleIdentityRepository,
   *   users: import("./ports.js").UserRepository,
   *   custody: {
   *     keep: (input: { userId: string, network: string, account: string, keys: import("./ports.js").NewAccountKeys }) => Promise<string>,
   *     keptAccountOf: (userId: string) => Promise<Readonly<{ network: string, account: string, postingPublic: string }> | null>,
   *     forget: (userId: string) => Promise<boolean>,
   *   },
   *   auth: Pick<import("./AuthService.js").AuthService, "openVouchedSession">,
   *   wallet: import("./ports.js").WalletProvider & { accountExists: (account: string) => Promise<import("@magic8/engine/shared/Result.js").Ok<boolean> | import("@magic8/engine/shared/Result.js").Fail> },
   *   secrets: import("../../../kernel/crypto/SecretBox.js").SecretBox,
   *   clock: import("../../../kernel/time.js").Clock,
   *   random: import("../../../kernel/random.js").SecureRandom,
   *   audit: import("../../../kernel/audit/AuditTrail.js").AuditTrail,
   *   unitOfWork: import("../../../kernel/unitOfWork.js").UnitOfWork,
   *   logger: import("../../../kernel/logger.js").Logger,
   *   clientId: string,
   *   redirectUri: string,
   * }} deps `wallet`: the network new accounts are created on
   */
  constructor({ oauth, accounts, identities, users, custody, auth, wallet, secrets, clock, random, audit, unitOfWork, logger, clientId, redirectUri }) {
    assertImplements(oauth, GOOGLE_OAUTH_METHODS, "GoogleOAuth");
    assertImplements(accounts, ACCOUNT_FACTORY_METHODS, "AccountFactory");
    assertImplements(identities, GOOGLE_IDENTITY_REPOSITORY_METHODS, "GoogleIdentityRepository");
    if (typeof wallet.accountExists !== "function") {
      throw new TypeError("GoogleSignIn: the wallet provider cannot tell whether an account exists");
    }
    this.#oauth = oauth;
    this.#accounts = accounts;
    this.#identities = identities;
    this.#users = users;
    this.#custody = custody;
    this.#auth = auth;
    this.#wallet = wallet;
    this.#secrets = secrets;
    this.#clock = clock;
    this.#random = random;
    this.#audit = audit;
    this.#unitOfWork = unitOfWork;
    this.#logger = logger;
    this.#clientId = clientId;
    this.#redirectUri = redirectUri;
  }

  /**
   * @param {{ purpose?: string }} [request] one of GooglePurpose; signing in by default
   * @returns {Readonly<{ location: string, flow: string }>} where to send the browser, and the cookie that remembers this sign-in
   */
  start({ purpose = GooglePurpose.SIGN_IN } = {}) {
    const state = base64Url(this.#random.bytes(16));
    const nonce = base64Url(this.#random.bytes(16));
    const verifier = base64Url(this.#random.bytes(32));
    const codeChallenge = base64Url(hexToBytes(sha256Hex(utf8(verifier))));
    const exporting = purpose === GooglePurpose.EXPORT;
    const flow = this.#seal({ state, nonce, verifier, purpose: exporting ? GooglePurpose.EXPORT : GooglePurpose.SIGN_IN, expiresAt: this.#clock.now() + FLOW_TTL_MS }, FLOW_CONTEXT);
    return Object.freeze({ location: this.#oauth.authorizationUrl({ state, nonce, codeChallenge, redirectUri: this.#redirectUri, reauthenticate: exporting }), flow });
  }

  /**
   * Google sent the browser back.
   * @param {{ code: string | null, state: string | null, error: string | null, flow: string | null, ip: string }} input
   * @returns {Promise<GoogleResult>}
   */
  async complete({ code, state, error, flow, ip }) {
    if (error !== null) {
      return failed(GoogleFailure.CANCELLED);
    }
    const identity = await this.#identityOf({ code, state, flow, ip });
    if (!identity.ok) {
      return failed(identity.error.code);
    }
    if (identity.value.purpose === GooglePurpose.EXPORT) {
      return this.#reauthenticated(identity.value, ip);
    }
    const { sub, email } = identity.value;
    const link = await this.#identities.findBySub(sub);
    if (link !== null) {
      return this.#signedIn(link, ip);
    }
    const existing = await this.#accounts.accountOf(sub);
    if (!existing.ok) {
      return failed(GoogleFailure.UNAVAILABLE);
    }
    if (existing.value !== null) {
      return Object.freeze({ kind: GoogleOutcome.EXISTING, account: existing.value, ownKeys: false });
    }
    const signup = this.#seal({ sub, email: email !== null && email.length <= MAX_CARRIED_EMAIL ? email : null, expiresAt: this.#clock.now() + SIGNUP_TTL_MS }, SIGNUP_CONTEXT);
    return Object.freeze({ kind: GoogleOutcome.NEW, signup });
  }

  /**
   * Who Google says signed in, if the answer belongs to the sign-in of this browser's cookie.
   * @param {{ code: string | null, state: string | null, flow: string | null, ip: string }} input
   * @returns {Promise<import("@magic8/engine/shared/Result.js").Ok<import("../domain/googleIdentity.js").GoogleIdentity & { purpose: string }> | import("@magic8/engine/shared/Result.js").Fail>}
   *   failure codes are GoogleFailure reasons; `purpose`: what the sign-in was started for
   */
  async #identityOf({ code, state, flow, ip }) {
    const pending = this.#open(flow, FLOW_CONTEXT);
    if (pending === null || typeof pending.state !== "string" || pending.state !== state || code === null) {
      return fail(GoogleFailure.EXPIRED, "this sign-in is unknown or expired");
    }
    const exchanged = await this.#oauth.exchangeCode({ code, codeVerifier: String(pending.verifier), redirectUri: this.#redirectUri });
    if (!exchanged.ok) {
      return fail(exchanged.error.code === "UNAVAILABLE" ? GoogleFailure.UNAVAILABLE : GoogleFailure.FAILED, exchanged.error.message);
    }
    const identity = verifiedGoogleIdentity(exchanged.value, { clientId: this.#clientId, nonce: String(pending.nonce), now: this.#clock.now() });
    if (!identity.ok) {
      await this.#audit.record({ actorKind: "system", action: "auth.google_refused", targetKind: "google", targetId: "unknown", ip, details: { reason: identity.error.message } });
      return fail(GoogleFailure.FAILED, identity.error.message);
    }
    return ok(Object.freeze({ ...identity.value, purpose: pending.purpose === GooglePurpose.EXPORT ? GooglePurpose.EXPORT : GooglePurpose.SIGN_IN }));
  }

  /**
   * The player signed in at Google again, to export their wallet: only an identity linked here. Google was asked for
   * the password (prompt=login), but its ID tokens do not always say when it was typed (`auth_time`): when they do,
   * it must be recent; when they do not, the fresh token of this very identity is the proof, as strong as the
   * Google session it comes from.
   * @param {import("../domain/googleIdentity.js").GoogleIdentity} identity
   * @param {string} ip
   * @returns {Promise<GoogleResult>}
   */
  async #reauthenticated({ sub, authTime }, ip) {
    const link = await this.#identities.findBySub(sub);
    const now = this.#clock.now();
    if (link === null || (authTime !== null && authTime < now - REAUTH_TTL_MS)) {
      return failed(GoogleFailure.FAILED);
    }
    await this.#audit.record({ actorKind: "user", actorUserId: link.userId, action: "auth.google_reauthenticated", targetKind: "user", targetId: link.userId, ip, details: { authTime: authTime !== null } });
    return Object.freeze({ kind: GoogleOutcome.REAUTHENTICATED, reauth: this.#seal({ userId: link.userId, expiresAt: now + REAUTH_TTL_MS }, REAUTH_CONTEXT) });
  }

  /**
   * Who signed in at Google again in the last ten minutes, by the cookie that says it.
   * @param {string | null} reauth the cookie
   * @returns {string | null} their user id
   */
  reauthenticatedUser(reauth) {
    const payload = this.#open(reauth, REAUTH_CONTEXT);
    return typeof payload?.userId === "string" ? payload.userId : null;
  }

  /**
   * Whether a name can be the new account's.
   * @param {{ signup: string | null, name: string }} input
   * @returns {Promise<Readonly<{ available: boolean, reason: "invalid" | "taken" | null }>>}
   */
  async nameStatus({ signup, name }) {
    this.#signupOf(signup);
    if (!this.#wallet.isValidAccountName(name)) {
      return Object.freeze({ available: false, reason: "invalid" });
    }
    const exists = await this.#wallet.accountExists(name);
    if (!exists.ok) {
      throw new AppError("CHAIN_UNAVAILABLE", "the blockchain cannot be reached right now, try again");
    }
    return Object.freeze({ available: !exists.value, reason: exists.value ? "taken" : null });
  }

  /**
   * Creates the account of a new Google sign-in, keeps its keys and opens its session.
   * @param {{ signup: string | null, account: unknown, ip: string }} input
   * @returns {Promise<OpenedSession>}
   */
  async createAccount({ signup, account, ip }) {
    const { sub, email } = this.#signupOf(signup);
    if (!this.#wallet.isValidAccountName(account)) {
      throw new AppError("INVALID_ACCOUNT", "this name cannot be an account name");
    }
    const link = await this.#identities.findBySub(sub);
    if (link !== null) {
      // Sent twice: the first one created it.
      return this.#openFor(link, ip);
    }
    const created = await this.#accounts.createAccount({ sub, email, account: /** @type {string} */ (account) });
    if (!created.ok) {
      throw creationFailure(created.error);
    }
    const network = this.#wallet.network;
    // The account exists on chain from here: its keys exist nowhere else.
    try {
      const session = await this.#unitOfWork(async () => {
        const now = this.#clock.now();
        const user = await this.#users.findOrCreate({ network, account: created.value.account }, now, uuidV4(this.#random));
        const postingPublic = await this.#custody.keep({ userId: user.id, network, account: created.value.account, keys: created.value.keys });
        if (!(await this.#identities.link({ sub, userId: user.id, email }, now))) {
          throw new AppError("CONFLICT", "this Google account is already linked to an account");
        }
        await this.#audit.record({ actorKind: "user", actorUserId: user.id, action: "auth.google_account_created", targetKind: "account", targetId: `${network}:${created.value.account}`, ip });
        return this.#auth.openVouchedSession({ network, account: created.value.account, publicKey: postingPublic, method: SessionMethod.GOOGLE, ip });
      });
      return session;
    } catch (error) {
      this.#logger.error("a Google account was created on chain but could not be kept", { account: created.value.account, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  /**
   * @param {import("./ports.js").GoogleIdentityLink} link
   * @param {string} ip
   * @returns {Promise<GoogleResult>}
   */
  async #signedIn(link, ip) {
    const ownKeys = await this.#ownKeysAccount(link, ip);
    if (ownKeys !== null) {
      return Object.freeze({ kind: GoogleOutcome.EXISTING, account: ownKeys, ownKeys: true });
    }
    try {
      return Object.freeze({ kind: GoogleOutcome.SIGNED_IN, session: await this.#openFor(link, ip) });
    } catch (error) {
      if (error instanceof AppError && error.code === "FORBIDDEN") {
        return failed(GoogleFailure.FAILED);
      }
      throw error;
    }
  }

  /**
   * The account of a linked identity, when it no longer uses the keys the
   * server keeps (the player changed them): those are dropped. An unreadable
   * chain does not stop the sign-in; the key audit catches up later.
   * @param {import("./ports.js").GoogleIdentityLink} link
   * @param {string} ip
   * @returns {Promise<string | null>}
   */
  async #ownKeysAccount(link, ip) {
    const kept = await this.#custody.keptAccountOf(link.userId);
    if (kept === null) {
      return (await this.#users.findById(link.userId))?.account ?? null;
    }
    const current = await this.#wallet.isPostingKey(kept.account, kept.postingPublic);
    if (current.ok || current.error.code !== KEY_GONE) {
      return null;
    }
    if (await this.#custody.forget(link.userId)) {
      await this.#audit.record({ actorKind: "user", actorUserId: link.userId, action: "auth.google_keys_released", targetKind: "account", targetId: `${kept.network}:${kept.account}`, ip });
    }
    return kept.account;
  }

  /**
   * @param {import("./ports.js").GoogleIdentityLink} link
   * @param {string} ip
   */
  async #openFor(link, ip) {
    const kept = await this.#custody.keptAccountOf(link.userId);
    if (kept === null) {
      throw new Error(`GoogleSignIn: the Google identity of user ${link.userId} has no kept keys`);
    }
    const session = await this.#auth.openVouchedSession({ network: kept.network, account: kept.account, publicKey: kept.postingPublic, method: SessionMethod.GOOGLE, ip });
    await this.#identities.recordLogin(link.sub, this.#clock.now());
    return session;
  }

  /**
   * @param {string | null} signup the sign-up cookie
   * @returns {{ sub: string, email: string | null }}
   */
  #signupOf(signup) {
    const pending = this.#open(signup, SIGNUP_CONTEXT);
    if (pending === null || typeof pending.sub !== "string") {
      throw new AppError("SIGNUP_EXPIRED", "this sign-up has expired: sign in with Google again");
    }
    return { sub: pending.sub, email: typeof pending.email === "string" ? pending.email : null };
  }

  /**
   * @param {Record<string, unknown> & { expiresAt: number }} payload
   * @param {string} context
   */
  #seal(payload, context) {
    const sealed = base64Url(this.#secrets.seal(utf8(JSON.stringify(payload)), context));
    if (sealed.length > MAX_SEALED_LENGTH) {
      throw new Error("GoogleSignIn: a sealed cookie would be too long");
    }
    return sealed;
  }

  /**
   * @param {string | null} value a sealed cookie
   * @param {string} context
   * @returns {Record<string, unknown> | null} its payload, when it opens and has not expired
   */
  #open(value, context) {
    if (value === null || value === "") {
      return null;
    }
    try {
      const payload = /** @type {Record<string, unknown>} */ (parseJson(Buffer.from(this.#secrets.open(new Uint8Array(Buffer.from(value, "base64url")), context)).toString("utf8")));
      return typeof payload?.expiresAt === "number" && payload.expiresAt > this.#clock.now() ? payload : null;
    } catch {
      return null;
    }
  }
}

/** @param {string} reason */
function failed(reason) {
  return Object.freeze({ kind: GoogleOutcome.FAILED, reason });
}

/**
 * join.cur8's refusal → what the player is told.
 * @param {import("@magic8/engine/shared/Result.js").ResultError} error
 */
function creationFailure(error) {
  switch (error.code) {
    case AccountFactoryFailure.ALREADY_CREATED: {
      const account = /** @type {{ account?: unknown } | null} */ (error.details)?.account;
      return new AppError("CONFLICT", "this Google account already created an account: sign in with its posting key or Keychain", typeof account === "string" ? { account } : undefined);
    }
    case AccountFactoryFailure.NAME_TAKEN:
      return new AppError("NAME_TAKEN", "this name is taken");
    case AccountFactoryFailure.INVALID_ACCOUNT:
      return new AppError("INVALID_ACCOUNT", "this name cannot be an account name");
    default:
      return new AppError("ACCOUNTS_UNAVAILABLE", "new accounts cannot be created right now, try again later");
  }
}
