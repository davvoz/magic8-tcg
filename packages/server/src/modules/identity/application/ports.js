/**
 * Ports of the identity module, implemented on PostgreSQL
 * (infrastructure/PgIdentityRepositories.js). Any implementation must honour
 * the atomicity of `consume` and the uniqueness of (network, account).
 *
 * @typedef {Readonly<{ id: string, network: string, account: string, status: "active" | "suspended", roles: readonly string[], createdAt: number, lastLoginAt: number | null }>} User
 *
 * @typedef {object} UserRepository
 * @property {(identity: { network: string, account: string }, now: number, newId: string) => Promise<User>} findOrCreate returns the existing user or creates it with `newId`
 * @property {(id: string) => Promise<User | null>} findById
 * @property {(id: string, now: number) => Promise<void>} recordLogin
 *
 * @typedef {object} ChallengeRepository
 * @property {(challenge: import("../domain/LoginChallenge.js").LoginChallenge) => Promise<void>} save
 * @property {(id: string, now: number) => Promise<import("../domain/LoginChallenge.js").LoginChallenge | null>} consume
 *   atomically marks the challenge consumed and returns it, or returns null if it is unknown, expired or already consumed
 * @property {(now: number) => Promise<number>} purgeExpired
 *
 * @typedef {object} SessionRepository
 * @property {(session: import("../domain/Session.js").Session) => Promise<void>} save
 * @property {(tokenHash: string) => Promise<import("../domain/Session.js").Session | null>} findByTokenHash
 * @property {(id: string, now: number) => Promise<void>} touch
 * @property {(id: string, reason: string, now: number) => Promise<boolean>} revoke true if it was active
 * @property {(userId: string, publicKey: string, reason: string, now: number) => Promise<number>} revokeByLoginKey
 * @property {(now: number, limit: number, after?: { userId: string, loginPublicKey: string } | null) => Promise<readonly Readonly<{ userId: string, loginPublicKey: string }>[]>} listActiveLoginKeys
 *   distinct pairs in (userId, loginPublicKey) order, starting after `after`
 */

export const USER_REPOSITORY_METHODS = Object.freeze(["findOrCreate", "findById", "recordLogin"]);
export const CHALLENGE_REPOSITORY_METHODS = Object.freeze(["save", "consume", "purgeExpired"]);
export const SESSION_REPOSITORY_METHODS = Object.freeze(["save", "findByTokenHash", "touch", "revoke", "revokeByLoginKey", "listActiveLoginKeys"]);

/**
 * Wallet providers are defined by the blockchain adapters (e.g. SteemWalletProvider).
 * @typedef {object} WalletProvider
 * @property {string} network
 * @property {string} loginKeyRole
 * @property {(name: unknown) => boolean} isValidAccountName
 * @property {(challenge: { account: string, nonce: string, origin: string, issuedAt: number, expiresAt: number }) => string} buildLoginMessage
 * @property {(proof: { account: string, message: string, signature: string }) => Promise<import("@magic8/engine/shared/Result.js").Ok<Readonly<{ network: string, account: string, publicKey: string }>> | import("@magic8/engine/shared/Result.js").Fail>} verifyLogin
 * @property {(account: string, publicKey: string) => Promise<import("@magic8/engine/shared/Result.js").Ok<true> | import("@magic8/engine/shared/Result.js").Fail>} isPostingKey
 * @property {(account: string) => Promise<import("@magic8/engine/shared/Result.js").Ok<readonly Readonly<{ asset: string, amount: string }>[]> | import("@magic8/engine/shared/Result.js").Fail>} [balancesOf]
 *   what the account can spend now, amounts as the chain writes them ("12.500"); optional
 * @property {(account: string, publicKey: string) => Promise<import("@magic8/engine/shared/Result.js").Ok<readonly string[]> | import("@magic8/engine/shared/Result.js").Fail>} [keyRolesOf]
 *   the authorities ("owner", "active", "posting") the key satisfies alone; optional
 * @property {() => Promise<import("@magic8/engine/shared/Result.js").Ok<Readonly<{ blockNum: number, blockId: string, time: number }>> | import("@magic8/engine/shared/Result.js").Fail>} [reference]
 *   the head block a transaction signed now references; optional
 * @property {(account: string, transaction: unknown) => Promise<import("@magic8/engine/shared/Result.js").Ok<string> | import("@magic8/engine/shared/Result.js").Fail>} [broadcastTransfer]
 *   relays a single transfer from `account` signed in its browser; resolves to the transaction id; optional
 */
export const WALLET_PROVIDER_METHODS = Object.freeze(["isValidAccountName", "buildLoginMessage", "verifyLogin", "isPostingKey"]);

/**
 * Signing in with Google (docs/tcg/29-google.md).
 *
 * @typedef {Readonly<{ sub: string, userId: string, email: string | null }>} GoogleIdentityLink
 * @typedef {Readonly<{ masterPassword: string, owner: string, active: string, posting: string, memo: string }>} NewAccountKeys
 *   a new account's private keys (wallet format) and the password they derive from
 *
 * @typedef {object} GoogleIdentityRepository
 * @property {(sub: string) => Promise<GoogleIdentityLink | null>} findBySub
 * @property {(link: GoogleIdentityLink, now: number) => Promise<boolean>} link false when the identity or the user is already linked
 * @property {(sub: string, now: number) => Promise<void>} recordLogin
 *
 * @typedef {object} GoogleOAuth Google's OAuth endpoints, for the game's client
 * @property {(request: { state: string, nonce: string, codeChallenge: string, redirectUri: string }) => string} authorizationUrl
 *   where the browser goes to sign in (PKCE with S256)
 * @property {(request: { code: string, codeVerifier: string, redirectUri: string }) => Promise<import("@magic8/engine/shared/Result.js").Ok<unknown> | import("@magic8/engine/shared/Result.js").Fail>} exchangeCode
 *   the claims of the ID token Google returns for the code
 *
 * @typedef {object} AccountFactory who creates the accounts of Google sign-ins (join.cur8's partner API)
 * @property {(sub: string) => Promise<import("@magic8/engine/shared/Result.js").Ok<string | null> | import("@magic8/engine/shared/Result.js").Fail>} accountOf
 *   the account this Google identity already created there, if any
 * @property {(request: { sub: string, email: string | null, account: string }) => Promise<import("@magic8/engine/shared/Result.js").Ok<Readonly<{ account: string, keys: NewAccountKeys }>> | import("@magic8/engine/shared/Result.js").Fail>} createAccount
 *   fails with ALREADY_CREATED (details: { account }), NAME_TAKEN, INVALID_ACCOUNT or UNAVAILABLE
 */
export const GOOGLE_IDENTITY_REPOSITORY_METHODS = Object.freeze(["findBySub", "link", "recordLogin"]);
export const GOOGLE_OAUTH_METHODS = Object.freeze(["authorizationUrl", "exchangeCode"]);
export const ACCOUNT_FACTORY_METHODS = Object.freeze(["accountOf", "createAccount"]);
export const AccountFactoryFailure = Object.freeze({ ALREADY_CREATED: "ALREADY_CREATED", NAME_TAKEN: "NAME_TAKEN", INVALID_ACCOUNT: "INVALID_ACCOUNT", UNAVAILABLE: "UNAVAILABLE" });

