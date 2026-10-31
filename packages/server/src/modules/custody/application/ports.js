/**
 * Ports of the custody module (docs/tcg/29-google.md): the keys of the
 * accounts the server keeps for players who signed in with Google, and what
 * the server signs with them.
 *
 * @typedef {Readonly<{ masterPassword: string, owner: string, active: string, posting: string, memo: string }>} AccountKeys
 *   private keys in their wallet format, and the password they derive from
 * @typedef {Readonly<{ network: string, account: string, postingPublic: string }>} KeptAccount
 *
 * @typedef {object} Keyring the chain adapter's view of its keys (e.g. SteemKeyring)
 * @property {string} network
 * @property {(privateKey: string) => string | null} publicKeyOf the public key of a private key, null when it is not one
 *
 * @typedef {Readonly<{ blockNum: number, blockId: string, time: number }>} BlockReference the head block a transaction references
 * @typedef {Readonly<{ from: string, to: string, amount: string, asset: string, memo: string }>} TransferRequest amount as a decimal string ("1.000")
 * @typedef {Readonly<{ author: string, parentAuthor: string, parentPermlink: string, permlink: string, title: string, body: string, jsonMetadata: string }>} CommentRequest
 * @typedef {Readonly<{ transaction: Readonly<Record<string, unknown>>, txId: string }>} SignedTransaction in the node's JSON form
 *
 * @typedef {Keyring & {
 *   signMessage: (message: string, privateKey: string) => string,
 *   signTransfer: (request: { reference: BlockReference, expirationSeconds: number, transfer: TransferRequest }, privateKey: string) => SignedTransaction,
 *   signComment: (request: { reference: BlockReference, expirationSeconds: number, comment: CommentRequest }, privateKey: string) => SignedTransaction,
 * }} SigningKeyring
 *
 * @typedef {object} CustodyRepository
 * @property {(entry: { userId: string, network: string, account: string, postingPublic: string, sealed: Uint8Array, createdAt: number }) => Promise<boolean>} insert
 *   false when the user (or the account) already has kept keys
 * @property {(userId: string) => Promise<KeptAccount | null>} find
 * @property {(userId: string) => Promise<Readonly<{ network: string, account: string, sealed: Uint8Array }> | null>} findSealed
 * @property {(userId: string) => Promise<boolean>} remove false when there was nothing to remove
 * @property {(memo: string, userId: string, at: number) => Promise<boolean>} claimTransfer false when a transfer with this memo was already signed
 * @property {(memo: string, txId: string) => Promise<void>} recordTransfer
 * @property {(memo: string) => Promise<string | null>} transferOf the id of the transaction already signed for this memo (null: none, or not known yet)
 * @property {(memo: string) => Promise<void>} releaseTransfer
 *
 * A payment the game asked a player for, still open (the shop's orders, the
 * reservations of the player market): what a kept account may pay.
 * @typedef {Readonly<{ network: string, from: string, to: string, asset: string, amount: string, memo: string, expiresAt: number }>} OpenPayment
 * @typedef {{ openPayment: (userId: string, memo: string) => Promise<OpenPayment | null> }} PaymentSource
 *
 * The chain, as the identity module already reads and relays it for the browsers that sign with their own keys.
 * `user` is the signed-in user, as the request's principal carries it.
 * @typedef {object} ChainAccess
 * @property {(user: any) => Promise<BlockReference>} chainReference
 * @property {(user: any, transaction: unknown, ip: string) => Promise<string>} relayTransfer the transaction id; throws an AppError
 *
 * @typedef {{ relay: (user: Player, transaction: unknown, ip: string) => Promise<string> }} PingRelay
 * @typedef {Readonly<{ id: string, network: string, account: string }>} Player
 */

export const KEYRING_METHODS = Object.freeze(["publicKeyOf"]);
export const SIGNING_KEYRING_METHODS = Object.freeze(["publicKeyOf", "signMessage", "signTransfer", "signComment"]);
export const CUSTODY_REPOSITORY_METHODS = Object.freeze(["insert", "find", "findSealed", "remove", "claimTransfer", "recordTransfer", "transferOf", "releaseTransfer"]);
export const PAYMENT_SOURCE_METHODS = Object.freeze(["openPayment"]);
export const CHAIN_ACCESS_METHODS = Object.freeze(["chainReference", "relayTransfer"]);
