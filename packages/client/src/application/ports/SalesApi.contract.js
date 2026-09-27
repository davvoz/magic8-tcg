/**
 * The public board where players sell copies to each other
 * (docs/tcg/14-vendite.md), as the server runs it. Prices, payment
 * instructions and every status come from the server; the client never
 * computes an amount or a recipient. The payment goes from the buyer's
 * wallet straight to the seller's account.
 *
 * @typedef {Readonly<{ asset: string, amount: string }>} Price amount as a decimal string ("1.500")
 * @typedef {Readonly<{ id: string, definitionId: string, edition: string, serial: number }>} ListedCard
 * @typedef {Readonly<{
 *   id: string, status: "ACTIVE" | "SOLD" | "CANCELLED" | "EXPIRED", seller: string, card: ListedCard, price: Price,
 *   reserved: boolean, buyer: string | null, createdAt: number, expiresAt: number, closedAt: number | null,
 * }>} Listing `reserved`: someone is paying for it now; `buyer`: who bought it, once sold
 * @typedef {Readonly<{ listings: readonly Listing[], total: number, offset: number, pageSize: number }>} BoardPage
 * @typedef {Readonly<{ network: string, from: string, to: string, asset: string, amount: string, memo: string, expiresAt: number }>} PaymentInstructions
 * @typedef {Readonly<{
 *   id: string, listingId: string, status: "PENDING" | "DETECTED" | "COMPLETED" | "EXPIRED" | "CANCELLED", seller: string, card: ListedCard, price: Price,
 *   payment: PaymentInstructions | null, txId: string | null, problem: string | null, createdAt: number, expiresAt: number, closedAt: number | null,
 * }>} Purchase `payment`: only while it can be paid; `problem`: why a transfer with its memo did not pay it
 * @typedef {Readonly<{ listings: readonly Listing[], purchases: readonly Purchase[] }>} Activity
 * @typedef {Readonly<{ card?: string, seller?: string, sort?: "newest" | "cheapest", offset?: number }>} BoardQuery `card`: one card id, or several comma-separated
 *
 * @typedef {import("@magic8/engine/shared/Result.js").Fail} Fail
 * @typedef {import("@magic8/engine/shared/Result.js").Ok<Listing> | Fail} ListingResult
 * @typedef {import("@magic8/engine/shared/Result.js").Ok<Purchase> | Fail} PurchaseResult
 * @typedef {object} SalesApi
 * @property {(query: BoardQuery) => Promise<import("@magic8/engine/shared/Result.js").Ok<BoardPage> | Fail>} board public
 * @property {() => Promise<import("@magic8/engine/shared/Result.js").Ok<Activity> | Fail>} mine
 * @property {(request: { copy: string, price: string, asset: string, idempotencyKey: string }) => Promise<ListingResult>} list
 * @property {(listingId: string) => Promise<ListingResult>} cancelListing
 * @property {(listingId: string) => Promise<PurchaseResult>} buy reserves the listing; answers with the payment instructions
 * @property {(purchaseId: string) => Promise<PurchaseResult>} purchase
 * @property {(purchaseId: string, txId: string) => Promise<PurchaseResult>} paymentHint
 * @property {(purchaseId: string) => Promise<PurchaseResult>} release gives up an unpaid purchase
 */

export const ListingStatus = Object.freeze({ ACTIVE: "ACTIVE", SOLD: "SOLD", CANCELLED: "CANCELLED", EXPIRED: "EXPIRED" });
export const SalePurchaseStatus = Object.freeze({ PENDING: "PENDING", DETECTED: "DETECTED", COMPLETED: "COMPLETED", EXPIRED: "EXPIRED", CANCELLED: "CANCELLED" });

export const SALES_API_METHODS = Object.freeze(["board", "mine", "list", "cancelListing", "buy", "purchase", "paymentHint", "release"]);
