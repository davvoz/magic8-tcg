/**
 * Card-for-card trades as the server runs them (docs/tcg/13-scambi.md).
 *
 * @typedef {Readonly<{ id: string, definitionId: string, serial: number }>} TradeCopy
 * @typedef {Readonly<{ definitionId: string, count: number }>} TradeWant
 * @typedef {Readonly<{
 *   id: string, status: "OPEN" | "ACCEPTED" | "DECLINED" | "CANCELLED" | "EXPIRED", role: "proposer" | "counterparty",
 *   proposer: string, counterparty: string, give: readonly TradeCopy[], wants: readonly TradeWant[], take: readonly TradeCopy[],
 *   createdAt: number, expiresAt: number, closedAt: number | null,
 * }>} Trade give: the proposer's copies; take: the counterparty's, once accepted
 * @typedef {import("@magic8/engine/shared/Result.js").Ok<Trade> | import("@magic8/engine/shared/Result.js").Fail} TradeResult
 *
 * @typedef {object} TradingApi
 * @property {() => Promise<import("@magic8/engine/shared/Result.js").Ok<readonly Trade[]> | import("@magic8/engine/shared/Result.js").Fail>} list
 * @property {(account: string) => Promise<import("@magic8/engine/shared/Result.js").Ok<readonly TradeWant[]> | import("@magic8/engine/shared/Result.js").Fail>} tradeableOf the cards another player could give in a trade now, with how many copies
 * @property {(offer: { to: string, give: readonly string[], want: readonly TradeWant[], idempotencyKey: string }) => Promise<TradeResult>} propose
 * @property {(tradeId: string) => Promise<TradeResult>} accept
 * @property {(tradeId: string) => Promise<TradeResult>} decline
 * @property {(tradeId: string) => Promise<TradeResult>} cancel
 */

export {};
