/**
 * SalesApi over the game server's HTTP API, with every response checked for
 * the shape the application relies on; anything else is BAD_RESPONSE.
 */
import { fail, ok } from "@magic8/engine/shared/Result.js";
import { ApiFailure } from "../../application/ports/AuthApi.contract.js";
import { ListingStatus, SalePurchaseStatus } from "../../application/ports/SalesApi.contract.js";
import { HttpJsonTransport } from "./HttpJsonTransport.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CARD_ID = /^[a-z0-9_]{1,64}$/;
const AMOUNT = /^\d{1,15}\.\d{1,8}$/;
const ASSET = /^[A-Z][A-Z0-9]{0,9}$/;
const MEMO = /^m8sale-[a-z2-7]{26}$/;
const TX_ID = /^[0-9a-f]{40}$/;
const LISTING_STATUSES = Object.freeze(Object.values(ListingStatus));
const PURCHASE_STATUSES = Object.freeze(Object.values(SalePurchaseStatus));

const isTime = (value) => Number.isSafeInteger(value) && value >= 0;
const isAccount = (value) => typeof value === "string" && /^[a-z][a-z0-9.-]{2,15}$/.test(value);
const isId = (value) => typeof value === "string" && UUID.test(value);
const isTxId = (value) => typeof value === "string" && TX_ID.test(value);
const isProblem = (value) => typeof value === "string" && /^[A-Z_]{1,32}$/.test(value);
const isAmount = (asset, amount) => typeof asset === "string" && ASSET.test(asset) && typeof amount === "string" && AMOUNT.test(amount);
/** @param {any} value */
const hasTimes = (value) => isTime(value.createdAt) && isTime(value.expiresAt) && (value.closedAt === null || isTime(value.closedAt));

/** @param {any} value */
const price = (value) => (isAmount(value?.asset, value?.amount) ? Object.freeze({ asset: value.asset, amount: value.amount }) : null);

/** @param {any} value */
function card(value) {
  const valid = typeof value?.id === "string" && UUID.test(value.id) && typeof value.definitionId === "string" && CARD_ID.test(value.definitionId) && typeof value.edition === "string" && Number.isSafeInteger(value.serial) && value.serial > 0;
  return valid ? Object.freeze({ id: value.id, definitionId: value.definitionId, edition: value.edition, serial: value.serial }) : null;
}

/** @param {any} value the fields of a listing besides its card and price */
const hasListingFields = (value) =>
  isId(value?.id) && LISTING_STATUSES.includes(value.status) && isAccount(value.seller) && typeof value.reserved === "boolean" && (value.buyer === null || isAccount(value.buyer)) && hasTimes(value);

/**
 * @param {any} value
 * @returns {import("../../application/ports/SalesApi.contract.js").Listing | null}
 */
function listing(value) {
  const listed = card(value?.card);
  const priced = price(value?.price);
  if (!hasListingFields(value) || listed === null || priced === null) {
    return null;
  }
  const { id, status, seller, reserved, buyer, createdAt, expiresAt, closedAt } = value;
  return Object.freeze({ id, status, seller, card: listed, price: priced, reserved, buyer, createdAt, expiresAt, closedAt });
}

/** @param {any} value */
const isPayable = (value) => typeof value?.network === "string" && isAccount(value.from) && isAccount(value.to) && isAmount(value.asset, value.amount) && typeof value.memo === "string" && MEMO.test(value.memo) && isTime(value.expiresAt);

/**
 * @param {any} value
 * @returns {import("../../application/ports/SalesApi.contract.js").PaymentInstructions | null | undefined} undefined when malformed
 */
function instructions(value) {
  if (value === null) {
    return null;
  }
  return isPayable(value) ? Object.freeze({ network: value.network, from: value.from, to: value.to, asset: value.asset, amount: value.amount, memo: value.memo, expiresAt: value.expiresAt }) : undefined;
}

/** @param {any} value the fields of a purchase besides its card, price and instructions */
const hasPurchaseFields = (value) =>
  isId(value?.id) && isId(value.listingId) && PURCHASE_STATUSES.includes(value.status) && isAccount(value.seller) && (value.txId === null || isTxId(value.txId)) && (value.problem === null || isProblem(value.problem)) && hasTimes(value);

/**
 * @param {any} value
 * @returns {import("../../application/ports/SalesApi.contract.js").Purchase | null}
 */
function purchase(value) {
  const listed = card(value?.card);
  const priced = price(value?.price);
  const payment = instructions(value?.payment ?? null);
  if (!hasPurchaseFields(value) || listed === null || priced === null || payment === undefined) {
    return null;
  }
  const { id, listingId, status, seller, txId, problem, createdAt, expiresAt, closedAt } = value;
  return Object.freeze({ id, listingId, status, seller, card: listed, price: priced, payment, txId, problem, createdAt, expiresAt, closedAt });
}

/**
 * @template T
 * @param {unknown} values
 * @param {(value: any) => T | null} parse
 * @returns {readonly T[] | null}
 */
function all(values, parse) {
  const items = Array.isArray(values) ? values.map(parse) : null;
  return items === null || items.includes(null) ? null : Object.freeze(/** @type {T[]} */ (items));
}

/**
 * "?card=…&sort=…" with the filters that are set, or "".
 * @param {import("../../application/ports/SalesApi.contract.js").BoardQuery} query
 */
function queryString({ card: definitionId, seller, sort, offset }) {
  const pairs = [["card", definitionId], ["seller", seller], ["sort", sort], ["offset", offset]].filter(([, value]) => value !== undefined && value !== "");
  return pairs.length === 0 ? "" : "?" + pairs.map(([name, value]) => `${name}=${encodeURIComponent(String(value))}`).join("&");
}

const badResponse = () => fail(ApiFailure.BAD_RESPONSE, "the game server sent an unexpected response");

export class HttpSalesApi {
  #transport;

  /** @param {ConstructorParameters<typeof HttpJsonTransport>[0]} deps */
  constructor(deps) {
    this.#transport = new HttpJsonTransport(deps);
  }

  /** @param {import("../../application/ports/SalesApi.contract.js").BoardQuery} [query] */
  async board(query = {}) {
    const response = await this.#transport.request("GET", `/api/listings${queryString(query)}`);
    if (!response.ok) {
      return response;
    }
    const body = /** @type {any} */ (response.value);
    const listings = all(body?.listings, listing);
    const counts = [body?.total, body?.offset, body?.pageSize].every(isTime);
    return listings === null || !counts ? badResponse() : ok(Object.freeze({ listings, total: body.total, offset: body.offset, pageSize: body.pageSize }));
  }

  async mine() {
    const response = await this.#transport.request("GET", "/api/listings/mine");
    if (!response.ok) {
      return response;
    }
    const body = /** @type {any} */ (response.value);
    const listings = all(body?.listings, listing);
    const purchases = all(body?.purchases, purchase);
    return listings === null || purchases === null ? badResponse() : ok(Object.freeze({ listings, purchases }));
  }

  /** @param {{ copy: string, price: string, asset: string, idempotencyKey: string }} request */
  async list({ copy, price: amount, asset, idempotencyKey }) {
    return this.#listing(await this.#transport.request("POST", "/api/listings", { body: { copy, price: amount, asset }, headers: { "Idempotency-Key": idempotencyKey } }));
  }

  /** @param {string} listingId */
  async cancelListing(listingId) {
    return this.#listing(await this.#transport.request("POST", `/api/listings/${encodeURIComponent(listingId)}/cancel`, { body: {} }));
  }

  /** @param {string} listingId */
  async buy(listingId) {
    return this.#purchase(await this.#transport.request("POST", `/api/listings/${encodeURIComponent(listingId)}/buy`, { body: {} }));
  }

  /** @param {string} purchaseId */
  async purchase(purchaseId) {
    return this.#purchase(await this.#transport.request("GET", `/api/purchases/${encodeURIComponent(purchaseId)}`));
  }

  /**
   * @param {string} purchaseId
   * @param {string} txId
   */
  async paymentHint(purchaseId, txId) {
    return this.#purchase(await this.#transport.request("POST", `/api/purchases/${encodeURIComponent(purchaseId)}/payment-hint`, { body: { txId } }));
  }

  /** @param {string} purchaseId */
  async release(purchaseId) {
    return this.#purchase(await this.#transport.request("POST", `/api/purchases/${encodeURIComponent(purchaseId)}/release`, { body: {} }));
  }

  /** @param {any} response */
  #listing(response) {
    if (!response.ok) {
      return response;
    }
    const parsed = listing(response.value?.listing);
    return parsed === null ? badResponse() : ok(parsed);
  }

  /** @param {any} response */
  #purchase(response) {
    if (!response.ok) {
      return response;
    }
    const parsed = purchase(response.value?.purchase);
    return parsed === null ? badResponse() : ok(parsed);
  }
}
