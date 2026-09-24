/** Card types supported by the engine. Adding a type requires validator and play-handler support. */
export const CardType = Object.freeze({
  CREATURE: "creature",
  SPELL: "spell",
});

export const CARD_TYPES = Object.freeze(Object.values(CardType));
