/**
 * TradingApi over the game server's HTTP API, with every response checked
 * for the shape the application relies on.
 */
import { fail, ok } from "@magic8/engine/shared/Result.js";
import { ApiFailure } from "../../application/ports/AuthApi.contract.js";
import { HttpJsonTransport } from "./HttpJsonTransport.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CARD_ID = /^[a-z0-9_]{1,64}$/;
const STATUSES = Object.freeze(["OPEN", "ACCEPTED", "DECLINED", "CANCELLED", "EXPIRED"]);
const isCount = (value) => Number.isSafeInteger(value) && value >= 0;
const isAccount = (value) => typeof value === "string" && /^[a-z0-9.-]{1,32}$/.test(value);

/** @param {any} value */
const copy = (value) =>
  typeof value?.id === "string" && UUID.test(value.id) && typeof value.definitionId === "string" && CARD_ID.test(value.definitionId) && isCount(value.serial)
    ? Object.freeze({ id: value.id, definitionId: value.definitionId, serial: value.serial })
    : null;

/** @param {any} value */
const want = (value) => (typeof value?.definitionId === "string" && CARD_ID.test(value.definitionId) && isCount(value.count) ? Object.freeze({ definitionId: value.definitionId, count: value.count }) : null);

/** @param {unknown} value @param {(item: any) => any} parse */
function listOf(value, parse) {
  const items = Array.isArray(value) ? value.map(parse) : null;
  return items === null || items.includes(null) ? null : Object.freeze(items);
}

/** @param {any} value */
const hasTradeFields = (value) =>
  typeof value?.id === "string" && UUID.test(value.id) && STATUSES.includes(value.status) && (value.role === "proposer" || value.role === "counterparty") && isAccount(value.proposer) && isAccount(value.counterparty) && isCount(value.createdAt) && isCount(value.expiresAt) && (value.closedAt === null || isCount(value.closedAt));

/**
 * @param {any} value
 * @returns {import("../../application/ports/TradingApi.contract.js").Trade | null}
 */
function trade(value) {
  const give = listOf(value?.give, copy);
  const take = listOf(value?.take, copy);
  const wants = listOf(value?.wants, want);
  if (!hasTradeFields(value) || give === null || take === null || wants === null) {
    return null;
  }
  const { id, status, role, proposer, counterparty, createdAt, expiresAt, closedAt } = value;
  return Object.freeze({ id, status, role, proposer, counterparty, give, wants, take, createdAt, expiresAt, closedAt });
}

const badResponse = () => fail(ApiFailure.BAD_RESPONSE, "the game server sent an unexpected response");

export class HttpTradingApi {
  #transport;

  /** @param {ConstructorParameters<typeof HttpJsonTransport>[0]} deps */
  constructor(deps) {
    this.#transport = new HttpJsonTransport(deps);
  }

  async list() {
    const response = await this.#transport.request("GET", "/api/trades");
    if (!response.ok) {
      return response;
    }
    const trades = listOf(/** @type {any} */ (response.value)?.trades, trade);
    return trades === null ? badResponse() : ok(trades);
  }

  /** @param {string} account */
  async tradeableOf(account) {
    const response = await this.#transport.request("GET", `/api/trades/tradeable/${encodeURIComponent(account)}`);
    if (!response.ok) {
      return response;
    }
    const cards = listOf(/** @type {any} */ (response.value)?.cards, want);
    return cards === null ? badResponse() : ok(cards);
  }

  /** @param {{ to: string, give: readonly string[], want: readonly { definitionId: string, count: number }[], idempotencyKey: string }} offer */
  async propose({ to, give, want: wanted, idempotencyKey }) {
    return this.#one(await this.#transport.request("POST", "/api/trades", { body: { to, give, want: wanted }, headers: { "Idempotency-Key": idempotencyKey } }));
  }

  /** @param {string} tradeId */
  async accept(tradeId) {
    return this.#one(await this.#transport.request("POST", `/api/trades/${encodeURIComponent(tradeId)}/accept`, { body: {} }));
  }

  /** @param {string} tradeId */
  async decline(tradeId) {
    return this.#one(await this.#transport.request("POST", `/api/trades/${encodeURIComponent(tradeId)}/decline`, { body: {} }));
  }

  /** @param {string} tradeId */
  async cancel(tradeId) {
    return this.#one(await this.#transport.request("POST", `/api/trades/${encodeURIComponent(tradeId)}/cancel`, { body: {} }));
  }

  /** @param {any} response */
  #one(response) {
    if (!response.ok) {
      return response;
    }
    const parsed = trade(response.value?.trade);
    return parsed === null ? badResponse() : ok(parsed);
  }
}
