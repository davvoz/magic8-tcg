/**
 * The server's marketplace API as the client application sees it. Prices,
 * payment instructions and the cards received all come from the server;
 * the client never computes an amount or a recipient.
 *
 * @typedef {Readonly<{ asset: string, amount: string }>} Price amount as a decimal string ("1.000")
 * @typedef {Readonly<{ type: string, ref: string, count: number, finish: string | null }>} ProductContent
 * @typedef {Readonly<{ id: string, kind: string, name: string, description: string, prices: readonly Price[], contents: readonly ProductContent[], rarity: string | null, cards: number, perOrder: number }>} Product `rarity`: of a product that is one card
 * @typedef {Readonly<{ numerator: number, denominator: number }>} Chance
 * @typedef {Readonly<{ id: string, hash: string, size: number, slots: readonly Readonly<{ count: number, odds: Readonly<Record<string, Chance>> }>[], foil: Chance }>} DropTable
 * @typedef {Readonly<{ rarity: string, standard: string, foil: string | null }>} RarityPrice what a single card costs, by finish
 * @typedef {Readonly<{ asset: string, singles: readonly RarityPrice[] }>} PriceList
 * @typedef {Readonly<{ products: readonly Product[], dropTables: readonly DropTable[], rarities: readonly string[], priceList: PriceList }>} Listing `rarities`: commonest first
 * @typedef {Readonly<{ network: string, from: string, to: string, asset: string, amount: string, memo: string, expiresAt: number }>} PaymentInstructions
 * @typedef {Readonly<{ id: string, definitionId: string, edition: string, serial: number, finish: string }>} ReceivedCard
 * @typedef {Readonly<{ txId: string | null, cards: readonly ReceivedCard[], packs: readonly Readonly<{ index: number, cards: readonly ReceivedCard[] }>[] }>} Fulfilment
 * @typedef {Readonly<{
 *   id: string, status: string, items: readonly Readonly<{ productId: string, name: string, quantity: number, unitAmount: string }>[],
 *   total: Price, payment: PaymentInstructions | null, failureReason: string | null, createdAt: number, fulfilment: Fulfilment | null,
 * }>} Order
 *
 * @typedef {import("@magic8/engine/shared/Result.js").Fail} Fail
 * @typedef {object} MarketApi
 * @property {() => Promise<import("@magic8/engine/shared/Result.js").Ok<Listing> | Fail>} listing
 * @property {(request: { productId: string, quantity: number, asset: string }, idempotencyKey: string) => Promise<import("@magic8/engine/shared/Result.js").Ok<Order> | Fail>} createOrder
 * @property {(orderId: string) => Promise<import("@magic8/engine/shared/Result.js").Ok<Order> | Fail>} getOrder
 * @property {() => Promise<import("@magic8/engine/shared/Result.js").Ok<readonly Order[]> | Fail>} listOrders
 * @property {(orderId: string) => Promise<import("@magic8/engine/shared/Result.js").Ok<Order> | Fail>} cancelOrder
 * @property {(orderId: string, txId: string) => Promise<import("@magic8/engine/shared/Result.js").Ok<Order> | Fail>} paymentHint
 */

export const OrderStatus = Object.freeze({
  CREATED: "CREATED",
  PAYMENT_PENDING: "PAYMENT_PENDING",
  PAYMENT_DETECTED: "PAYMENT_DETECTED",
  PAYMENT_VERIFIED: "PAYMENT_VERIFIED",
  FULFILLED: "FULFILLED",
  FAILED: "FAILED",
  EXPIRED: "EXPIRED",
  CANCELLED: "CANCELLED",
});

export const MARKET_API_METHODS = Object.freeze(["listing", "createOrder", "getOrder", "listOrders", "cancelOrder", "paymentHint"]);
