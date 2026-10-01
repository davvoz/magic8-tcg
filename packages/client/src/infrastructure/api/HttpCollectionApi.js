/**
 * CollectionApi over the game server's HTTP API. Every response is checked
 * for the shape the application relies on before it gets there: a server
 * bug or a hostile proxy produces BAD_RESPONSE, not a broken screen.
 */
import { fail, ok } from "@magic8/engine/shared/Result.js";
import { ApiFailure } from "../../application/ports/AuthApi.contract.js";
import { HttpJsonTransport } from "./HttpJsonTransport.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isString = (value) => typeof value === "string";
const isCount = (value) => Number.isSafeInteger(value) && value > 0;

/** @param {unknown} value */
function entries(value) {
  if (!Array.isArray(value) || !value.every((entry) => isObject(entry) && isString(entry.cardId) && isCount(entry.count))) {
    return null;
  }
  return Object.freeze(value.map((entry) => Object.freeze({ cardId: entry.cardId, count: entry.count })));
}

/**
 * @param {unknown} value
 * @returns {import("../../application/ports/CollectionApi.contract.js").AccountDeck | null}
 */
function accountDeck(value) {
  if (!isObject(value)) {
    return null;
  }
  const deck = /** @type {any} */ (value);
  const cards = entries(deck.cards);
  const problems = Array.isArray(deck.problems) && deck.problems.every((problem) => isObject(problem) && isString(problem.code) && isString(problem.message)) ? deck.problems : null;
  if (!UUID_PATTERN.test(deck.id) || !isString(deck.name) || cards === null || !isCount(deck.version) || typeof deck.playable !== "boolean" || problems === null) {
    return null;
  }
  return Object.freeze({
    id: deck.id,
    name: deck.name,
    cards,
    version: deck.version,
    playable: deck.playable,
    problems: Object.freeze(problems.map((problem) => Object.freeze({ code: problem.code, message: problem.message, cardId: isString(problem.cardId) ? problem.cardId : null }))),
  });
}

/** @param {unknown} value */
function starterChoice(value) {
  if (!isObject(value)) {
    return null;
  }
  const choice = /** @type {any} */ (value);
  const cards = entries(choice.cards);
  if (!isString(choice.id) || !isString(choice.name) || !isCount(choice.size) || cards === null) {
    return null;
  }
  return Object.freeze({ id: choice.id, name: choice.name, size: choice.size, cards });
}

/** @param {unknown} value */
function collectionEntry(value) {
  if (!isObject(value)) {
    return null;
  }
  const entry = /** @type {any} */ (value);
  const copies = Array.isArray(entry.copies) && entry.copies.every((copy) => isObject(copy) && UUID_PATTERN.test(copy.id) && isString(copy.edition) && isCount(copy.serial) && isString(copy.status)) ? entry.copies : null;
  if (!isString(entry.definitionId) || copies === null) {
    return null;
  }
  return Object.freeze({ definitionId: entry.definitionId, copies: Object.freeze(copies.map((copy) => Object.freeze({ id: copy.id, edition: copy.edition, serial: copy.serial, status: copy.status, tradeable: copy.tradeable === true }))) });
}

/**
 * @template T
 * @param {unknown[] | unknown} values
 * @param {(value: unknown) => T | null} parse
 * @returns {readonly T[] | null}
 */
function all(values, parse) {
  if (!Array.isArray(values)) {
    return null;
  }
  const parsed = values.map(parse);
  return parsed.every((item) => item !== null) ? Object.freeze(/** @type {T[]} */ (parsed)) : null;
}

/**
 * @template T
 * @param {T | null} value
 */
const shaped = (value) => (value === null ? fail(ApiFailure.BAD_RESPONSE, "unexpected response from the game server") : ok(value));

export class HttpCollectionApi {
  #transport;

  /**
   * @param {{ fetch: typeof fetch, base?: string }} deps
   */
  constructor(deps) {
    this.#transport = new HttpJsonTransport(deps);
  }

  async starter() {
    const response = await this.#transport.request("GET", "/api/starter");
    if (!response.ok) {
      return response;
    }
    const body = /** @type {any} */ (response.value);
    const choices = all(body?.choices, starterChoice);
    return shaped(typeof body?.claimed === "boolean" && choices !== null ? Object.freeze({ claimed: body.claimed, choices }) : null);
  }

  /** @param {string} starterId */
  async claimStarter(starterId) {
    const response = await this.#transport.request("POST", "/api/starter", { body: { starterId } });
    if (!response.ok) {
      return response;
    }
    const body = /** @type {any} */ (response.value);
    const deck = accountDeck(body?.deck);
    return shaped(deck !== null && isCount(body?.cardsGranted) ? Object.freeze({ deck, cardsGranted: body.cardsGranted }) : null);
  }

  async collection() {
    const response = await this.#transport.request("GET", "/api/collection");
    return response.ok ? shaped(all(/** @type {any} */ (response.value)?.cards, collectionEntry)) : response;
  }

  async listDecks() {
    const response = await this.#transport.request("GET", "/api/decks");
    return response.ok ? shaped(all(/** @type {any} */ (response.value)?.decks, accountDeck)) : response;
  }

  /** @param {import("../../application/ports/CollectionApi.contract.js").DeckInput} input */
  async createDeck(input) {
    const response = await this.#transport.request("POST", "/api/decks", { body: input });
    return response.ok ? shaped(accountDeck(/** @type {any} */ (response.value)?.deck)) : response;
  }

  /**
   * @param {string} id
   * @param {number} version
   * @param {import("../../application/ports/CollectionApi.contract.js").DeckInput} input
   */
  async updateDeck(id, version, input) {
    if (!UUID_PATTERN.test(id)) {
      return fail(ApiFailure.BAD_RESPONSE, "not a server deck id");
    }
    const response = await this.#transport.request("PUT", `/api/decks/${id}`, { body: input, headers: { "If-Match": `"${version}"` } });
    return response.ok ? shaped(accountDeck(/** @type {any} */ (response.value)?.deck)) : response;
  }

  /** @param {string} id */
  async deleteDeck(id) {
    if (!UUID_PATTERN.test(id)) {
      return fail(ApiFailure.BAD_RESPONSE, "not a server deck id");
    }
    const response = await this.#transport.request("DELETE", `/api/decks/${id}`);
    return response.ok ? ok(null) : response;
  }
}
