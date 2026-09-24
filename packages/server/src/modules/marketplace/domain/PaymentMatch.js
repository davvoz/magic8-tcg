/**
 * Whether a transfer pays an order (docs/tcg/05-threat-model.md T5–T7).
 * Pure: every field of the transfer must match what the order asked for;
 * anything else is a problem that sends the transfer to the refund queue.
 * The transfer's block time decides lateness, not when the watcher saw it.
 */
import { AWAITING_PAYMENT, MEMO_PATTERN } from "./Order.js";

export const MatchProblem = Object.freeze({
  NO_ORDER: "NO_ORDER",
  ORDER_NOT_PAYABLE: "ORDER_NOT_PAYABLE",
  WRONG_ASSET: "WRONG_ASSET",
  WRONG_AMOUNT: "WRONG_AMOUNT",
  WRONG_SENDER: "WRONG_SENDER",
  LATE: "LATE",
});

/**
 * @param {string} memo
 * @returns {boolean} whether the memo can be one of our order references (exact, no trimming)
 */
export const isOrderMemo = (memo) => MEMO_PATTERN.test(memo);

/**
 * @param {import("./Order.js").Order | null} order the order whose memo the transfer carries
 * @param {Readonly<{ network: string, to: string, from: string, asset: string, amount: number, time: number }>} transfer
 * @returns {string | null} a MatchProblem, or null when the transfer pays the order
 */
export function matchTransfer(order, transfer) {
  if (order === null || order.network !== transfer.network || order.receiver !== transfer.to) {
    return MatchProblem.NO_ORDER;
  }
  if (!AWAITING_PAYMENT.includes(order.status)) {
    return MatchProblem.ORDER_NOT_PAYABLE;
  }
  if (transfer.asset !== order.asset) {
    return MatchProblem.WRONG_ASSET;
  }
  if (transfer.amount !== order.totalAmount) {
    return MatchProblem.WRONG_AMOUNT;
  }
  if (transfer.from !== order.payer) {
    return MatchProblem.WRONG_SENDER;
  }
  if (transfer.time > order.expiresAt) {
    return MatchProblem.LATE;
  }
  return null;
}
