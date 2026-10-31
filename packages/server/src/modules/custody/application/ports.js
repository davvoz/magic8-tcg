/**
 * Ports of the custody module (docs/tcg/29-google.md): the keys of the
 * accounts the server keeps for players who signed in with Google.
 *
 * @typedef {Readonly<{ masterPassword: string, owner: string, active: string, posting: string, memo: string }>} AccountKeys
 *   private keys in their wallet format, and the password they derive from
 *
 * @typedef {object} Keyring the chain adapter's view of its keys (e.g. SteemKeyring)
 * @property {string} network
 * @property {(privateKey: string) => string | null} publicKeyOf the public key of a private key, null when it is not one
 *
 * @typedef {object} CustodyRepository
 * @property {(entry: { userId: string, network: string, account: string, postingPublic: string, sealed: Uint8Array, createdAt: number }) => Promise<boolean>} insert
 *   false when the user (or the account) already has kept keys
 * @property {(userId: string) => Promise<Readonly<{ network: string, account: string, postingPublic: string }> | null>} find
 */

export const KEYRING_METHODS = Object.freeze(["publicKeyOf"]);
export const CUSTODY_REPOSITORY_METHODS = Object.freeze(["insert", "find"]);
