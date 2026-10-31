/**
 * The keys of an account a server keeps for its player (docs/tcg/29-google.md):
 * what the server's custody needs to know of STEEM keys, without knowing STEEM.
 */
import { decodeWif, publicKeyOf } from "../crypto/keys.js";
import { STEEM_NETWORK } from "./SteemBlockchainProvider.js";

export class SteemKeyring {
  get network() {
    return STEEM_NETWORK;
  }

  /**
   * @param {string} wif a private key in wallet import format
   * @returns {string | null} its public key ("STM…"), or null when it is not a private key
   */
  publicKeyOf(wif) {
    const key = typeof wif === "string" ? decodeWif(wif) : null;
    return key === null ? null : publicKeyOf(key);
  }
}
