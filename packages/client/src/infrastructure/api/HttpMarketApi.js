/**
 * MarketApi over the game server's HTTP API. Every response is checked for
 * the shape the application relies on; anything else is BAD_RESPONSE.
 */
import { fail, ok } from "@magic8/engine/shared/Result.js";
import { ApiFailure } from "../../application/ports/AuthApi.contract.js";
import { HttpJsonTransport } from "./HttpJsonTransport.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const AMOUNT_PATTERN = /^\d{1,15}\.\d{1,8}$/;
const TX_ID_PATTERN = /^[0-9a-f]{40}$/;

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isString = (value) => typeof value === "string";
const isCount = (value) => Number.isSafeInteger(value) && value > 0;
const isTime = (value) => Number.isSafeInteger(value) && value >= 0;

/**
 * @template T
 * @param {unknown} values
 * @param {(value: any) => T | null} parse
 * @returns {readonly T[] | null}
 */
function all(values, parse) {
  if (!Array.isArray(values)) {
    return null;
  }
  const parsed = values.map((value) => (isObject(value) ? parse(value) : null));
  return parsed.every((item) => item !== null) ? Object.freeze(/** @type {T[]} */ (parsed)) : null;
}

/** @param {any} value */
const price = (value) => (isString(value.asset) && isString(value.amount) && AMOUNT_PATTERN.test(value.amount) ? Object.freeze({ asset: value.asset, amount: value.amount }) : null);

/** @param {any} value */
function chance(value) {
  return isObject(value) && Number.isSafeInteger(value.numerator) && isCount(value.denominator) && value.numerator >= 0 && value.numerator <= value.denominator
    ? Object.freeze({ numerator: value.numerator, denominator: value.denominator })
    : null;
}

/** @param {any} value */
function product(value) {
  const prices = all(value.prices, price);
  const contents = all(value.contents, (content) =>
    isString(content.type) && isString(content.ref) && isCount(content.count) ? Object.freeze({ type: content.type, ref: content.ref, count: content.count }) : null,
  );
  const rarity = value.rarity ?? null;
  const named = ["id", "kind", "name", "description"].every((key) => isString(value[key]));
  if (!named || prices === null || contents === null || !(rarity === null || isString(rarity)) || !isCount(value.cards) || !isCount(value.limits?.perOrder)) {
    return null;
  }
  return Object.freeze({ id: value.id, kind: value.kind, name: value.name, description: value.description, prices, contents, rarity, cards: value.cards, perOrder: value.limits.perOrder });
}

/** @param {unknown} value */
function priceList(value) {
  const raw = /** @type {any} */ (value);
  const isAmount = (amount) => isString(amount) && AMOUNT_PATTERN.test(amount);
  const singles = isObject(raw) ? all(raw.singles, (entry) => (isString(entry.rarity) && isAmount(entry.price) ? Object.freeze({ rarity: entry.rarity, price: entry.price }) : null)) : null;
  return singles !== null && isString(raw.asset) ? Object.freeze({ asset: raw.asset, singles }) : null;
}

/** @param {any} value */
function dropTable(value) {
  const slots = all(value.odds, (slot) => {
    const odds = isObject(slot.odds) ? Object.entries(slot.odds).map(([rarity, odd]) => [rarity, chance(odd)]) : null;
    return isCount(slot.count) && odds !== null && odds.every(([, odd]) => odd !== null) ? Object.freeze({ count: slot.count, odds: Object.freeze(Object.fromEntries(odds)) }) : null;
  });
  if (!isString(value.id) || !isString(value.hash) || !isCount(value.size) || slots === null) {
    return null;
  }
  return Object.freeze({ id: value.id, hash: value.hash, size: value.size, slots });
}

/** @param {any} value */
function receivedCard(value) {
  return UUID_PATTERN.test(value.id) && isString(value.definitionId) && isString(value.edition) && isCount(value.serial)
    ? Object.freeze({ id: value.id, definitionId: value.definitionId, edition: value.edition, serial: value.serial })
    : null;
}

/** @param {unknown} value */
function fulfilment(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (!isObject(value)) {
    return undefined;
  }
  const raw = /** @type {any} */ (value);
  const cards = all(raw.cards, receivedCard);
  const packs = all(raw.packs, (pack) => {
    const packCards = all(pack.cards, receivedCard);
    return Number.isSafeInteger(pack.index) && packCards !== null ? Object.freeze({ index: pack.index, cards: packCards }) : null;
  });
  const txId = raw.txId === null || (isString(raw.txId) && TX_ID_PATTERN.test(raw.txId)) ? raw.txId : undefined;
  return cards === null || packs === null || txId === undefined ? undefined : Object.freeze({ txId, cards, packs });
}

/** @param {unknown} value */
function payment(value) {
  if (value === null) {
    return null;
  }
  const raw = /** @type {any} */ (value);
  const valid = isObject(raw) && ["network", "from", "to", "asset", "memo"].every((key) => isString(raw[key])) && isString(raw.amount) && AMOUNT_PATTERN.test(raw.amount) && isTime(raw.expiresAt);
  return valid ? Object.freeze({ network: raw.network, from: raw.from, to: raw.to, asset: raw.asset, amount: raw.amount, memo: raw.memo, expiresAt: raw.expiresAt }) : undefined;
}

/**
 * @param {unknown} value
 * @returns {import("../../application/ports/MarketApi.contract.js").Order | null}
 */
function order(value) {
  if (!isObject(value)) {
    return null;
  }
  const raw = /** @type {any} */ (value);
  const items = all(raw.items, (item) => (isString(item.productId) && isString(item.name) && isCount(item.quantity) && isString(item.unitAmount) ? Object.freeze({ productId: item.productId, name: item.name, quantity: item.quantity, unitAmount: item.unitAmount }) : null));
  const total = isObject(raw.total) ? price(raw.total) : null;
  const instructions = payment(raw.payment);
  const received = fulfilment(raw.fulfilment);
  if (!UUID_PATTERN.test(raw.id) || !isString(raw.status) || items === null || total === null || instructions === undefined || received === undefined || !isTime(raw.createdAt) || !(raw.failureReason === null || isString(raw.failureReason))) {
    return null;
  }
  return Object.freeze({ id: raw.id, status: raw.status, items, total, payment: instructions, failureReason: raw.failureReason, createdAt: raw.createdAt, fulfilment: received });
}

/**
 * @template T
 * @param {T | null} value
 */
const shaped = (value) => (value === null ? fail(ApiFailure.BAD_RESPONSE, "unexpected response from the game server") : ok(value));

/** @typedef {import("../../application/ports/MarketApi.contract.js").MarketApi} MarketApi */

/** @implements {MarketApi} */
export class HttpMarketApi {
  #transport;

  /** @param {{ fetch: typeof fetch, base?: string }} deps */
  constructor(deps) {
    this.#transport = new HttpJsonTransport(deps);
  }

  async listing() {
    const response = await this.#transport.request("GET", "/api/products");
    if (!response.ok) {
      return response;
    }
    const body = /** @type {any} */ (response.value);
    const products = all(body?.products, product);
    const dropTables = all(body?.dropTables, dropTable);
    const rarities = Array.isArray(body?.rarities) && body.rarities.every(isString) ? Object.freeze([...body.rarities]) : null;
    const prices = priceList(body?.priceList);
    return shaped(products !== null && dropTables !== null && rarities !== null && prices !== null ? Object.freeze({ products, dropTables, rarities, priceList: prices }) : null);
  }

  /**
   * @param {{ items: readonly Readonly<{ productId: string, quantity: number }>[], asset: string }} request
   * @param {string} idempotencyKey
   */
  async createOrder({ items, asset }, idempotencyKey) {
    const body = { items: items.map(({ productId, quantity }) => ({ productId, quantity })), asset };
    const response = await this.#transport.request("POST", "/api/orders", { body, headers: { "Idempotency-Key": idempotencyKey } });
    return response.ok ? shaped(order(/** @type {any} */ (response.value)?.order)) : response;
  }

  /** @param {string} orderId */
  async getOrder(orderId) {
    return this.#orderRequest("GET", orderId, "");
  }

  async listOrders() {
    const response = await this.#transport.request("GET", "/api/orders");
    return response.ok ? shaped(all(/** @type {any} */ (response.value)?.orders, order)) : response;
  }

  /** @param {string} orderId */
  async cancelOrder(orderId) {
    return this.#orderRequest("POST", orderId, "/cancel", {});
  }

  /**
   * @param {string} orderId
   * @param {string} txId
   */
  async paymentHint(orderId, txId) {
    return this.#orderRequest("POST", orderId, "/payment-hint", { txId });
  }

  /**
   * @param {string} method
   * @param {string} orderId
   * @param {string} suffix
   * @param {unknown} [body]
   */
  async #orderRequest(method, orderId, suffix, body) {
    if (!UUID_PATTERN.test(orderId)) {
      return fail(ApiFailure.BAD_RESPONSE, "not an order id");
    }
    const response = await this.#transport.request(method, `/api/orders/${orderId}${suffix}`, body === undefined ? {} : { body });
    return response.ok ? shaped(order(/** @type {any} */ (response.value)?.order)) : response;
  }
}
