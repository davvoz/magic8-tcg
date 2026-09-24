/**
 * A browser wallet that holds the user's keys and signs on their behalf
 * (Steem Keychain first). Keys never leave it; the client only ever sees
 * signatures.
 *
 * @typedef {object} WalletConnector
 * @property {string} name shown to the user ("Steem Keychain")
 * @property {() => boolean} isAvailable
 * @property {(request: { account: string, message: string, keyRole: string }) => Promise<import("@magic8/engine/shared/Result.js").Ok<string> | import("@magic8/engine/shared/Result.js").Fail>} signMessage resolves to the signature
 * @property {(request: TransferRequest) => Promise<import("@magic8/engine/shared/Result.js").Ok<string> | import("@magic8/engine/shared/Result.js").Fail>} requestTransfer
 *   asks the user to approve a transfer exactly as the server's payment instructions say; resolves to the transaction id
 *
 * @typedef {Readonly<{ from: string, to: string, amount: string, asset: string, memo: string }>} TransferRequest amount as a decimal string ("1.000")
 */

export const WalletFailure = Object.freeze({
  NOT_INSTALLED: "WALLET_NOT_INSTALLED",
  REJECTED: "WALLET_REJECTED",
  TIMEOUT: "WALLET_TIMEOUT",
  BAD_SIGNATURE: "WALLET_BAD_SIGNATURE",
  BAD_RESPONSE: "WALLET_BAD_RESPONSE",
});

export const WALLET_CONNECTOR_METHODS = Object.freeze(["isAvailable", "signMessage", "requestTransfer"]);
