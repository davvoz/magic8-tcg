/**
 * HTTP surface of the decks module (docs/tcg/02-protocollo-multiplayer.md §2).
 * A deck's version travels as its ETag; PUT requires If-Match with it.
 */
import { checkArray, checkString } from "@magic8/engine/shared/validation.js";
import { AppError } from "../../../kernel/AppError.js";
import { Auth } from "../../../platform/http/Router.js";
import { validated } from "../../../platform/http/validateBody.js";

const DECK_KEYS = Object.freeze(["name", "cards"]);
const MAX_ENTRIES = 200;
const READ_RATE = Object.freeze({ name: "decks-read", capacity: 60, refillPerSecond: 1, by: /** @type {const} */ ("user") });
const WRITE_RATE = Object.freeze({ name: "decks-write", capacity: 30, refillPerSecond: 0.5, by: /** @type {const} */ ("user") });
const ETAG_PATTERN = /^(?:W\/)?"(\d{1,9})"$/;

/** @param {unknown} body */
function deckInput(body) {
  return validated(body, DECK_KEYS, (issues, object) => {
    checkString(issues, object.name, "body.name", { minLength: 1, maxLength: 64 });
    // Entries are validated by the engine's deck-list validation in DeckService.
    checkArray(issues, object.cards, "body.cards", { maxLength: MAX_ENTRIES });
  });
}

/** @param {{ version: number }} deck */
const etag = (deck) => ({ ETag: `"${deck.version}"` });

/**
 * @param {string | null} header
 * @returns {number}
 */
function expectedVersion(header) {
  if (header === null) {
    throw new AppError("PRECONDITION_REQUIRED", "send If-Match with the version you edited");
  }
  const match = ETAG_PATTERN.exec(header.trim());
  if (match === null) {
    throw new AppError("VALIDATION", "If-Match must be the deck's ETag");
  }
  return Number(match[1]);
}

/**
 * @param {{ router: import("../../../platform/http/Router.js").Router, decks: import("../application/DeckService.js").DeckService }} deps
 */
export function registerDeckRoutes({ router, decks }) {
  router.add({
    method: "GET",
    path: "/api/decks",
    auth: Auth.REQUIRED,
    rateLimit: READ_RATE,
    handler: async (context) => ({ status: 200, body: await decks.list(context.principal.user.id) }),
  });

  router.add({
    method: "POST",
    path: "/api/decks",
    auth: Auth.REQUIRED,
    rateLimit: WRITE_RATE,
    handler: async (context) => {
      const input = deckInput(await context.readJson());
      const deck = await decks.create(context.principal.user.id, { name: input.name, cards: input.cards });
      return { status: 201, body: { deck }, headers: etag(deck) };
    },
  });

  router.add({
    method: "GET",
    path: "/api/decks/:id",
    auth: Auth.REQUIRED,
    rateLimit: READ_RATE,
    handler: async (context) => {
      const deck = await decks.get(context.principal.user.id, context.params.id);
      return { status: 200, body: { deck }, headers: etag(deck) };
    },
  });

  router.add({
    method: "PUT",
    path: "/api/decks/:id",
    auth: Auth.REQUIRED,
    rateLimit: WRITE_RATE,
    handler: async (context) => {
      const version = expectedVersion(context.header("if-match"));
      const input = deckInput(await context.readJson());
      const deck = await decks.update(context.principal.user.id, context.params.id, version, { name: input.name, cards: input.cards });
      return { status: 200, body: { deck }, headers: etag(deck) };
    },
  });

  router.add({
    method: "DELETE",
    path: "/api/decks/:id",
    auth: Auth.REQUIRED,
    rateLimit: WRITE_RATE,
    handler: async (context) => {
      await decks.remove(context.principal.user.id, context.params.id);
      return { status: 204 };
    },
  });
}
