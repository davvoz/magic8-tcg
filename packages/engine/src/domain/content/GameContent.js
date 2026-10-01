/**
 * Validates a raw content bundle (card sets, preconstructed decks, game and
 * deck rules — plain JSON, from files or the network) into the immutable
 * GameContent every consumer depends on: the browser client, the game
 * server and the replay verifier all build it here, the same way.
 * Content must be fully valid: a single bad card or an illegal
 * preconstructed deck fails the build, with a path-qualified reason.
 */
import { fail, ok } from "../../shared/Result.js";
import { CardCatalog } from "../cards/CardCatalog.js";
import { validateCardSet } from "../cards/validateCardDefinition.js";
import { validateDeckRules } from "../decks/DeckRules.js";
import { validateDeck } from "../decks/DeckValidator.js";
import { validateDeckList } from "../decks/validateDeckList.js";
import { validateGameRules } from "../game/GameRules.js";

export const ContentError = Object.freeze({
  LOAD_FAILED: "CONTENT_LOAD_FAILED",
  INVALID: "CONTENT_INVALID",
});

/** The parts of a raw bundle, as named in files and on the wire. */
export const ContentResource = Object.freeze({
  /** Array of card-set files. */
  CARD_SETS: "cardSets",
  /** Array of deck-list files. */
  PRECON_DECKS: "preconDecks",
  GAME_RULES: "gameRules",
  DECK_RULES: "deckRules",
});

/**
 * @typedef {Readonly<{ cardSets: unknown, preconDecks: unknown, gameRules: unknown, deckRules: unknown }>} RawContent
 * @typedef {Readonly<{
 *   catalog: CardCatalog,
 *   gameRules: import("../game/GameRules.js").GameRules,
 *   deckRules: import("../decks/DeckRules.js").DeckRules,
 *   preconDecks: readonly import("../decks/DeckList.js").DeckList[],
 * }>} GameContent
 */

/**
 * @param {RawContent} raw
 * @param {import("../effects/EffectRegistry.js").EffectRegistry} effects
 * @returns {import("../../shared/Result.js").Ok<GameContent> | import("../../shared/Result.js").Fail}
 */
export function buildGameContent(raw, effects) {
  const deckRules = validateDeckRules(raw.deckRules);
  const gameRules = validateGameRules(raw.gameRules);
  if (!deckRules.ok) {
    return invalid("rules", deckRules);
  }
  if (!gameRules.ok) {
    return invalid("rules", gameRules);
  }
  const catalog = buildCatalog(raw.cardSets, { factions: deckRules.value.factions, effects });
  if (!catalog.ok) {
    return catalog;
  }
  const preconDecks = buildPreconDecks(raw.preconDecks, deckRules.value, catalog.value);
  if (!preconDecks.ok) {
    return preconDecks;
  }
  return ok(Object.freeze({ catalog: catalog.value, gameRules: gameRules.value, deckRules: deckRules.value, preconDecks: preconDecks.value }));
}

/**
 * @param {unknown} rawSets
 * @param {import("../cards/validateCardDefinition.js").CardValidationContext} context
 */
function buildCatalog(rawSets, context) {
  if (!Array.isArray(rawSets) || rawSets.length === 0) {
    return fail(ContentError.INVALID, "cardSets must be a non-empty array");
  }
  const definitions = [];
  for (const [index, rawSet] of rawSets.entries()) {
    const set = validateCardSet(rawSet, context);
    if (!set.ok) {
      return invalid(`cardSets[${index}]`, set);
    }
    definitions.push(...set.value);
  }
  const catalog = CardCatalog.fromDefinitions(definitions);
  return catalog.ok ? catalog : invalid("cardSets", catalog);
}

/**
 * @param {unknown} rawDecks
 * @param {import("../decks/DeckRules.js").DeckRules} deckRules
 * @param {CardCatalog} catalog
 */
function buildPreconDecks(rawDecks, deckRules, catalog) {
  if (!Array.isArray(rawDecks) || rawDecks.length === 0) {
    return fail(ContentError.INVALID, "preconDecks must be a non-empty array");
  }
  const decks = [];
  for (const [index, rawDeck] of rawDecks.entries()) {
    const list = validateDeckList(rawDeck);
    if (!list.ok) {
      return invalid(`preconDecks[${index}]`, list);
    }
    if (!list.value.preconstructed) {
      return fail(ContentError.INVALID, `preconDecks[${index}] (${list.value.id}) is not flagged preconstructed`);
    }
    const report = validateDeck(list.value, deckRules, catalog);
    if (!report.valid) {
      return fail(ContentError.INVALID, `preconDecks[${index}] (${list.value.id}) breaks deck rules: ${report.problems[0].message}`, { problems: report.problems });
    }
    decks.push(list.value);
  }
  return ok(Object.freeze(decks));
}

/**
 * @param {string} where
 * @param {import("../../shared/Result.js").Fail} failure
 */
function invalid(where, failure) {
  return fail(ContentError.INVALID, `${where}: ${failure.error.message}`, failure.error.details);
}
