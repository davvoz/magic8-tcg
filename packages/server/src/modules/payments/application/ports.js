/**
 * Ports of the payments module.
 *
 * @typedef {import("../domain/Payment.js").Transfer} Transfer
 * @typedef {import("../domain/Payment.js").Payment} Payment
 *
 * @typedef {object} PaymentProvider one per network (STEEM: SteemTransferPaymentProvider)
 * @property {string} network
 * @property {() => readonly { asset: string, precision: number }[]} supportedAssets what it can verify
 * @property {(account: string) => Promise<number>} latestCursor where a new reader that recognises its transfer by memo starts (a sale)
 * @property {(account: string) => Promise<HistoryPosition>} latestPosition where a new watcher starts reading: nothing already in the history is read
 * @property {(receiver: string, cursor: number, limit: number, sinceBlock?: number | null) => Promise<TransferPage>} incomingTransfers oldest first; a transfer may come back (keyed by transaction and operation)
 * @property {(sender: string, cursor: number, limit: number, sinceBlock?: number | null) => Promise<TransferPage>} outgoingTransfers oldest first (refunds)
 * @property {(transfer: Transfer) => Promise<"IRREVERSIBLE" | "PENDING" | "MISSING">} confirm final only when independent nodes agree
 *
 * @typedef {Readonly<{ cursor: number, sinceBlock: number | null }>} HistoryPosition a history index, and the first block a read may still find news in (null: unknown)
 * @typedef {Readonly<{ transfers: readonly Transfer[], cursor: number, sinceBlock: number | null }>} TransferPage
 *
 * @typedef {Readonly<{ id: string, network: string, paymentId: string, toAccount: string, asset: string, amount: number, status: string, createdAt: number,
 *   transfer: Readonly<{ txId: string, opIndex: number, blockNum: number, time: number }> | null, confirmedAt: number | null }>} Refund
 *
 * @typedef {object} PaymentRepository
 * @property {(payment: Payment) => Promise<boolean>} insert false (nothing written) when that transfer was already recorded
 * @property {(network: string, txId: string, opIndex: number) => Promise<Payment | null>} findByTransfer
 * @property {(id: string) => Promise<Payment | null>} find
 * @property {(network: string, limit: number) => Promise<readonly Payment[]>} listDetected oldest block first
 * @property {(id: string, from: string, to: string, changes: { problem?: string | null, orderId?: string | null, blockNum?: number, irreversibleAt?: number }) => Promise<Payment | null>} transition compare-and-set
 * @property {(refund: { id: string, paymentId: string, toAccount: string, asset: string, amount: number, at: number }) => Promise<void>} insertRefund
 * @property {(limit: number) => Promise<readonly Refund[]>} listPendingRefunds
 * @property {(statuses: readonly string[], limit: number) => Promise<readonly Refund[]>} listRefunds oldest first
 * @property {(id: string) => Promise<Refund | null>} findRefund
 * @property {(id: string, transfer: Transfer, at: number) => Promise<Refund | null>} markRefundSent PENDING → SENT, compare-and-set
 * @property {(id: string, at: number) => Promise<Refund | null>} confirmRefund SENT → CONFIRMED
 * @property {(id: string, at: number) => Promise<Refund | null>} reopenRefund SENT → PENDING (the transfer vanished)
 * @property {(name: string) => Promise<HistoryPosition | null>} getCursor
 * @property {(name: string, network: string, position: HistoryPosition, at: number) => Promise<void>} setCursor never moves the index back
 */

export const PAYMENT_PROVIDER_METHODS = Object.freeze(["supportedAssets", "latestCursor", "latestPosition", "incomingTransfers", "outgoingTransfers", "confirm"]);
export const PAYMENT_REPOSITORY_METHODS = Object.freeze(["insert", "findByTransfer", "find", "listDetected", "transition", "insertRefund", "listPendingRefunds", "listRefunds", "findRefund", "markRefundSent", "confirmRefund", "reopenRefund", "getCursor", "setCursor"]);
