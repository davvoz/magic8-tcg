/**
 * Decks module: users' decks, validated against the rules and ownership.
 * Other modules use only what is exported here.
 */
export { DeckService } from "./application/DeckService.js";
export { PgDeckRepository } from "./infrastructure/PgDeckRepository.js";
export { registerDeckRoutes } from "./http/deckRoutes.js";
