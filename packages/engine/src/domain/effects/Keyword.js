/** Static keyword abilities. Each keyword is interpreted by exactly one engine system. */
export const Keyword = Object.freeze({
  /** May attack the turn it enters the battlefield. Interpreted by CombatSystem. */
  HASTE: "haste",
});

export const KEYWORDS = Object.freeze(Object.values(Keyword));
