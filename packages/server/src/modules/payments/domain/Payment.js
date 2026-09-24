/**
 * A payment: one transfer to a shop account, seen on a chain. It is counted
 * once, ever (UNIQUE (network, tx_id, op_index)), and either applied to one
 * order or queued for a refund; nothing that arrives is kept silently.
 *
 * @typedef {Readonly<{ network: string, txId: string, opIndex: number, blockNum: number, time: number, from: string, to: string, asset: string, amount: number, memo: string }>} Transfer
 * @typedef {Transfer & Readonly<{ id: string, orderId: string | null, status: string, problem: string | null, observedAt: number, irreversibleAt: number | null }>} Payment
 */

export const PaymentStatus = Object.freeze({
  /** Seen in a block, not yet irreversible. */
  DETECTED: "DETECTED",
  VERIFIED: "VERIFIED",
  /** Irreversible and applied to its order. */
  APPLIED: "APPLIED",
  /** Irreversible, pays nothing: the sender gets it back (refund queue). */
  REFUND_REQUIRED: "REFUND_REQUIRED",
  REFUNDED: "REFUNDED",
  /** Not counted: the transfer left the chain (micro-fork) or an operator dismissed it. */
  IGNORED: "IGNORED",
});

/** Why a transfer pays nothing. */
export const PaymentProblem = Object.freeze({
  NO_ORDER: "NO_ORDER",
  ORDER_NOT_PAYABLE: "ORDER_NOT_PAYABLE",
  WRONG_ASSET: "WRONG_ASSET",
  WRONG_AMOUNT: "WRONG_AMOUNT",
  WRONG_SENDER: "WRONG_SENDER",
  LATE: "LATE",
  VANISHED: "VANISHED",
});

/** Confirmation verdicts of a PaymentProvider. */
export const Confirmation = Object.freeze({ IRREVERSIBLE: "IRREVERSIBLE", PENDING: "PENDING", MISSING: "MISSING" });
