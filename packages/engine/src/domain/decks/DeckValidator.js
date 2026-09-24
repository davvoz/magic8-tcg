/**
 * Rule-level deck validation: checks a structurally valid DeckList against
 * DeckRules and a CardCatalog and returns a report listing every problem,
 * so the deck builder can show all of them at once.
 */

export const DeckProblem = Object.freeze({
  TOO_SMALL: "TOO_SMALL",
  TOO_LARGE: "TOO_LARGE",
  TOO_MANY_COPIES: "TOO_MANY_COPIES",
  UNKNOWN_CARD: "UNKNOWN_CARD",
  TYPE_NOT_ALLOWED: "TYPE_NOT_ALLOWED",
  FACTION_MISMATCH: "FACTION_MISMATCH",
  UNKNOWN_FACTION: "UNKNOWN_FACTION",
  /** The faction exists but is the shared (neutral) pool, not something a deck can be built around. */
  NOT_A_DECK_FACTION: "NOT_A_DECK_FACTION",
  NAME_TOO_LONG: "NAME_TOO_LONG",
});

/**
 * @typedef {Readonly<{ code: string, message: string, cardId: string | null }>} DeckProblemEntry
 * @typedef {Readonly<{ valid: boolean, problems: readonly DeckProblemEntry[] }>} DeckValidationReport
 */

/**
 * @param {import("./DeckList.js").DeckList} deck
 * @param {import("./DeckRules.js").DeckRules} rules
 * @param {import("../cards/CardCatalog.js").CardCatalog} catalog
 * @returns {DeckValidationReport}
 */
export function validateDeck(deck, rules, catalog) {
  /** @type {DeckProblemEntry[]} */
  const problems = [];
  const report = (code, message, cardId = null) => problems.push(Object.freeze({ code, message, cardId }));

  checkDeckLevel(deck, rules, report);
  const scope = { deck, rules, catalog, report };
  for (const entry of deck.entries) {
    checkEntry(entry, scope);
  }
  return Object.freeze({ valid: problems.length === 0, problems: Object.freeze(problems) });
}

/**
 * @param {import("./DeckList.js").DeckList} deck
 * @param {import("./DeckRules.js").DeckRules} rules
 * @param {(code: string, message: string, cardId?: string | null) => void} report
 */
function checkDeckLevel(deck, rules, report) {
  const total = deck.totalCards;
  if (total < rules.minSize) {
    report(DeckProblem.TOO_SMALL, `deck has ${total} cards; minimum is ${rules.minSize}`);
  }
  if (total > rules.maxSize) {
    report(DeckProblem.TOO_LARGE, `deck has ${total} cards; maximum is ${rules.maxSize}`);
  }
  if (deck.name.length > rules.deckNameMaxLength) {
    report(DeckProblem.NAME_TOO_LONG, `deck name exceeds ${rules.deckNameMaxLength} characters`);
  }
  if (!rules.isKnownFaction(deck.faction)) {
    report(DeckProblem.UNKNOWN_FACTION, `unknown faction "${deck.faction}"`);
  } else if (!rules.isDeckFaction(deck.faction)) {
    report(DeckProblem.NOT_A_DECK_FACTION, `"${deck.faction}" cards are shared; a deck must belong to one of: ${rules.deckFactions.join(", ")}`);
  }
}

/**
 * @typedef {object} EntryScope
 * @property {import("./DeckList.js").DeckList} deck
 * @property {import("./DeckRules.js").DeckRules} rules
 * @property {import("../cards/CardCatalog.js").CardCatalog} catalog
 * @property {(code: string, message: string, cardId?: string | null) => void} report
 */

/**
 * @param {Readonly<{ cardId: string, count: number }>} entry
 * @param {EntryScope} scope
 */
function checkEntry(entry, { deck, rules, catalog, report }) {
  const definition = catalog.get(entry.cardId);
  if (definition === undefined) {
    report(DeckProblem.UNKNOWN_CARD, `unknown card "${entry.cardId}"`, entry.cardId);
    return;
  }
  if (entry.count > rules.maxCopies) {
    report(DeckProblem.TOO_MANY_COPIES, `${definition.name}: ${entry.count} copies; maximum is ${rules.maxCopies}`, entry.cardId);
  }
  if (!rules.allowedTypes.includes(definition.type)) {
    report(DeckProblem.TYPE_NOT_ALLOWED, `${definition.name}: type "${definition.type}" is not allowed`, entry.cardId);
  }
  if (!rules.allowsFaction(deck.faction, definition.faction)) {
    report(DeckProblem.FACTION_MISMATCH, `${definition.name}: faction "${definition.faction}" cannot go in a ${deck.faction} deck`, entry.cardId);
  }
}
