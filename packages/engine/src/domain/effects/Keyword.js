/** Static keyword abilities. Each keyword is interpreted by exactly one engine system. */
export const Keyword = Object.freeze({
  /** May attack the turn it enters the battlefield. Interpreted by CombatSystem. */
  HASTE: "haste",
  /** When blocked, damage beyond what kills its blockers hits the defending player. Interpreted by CombatSystem. */
  TRAMPLE: "trample",
  /** Attacking does not exhaust it, so it can still block on the opponent's turn. Interpreted by DeclareAttackersHandler. */
  VIGILANCE: "vigilance",
});

export const KEYWORDS = Object.freeze(Object.values(Keyword));
