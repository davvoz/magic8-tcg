/**
 * Placeholder strip for a card id missing from the catalog (content changed
 * since a deck was saved, or the server knows a card this client does not);
 * lists draw it in the danger colour.
 * @param {string} cardId
 * @returns {import("./CardStrip.js").StripCard}
 */
export function unknownCard(cardId) {
  return Object.freeze({ name: `${cardId} (unknown card)`, type: "unknown", faction: "unknown", cost: 0, attack: 0, health: 0, keywords: Object.freeze([]) });
}
