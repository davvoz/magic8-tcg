/**
 * The AI's own decks (data/decks/ai/): what the daily challenges'
 * characters and the practice AI sit down with. They are deck-list files
 * like the preconstructed ones, kept apart from them because a
 * preconstructed deck is also a player's (the free starter, offline
 * practice, the shop's decks), and the AI's decks may hold cards a new
 * player should not get for free. Each one must be legal and its id
 * distinct from every other deck's, preconstructed ones included.
 */
import { fail, ok } from "../../shared/Result.js";
import { validateDeck } from "../decks/DeckValidator.js";
import { validateDeckList } from "../decks/validateDeckList.js";
import { ContentError } from "./GameContent.js";

/** More than the roster and the practice AI could ever use. */
const MAX_AI_DECKS = 64;

/**
 * @param {unknown} rawDecks the deck-list files, in file name order
 * @param {import("./GameContent.js").GameContent} content
 * @returns {import("../../shared/Result.js").Ok<readonly import("../decks/DeckList.js").DeckList[]> | import("../../shared/Result.js").Fail}
 */
export function buildAiDecks(rawDecks, content) {
  if (!Array.isArray(rawDecks) || rawDecks.length > MAX_AI_DECKS) {
    return fail(ContentError.INVALID, `aiDecks must be an array of at most ${MAX_AI_DECKS}`);
  }
  const ids = new Set(content.preconDecks.map((deck) => deck.id));
  const decks = [];
  for (const [index, rawDeck] of rawDecks.entries()) {
    const list = validateDeckList(rawDeck);
    if (!list.ok) {
      return fail(ContentError.INVALID, `aiDecks[${index}]: ${list.error.message}`, list.error.details);
    }
    if (ids.has(list.value.id)) {
      return fail(ContentError.INVALID, `aiDecks[${index}] (${list.value.id}): another deck has this id`);
    }
    const report = validateDeck(list.value, content.deckRules, content.catalog);
    if (!report.valid) {
      return fail(ContentError.INVALID, `aiDecks[${index}] (${list.value.id}) breaks deck rules: ${report.problems[0].message}`, { problems: report.problems });
    }
    ids.add(list.value.id);
    decks.push(list.value);
  }
  return ok(Object.freeze(decks));
}
