/**
 * What makes a user's deck acceptable (docs/tcg/01-architettura.md §3, Decks):
 *
 * - to be saved, a deck must be well formed (the engine's structural
 *   validation) and use only cards the user owns, in the counts they own;
 * - to be playable it must also satisfy the deck rules (size, copies,
 *   card types). An unfinished deck can be saved as a draft; matchmaking
 *   accepts only playable decks.
 *
 * Ownership can change after saving (future trading), so playability is
 * evaluated again whenever a deck is read or used, never stored.
 */
import { validateDeck } from "@magic8/engine/domain/decks/DeckValidator.js";
import { validateDeckList } from "@magic8/engine/domain/decks/validateDeckList.js";
import { fail, ok } from "@magic8/engine/shared/Result.js";

export const NOT_OWNED = "NOT_OWNED";
/** Placeholder id for structural validation: stored decks are identified by UUID. */
const DRAFT_ID = "draft";

/**
 * @typedef {Readonly<{ name: string, entries: readonly Readonly<{ cardId: string, count: number }>[] }>} DeckDraft
 * @typedef {Readonly<{ playable: boolean, problems: readonly Readonly<{ code: string, message: string, cardId: string | null }>[] }>} DeckEvaluation
 */

/**
 * @param {{ name: unknown, cards: unknown }} input
 * @param {import("@magic8/engine/domain/decks/DeckRules.js").DeckRules} rules
 * @returns {import("@magic8/engine/shared/Result.js").Ok<DeckDraft> | import("@magic8/engine/shared/Result.js").Fail}
 */
export function parseDeckDraft({ name, cards }, rules) {
  const trimmed = typeof name === "string" ? name.trim() : name;
  const list = validateDeckList({ id: DRAFT_ID, name: trimmed, cards }, { requireSchemaVersion: false });
  if (!list.ok) {
    return list;
  }
  if (list.value.name.length === 0 || list.value.name.length > rules.deckNameMaxLength) {
    return fail("VALIDATION", `deck name must be 1 to ${rules.deckNameMaxLength} characters`);
  }
  if (list.value.totalCards > rules.maxSize) {
    return fail("VALIDATION", `a deck holds at most ${rules.maxSize} cards`);
  }
  return ok(Object.freeze({ name: list.value.name, entries: list.value.entries }));
}

/**
 * Cards the draft uses beyond what the user owns.
 * @param {DeckDraft} draft
 * @param {ReadonlyMap<string, number>} owned active copies per card
 * @returns {readonly Readonly<{ cardId: string, needed: number, owned: number }>[]}
 */
export function missingCards(draft, owned) {
  return Object.freeze(
    draft.entries
      .filter((entry) => entry.count > (owned.get(entry.cardId) ?? 0))
      .map((entry) => Object.freeze({ cardId: entry.cardId, needed: entry.count, owned: owned.get(entry.cardId) ?? 0 })),
  );
}

/**
 * @param {DeckDraft} draft
 * @param {import("@magic8/engine/domain/content/GameContent.js").GameContent} content
 * @param {ReadonlyMap<string, number>} owned
 * @returns {DeckEvaluation}
 */
export function evaluateDeck(draft, content, owned) {
  const deckList = toDeckList(draft);
  const report = validateDeck(deckList, content.deckRules, content.catalog);
  const ownership = missingCards(draft, owned).map((missing) => Object.freeze({ code: NOT_OWNED, message: `you own ${missing.owned} of the ${missing.needed} copies`, cardId: missing.cardId }));
  const problems = Object.freeze([...report.problems, ...ownership]);
  return Object.freeze({ playable: problems.length === 0, problems });
}

/**
 * The engine's view of a stored deck (e.g. to start a game with it).
 * @param {DeckDraft} draft
 */
export function toDeckList(draft) {
  const result = validateDeckList({ id: DRAFT_ID, name: draft.name, cards: draft.entries }, { requireSchemaVersion: false });
  if (!result.ok) {
    throw new TypeError(`toDeckList: a stored deck is not a valid deck list: ${result.error.message}`);
  }
  return result.value;
}
