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
 */
export const WALLET_PROVIDER_METHODS = Object.freeze(["isValidAccountName", "buildLoginMessage", "verifyLogin", "isPostingKey"]);

