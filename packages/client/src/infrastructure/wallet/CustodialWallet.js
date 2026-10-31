/**
 * The wallet KIJAM keeps for a player who signed in with Google
 * (docs/tcg/29-google.md): a WalletConnector whose keys are on the game
 * server, which signs in its place. Nothing to approve: the purchase button
 * is the approval. The server signs only a transfer paying what the game
 * asked for, a game's session key and a ping.
 */
import { fail, ok } from "@magic8/engine/shared/Result.js";
import { ApiFailure } from "../../application/ports/AuthApi.contract.js";
import { WalletFailure } from "../../application/ports/WalletConnector.contract.js";

/** Failures after which a transfer may or may not have reached the chain. */
const UNCERTAIN = Object.freeze([ApiFailure.NETWORK, ApiFailure.UNAVAILABLE, "CHAIN_UNAVAILABLE"]);
const ALREADY_PAID = "ALREADY_PAID";
const TX_ID_PATTERN = /^[0-9a-f]{40}$/;

export class CustodialWallet {
  #api;

  /** @param {{ api: Pick<import("../api/HttpCustodyApi.js").HttpCustodyApi, "transfer" | "signMessage" | "ping"> }} deps */
  constructor({ api }) {
    this.#api = api;
  }

  get name() {
    return "your KIJAM wallet";
  }

  /** Always there: it lives on the game server. */
  isAvailable() {
    return true;
  }

  /** @param {{ account: string, message: string, keyRole: string }} request */
  async signMessage({ message }) {
    const signed = await this.#api.signMessage(message);
    return signed.ok ? signed : fail(WalletFailure.REJECTED, signed.error.message);
  }

  /**
   * Pays exactly what the server's instructions say.
   * @param {import("../../application/ports/WalletConnector.contract.js").TransferRequest} request
   */
  async requestTransfer(request) {
    const paid = await this.#api.transfer(request);
    if (paid.ok) {
      return paid;
    }
    const { code, message, details } = paid.error;
    // Sent already (a second tap, a reload): the payment is on its way.
    const txId = /** @type {any} */ (details)?.txId;
    if (code === ALREADY_PAID && typeof txId === "string" && TX_ID_PATTERN.test(txId)) {
      return ok(txId);
    }
    if (UNCERTAIN.includes(code)) {
      return fail(WalletFailure.TIMEOUT, "the network did not confirm the payment, but it may still go through: wait for it before paying again");
    }
    return fail(WalletFailure.REJECTED, code === "TRANSFER_REJECTED" ? `the chain refused the payment: ${message}` : message);
  }

  /**
   * Publishes a ping from the player's account.
   * @param {import("../../application/ports/WalletConnector.contract.js").CommentRequest} request
   */
  async postComment({ author: _author, ...comment }) {
    return this.#api.ping(comment);
  }
}
