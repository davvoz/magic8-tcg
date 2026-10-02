/**
 * Use cases of sign-in (docs/tcg/01-architettura.md §8.1, threats T16–T18):
 *
 * - issueChallenge: a random nonce bound to account, network and origin,
 *   valid for a short time, stored server-side;
 * - login: the challenge is consumed first (single use even when the
 *   signature turns out to be wrong), its origin must match the request,
 *   the wallet provider verifies the signature against the chain, then a
 *   session token is issued — returned once, stored only as a hash;
 * - authenticate: token → session → user, enforcing revocation, absolute
 *   and idle expiry and user suspension;
 * - logout: revocation.
 */
import { sha256Hex, utf8 } from "@magic8/protocol";
import { AppError } from "../../../kernel/AppError.js";
import { assertImplements } from "../../../kernel/contracts.js";
import { base64Url, uuidV4 } from "../../../kernel/random.js";
import { RevokeReason, sessionState } from "../domain/Session.js";
import { CHALLENGE_REPOSITORY_METHODS, SESSION_REPOSITORY_METHODS, USER_REPOSITORY_METHODS, WALLET_PROVIDER_METHODS } from "./ports.js";

const TOKEN_BYTES = 32;
const NONCE_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const SIGNATURE_MAX_LENGTH = 256;

/** Wallet failures that mean "the chain could not be asked", as opposed to "the proof is wrong". */
const UNAVAILABLE = "CHAIN_UNAVAILABLE";

/**
 * @typedef {Readonly<{ user: import("./ports.js").User, session: import("../domain/Session.js").Session }>} Principal
 */

export class AuthService {
  #wallets;
  #users;
  #challenges;
  #sessions;
  #audit;
  #clock;
  #random;
  #policy;
  #defaultNetwork;
  #unitOfWork;

  /**
   * @param {{
   *   wallets: ReadonlyMap<string, import("./ports.js").WalletProvider>,
   *   defaultNetwork: string,
   *   users: import("./ports.js").UserRepository,
   *   challenges: import("./ports.js").ChallengeRepository,
   *   sessions: import("./ports.js").SessionRepository,
   *   audit: import("../../../kernel/audit/AuditTrail.js").AuditTrail,
   *   clock: import("../../../kernel/time.js").Clock,
   *   random: import("../../../kernel/random.js").SecureRandom,
   *   policy: ReturnType<typeof import("../domain/policies.js").identityPolicy>,
   *   unitOfWork: import("../../../kernel/unitOfWork.js").UnitOfWork,
   * }} deps
   */
  constructor({ wallets, defaultNetwork, users, challenges, sessions, audit, clock, random, policy, unitOfWork }) {
    for (const [network, wallet] of wallets) {
      assertImplements(wallet, WALLET_PROVIDER_METHODS, `wallet provider "${network}"`);
    }
    if (!wallets.has(defaultNetwork)) {
      throw new TypeError(`AuthService: no wallet provider for the default network "${defaultNetwork}"`);
    }
    assertImplements(users, USER_REPOSITORY_METHODS, "UserRepository");
    assertImplements(challenges, CHALLENGE_REPOSITORY_METHODS, "ChallengeRepository");
    assertImplements(sessions, SESSION_REPOSITORY_METHODS, "SessionRepository");
    this.#wallets = wallets;
    this.#defaultNetwork = defaultNetwork;
    this.#users = users;
    this.#challenges = challenges;
    this.#sessions = sessions;
    this.#audit = audit;
    this.#clock = clock;
    this.#random = random;
    this.#policy = policy;
    this.#unitOfWork = unitOfWork;
  }

  /**
   * @param {{ account: unknown, network?: unknown, origin: string }} input
   * @returns {Promise<Readonly<{ challengeId: string, network: string, account: string, message: string, keyRole: string, expiresAt: number }>>}
   */
  async issueChallenge({ account, network = this.#defaultNetwork, origin }) {
    const wallet = this.#walletFor(network);
    if (!wallet.isValidAccountName(account)) {
      throw new AppError("INVALID_ACCOUNT", "invalid account name");
    }
    const now = this.#clock.now();
    const expiresAt = now + this.#policy.challengeTtlMs;
    const id = uuidV4(this.#random);
    const message = wallet.buildLoginMessage({ account: /** @type {string} */ (account), nonce: base64Url(this.#random.bytes(NONCE_BYTES)), origin, issuedAt: now, expiresAt });
    await this.#challenges.save(Object.freeze({ id, network: wallet.network, account: /** @type {string} */ (account), origin, message, createdAt: now, expiresAt, consumedAt: null }));
    return Object.freeze({ challengeId: id, network: wallet.network, account: /** @type {string} */ (account), message, keyRole: wallet.loginKeyRole, expiresAt });
  }

  /**
   * @param {{ challengeId: unknown, signature: unknown, origin: string, ip: string }} input
   * @returns {Promise<Readonly<{ user: import("./ports.js").User, token: string, expiresAt: number }>>}
   */
  async login({ challengeId, signature, origin, ip }) {
    if (typeof challengeId !== "string" || typeof signature !== "string" || signature.length > SIGNATURE_MAX_LENGTH) {
      throw new AppError("VALIDATION", "challengeId and signature are required");
    }
    const now = this.#clock.now();
    const challenge = await this.#challenges.consume(challengeId, now);
    if (challenge === null || challenge.origin !== origin) {
      throw new AppError("CHALLENGE_INVALID", "the login challenge is unknown, expired or already used");
    }
    const wallet = this.#walletFor(challenge.network);
    const verified = await wallet.verifyLogin({ account: challenge.account, message: challenge.message, signature });
    if (!verified.ok) {
      await this.#audit.record({ actorKind: "system", action: "auth.login_failed", targetKind: "account", targetId: `${challenge.network}:${challenge.account}`, ip, details: { reason: verified.error.code } });
      if (verified.error.code === UNAVAILABLE) {
        throw new AppError("CHAIN_UNAVAILABLE", "the blockchain cannot be reached right now, try again");
      }
      throw new AppError("LOGIN_FAILED", "the signature does not prove control of this account");
    }
    // The chain was asked outside the transaction: no connection is held across a network call.
    return this.#unitOfWork(() => this.#openSession({ challenge, publicKey: verified.value.publicKey, now, ip }));
  }

  /**
   * @param {{ challenge: import("../domain/LoginChallenge.js").LoginChallenge, publicKey: string, now: number, ip: string }} input
   */
  async #openSession({ challenge, publicKey, now, ip }) {
    const user = await this.#users.findOrCreate({ network: challenge.network, account: challenge.account }, now, uuidV4(this.#random));
    if (user.status !== "active") {
      throw new AppError("FORBIDDEN", "this account is suspended");
    }
    const token = base64Url(this.#random.bytes(TOKEN_BYTES));
    const expiresAt = now + this.#policy.sessionAbsoluteTtlMs;
    const session = Object.freeze({
      id: uuidV4(this.#random),
      userId: user.id,
      tokenHash: hashToken(token),
      loginPublicKey: publicKey,
      createdAt: now,
      lastSeenAt: now,
      expiresAt,
      revokedAt: null,
      revokeReason: null,
    });
    await this.#sessions.save(session);
    await this.#users.recordLogin(user.id, now);
    await this.#audit.record({ actorKind: "user", actorUserId: user.id, action: "auth.login", targetKind: "session", targetId: session.id, ip, details: { publicKey } });
    return Object.freeze({ user, token, expiresAt });
  }

  /**
   * @param {string | null} token the cookie value
   * @returns {Promise<Principal | null>}
   */
  async authenticate(token) {
    if (token === null || !TOKEN_PATTERN.test(token)) {
      return null;
    }
    const session = await this.#sessions.findByTokenHash(hashToken(token));
    if (session === null) {
      return null;
    }
    const now = this.#clock.now();
    const state = sessionState(session, now, this.#policy);
    if (state === "idle") {
      await this.#sessions.revoke(session.id, RevokeReason.IDLE, now);
    }
    if (state !== "active") {
      return null;
    }
    const user = await this.#users.findById(session.userId);
    if (user === null || user.status !== "active") {
      await this.#sessions.revoke(session.id, RevokeReason.USER_SUSPENDED, now);
      return null;
    }
    if (now - session.lastSeenAt >= this.#policy.sessionTouchIntervalMs) {
      await this.#sessions.touch(session.id, now);
    }
    return Object.freeze({ user, session });
  }

  /**
   * @param {Principal} principal
   * @param {string} ip
   */
  async logout(principal, ip) {
    await this.#unitOfWork(async () => {
      const revoked = await this.#sessions.revoke(principal.session.id, RevokeReason.LOGOUT, this.#clock.now());
      if (revoked) {
        await this.#audit.record({ actorKind: "user", actorUserId: principal.user.id, action: "auth.logout", targetKind: "session", targetId: principal.session.id, ip });
      }
    });
  }

  /** @param {unknown} network */
  /**
   * What the player can spend from their wallet right now, read from the chain.
   * @param {import("./ports.js").User} user
   * @returns {Promise<readonly Readonly<{ asset: string, amount: string }>[]>}
   */
  async balancesOf(user) {
    const wallet = this.#walletFor(user.network);
    if (typeof wallet.balancesOf !== "function") {
      throw new AppError("UNSUPPORTED_NETWORK", "this network's wallet balances cannot be read");
    }
    const balances = await wallet.balancesOf(user.account);
    if (!balances.ok) {
      throw balances.error.code === UNAVAILABLE ? new AppError("CHAIN_UNAVAILABLE", "the blockchain cannot be reached right now, try again") : new AppError("NOT_FOUND", "the account was not found on the chain");
    }
    return balances.value;
  }

  #walletFor(network) {
    const wallet = typeof network === "string" ? this.#wallets.get(network) : undefined;
    if (wallet === undefined) {
      throw new AppError("UNSUPPORTED_NETWORK", "unsupported network");
    }
    return wallet;
  }
}

/** @param {string} token */
export function hashToken(token) {
  return sha256Hex(utf8(token));
}
